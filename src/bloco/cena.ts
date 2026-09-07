// src/bloco/cena.ts
// -----------------------------------------------------------------------------
// O BLOCO: um pedaço do planeta arrancado e posto sobre a mesa.
// -----------------------------------------------------------------------------
// POR QUE UM BLOCO, E NÃO MAIS UMA CAMADA NO GLOBO
//
// O globo é ótimo para ver ONDE, e ruim para ver QUANTO em vertical. Ele
// mostra o planeta de fora, a câmera orbita o centro da Terra, e a única coisa
// que se pode fazer com o relevo ali é levantá-lo alguns milésimos de raio —
// invisível — ou exagerá-lo até o planeta virar uma bola de espinhos.
//
// A vertical é a dimensão que a meteorologia usa mais e que o globo dá pior. O
// bloco resolve trocando a pergunta: em vez de "onde no planeta", passa a ser
// "como é a coluna de atmosfera sobre ESTE lugar".
//
// É o diagrama de bloco da geologia, que existe há um século e meio pela mesma
// razão: quando o eixo vertical importa, recorta-se um paralelepípedo do
// terreno, levanta-se ele, e as paredes do corte passam a mostrar o que a
// vista de cima escondia.
//
// -----------------------------------------------------------------------------
// AS DUAS VERTICAIS, E POR QUE ELAS NÃO PODEM SER A MESMA
// -----------------------------------------------------------------------------
// O bloco carrega DOIS eixos verticais, e confundi-los seria mentir:
//
//   O TERRENO está em METROS, e é altitude de verdade. O único ajuste é o
//   exagero, que é uma escolha de visualização e aparece declarado na tela —
//   como em qualquer diagrama de bloco desde o século XIX.
//
//   A MALHA DO CAMPO está em unidade do campo — hPa, °C, mm — e a altura dela
//   é o VALOR normalizado, não altitude. Uma superfície de pressão desenhada a
//   "3 km" não está a três quilômetros de nada.
//
// Por isso a malha flutua numa faixa própria, separada do terreno por um vão
// visível, e a interface nomeia as duas coisas de formas diferentes. Encostar
// uma na outra faria parecer que a superfície de pressão é uma nuvem pousada
// no morro.
//
// -----------------------------------------------------------------------------
// AS PAREDES SÃO A ESCALA
// -----------------------------------------------------------------------------
// O corte lateral não é decoração: ele é o único lugar do bloco onde a escala
// vertical pode ser LIDA em vez de estimada. As paredes ganham estratos a cada
// intervalo redondo de altitude e uma linha distinta no nível do mar, então
// contar faixas dá a altura sem precisar de eixo, de rótulo ou de legenda.
//
// E o nível do mar precisa mesmo ser distinto, porque a batimetria entra no
// mesmo raster: um bloco de cidade costeira mostra o fundo do mar, e sem a
// linha de zero não se sabe onde a água começa.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type CampoEscalar, medido } from "../malha/campo.ts";
import { corDaRampa, corDoValor, sRGBparaLinear, type Parada, type ModoRampa } from "../malha/rampa.ts";
import {
  type RelevoPronto,
  latDaLinhaDoBloco, lngDaColunaDoBloco, tamanhoKm,
} from "./relevo.ts";
import {
  malhaDoTerreno, saiaDoBloco, faixaDoCampo, estratoPara, kmDeMetros, metricaDa,
  type MalhaBruta,
} from "./geometria.ts";

/**
 * RAMPA HIPSOMÉTRICA — a convenção cartográfica, não uma paleta inventada.
 *
 * Azul de profundidade abaixo do zero, verde de planície logo acima, ocre de
 * planalto, marrom de montanha, branco de neve permanente. É a mesma leitura
 * de qualquer atlas físico, e por isso não precisa de legenda para funcionar.
 *
 * O salto no zero é DELIBERADO e brusco: −1 m e +1 m são lados opostos da
 * linha d'água, e suavizar ali apagaria a costa, que é a feição mais
 * importante de um bloco costeiro.
 */
const HIPSO: Parada[] = [
  [-8000, [8, 20, 48]],
  [-3000, [16, 46, 92]],
  [-600, [30, 84, 140]],
  [-60, [70, 132, 180]],
  [-1, [140, 190, 214]],
  [0, [92, 138, 84]],
  [200, [126, 158, 88]],
  [700, [186, 176, 98]],
  [1600, [166, 130, 78]],
  [2800, [140, 106, 84]],
  [4200, [186, 178, 172]],
  [6000, [246, 248, 250]],
];

const TERRENO_VERT = /* glsl */ `
  varying vec3 vCor;
  varying vec3 vN;
  varying float vAlt;
  attribute float alt;          // altitude em METROS, para a parede e os estratos
  void main() {
    vCor = color;
    vN = normalize(normalMatrix * normal);
    vAlt = alt;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Luz de estúdio, presa à cena e não ao Sol.
 *
 * O bloco é um instrumento sobre a mesa, não uma fotografia do planeta: a
 * sombra aqui serve para revelar FORMA do terreno, e uma luz na posição solar
 * real deixaria metade dos blocos do mundo ilegíveis por serem de madrugada.
 *
 * A direção vem do noroeste alto, que é a convenção do sombreamento de relevo
 * desde o mapa impresso — o olho lê vale como vale só quando a luz vem de cima
 * e da esquerda. Com a luz do outro lado o cérebro inverte, e a montanha vira
 * cratera.
 */
const TERRENO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCor;
  varying vec3 vN;
  varying float vAlt;
  uniform float uOpacidade;
  void main() {
    vec3 luz = normalize(vec3(-0.55, 0.78, 0.30));
    float d = max(dot(normalize(vN), luz), 0.0);
    float amb = 0.42;
    gl_FragColor = vec4(vCor * (amb + 0.72 * d), uOpacidade);
  }
`;

const PAREDE_VERT = /* glsl */ `
  varying float vAlt;
  attribute float alt;
  void main() {
    vAlt = alt;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A PAREDE DO CORTE, com estratos legíveis.
 *
 * Uma faixa a cada `uPasso` metros e uma linha forte no nível do mar. Contar
 * faixas dá a altura sem eixo nem legenda — que é a razão de a parede existir.
 */
const PAREDE_FRAG = /* glsl */ `
  precision highp float;
  varying float vAlt;
  uniform float uPasso;
  uniform float uOpacidade;

  void main() {
    // Rocha mais escura quanto mais fundo: a leitura intuitiva de "sob o solo".
    float t = clamp((vAlt + 2000.0) / 8000.0, 0.0, 1.0);
    vec3 base = mix(vec3(0.10, 0.11, 0.14), vec3(0.34, 0.31, 0.28), t);

    // Estratos. fwidth mantem a linha com a mesma espessura em qualquer
    // zoom; sem ele a faixa some ao afastar e engorda ao aproximar.
    float f = fract(vAlt / uPasso);
    float largura = fwidth(vAlt / uPasso) * 1.2;
    float linha = 1.0 - smoothstep(0.0, largura, min(f, 1.0 - f));
    base = mix(base, base * 1.9 + 0.05, linha * 0.55);

    // O NÍVEL DO MAR é outra coisa, e tem que se distinguir de um estrato
    // qualquer: a batimetria entra no mesmo raster, e sem esta linha não se
    // sabe onde a água começa.
    float dz = abs(vAlt);
    float mar = 1.0 - smoothstep(0.0, fwidth(vAlt) * 2.0 + 8.0, dz);
    base = mix(base, vec3(0.36, 0.72, 0.92), mar * 0.85);

    gl_FragColor = vec4(base, uOpacidade);
  }
`;

const CAMPO_VERT = /* glsl */ `
  varying vec3 vCor;
  varying vec3 vN;
  void main() {
    vCor = color;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAMPO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCor;
  varying vec3 vN;
  uniform float uOpacidade;
  void main() {
    vec3 luz = normalize(vec3(-0.55, 0.78, 0.30));
    float d = max(dot(normalize(vN), luz), 0.0);
    // A malha do campo é translúcida e vista dos dois lados: o piso de luz é
    // mais alto que o do terreno para ela não sumir vista por baixo.
    gl_FragColor = vec4(vCor * (0.58 + 0.5 * d), uOpacidade);
  }
`;

export interface EscalaCampo {
  lo: number; hi: number; stops: Parada[]; modo: ModoRampa;
}

export interface EstadoBloco {
  /** altitude mínima e máxima do recorte, em metros */
  minimoM: number | null;
  maximoM: number | null;
  larguraKm: number;
  alturaKm: number;
  /** intervalo entre estratos da parede, em metros */
  estratoM: number;
}

const CORES = {
  fundo: 0x070a10,
  grade: 0x1b2430,
  agulha: 0x5de0b0,
};

export class BlocoCena {
  private cena = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controles: OrbitControls;
  private raf = 0;
  private descartada = false;

  private grupo = new THREE.Group();
  private terreno: THREE.Mesh | null = null;
  private paredes: THREE.Mesh | null = null;
  private campoMesh: THREE.Mesh | null = null;
  private agulha: THREE.Group | null = null;

  private matTerreno: THREE.ShaderMaterial;
  private matParede: THREE.ShaderMaterial;
  private matCampo: THREE.ShaderMaterial;

  private relevo: RelevoPronto | null = null;
  private campo: CampoEscalar | null = null;
  private escala: EscalaCampo | null = null;

  private exagero = 12;
  private alturaCampoKm = 0;
  private mostrarCampo = true;
  private mostrarParedes = true;
  private estratoM = 500;
  private pisoY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.cena.background = new THREE.Color(CORES.fundo);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 20000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.controles = new OrbitControls(this.camera, canvas);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    // O bloco tem um "chão": deixar a câmera passar por baixo dele mostra a
    // face inferior, que não carrega informação nenhuma e desorienta.
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.minDistance = 2;
    this.controles.screenSpacePanning = false;

    this.matTerreno = new THREE.ShaderMaterial({
      vertexShader: TERRENO_VERT, fragmentShader: TERRENO_FRAG,
      uniforms: { uOpacidade: { value: 1 } },
      vertexColors: true,
    });
    this.matParede = new THREE.ShaderMaterial({
      vertexShader: PAREDE_VERT, fragmentShader: PAREDE_FRAG,
      uniforms: { uPasso: { value: this.estratoM }, uOpacidade: { value: 1 } },
      side: THREE.DoubleSide,
    });
    this.matCampo = new THREE.ShaderMaterial({
      vertexShader: CAMPO_VERT, fragmentShader: CAMPO_FRAG,
      uniforms: { uOpacidade: { value: 0.78 } },
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.cena.add(this.grupo);
    this.laco();
  }

  // --------------------------------------------------------------- geometria

  private alturaKm(metros: number) { return kmDeMetros(metros, this.exagero); }

  definirRelevo(relevo: RelevoPronto) {
    if (this.descartada) return;
    this.relevo = relevo;
    // O passo de estrato acompanha a amplitude: 500 m num bloco alpino é
    // legível, e num bloco de planície seria uma faixa só.
    this.estratoM = estratoPara((relevo.maximo ?? 0) - (relevo.minimo ?? 0));
    this.matParede.uniforms.uPasso.value = this.estratoM;
    this.reconstruir();
    this.enquadrar();
  }

  definirCampo(campo: CampoEscalar | null, escala: EscalaCampo | null) {
    if (this.descartada) return;
    this.campo = campo;
    this.escala = escala;
    this.reconstruirCampo();
  }

  private reconstruir() {
    this.limparMalhas();
    const r = this.relevo;
    if (!r) return;

    const { nx, ny } = r.campo;
    // A GEOMETRIA MORA FORA DO MOTOR — ver src/bloco/geometria.ts. Aqui só se
    // pinta o que ela devolve e se entrega à GPU.
    const bruta = malhaDoTerreno(r.campo, r.caixa, this.exagero, r.minimo ?? 0);

    const cor = new Float32Array(bruta.vertices * 3);
    for (let k = 0; k < bruta.vertices; k++) {
      const [cr, cg, cb] = corDaRampa(HIPSO, bruta.altitude[k]);
      cor[k * 3] = sRGBparaLinear(cr);
      cor[k * 3 + 1] = sRGBparaLinear(cg);
      cor[k * 3 + 2] = sRGBparaLinear(cb);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(bruta.posicao, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
    geo.setAttribute("alt", new THREE.BufferAttribute(bruta.altitude, 1));
    geo.setIndex(new THREE.BufferAttribute(bruta.indice, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terreno = new THREE.Mesh(geo, this.matTerreno);
    this.terreno.frustumCulled = false;
    this.grupo.add(this.terreno);

    this.construirParedes(bruta, nx, ny);
    this.reconstruirCampo();
    this.construirAgulha();
  }

  /**
   * A SAIA DO BLOCO: cada vértice da borda desce até o piso.
   *
   * Sem ela o terreno é uma casca fina e o recorte parece um tapete flutuando,
   * não um pedaço de planeta. Com ela o bloco ganha volume — e, mais
   * importante, ganha a superfície onde a escala vertical pode ser lida.
   */
  private construirParedes(bruta: MalhaBruta, nx: number, ny: number) {
    const r = this.relevo;
    if (!r) return;
    const { largura } = tamanhoKm(r.caixa);
    const saia = saiaDoBloco(bruta, nx, ny, r.minimo ?? 0, this.exagero, largura);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(saia.posicao, 3));
    geo.setAttribute("alt", new THREE.BufferAttribute(saia.altitude, 1));
    geo.computeBoundingSphere();

    this.paredes = new THREE.Mesh(geo, this.matParede);
    this.paredes.frustumCulled = false;
    this.paredes.visible = this.mostrarParedes;
    this.grupo.add(this.paredes);
    this.pisoY = saia.pisoY;
  }

  /**
   * A MALHA DO CAMPO, flutuando acima do terreno.
   *
   * A altura aqui é VALOR, não altitude — ver o cabeçalho deste arquivo. Ela
   * ocupa uma faixa própria, acima do pico mais alto do recorte, para que o vão
   * entre as duas superfícies deixe claro que são coisas diferentes.
   */
  private reconstruirCampo() {
    if (this.campoMesh) {
      this.grupo.remove(this.campoMesh);
      this.campoMesh.geometry.dispose();
      this.campoMesh = null;
    }
    const r = this.relevo, c = this.campo, e = this.escala;
    if (!r || !c || !e || c.nx < 2 || c.ny < 2) return;

    const m = metricaDa(r.caixa);
    const { largura } = tamanhoKm(r.caixa);
    const { base, espessura } = faixaDoCampo(
      r.maximo ?? 0, this.exagero, largura, this.alturaCampoKm);

    const { nx, ny } = c;
    const n = nx * ny;
    const pos = new Float32Array(n * 3);
    const cor = new Float32Array(n * 3);
    const faixa = e.hi - e.lo;
    const inv = Math.abs(faixa) > 0 ? 1 / faixa : 0;

    for (let j = 0; j < ny; j++) {
      const lat = latDaLinhaDoBloco(j, ny, r.caixa);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const lng = lngDaColunaDoBloco(i, nx, r.caixa);
        const tem = medido(c, k);
        const v = tem ? c.valores[k] : e.lo;
        const t = Math.max(0, Math.min(1, (v - e.lo) * inv));
        pos[k * 3] = (lng - m.lngC) * m.kmPorLng;
        pos[k * 3 + 1] = base + t * espessura;
        pos[k * 3 + 2] = (m.latC - lat) * m.kmPorLat;
        const [cr, cg, cb] = tem ? corDoValor(e.stops, v, e.modo) : [90, 96, 104];
        cor[k * 3] = sRGBparaLinear(cr);
        cor[k * 3 + 1] = sRGBparaLinear(cg);
        cor[k * 3 + 2] = sRGBparaLinear(cb);
      }
    }

    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = j * nx + i + 1;
        const cc = (j + 1) * nx + i + 1, d = (j + 1) * nx + i;
        if (!medido(c, a) || !medido(c, b) || !medido(c, cc) || !medido(c, d)) continue;
        idx.push(a, b, cc, a, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.campoMesh = new THREE.Mesh(geo, this.matCampo);
    this.campoMesh.frustumCulled = false;
    this.campoMesh.renderOrder = 2;
    this.campoMesh.visible = this.mostrarCampo;
    this.grupo.add(this.campoMesh);
  }

  /**
   * A AGULHA do ponto escolhido.
   *
   * Um bloco sem âncora é bonito e não responde "onde eu cliquei". A agulha
   * sobe do piso, atravessa o terreno e chega à malha do campo — é ela que
   * amarra as duas superfícies à MESMA coluna vertical, que é a leitura que o
   * bloco existe para permitir.
   */
  private construirAgulha() {
    if (this.agulha) { this.grupo.remove(this.agulha); this.agulha = null; }
    const r = this.relevo;
    if (!r) return;

    const { largura } = tamanhoKm(r.caixa);
    const faixa = faixaDoCampo(r.maximo ?? 0, this.exagero, largura, this.alturaCampoKm);
    const topo = faixa.base + faixa.espessura;
    const piso = this.pisoY;

    const g = new THREE.Group();
    const linha = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, piso, 0), new THREE.Vector3(0, topo * 1.04, 0),
    ]);
    g.add(new THREE.Line(linha, new THREE.LineBasicMaterial({
      color: CORES.agulha, transparent: true, opacity: 0.55,
    })));

    const bola = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.12, largura * 0.006), 12, 10),
      new THREE.MeshBasicMaterial({ color: CORES.agulha }),
    );
    // No terreno, e não no ar: é ali que o ponto foi clicado.
    const alturaNoCentro = this.alturaDoCentro();
    bola.position.set(0, alturaNoCentro, 0);
    g.add(bola);

    this.agulha = g;
    this.grupo.add(g);
  }

  private alturaDoCentro(): number {
    const r = this.relevo;
    if (!r) return 0;
    const { nx, ny } = r.campo;
    const k = Math.floor(ny / 2) * nx + Math.floor(nx / 2);
    return this.alturaKm(medido(r.campo, k) ? r.campo.valores[k] : (r.minimo ?? 0));
  }

  // ------------------------------------------------------------------ câmera

  /** Põe a câmera numa vista de três quartos que mostra topo e parede. */
  enquadrar() {
    const r = this.relevo;
    if (!r) return;
    const { largura, altura } = tamanhoKm(r.caixa);
    const d = Math.max(largura, altura);
    this.controles.target.set(0, this.alturaKm((r.maximo ?? 0) * 0.4), 0);
    // Do sudeste e de cima: mostra a parede sul e a leste ao mesmo tempo, que
    // é o enquadramento clássico do diagrama de bloco.
    this.camera.position.set(d * 0.78, d * 0.62, d * 0.95);
    this.controles.maxDistance = d * 6;
    this.controles.update();
  }

  redimensionar() {
    if (this.descartada) return;
    const l = Math.max(1, this.canvas.clientWidth);
    const a = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(l, a, false);
    this.camera.aspect = l / a;
    this.camera.updateProjectionMatrix();
  }

  private laco() {
    const passo = () => {
      if (this.descartada) return;
      this.controles.update();
      this.renderer.render(this.cena, this.camera);
      this.raf = requestAnimationFrame(passo);
    };
    this.raf = requestAnimationFrame(passo);
  }

  // ---------------------------------------------------------------- controles

  definirExagero(x: number) {
    this.exagero = Math.max(1, Math.min(60, x));
    this.reconstruir();
  }
  definirAlturaCampo(km: number) {
    this.alturaCampoKm = Math.max(0, km);
    this.reconstruirCampo();
    this.construirAgulha();
  }
  definirMostrarCampo(on: boolean) {
    this.mostrarCampo = on;
    if (this.campoMesh) this.campoMesh.visible = on;
  }
  definirMostrarParedes(on: boolean) {
    this.mostrarParedes = on;
    if (this.paredes) this.paredes.visible = on;
  }
  definirOpacidadeCampo(o: number) {
    this.matCampo.uniforms.uOpacidade.value = Math.max(0.1, Math.min(1, o));
  }

  get estado(): EstadoBloco {
    const r = this.relevo;
    const t = r ? tamanhoKm(r.caixa) : { largura: 0, altura: 0 };
    return {
      minimoM: r?.minimo ?? null,
      maximoM: r?.maximo ?? null,
      larguraKm: t.largura,
      alturaKm: t.altura,
      estratoM: this.estratoM,
    };
  }

  // ------------------------------------------------------------------ limpeza

  private limparMalhas() {
    for (const o of [this.terreno, this.paredes, this.campoMesh]) {
      if (!o) continue;
      this.grupo.remove(o);
      o.geometry.dispose();
    }
    this.terreno = null; this.paredes = null; this.campoMesh = null;
    if (this.agulha) {
      for (const f of this.agulha.children) {
        const m = f as THREE.Mesh | THREE.Line;
        m.geometry?.dispose?.();
        (m.material as THREE.Material)?.dispose?.();
      }
      this.grupo.remove(this.agulha);
      this.agulha = null;
    }
  }

  dispose() {
    this.descartada = true;
    cancelAnimationFrame(this.raf);
    this.limparMalhas();
    this.matTerreno.dispose();
    this.matParede.dispose();
    this.matCampo.dispose();
    this.controles.dispose();

    // `dispose()` SOZINHO NÃO DEVOLVE O CONTEXTO WEBGL.
    //
    // Ele libera os recursos que o three alocou dentro do contexto, e deixa o
    // contexto vivo — o navegador só o recolhe quando o coletor de lixo chega
    // no canvas, o que pode demorar muito. E o teto de contextos simultâneos é
    // baixo: os navegadores param em torno de dezesseis.
    //
    // Este painel abre e fecha, e o modo estrito do React monta, desmonta e
    // monta de novo. Sem `forceContextLoss` cada ciclo vazava um contexto, e
    // depois de algumas aberturas `new WebGLRenderer` passava a LANÇAR. O
    // efeito visível era o painel deixar de abrir — sem erro na tela, porque
    // um erro dentro de efeito derruba a árvore inteira do React.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
