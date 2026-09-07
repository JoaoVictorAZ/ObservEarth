// src/piramideGlobo.ts
// -----------------------------------------------------------------------------
// RESOLUÇÃO QUE ACOMPANHA O ZOOM — agora também no GLOBO.
// -----------------------------------------------------------------------------
// O QUE ESTAVA ERRADO
//
// O mapa plano ganhou pirâmide de tiles e passou a servir 0,30 km por pixel no
// zoom fechado. O globo continuou pedindo UMA imagem do mundo inteiro com 4096
// px de largura — 360° ÷ 4096 ≈ 9,8 km por pixel, FIXO. Aproximar num ciclone
// esticava esses mesmos texels até cada um cobrir vários pixels de tela.
//
// A consequência não era só estética. O globo é o modo padrão do aplicativo, e
// o discurso do projeto é que se aproxima para ver o fenômeno. Trinta e duas
// vezes menos detalhe no modo principal do que no secundário é uma promessa
// que a tela não cumpria.
//
// Nenhum aumento de textura resolve: 8192 adia o problema em um passo de zoom
// e dobra o download de quem olha o planeta inteiro. Só recorte resolve — e o
// recorte já estava escrito e testado em `src/tiles.ts`, que é matemática pura
// e não sabe se quem chama desenha num plano ou numa esfera. Este arquivo é a
// segunda chamada dela.
//
// O QUE MUDA DO PLANO PARA A ESFERA
//
// No plano, um tile é um retângulo. Na esfera, é um SETOR — um pedaço de casca
// com quatro bordas curvas. O `THREE.SphereGeometry` sabe construir setores
// (`phiStart`, `phiLength`, `thetaStart`, `thetaLength`), então a imagem
// equirretangular cola no setor sem reprojeção nenhuma: os dois estão no mesmo
// espaço de coordenada.
//
// E a janela visível deixa de ser um retângulo de tela e vira uma CALOTA. É a
// única conta de verdade nova aqui, e está em `calotaVisivel`.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { planoDeTiles, tilesEm, type Tile } from "./tiles.ts";
import type { JanelaVista } from "./calota.ts";
import { ordemDoTile } from "./ordemDesenho.ts";

export { calotaVisivel, type JanelaVista } from "./calota.ts";

interface ItemTile {
  z: number;
  malha: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  tex: THREE.Texture | null;
}

/**
 * Setor de esfera para um tile equirretangular.
 *
 * A CONVENÇÃO DO `SphereGeometry` do three.js não é lat/lng, e a conversão tem
 * um deslocamento de 90° que não é óbvio. Lá dentro,
 *
 *     x = −r·cos(φ)·sen(θ)      y = r·cos(θ)      z = r·sen(φ)·sen(θ)
 *
 * enquanto o globe.gl — e portanto toda a cena — usa
 *
 *     x = r·cos(lat)·sen(lng)   y = r·sen(lat)    z = r·cos(lat)·cos(lng)
 *
 * Igualando as duas no equador sai φ = lng + π/2 e θ = π/2 − lat. Errar esse
 * quarto de volta gira a imagem 90° em relação aos continentes, que é o tipo
 * de defeito que parece "quase certo" e demora a ser notado.
 *
 * O número de segmentos acompanha o TAMANHO ANGULAR do tile: um tile de 180°
 * precisa de muitos para não virar um polígono facetado, e um de 3° fica liso
 * com poucos. Fixar o número gastaria vértices no zoom fechado e mostraria as
 * arestas no afastado.
 */
function geometriaDoTile(t: Tile, raio: number): THREE.SphereGeometry {
  const rad = Math.PI / 180;
  const larguraGraus = t.leste - t.oeste;
  const alturaGraus = t.norte - t.sul;
  const segs = Math.max(6, Math.min(48, Math.round(larguraGraus / 2.5)));

  return new THREE.SphereGeometry(
    raio,
    segs, Math.max(4, Math.round(segs / 2)),
    (t.oeste + 90) * rad, larguraGraus * rad,
    (90 - t.norte) * rad, alturaGraus * rad,
  );
}

export interface OpcoesPiramide {
  raio: number;
  /** quantos tiles no máximo ficam vivos ao mesmo tempo */
  tetoVivos?: number;
}

export class PiramideGlobo {
  private grupo = new THREE.Group();
  private tiles = new Map<string, ItemTile>();
  private camada: string | null = null;      // "id|data"
  private nivelAtual = -1;
  private nivelAnterior = -1;
  private opacidade = 1;
  private descartada = false;
  private raio: number;
  private tetoVivos: number;

  constructor(private cena: THREE.Scene, opc: OpcoesPiramide) {
    this.raio = opc.raio;
    this.tetoVivos = opc.tetoVivos ?? 120;
    // O GRUPO FICA EM ZERO, e isso é a correção de um defeito real.
    //
    // `renderOrder` num Group vira `groupOrder`, que o three.js compara ANTES
    // do renderOrder de cada objeto. Com o grupo em 3, os tiles passavam à
    // frente do vento — que está solto na cena com renderOrder 5 — e a imagem
    // de satélite cobria as partículas ao ligar as duas camadas. Ver
    // `src/ordemDesenho.ts`.
    this.grupo.renderOrder = 0;
    cena.add(this.grupo);
  }

  /** `null` desliga a pirâmide e devolve a vez à textura única do globo. */
  definirCamada(id: string | null, dia: string) {
    const nova = id ? `${id}|${dia}` : null;
    if (nova === this.camada) return;
    this.camada = nova;
    this.limpar();
    this.nivelAtual = -1;
    this.nivelAnterior = -1;
  }

  definirOpacidade(o: number) {
    this.opacidade = Math.max(0, Math.min(1, o));
    for (const t of this.tiles.values()) t.material.opacity = this.opacidade;
  }

  definirVisivel(on: boolean) { this.grupo.visible = on; }

  /** Existe algum tile já pintado? A tela usa isto para saber se pode desligar
   *  a textura única sem abrir um buraco preto. */
  get pronta(): boolean {
    for (const t of this.tiles.values()) if (t.tex) return true;
    return false;
  }

  get vivos(): number { return this.tiles.size; }
  get nivel(): number { return this.nivelAtual; }

  /**
   * Pede os tiles do nível certo para a câmera atual.
   *
   * O NÍVEL 0 FICA SEMPRE CARREGADO — são dois tiles, e eles são o piso. Sem
   * eles, cada troca de zoom abriria buracos até o nível novo chegar. O nível
   * anterior também sobrevive até o novo estar completo: trocar de nível é a
   * operação mais visível de um mapa por tiles, e a diferença entre "carregou"
   * e "piscou" está exatamente aqui. É a mesma política do `mapa2d.ts`, e ela
   * mora nos dois lugares porque a estrutura de cena é diferente — o que se
   * compartilha é a decisão, e ela está em `src/tiles.ts`, testada.
   */
  atualizar(vista: JanelaVista, larguraPx: number, dpr: number) {
    if (this.descartada || !this.camada) return;

    const { z, lista } = planoDeTiles(
      vista.lngOeste, vista.latSul, vista.lngLeste, vista.latNorte,
      vista.larguraGraus, larguraPx, dpr,
    );
    const alvo = [...tilesEm(-180, -90, 180, 90, 0), ...lista];

    const querido = new Set(alvo.map((t) => t.chave));
    for (const t of alvo) if (!this.tiles.has(t.chave)) this.pedir(t);

    const guardar = new Set([0, z, this.nivelAnterior]);
    for (const [chave, item] of this.tiles) {
      if (querido.has(chave)) continue;
      if (guardar.has(item.z) && item.z !== z) continue;
      this.descartar(chave);
    }

    // TETO DE MEMÓRIA. Cada tile é uma textura de 512×512 em RGBA: 1 MB na
    // GPU. Sem teto, uma sessão longa girando o planeta acumularia todos os
    // tiles do nível anterior de cada vista já visitada. O corte começa pelos
    // níveis grossos, que são os que menos custam recarregar.
    if (this.tiles.size > this.tetoVivos) {
      const sobrando = [...this.tiles.entries()]
        .filter(([c, i]) => i.z !== 0 && i.z !== z && !querido.has(c))
        .sort((a, b) => a[1].z - b[1].z);
      for (const [chave] of sobrando) {
        if (this.tiles.size <= this.tetoVivos) break;
        this.descartar(chave);
      }
    }

    if (z !== this.nivelAtual) { this.nivelAnterior = this.nivelAtual; this.nivelAtual = z; }
  }

  private pedir(t: Tile) {
    const camada = this.camada;
    if (!camada) return;
    const [id, dia] = camada.split("|");

    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: this.opacidade,
      depthWrite: false, depthTest: false,
    });
    const malha = new THREE.Mesh(geometriaDoTile(t, this.raio * (1 + 0.0008 + t.z * 0.00002)), mat);
    // Nível mais fino desenha POR CIMA do mais grosso. Sem esta ordem, o nível
    // 0 poderia cobrir o detalhe que acabou de chegar — e o raio também sobe
    // um fio por nível, porque com `depthTest` desligado a ordem de desenho é
    // a única coisa que decide quem fica na frente.
    malha.renderOrder = ordemDoTile(t.z);
    malha.visible = false;
    malha.frustumCulled = false;
    this.grupo.add(malha);

    const item: ItemTile = { z: t.z, malha, material: mat, tex: null };
    this.tiles.set(t.chave, item);

    new THREE.TextureLoader().load(
      `/api/tile/${id}/${t.z}/${t.y}/${t.x}?date=${dia}`,
      (tex) => {
        // Três razões para descartar a textura recém-chegada, e todas
        // acontecem de verdade: a pirâmide morreu, o tile foi despejado
        // enquanto baixava, ou o usuário trocou de camada no meio do caminho.
        if (this.descartada || this.tiles.get(t.chave) !== item || camada !== this.camada) {
          tex.dispose();
          return;
        }
        if (!tex.image || tex.image.width <= 0) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        item.tex = tex;
        mat.map = tex;
        mat.needsUpdate = true;
        malha.visible = true;
      },
      undefined,
      () => {
        // Tile que não veio some da lista, para a próxima passada tentar de
        // novo em vez de deixar um quadrado vazio para sempre.
        if (this.tiles.get(t.chave) === item) this.descartar(t.chave);
      },
    );
  }

  private descartar(chave: string) {
    const item = this.tiles.get(chave);
    if (!item) return;
    this.grupo.remove(item.malha);
    item.malha.geometry.dispose();
    item.material.dispose();
    item.tex?.dispose();
    this.tiles.delete(chave);
  }

  private limpar() {
    for (const chave of [...this.tiles.keys()]) this.descartar(chave);
  }

  dispose() {
    this.descartada = true;
    this.limpar();
    this.cena.remove(this.grupo);
  }
}
