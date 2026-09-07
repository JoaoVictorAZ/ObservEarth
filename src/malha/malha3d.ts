// src/malha/malha3d.ts
// -----------------------------------------------------------------------------
// A MALHA: o campo escalar como RELEVO sobre a esfera.
// -----------------------------------------------------------------------------
// POR QUE ALTURA, SE A COR JÁ DIZ O VALOR
//
// Porque cor e altura falham em coisas diferentes, e as duas juntas cobrem o
// buraco uma da outra.
//
// A cor é um canal RUIM para ordem. O olho compara duas cores vizinhas com
// facilidade e duas cores distantes com dificuldade, e não consegue dizer se a
// diferença entre elas é grande ou pequena sem voltar à legenda. Pior: cerca
// de 8% dos homens não distinguem vermelho de verde, que é o eixo em que quase
// toda rampa meteorológica coloca a informação principal.
//
// A altura é um canal BOM para ordem e péssimo para valor absoluto. Ninguém lê
// "1032 hPa" de uma elevação, mas todo mundo vê num relance onde estão as
// cristas e os cavados, quantos são, e qual é mais fundo — que é exatamente a
// pergunta que a lista de pontos críticos responde em números.
//
// Então a malha carrega as duas: cor pela MESMA rampa do PNG (ver ./rampa) e
// altura pelo valor normalizado. Quem quiser o número clica; quem quiser a
// estrutura olha.
//
// O QUE A MALHA NÃO É
//
// Não é terreno. A altura é uma variável meteorológica esticada, não uma
// medida de elevação, e o `exagero` é uma escolha de visualização declarada na
// interface — não uma propriedade do dado. É por isso que o relevo real, que
// ESTÁ em metros, mora noutro lugar (`mapa2d.ts`, tiles terrarium) e não aqui.
//
// BURACO CONTINUA BURACO. Um vértice sem dado não vira zero e não vira nível
// médio: os triângulos que o tocariam simplesmente não são gerados. A malha
// fica vazada, e a pessoa vê que ali não há dado — que é o comportamento que o
// resto do projeto tem para imagem de satélite e precisa ter aqui também.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { type CampoEscalar, latDaLinha, lngDaColuna, medido } from "./campo.ts";
import { type Parada, type ModoRampa, corDoValor, sRGBparaLinear } from "./rampa.ts";
import type { PontoCritico } from "./extremos.ts";
import { ORDEM } from "../ordemDesenho.ts";

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vCor;
  void main() {
    vN = normalize(normalMatrix * normal);
    vCor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ILUMINAÇÃO PRÓPRIA, presa à câmera — e não a luz do sol da cena.
//
// A camada de análise precisa ser legível no lado NOITE do planeta. O globo
// tem um terminador dia/noite de verdade, e é assim que ele deve ser para a
// imagem de satélite; mas um mapa de pressão que só se lê onde é dia seria uma
// ferramenta pela metade. A lanterna na câmera dá o mesmo sombreado em toda
// parte, e o sombreado aqui serve para revelar FORMA, não hora do dia.
const FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vCor;
  void main() {
    float face = abs(normalize(vN).z);
    // O piso de 0,42 impede que a encosta virada para o lado suma em preto:
    // ali ainda há dado, e dado que some é indistinguível de dado que falta.
    float luz = 0.42 + 0.58 * pow(face, 0.8);
    gl_FragColor = vec4(vCor * luz, uOpacity);
  }
`;

export interface OpcoesMalha {
  /** raio da esfera de base, na unidade da cena */
  raio: number;
  /** altura máxima como fração do raio. 0,12 é um relevo forte e ainda legível */
  exagero?: number;
  opacidade?: number;
}

export interface Escala {
  /** valor mapeado à altura 0 */
  lo: number;
  /** valor mapeado à altura máxima */
  hi: number;
  stops: Parada[];
  modo: ModoRampa;
}

/**
 * Converte lat/lng/altura em posição, na MESMA convenção do globe.gl:
 * y é o eixo polar, e a longitude 0 aponta para +z.
 *
 * Precisa bater exatamente com `getCoords` do globe.gl, senão a malha fica
 * girada em relação aos continentes — um erro que parece "quase certo" e por
 * isso demora a ser notado.
 */
function paraCena(lat: number, lng: number, r: number, alvo: THREE.Vector3) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const c = Math.cos(la);
  alvo.set(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
}

export class MalhaEscalar {
  private grupo = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private arame: THREE.Mesh | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private mat: THREE.ShaderMaterial;
  private matArame: THREE.MeshBasicMaterial;
  private marcadores = new THREE.Group();

  private campo: CampoEscalar | null = null;
  private escala: Escala | null = null;
  private raio: number;
  private exagero: number;
  private nx = 0;
  private ny = 0;
  private descartada = false;
  // Campo comum, e não parâmetro-propriedade do construtor. `private cena:` na
  // assinatura é açúcar do TypeScript que o modo "strip-only" do Node recusa —
  // e com ele este arquivo não podia ser carregado por um teste, que é
  // justamente onde a geometria da malha precisa ser conferida sem GPU.
  private cena: THREE.Scene;

  constructor(cena: THREE.Scene, opc: OpcoesMalha) {
    this.cena = cena;
    this.raio = opc.raio;
    this.exagero = opc.exagero ?? 0.12;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uOpacity: { value: opc.opacidade ?? 0.92 } },
      vertexColors: true,
      transparent: (opc.opacidade ?? 0.92) < 1,
      side: THREE.DoubleSide,   // a malha é vazada: o outro lado precisa existir
    });

    this.matArame = new THREE.MeshBasicMaterial({
      color: 0x0b1220, wireframe: true, transparent: true, opacity: 0.22,
      depthWrite: false,
    });

    this.grupo.add(this.marcadores);
    this.grupo.visible = false;
    // ORDEM DE GRUPO, e é a única do projeto que é — ver src/ordemDesenho.ts.
    // A malha não é uma casca sobre a esfera: é superfície levantada, desenha
    // com teste de profundidade LIGADO, e precisa vir depois de todas as
    // cascas que desenham com o teste desligado.
    this.grupo.renderOrder = ORDEM.MALHA;
    cena.add(this.grupo);
  }

  /**
   * Monta (ou remonta) a geometria para um campo.
   *
   * A geometria é reconstruída apenas quando a GRADE muda de tamanho. Trocar a
   * hora da linha do tempo mantém nx e ny e só reescreve posições e cores —
   * duas escritas em buffers que já existem, sem alocar 65 mil vértices de
   * novo a cada passo do reprodutor.
   */
  definirCampo(campo: CampoEscalar | null, escala: Escala | null) {
    if (this.descartada) return;
    this.campo = campo;
    this.escala = escala;

    if (!campo || !escala || campo.nx < 2 || campo.ny < 2) {
      this.grupo.visible = false;
      return;
    }

    if (!this.geo || campo.nx !== this.nx || campo.ny !== this.ny) {
      this.nx = campo.nx; this.ny = campo.ny;
      this.montarGeometria();
    }
    this.reescrever();
  }

  /**
   * O ÍNDICE — quais triângulos existem.
   *
   * Percorre os quadriláteros da grade e emite os dois triângulos de cada um
   * SÓ se os quatro cantos tiverem dado. É aqui que o buraco vira buraco.
   *
   * A coluna nx−1 fecha com a coluna 0: a grade não repete o meridiano de
   * −180°, então sem este fechamento haveria uma fenda de uma célula de
   * largura correndo do polo ao polo no antimeridiano. É o mesmo cuidado que
   * `server/vorticidade.js` toma no cálculo, pela mesma razão.
   *
   * As linhas polares são nx vértices no MESMO ponto do espaço, então os
   * triângulos que as tocam têm área zero. Eles são emitidos assim mesmo:
   * removê-los abriria um furo circular no polo, e um triângulo degenerado não
   * custa preenchimento nenhum — a rasterização o descarta sozinha.
   */
  private montarGeometria() {
    const { nx, ny } = this;
    const n = nx * ny;

    this.descartarGeometria();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // Uint32 e não Uint16: uma grade 360×181 tem 65.160 vértices e o índice de
    // 16 bits para em 65.535. A margem é de 375 vértices — passar disso
    // silenciosamente enrolaria os índices e desenharia triângulos ligando
    // pontos opostos do planeta.
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this.geo = geo;

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.arame = new THREE.Mesh(geo, this.matArame);
    this.arame.frustumCulled = false;
    this.arame.visible = false;
    this.grupo.add(this.mesh, this.arame);
  }

  private reescrever() {
    const campo = this.campo, escala = this.escala, geo = this.geo;
    if (!campo || !escala || !geo) return;

    const { nx, ny } = this;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const cor = geo.getAttribute("color") as THREE.BufferAttribute;
    const p = new THREE.Vector3();

    const faixa = escala.hi - escala.lo;
    // Faixa degenerada: campo constante, ou quantis que colapsaram. A malha
    // fica na altura da base em vez de dividir por zero e explodir para o
    // infinito — plana e honesta.
    const inv = Math.abs(faixa) > 0 ? 1 / faixa : 0;

    for (let j = 0; j < ny; j++) {
      const lat = latDaLinha(j, ny);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const tem = medido(campo, k);
        const v = tem ? campo.valores[k] : escala.lo;
        const t = Math.max(0, Math.min(1, (v - escala.lo) * inv));

        // Vértice sem dado fica NA BASE. Ele não vai ser desenhado — nenhum
        // triângulo o inclui — mas precisa de uma posição finita: um NaN aqui
        // contamina a caixa envolvente e o three.js some com a malha inteira.
        paraCena(lat, lngDaColuna(i, nx), this.raio * (1 + (tem ? t : 0) * this.exagero), p);
        pos.setXYZ(k, p.x, p.y, p.z);

        const [r, g, b] = tem
          ? corDoValor(escala.stops, v, escala.modo)
          : [90, 96, 104];
        cor.setXYZ(k, sRGBparaLinear(r), sRGBparaLinear(g), sRGBparaLinear(b));
      }
    }
    pos.needsUpdate = true;
    cor.needsUpdate = true;

    // O índice depende da MÁSCARA, que muda de uma hora para outra: uma célula
    // sem dado às 12h pode ter dado às 15h. Refazer é O(n) e barato perto de
    // manter uma contabilidade incremental que erraria em silêncio.
    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx; i++) {
        const i1 = (i + 1) % nx;                 // fecha o antimeridiano
        const a = j * nx + i, b = j * nx + i1;
        const c = (j + 1) * nx + i1, d = (j + 1) * nx + i;
        if (!medido(campo, a) || !medido(campo, b) ||
            !medido(campo, c) || !medido(campo, d)) continue;
        idx.push(a, b, c, a, c, d);
      }
    }
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  /** Marcadores de mínimo, máximo e sela, no ponto REFINADO. */
  marcarExtremos(pontos: PontoCritico[]) {
    if (this.descartada) return;
    this.limparMarcadores();
    const escala = this.escala;
    if (!escala || !pontos.length) return;

    const faixa = escala.hi - escala.lo;
    const inv = Math.abs(faixa) > 0 ? 1 / faixa : 0;
    // O marcador tem tamanho FIXO em unidades de cena, não em pixels. Ele
    // encolhe quando se afasta, como o relevo que marca — um pino de tamanho
    // constante na tela flutuaria descolado da malha ao girar o globo.
    const geoPino = new THREE.SphereGeometry(this.raio * 0.006, 10, 8);

    const cores: Record<string, number> = {
      maximo: 0xff5a3c,       // a mesma família quente da rampa de calor
      minimo: 0x4aa8ff,
      sela: 0xd8c26a,
      degenerado: 0x9aa3ad,
    };

    const p = new THREE.Vector3();
    const base = new THREE.Vector3();
    const hastes: number[] = [];

    for (const pt of pontos) {
      const t = Math.max(0, Math.min(1, (pt.valor - escala.lo) * inv));
      const r = this.raio * (1 + t * this.exagero);
      paraCena(pt.lat, pt.lng, r + this.raio * 0.008, p);
      paraCena(pt.lat, pt.lng, this.raio, base);

      const m = new THREE.Mesh(
        geoPino,
        new THREE.MeshBasicMaterial({ color: cores[pt.tipo] ?? 0xffffff }),
      );
      m.position.copy(p);
      m.userData = pt;
      this.marcadores.add(m);

      hastes.push(base.x, base.y, base.z, p.x, p.y, p.z);
    }

    const geoHaste = new THREE.BufferGeometry();
    geoHaste.setAttribute("position", new THREE.Float32BufferAttribute(hastes, 3));
    this.marcadores.add(new THREE.LineSegments(
      geoHaste,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
    ));
  }

  private limparMarcadores() {
    for (const o of [...this.marcadores.children]) {
      this.marcadores.remove(o);
      const m = o as THREE.Mesh | THREE.LineSegments;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    }
  }

  definirVisivel(on: boolean) { this.grupo.visible = on && !!this.geo; }
  definirArame(on: boolean) { if (this.arame) this.arame.visible = on; }
  definirOpacidade(o: number) {
    this.mat.uniforms.uOpacity.value = o;
    this.mat.transparent = o < 1;
    this.mat.needsUpdate = true;
  }

  /** Reaplica a altura sem refazer cor nem índice — é o que o controle arrasta. */
  definirExagero(x: number) {
    this.exagero = Math.max(0, Math.min(0.5, x));
    this.reescrever();
  }

  private descartarGeometria() {
    if (this.mesh) { this.grupo.remove(this.mesh); this.mesh = null; }
    if (this.arame) { this.grupo.remove(this.arame); this.arame = null; }
    this.geo?.dispose();
    this.geo = null;
  }

  dispose() {
    this.descartada = true;
    this.limparMarcadores();
    this.descartarGeometria();
    this.mat.dispose();
    this.matArame.dispose();
    this.cena.remove(this.grupo);
  }
}
