// src/fronteiras.ts
// -----------------------------------------------------------------------------
// AS FRONTEIRAS DO GLOBO — linhas, em pirâmide, uma chamada de desenho por tile.
// -----------------------------------------------------------------------------
// O QUE ESTA CAMADA SUBSTITUI
//
// A anterior mandava a coleção de POLÍGONOS inteira para `polygonsData` do
// three-globe, com o preenchimento e as laterais pintados de transparente. O
// motor triangulava e extrudava 470 feições — 1.132 anéis, 44.652 vértices —
// para que se visse apenas o contorno delas. E reenviava tudo a cada movimento
// de câmera com zoom, o que remontava toda a geometria por quadro.
//
// O que trafega agora, medido: 44 kB para o planeta inteiro no nível 0, contra
// 1.044 kB antes. Numa vista regional são 1,6 kB — e com a fonte de 10m, que é
// onze vezes mais detalhada do que a de 110m que o mapa usava em todo zoom.
//
// Uma fronteira é uma LINHA. A geometria certa para desenhar uma linha é uma
// linha, e todas as linhas de um tile cabem num único `LineSegments`: uma
// chamada de desenho por tile, contra milhares de malhas antes.
//
// -----------------------------------------------------------------------------
// A COR VIAJA NO VÉRTICE
// -----------------------------------------------------------------------------
// Costa, limite internacional e divisa estadual precisam de pesos visuais
// diferentes — senão o planeta vira uma teia cinza em que nada se destaca. Com
// um material por classe seriam três chamadas de desenho por tile; com a cor
// por vértice, continua sendo uma.
//
// A opacidade entra MULTIPLICADA na cor, e não no material. Sobre um fundo
// escuro o efeito é o mesmo, e é o que permite três pesos com um material só.
//
// -----------------------------------------------------------------------------
// A ESPESSURA DA LINHA NÃO É AJUSTÁVEL
// -----------------------------------------------------------------------------
// `linewidth` do `LineBasicMaterial` é ignorado por praticamente todo WebGL:
// a especificação permite implementar só a espessura 1, e é o que os drivers
// fazem. Desenhar linha grossa exige gerar geometria de faixa, com junções e
// pontas, e isso multiplicaria por seis a contagem de vértices para um ganho
// que este mapa não pede. A hierarquia aqui é feita com COR, não com peso.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { planoDeTiles, tilesEm, type Tile } from "./tiles.ts";
import type { JanelaVista } from "./calota.ts";
import { ORDEM } from "./ordemDesenho.ts";
import { buscarFronteiras, contarSegmentos, COSTA, PAIS, ESTADO } from "./fronteirasBin.ts";

/**
 * Peso de cada classe: [r, g, b] já multiplicado pela opacidade.
 *
 * A costa é a feição mais forte porque é a que orienta — é ela que diz onde se
 * está. O limite internacional vem logo atrás, e a divisa estadual fica no
 * limite do perceptível de propósito: ela existe para responder "qual estado",
 * não para competir com o litoral.
 */
const PESO: Record<number, [number, number, number]> = {
  [COSTA]: [0.86, 0.92, 1.0],
  [PAIS]: [0.72, 0.76, 0.82],
  [ESTADO]: [0.34, 0.40, 0.50],
};

interface ItemTile {
  z: number;
  linha: THREE.LineSegments | null;
  vivo: boolean;
  /**
   * O tile terminou de carregar?
   *
   * NÃO é o mesmo que ter geometria: um tile de oceano aberto chega vazio e
   * fica sem `linha`, e ainda assim está pronto. Confundir os dois faria a
   * troca de nível nunca acontecer sobre o Pacífico — a maior parte do
   * planeta — porque um tile sem linha jamais ficaria "carregado".
   */
  pronto: boolean;
}

export interface OpcoesFronteiras {
  raio: number;
  /** quantos tiles ficam vivos ao mesmo tempo */
  tetoVivos?: number;
}

export class FronteirasGlobo {
  private grupo = new THREE.Group();
  private tiles = new Map<string, ItemTile>();
  private material: THREE.LineBasicMaterial;
  private raio: number;
  private tetoVivos: number;
  private nivelAtual = -1;
  /**
   * O nível que está NA TELA — que não é o mesmo que o nível pedido.
   *
   * Só um nível desenha por vez. Ver `aplicarVisibilidade`.
   */
  private nivelVisivel = -1;
  /** os tiles do nível pedido na última atualização, para reavaliar a troca */
  private pedidoAtual: Tile[] = [];
  private descartada = false;
  private avisoFn: ((msg: string | null) => void) | null = null;
  private falhas = 0;
  // Campo comum, e não parâmetro-propriedade do construtor: `private cena:` na
  // assinatura é açúcar do TypeScript que o modo "strip-only" do Node recusa, e
  // com ele este arquivo não poderia ser carregado por um teste.
  private cena: THREE.Scene;

  /** o material, exposto para o teste conferir a política de profundidade */
  get materialDaLinha(): THREE.LineBasicMaterial { return this.material; }

  constructor(cena: THREE.Scene, opc: OpcoesFronteiras) {
    this.cena = cena;
    this.raio = opc.raio;
    this.tetoVivos = opc.tetoVivos ?? 90;

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,

      // -----------------------------------------------------------------
      // O TESTE DE PROFUNDIDADE FICA LIGADO, E ELE É O QUE ESCONDE O OUTRO
      // LADO DO PLANETA.
      // -----------------------------------------------------------------
      // A primeira versão desligava, copiando as camadas de imagem — e nelas
      // desligar é certo, porque são cascas a milésimos de raio umas das
      // outras e o teste ali produz cintilação em vez de sobreposição.
      //
      // A fronteira não é esse caso. Ela é geometria SOLTA no espaço, e sem
      // teste de profundidade o traço da Austrália e do Sudeste Asiático
      // aparecia desenhado por cima do Pacífico — as linhas da face oculta
      // atravessando a esfera inteira. Nada nas camadas de imagem sofria
      // disso porque cada setor delas é uma face única voltada para fora, e
      // o descarte de face traseira já resolve.
      //
      // Com o teste ligado, o buffer de profundidade da própria esfera do
      // globo faz o trabalho: a linha do lado de cá está a 0,25% de raio
      // FORA da superfície e passa; a do lado de lá está atrás dela e é
      // descartada. Não há cintilação porque 0,25% de raio não é coplanar —
      // são 25 unidades de cena num globo de raio 100, com o buffer de
      // profundidade logarítmico que `tuneRenderer` já liga.
      depthTest: true,

      // A ESCRITA continua desligada: material transparente que escreve
      // profundidade recorta o que vem depois dele na ordem de desenho, e
      // depois da fronteira vêm as isóbaras, as correntes e o vento.
      depthWrite: false,
    });

    this.grupo.renderOrder = 0;
    this.cena.add(this.grupo);
  }

  onAviso(fn: (msg: string | null) => void) { this.avisoFn = fn; }

  definirVisivel(on: boolean) { this.grupo.visible = on; }

  get vivos(): number { return this.tiles.size; }

  /**
   * O nível que está NA TELA — e não o que a câmera pediu.
   *
   * A diferença importa enquanto o nível novo carrega: durante esse intervalo
   * a câmera já pediu o fino e quem desenha ainda é o anterior. Anunciar o
   * pedido faria a barra de estado afirmar um detalhe que ainda não está lá.
   */
  get nivel(): number { return this.nivelVisivel; }
  /** o nível que a câmera pediu na última atualização */
  get nivelPedido(): number { return this.nivelAtual; }

  /**
   * Repõe os tiles para a câmera atual.
   *
   * Mesma política da pirâmide de imagem, e pelo mesmo motivo: o nível 0 fica
   * sempre carregado — são dois tiles e eles são o piso, sem eles cada troca de
   * zoom abriria um planeta sem contorno — e o nível anterior sobrevive até o
   * novo estar completo.
   */
  atualizar(vista: JanelaVista, larguraPx: number, dpr: number) {
    if (this.descartada) return;

    const { z, lista } = planoDeTiles(
      vista.lngOeste, vista.latSul, vista.lngLeste, vista.latNorte,
      vista.larguraGraus, larguraPx, dpr,
    );

    // O NÍVEL 0 CONTINUA CARREGADO, mas não mais VISÍVEL o tempo todo.
    //
    // São dois tiles e 44 kB, e eles cobrem o planeta inteiro — é o piso que
    // garante que a primeira pintura tenha contorno. O que mudou é que ele
    // deixou de ser desenhado por cima dos níveis finos. Ver
    // `aplicarVisibilidade`.
    const piso = tilesEm(-180, -90, 180, 90, 0);
    const querido = new Set(lista.map((t) => t.chave));
    this.pedidoAtual = lista;

    for (const t of [...piso, ...lista]) {
      if (!this.tiles.has(t.chave)) void this.pedir(t);
    }

    this.reavaliarNivel(z);

    // Mantém o nível 0, o nível pedido e o nível que está na tela — este
    // último porque ele é o que segura a imagem enquanto o novo não fecha.
    const guardar = new Set([0, z, this.nivelVisivel]);
    for (const [chave, item] of this.tiles) {
      if (querido.has(chave) || item.z === 0) continue;
      if (guardar.has(item.z) && item.z !== z) continue;
      this.descartar(chave);
    }

    if (this.tiles.size > this.tetoVivos) {
      const sobrando = [...this.tiles.entries()]
        .filter(([c, i]) => i.z !== 0 && i.z !== z && i.z !== this.nivelVisivel && !querido.has(c))
        .sort((a, b) => a[1].z - b[1].z);
      for (const [chave] of sobrando) {
        if (this.tiles.size <= this.tetoVivos) break;
        this.descartar(chave);
      }
    }

    this.nivelAtual = z;
  }

  /**
   * UM NÍVEL POR VEZ — e é isto que corrige a linha dupla.
   *
   * A pirâmide de IMAGEM mantém o nível 0 sempre desenhado como piso, e ali
   * está certo: um tile opaco de nível fino COBRE o grosso, então nunca se vê
   * os dois. Copiei essa política para as fronteiras, e para linha ela é
   * errada — uma linha não cobre nada. O traço de 110m e o de 10m apareciam os
   * DOIS, deslocados em vários quilômetros um do outro, e a costa ficava com
   * contorno duplo em todo zoom fechado.
   *
   * A regra certa é de substituição, não de empilhamento: desenha o nível mais
   * fino cujos tiles da vista JÁ CHEGARAM TODOS, e só ele.
   *
   * A troca é atômica de propósito. Desenhar o nível novo parcial junto com o
   * antigo produziria a mesma linha dupla, só que passageira — e trocar tile a
   * tile faria a costa mudar de espessura em pedaços enquanto carrega. Um
   * pequeno atraso na troca é melhor que qualquer uma das duas.
   */
  private reavaliarNivel(z: number) {
    let completo = this.pedidoAtual.length > 0;
    for (const t of this.pedidoAtual) {
      const item = this.tiles.get(t.chave);
      if (!item || !item.pronto) { completo = false; break; }
    }

    if (completo) this.nivelVisivel = z;
    // Primeira pintura: nada fechou ainda, e o piso é o que existe.
    else if (this.nivelVisivel < 0) this.nivelVisivel = 0;

    this.aplicarVisibilidade();
  }

  private aplicarVisibilidade() {
    for (const item of this.tiles.values()) {
      if (item.linha) item.linha.visible = item.z === this.nivelVisivel;
    }
  }

  private async pedir(t: Tile) {
    const item: ItemTile = { z: t.z, linha: null, vivo: true, pronto: false };
    this.tiles.set(t.chave, item);

    try {
      const fr = await buscarFronteiras(`/api/fronteiras/${t.z}/${t.y}/${t.x}`);
      // Três razões para descartar o que acabou de chegar, e todas acontecem:
      // a camada morreu, o tile foi despejado enquanto baixava, ou ele foi
      // pedido de novo e este é o pedido velho.
      if (this.descartada || !item.vivo || this.tiles.get(t.chave) !== item) return;

      const segmentos = contarSegmentos(fr.comprimentos);
      if (segmentos === 0) {
        // Tile de oceano aberto: nada a desenhar, mas CARREGADO. Ver o
        // comentário de `pronto` em ItemTile.
        item.pronto = true;
        this.reavaliarNivel(this.nivelAtual);
        return;
      }

      const pos = new Float32Array(segmentos * 6);
      const cor = new Float32Array(segmentos * 6);
      const p = new THREE.Vector3();

      let lido = 0, escrito = 0;
      for (let i = 0; i < fr.linhas; i++) {
        const n = fr.comprimentos[i];
        const [cr, cg, cb] = PESO[fr.classes[i]] ?? PESO[PAIS];
        for (let k = 0; k < n - 1; k++) {
          const a = (lido + k) * 2;
          this.paraCena(fr.coordenadas[a + 1], fr.coordenadas[a], p);
          pos[escrito] = p.x; pos[escrito + 1] = p.y; pos[escrito + 2] = p.z;
          this.paraCena(fr.coordenadas[a + 3], fr.coordenadas[a + 2], p);
          pos[escrito + 3] = p.x; pos[escrito + 4] = p.y; pos[escrito + 5] = p.z;
          cor[escrito] = cr; cor[escrito + 1] = cg; cor[escrito + 2] = cb;
          cor[escrito + 3] = cr; cor[escrito + 4] = cg; cor[escrito + 5] = cb;
          escrito += 6;
        }
        lido += n;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
      geo.computeBoundingSphere();

      const linha = new THREE.LineSegments(geo, this.material);
      // Nível mais fino desenha por cima do mais grosso, como nos tiles de
      // imagem: com o teste de profundidade desligado, a ordem é a única coisa
      // que decide quem fica na frente.
      linha.renderOrder = ORDEM.FRONTEIRAS + t.z * 0.01;
      linha.frustumCulled = false;
      // O nível fica no objeto: é por ele que `aplicarVisibilidade` decide, e
      // é por ele que o teste consegue perguntar o que está na tela.
      linha.userData.z = t.z;
      // Nasce invisível: quem decide o que aparece é `aplicarVisibilidade`,
      // e um tile que se mostra sozinho ao chegar é exatamente a linha dupla
      // que esta camada acabou de deixar de ter.
      linha.visible = false;
      item.linha = linha;
      item.pronto = true;
      this.grupo.add(linha);

      this.falhas = 0;
      this.avisoFn?.(null);
      // A troca de nível é reavaliada AQUI, e não só no movimento de câmera:
      // sem isto, o último tile a chegar não dispararia a troca e o mapa
      // ficaria no nível grosso até o próximo arrasto.
      this.reavaliarNivel(this.nivelAtual);
    } catch (e) {
      // Tile que não veio sai da lista para a próxima passada tentar de novo,
      // em vez de deixar um vazio permanente.
      if (this.tiles.get(t.chave) === item) this.tiles.delete(t.chave);
      this.falhas++;
      if (this.falhas === 4) {
        const msg = e instanceof Error ? e.message : String(e);
        this.avisoFn?.(`fronteiras indisponíveis (${msg})`);
      }
    }
  }

  /**
   * lat/lng → posição na cena, na convenção do globe.gl.
   *
   * Precisa bater com `getCoords` do globe.gl, senão a fronteira fica girada em
   * relação aos continentes — o mesmo cuidado de `src/malha/malha3d.ts` e de
   * `src/piramideGlobo.ts`, conferido em `test/malha-geometria.mjs`.
   *
   * O raio sobe 0,25% para a linha ficar ACIMA da imagem. Menos que isso e a
   * fronteira desaparece dentro da textura em algumas placas; mais e ela
   * descola visivelmente do relevo no limbo do globo.
   */
  private paraCena(lat: number, lng: number, alvo: THREE.Vector3) {
    const la = (lat * Math.PI) / 180;
    const lo = (lng * Math.PI) / 180;
    const r = this.raio * 1.0025;
    const c = Math.cos(la);
    alvo.set(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
  }

  private descartar(chave: string) {
    const item = this.tiles.get(chave);
    if (!item) return;
    item.vivo = false;
    if (item.linha) {
      this.grupo.remove(item.linha);
      item.linha.geometry.dispose();
    }
    this.tiles.delete(chave);
  }

  dispose() {
    this.descartada = true;
    for (const chave of [...this.tiles.keys()]) this.descartar(chave);
    this.material.dispose();
    this.cena.remove(this.grupo);
  }
}
