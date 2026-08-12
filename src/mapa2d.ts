// src/mapa2d.ts
// -----------------------------------------------------------------------------
// MOTOR 2D — o mesmo planeta, aberto na mesa.
// -----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO NÃO É UM "GLOBO ACHATADO"
//
// O `globe.ts` é construído sobre o globe.gl, que é uma esfera por definição:
// a câmera é orbital, as camadas de ponto e polígono são projetadas na
// superfície, e a própria noção de "altitude" organiza a profundidade. Não há
// como achatar aquilo — só como escrever o equivalente plano.
//
// O que torna isso barato é uma coincidência que não é coincidência: quase
// tudo que o globo desenha JÁ está em espaço equirretangular antes de virar
// esfera. A textura de rastro do vento, a imagem do GIBS, a grade do GFS. No
// globo, o shader reprojeta na esfera; aqui, cola no plano sem conta nenhuma.
//
// O `WindGPU` é reaproveitado SEM UMA LINHA DE MUDANÇA. Ele simula em UV
// normalizado e entrega uma textura; quem decide o que fazer com ela é o
// motor. Era assim antes de existir modo 2D, por acaso feliz de arquitetura.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { WindGPU } from "./windGPU";
import { PerfMonitor, TIERS, type FrameStats } from "./perf";
import type { Quake, WindGrid, IsobarSet, Fire, MotorGeo } from "./tipos";
import {
  MUNDO_W, MUNDO_H, COPIAS,
  aplicarZoom, travarVista, larguraGraus, daTela, enrolarLng, cruzaEmenda,
  type Vista,
} from "./projecao";
import {
  planoDeTiles, tilesEm, tilesMercator, nivelRelevo, mercY, alturaTerrarium,
  LAT_MERC, type Tile,
} from "./tiles";

const TEX_BASE = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const TEX_NOITE = "https://unpkg.com/three-globe/example/img/earth-night.jpg";

// -----------------------------------------------------------------------------
// SHADERS
// -----------------------------------------------------------------------------
// Todos partilham o mesmo vértice: um plano, uv direta. A única sutileza está
// no `1.0 - uv.y` do fragmento.
//
// POR QUE INVERTER O V. Tanto a textura do GIBS (carregada com `flipY = false`)
// quanto o alvo de render do vento têm a PRIMEIRA linha no NORTE. Num
// PlaneGeometry, porém, `uv.y = 0` é a borda de BAIXO — o sul. Sem a inversão
// o mundo aparece de cabeça para baixo, e o pior é que fica plausível: o
// Atlântico continua parecendo o Atlântico.

const PLANO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RASTER_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uFade;
  varying vec2 vUv;

  void main() {
    vec4 c = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y));
    if (c.a < 0.05) discard;
    gl_FragColor = vec4(c.rgb, c.a * uOpacity * uFade);
  }
`;

/**
 * RELEVO E BATIMETRIA — o dado, sombreado.
 *
 * A textura é um atlas de tiles `terrarium`: cada pixel guarda a altitude real
 * em metros, codificada em RGB com deslocamento de 32.768. Isso é o que separa
 * este shader de uma imagem de relevo pronta — aqui o número existe, e por
 * isso dá para pintar o oceano por PROFUNDIDADE e a terra por ALTITUDE com a
 * mesma fonte, e responder "-4.128 m" quando alguém perguntar.
 *
 * A REPROJEÇÃO. Os tiles só existem em Mercator; o mapa é equirretangular. A
 * conversão é feita aqui, por pixel: a latitude do fragmento vira y de
 * Mercator e é isso que indexa o atlas. Fazer no shader evita reamostrar o
 * dado duas vezes — reprojetar na CPU e depois deixar a GPU interpolar
 * borraria detalhe que custou requisição.
 */
const RELEVO_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec4 uAtlas;      // latN, latS, lngO, lngL cobertos pelo atlas
  uniform vec2 uPasso;      // tamanho de um texel, para o gradiente
  uniform float uExagero;   // exagero vertical do sombreamento
  varying vec2 vUv;
  const float PI = 3.14159265359;

  float mercY(float latGraus) {
    float l = clamp(latGraus, -85.0511, 85.0511);
    return 0.5 - log(tan(PI / 4.0 + radians(l) / 2.0)) / (2.0 * PI);
  }

  /** metros = (R·256 + G + B/256) − 32768 */
  float metros(vec2 uv) {
    vec3 c = texture2D(uMap, uv).rgb * 255.0;
    return (c.r * 256.0 + c.g + c.b / 256.0) - 32768.0;
  }

  void main() {
    // vUv está no plano equirretangular; vira lat/lng reais
    float lat = mix(uAtlas.y, uAtlas.x, vUv.y);
    float lng = mix(uAtlas.z, uAtlas.w, vUv.x);

    // ... e a latitude vira linha de Mercator dentro do atlas
    float y0 = mercY(uAtlas.x);
    float y1 = mercY(uAtlas.y);
    float v = (mercY(lat) - y0) / max(1e-9, y1 - y0);
    if (v < 0.0 || v > 1.0) discard;

    vec2 uv = vec2(vUv.x, v);
    float h = metros(uv);

    // Sombreamento por gradiente, luz do noroeste — a convenção cartográfica.
    // Vem depois da reprojeção de propósito: o gradiente é medido no atlas, que
    // é onde os texels são quadrados.
    float hx = metros(uv + vec2(uPasso.x, 0.0)) - metros(uv - vec2(uPasso.x, 0.0));
    float hy = metros(uv + vec2(0.0, uPasso.y)) - metros(uv - vec2(0.0, uPasso.y));
    vec3 n = normalize(vec3(-hx * uExagero, -hy * uExagero, 220.0));
    float luz = clamp(dot(n, normalize(vec3(-0.6, 0.6, 0.55))), 0.0, 1.0);

    vec3 cor;
    if (h < 0.0) {
      // BATIMETRIA. Faixa útil até ~-6.000 m; a raiz comprime o abissal, que é
      // quase todo o fundo do mar, e abre a plataforma continental — que é onde
      // a profundidade muda depressa e importa.
      float p = clamp(sqrt(min(-h, 6000.0) / 6000.0), 0.0, 1.0);
      cor = mix(vec3(0.42, 0.62, 0.74), vec3(0.02, 0.06, 0.16), p);
    } else {
      float p = clamp(h / 4500.0, 0.0, 1.0);
      cor = mix(vec3(0.20, 0.29, 0.22), vec3(0.52, 0.47, 0.40), sqrt(p));
      cor = mix(cor, vec3(0.93, 0.94, 0.96), smoothstep(0.62, 1.0, p));  // neve
    }

    cor *= 0.55 + luz * 0.75;
    gl_FragColor = vec4(cor, uOpacity);
  }
`;

const VENTO_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 c = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y));
    if (c.a < 0.015) discard;

    // No globo havia um corte de limbo (esconder o que está de perfil) e um
    // corte polar (esconder o leque que a projeção cria nos polos). Aqui não
    // existe limbo: o mapa inteiro está de frente.
    //
    // O corte polar TAMBÉM sai, e de propósito. Na esfera o leque é artefato
    // de reprojeção; no mapa plano o esticamento é a projeção sendo honesta
    // sobre o que ela é. Esconder ali seria apagar dado real do Ártico, que é
    // justamente onde a corrente de jato importa.
    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }
`;

/**
 * Terminador dia/noite.
 *
 * Calculado por pixel a partir do ângulo zenital solar, em vez de simulado com
 * luz direcional como no globo — num plano não há normal que ajude. A conta é
 * a padrão de astronomia de posição:
 *
 *   cos(z) = sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(H)
 *
 * onde δ é a declinação solar e H o ângulo horário. O `smoothstep` reproduz o
 * crepúsculo: a sombra não tem borda de faca no planeta real.
 */
const NOITE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uDecl;      // declinação solar, radianos
  uniform float uLngSol;    // longitude subsolar, radianos
  uniform float uForca;
  varying vec2 vUv;
  const float PI = 3.14159265359;

  void main() {
    float lat = (vUv.y - 0.5) * PI;          // -PI/2 .. PI/2
    float lng = (vUv.x - 0.5) * 2.0 * PI;    // -PI .. PI

    float cosZ = sin(lat) * sin(uDecl) + cos(lat) * cos(uDecl) * cos(lng - uLngSol);

    // -0.10 rad ~ -6 graus: o fim do crepúsculo civil.
    float luz = smoothstep(-0.18, 0.10, cosZ);
    float sombra = (1.0 - luz) * uForca;
    if (sombra < 0.01) discard;

    gl_FragColor = vec4(0.01, 0.02, 0.05, sombra);
  }
`;

/** Discos dos marcadores: sismo, foco de calor, estação, hospital. */
const PONTO_VERT = /* glsl */ `
  precision highp float;
  attribute float aTam;
  attribute vec3 aCor;
  uniform float uEscala;
  varying vec3 vCor;
  void main() {
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aTam * uEscala;
  }
`;

const PONTO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // núcleo sólido com borda suave: legível a 6 px, sem serrilhado a 60
    float a = 1.0 - smoothstep(0.72, 1.0, r);
    float brilho = 1.0 - smoothstep(0.0, 0.55, r);
    gl_FragColor = vec4(vCor + brilho * 0.35, a);
  }
`;

/** Anel pulsante dos sismos: o mesmo gesto do globo, feito em shader. */
const ANEL_VERT = /* glsl */ `
  precision highp float;
  attribute float aTam;
  attribute float aFase;
  attribute float aPeriodo;
  attribute vec3 aCor;
  uniform float uTempo;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vFase;
  void main() {
    float t = fract(uTempo / aPeriodo + aFase);
    vFase = t;
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aTam * uEscala * (0.15 + t * 0.85);
  }
`;

const ANEL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCor;
  varying float vFase;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float anel = smoothstep(0.62, 0.90, r) * (1.0 - smoothstep(0.90, 1.0, r));
    float a = anel * (1.0 - vFase) * 0.85;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCor, a);
  }
`;

// -----------------------------------------------------------------------------

interface CamadaRaster {
  malhas: THREE.Mesh[];
  material: THREE.ShaderMaterial;
  visivel(on: boolean): void;
}

interface ItemTile {
  z: number;
  malhas: THREE.Mesh[];
  material: THREE.ShaderMaterial;
  tex: THREE.Texture | null;
}

const EMBER: [number, [number, number, number]][] = [
  [0.00, [176, 42, 16]],
  [0.35, [236, 108, 24]],
  [0.68, [255, 190, 74]],
  [1.00, [255, 248, 232]],
];

function brasa(k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, k));
  for (let i = 1; i < EMBER.length; i++) {
    const [v1, c1] = EMBER[i];
    if (t > v1) continue;
    const [v0, c0] = EMBER[i - 1];
    const f = (v1 - v0) === 0 ? 0 : (t - v0) / (v1 - v0);
    return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
  }
  return EMBER[EMBER.length - 1][1];
}

export class MapEngine implements MotorGeo {
  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-180, 180, 90, -90, -100, 100);
  private raf = 0;
  private disposed = false;

  private vista: Vista = { lng: -48, lat: -15, alturaGraus: 120 };
  private largura = 1;
  private altura = 1;
  private ro: ResizeObserver | null = null;
  private aoRedimensionar: (() => void) | null = null;

  private time = new Date();
  private dayNight = true;
  private girando = false;

  // camadas raster, de baixo para cima
  private base: CamadaRaster | null = null;
  private noite: CamadaRaster | null = null;
  private imagem: CamadaRaster | null = null;
  private correntes: CamadaRaster | null = null;
  private vento: CamadaRaster | null = null;

  private imgTex: THREE.Texture | null = null;
  private imgFade = 0;
  private imgToken = 0;
  private imgOpacidade = 0.9;

  // pirâmide de tiles
  private geoTile = new THREE.PlaneGeometry(1, 1, 1, 1);
  private tiles = new Map<string, ItemTile>();
  private camadaTile: string | null = null;
  private nivelAtual = -1;
  private nivelAnterior = -1;
  private assentar: number | null = null;

  // relevo e batimetria
  private relevo: CamadaRaster | null = null;
  private relevoOn = false;
  private relevoTex: THREE.Texture | null = null;
  private relevoChave = "";
  private relevoToken = 0;
  /** amostras de altitude do atlas atual, para responder em metros */
  private relevoAmostra: {
    dados: Uint8ClampedArray; w: number; h: number;
    latN: number; latS: number; lngO: number; lngL: number;
  } | null = null;

  private windGPU: WindGPU | null = null;
  private windGrid: WindGrid | null = null;
  private windOn = false;
  private densidadeVento = 1;

  private currentGPU: WindGPU | null = null;
  private currentGrid: WindGrid | null = null;
  private currentsOn = false;

  // camadas vetoriais
  private fronteiras: THREE.LineSegments | null = null;
  private isobaras: THREE.LineSegments | null = null;
  private isobarData: IsobarSet | null = null;
  private isobarsOn = false;

  private pontos: THREE.Points | null = null;
  private aneis: THREE.Points | null = null;
  private marcador: THREE.Points | null = null;

  private rawQuakes: Quake[] = [];
  private rawFires: Fire[] = [];
  private rawOpenAQ: any[] = [];
  private rawHospitals: any[] = [];
  private clickTarget: { lat: number; lng: number } | null = null;

  private clickFn: ((lat: number, lng: number) => void) | null = null;
  private noticeFn: ((msg: string | null) => void) | null = null;
  private statsFn: ((s: FrameStats) => void) | null = null;

  readonly perf = new PerfMonitor();
  private baseDpr = 1;
  private relogio = 0;

  // ------------------------------------------------------------------ ciclo

  mount(container: HTMLElement) {
    this.container = container;

    const rnd = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rnd.setClearColor(0x04060a, 1);
    this.baseDpr = window.devicePixelRatio || 1;
    rnd.setPixelRatio(Math.min(this.baseDpr, TIERS[this.perf.tier].dpr));
    rnd.domElement.style.display = "block";
    rnd.domElement.style.width = "100%";
    rnd.domElement.style.height = "100%";
    rnd.domElement.style.touchAction = "none";
    container.appendChild(rnd.domElement);
    this.renderer = rnd;

    this.perf.onTierChange((t) => {
      rnd.setPixelRatio(Math.min(this.baseDpr, TIERS[t].dpr));
      const q = TIERS[t];
      this.windGPU?.resize(q.trail, this.particulasAlvo(q.particles), q.fadeEvery);
    });

    this.criarBase();
    this.criarNoite();

    const medir = () => {
      if (this.disposed || !this.renderer) return;
      this.largura = container.clientWidth || window.innerWidth;
      this.altura = container.clientHeight || window.innerHeight;
      this.renderer.setSize(this.largura, this.altura, false);
      this.ajustarCamera();
    };
    medir();
    requestAnimationFrame(medir);
    this.ro = new ResizeObserver(medir);
    this.ro.observe(container);
    this.aoRedimensionar = medir;
    window.addEventListener("resize", medir);

    this.ligarGestos(rnd.domElement);
    this.aplicarSol();
    void this.carregarFronteiras();
    this.loop();
  }

  private loop() {
    let prev = 0;
    const passo = (t: number) => {
      if (this.disposed) return;
      this.perf.begin();
      const dt = prev ? Math.min((t - prev) / 1000, 0.05) : 0;
      prev = t;
      this.relogio += dt;

      if (this.girando) {
        this.vista.lng = enrolarLng(this.vista.lng + dt * 3);
        this.ajustarCamera();
      }

      // Aparecimento da imagem: os mesmos 400 ms do globo. Trocar de camada com
      // corte seco parece falha de carregamento.
      if (this.imagem && this.imgFade < 1 && this.imgTex) {
        this.imgFade = Math.min(1, this.imgFade + dt * 2.5);
        this.imagem.material.uniforms.uFade.value = this.imgFade;
      }

      // O WindGPU alterna entre dois alvos de render a cada quadro (ping-pong),
      // então `texture` devolve um objeto DIFERENTE toda vez. Sem reapontar o
      // uniform, o plano ficaria amarrado ao alvo de um quadro só e o rastro
      // pararia — ou pior, piscaria a 30 Hz entre dois estados.
      if (this.windOn && this.windGPU && this.windGrid) {
        this.windGPU.step(dt);
        if (this.vento) this.vento.material.uniforms.uMap.value = this.windGPU.texture;
      }
      if (this.currentsOn && this.currentGPU && this.currentGrid) {
        this.currentGPU.step(dt);
        if (this.correntes) this.correntes.material.uniforms.uMap.value = this.currentGPU.texture;
      }

      if (this.aneis) {
        (this.aneis.material as THREE.ShaderMaterial).uniforms.uTempo.value = this.relogio;
      }

      if (this.renderer) this.renderer.render(this.scene, this.camera);
      this.perf.end(t, this.renderer ?? undefined);
      if (this.statsFn) this.statsFn(this.perf.stats);
      this.raf = requestAnimationFrame(passo);
    };
    this.raf = requestAnimationFrame(passo);
  }

  // ----------------------------------------------------------------- câmera

  private ajustarCamera() {
    const aspecto = this.largura / Math.max(1, this.altura);
    this.vista = travarVista(this.vista, aspecto);

    const gh = this.vista.alturaGraus;
    const gw = larguraGraus(gh, aspecto);

    this.camera.left = -gw / 2;
    this.camera.right = gw / 2;
    this.camera.top = gh / 2;
    this.camera.bottom = -gh / 2;
    this.camera.position.set(this.vista.lng, this.vista.lat, 10);
    this.camera.updateProjectionMatrix();

    // Marcadores encolhem com o zoom se o tamanho for em unidades de mundo, e
    // incham se for em pixel puro. A escala amarra ao tamanho do pixel: um
    // sismo tem o mesmo peso visual perto e longe.
    const escala = Math.min(3, Math.max(0.55, 90 / gh));
    for (const p of [this.pontos, this.aneis, this.marcador]) {
      if (p) (p.material as THREE.ShaderMaterial).uniforms.uEscala.value = escala;
    }

    this.agendarAssentamento();
  }

  /**
   * Tiles, relevo e janela do vento só são refeitos quando a vista PARA.
   *
   * Refazer durante o arrasto pediria uma pilha de tiles por quadro e
   * apagaria o rastro do vento continuamente. Durante o movimento tudo que
   * está na tela continua correto — o que já foi carregado está ancorado em
   * coordenada de mundo e acompanha o mapa. O que muda ao parar é só a
   * RESOLUÇÃO.
   */
  private agendarAssentamento() {
    if (this.assentar != null) window.clearTimeout(this.assentar);
    this.assentar = window.setTimeout(() => {
      this.assentar = null;
      if (this.disposed) return;
      this.atualizarTiles();
      this.atualizarJanelaVento();
      if (this.relevoOn) void this.atualizarRelevo();
    }, 180);
  }

  /**
   * Amarra a simulação de partículas à região visível.
   *
   * Com uma folga de 15% em volta: sem ela, uma partícula que entra pela borda
   * nasceria exatamente ali, visivelmente, em vez de já chegar em movimento.
   */
  private atualizarJanelaVento() {
    if (!this.windGPU) return;

    const aspecto = this.largura / Math.max(1, this.altura);
    const gw = larguraGraus(this.vista.alturaGraus, aspecto);
    const gh = this.vista.alturaGraus;

    const folgaW = Math.min(360, gw * 1.15);
    const folgaH = Math.min(180, gh * 1.15);

    if (folgaW >= 359 && folgaH >= 179) {
      this.windGPU.setJanela(0, 0, 1, 1);
    } else {
      const oeste = (this.vista.lng - folgaW / 2 + 180) / 360;
      const norte = 90 - this.vista.lat - folgaH / 2;   // y global cresce para o sul
      this.windGPU.setJanela(oeste, norte / 180, folgaW / 360, folgaH / 180);
    }

    // O TAMANHO DA PARTÍCULA ACOMPANHA O ZOOM.
    //
    // Só a janela já resolve o borrão — o rastro deixa de ser ampliado. Mas de
    // perto, com o rastro em escala 1:1, uma partícula do tamanho de "vento
    // planetário" vira um traço grosso demais para ler estrutura local. Encolhe
    // suavemente: 1,0 vendo o mundo, ~0,55 numa vista de poucos graus.
    this.windGPU.escalaPonto = 0.55 + 0.45 * Math.pow(Math.min(1, gh / 180), 0.35);
  }

  flyTo(lat: number, lng: number, altitude?: number) {
    this.vista.lat = lat;
    this.vista.lng = enrolarLng(lng);
    // O globo recebe `altitude` em raios; aqui o análogo é a altura em graus.
    // 1.6 (o padrão de lá) vira uma vista regional de ~28°.
    if (altitude != null) this.vista.alturaGraus = Math.min(180, Math.max(2, altitude * 17.5));
    this.ajustarCamera();
  }

  // ----------------------------------------------------------------- gestos

  private ligarGestos(el: HTMLElement) {
    let arrastando = false;
    let px = 0, py = 0, andou = 0;
    let id = -1;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      arrastando = true; andou = 0;
      px = e.clientX; py = e.clientY; id = e.pointerId;
      el.setPointerCapture(id);
    });

    el.addEventListener("pointermove", (e) => {
      if (!arrastando) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      andou += Math.abs(dx) + Math.abs(dy);

      const aspecto = this.largura / Math.max(1, this.altura);
      const gw = larguraGraus(this.vista.alturaGraus, aspecto);
      this.vista.lng -= (dx / Math.max(1, this.largura)) * gw;
      this.vista.lat += (dy / Math.max(1, this.altura)) * this.vista.alturaGraus;
      this.ajustarCamera();
    });

    const soltar = (e: PointerEvent) => {
      if (!arrastando) return;
      arrastando = false;
      try { el.releasePointerCapture(id); } catch { /* já solto */ }

      // Arrastar o mapa não é clicar nele. Sem este limiar, todo pan termina
      // abrindo a sonda num ponto que o usuário nunca escolheu.
      if (andou > 5) return;
      const r = el.getBoundingClientRect();
      const g = daTela(e.clientX - r.left, e.clientY - r.top, this.largura, this.altura, this.vista);
      this.clickFn?.(g.lat, g.lng);
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", () => { arrastando = false; });

    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const antes = daTela(e.clientX - r.left, e.clientY - r.top, this.largura, this.altura, this.vista);

      this.vista.alturaGraus = aplicarZoom(this.vista.alturaGraus, e.deltaY > 0 ? 1 : -1);
      this.ajustarCamera();

      // ZOOM ANCORADO NO CURSOR. Sem isto o mapa aproxima no centro da tela e o
      // lugar que a pessoa estava mirando escapa para fora — a diferença entre
      // um mapa que obedece e um que precisa ser corrigido a cada passo.
      const depois = daTela(e.clientX - r.left, e.clientY - r.top, this.largura, this.altura, this.vista);
      this.vista.lng += enrolarLng(antes.lng - depois.lng);
      this.vista.lat += antes.lat - depois.lat;
      this.ajustarCamera();
    }, { passive: false });
  }

  // ---------------------------------------------------------------- rasters

  /** Cria as três cópias lado a lado de uma camada de imagem. */
  private criarRaster(material: THREE.ShaderMaterial, z: number): CamadaRaster {
    const geo = new THREE.PlaneGeometry(MUNDO_W, MUNDO_H, 1, 1);
    const malhas = COPIAS.map((dx) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(dx, 0, z);
      m.renderOrder = z;
      this.scene.add(m);
      return m;
    });
    return {
      malhas, material,
      visivel: (on: boolean) => { for (const m of malhas) m.visible = on; },
    };
  }

  private criarBase() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uOpacity: { value: 1 }, uFade: { value: 1 } },
      vertexShader: PLANO_VERT, fragmentShader: RASTER_FRAG,
      transparent: false, depthWrite: false, depthTest: false,
    });
    this.base = this.criarRaster(mat, 0);
    this.carregarTextura(TEX_BASE, (tex) => { mat.uniforms.uMap.value = tex; });
  }

  private criarNoite() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uDecl: { value: 0 }, uLngSol: { value: 0 }, uForca: { value: 0.72 } },
      vertexShader: PLANO_VERT, fragmentShader: NOITE_FRAG,
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.noite = this.criarRaster(mat, 1);
  }

  private carregarTextura(url: string, aplicar: (t: THREE.Texture) => void) {
    new THREE.TextureLoader().load(url, (tex) => {
      if (this.disposed) { tex.dispose(); return; }
      if (!tex.image || tex.image.width <= 0 || tex.image.height <= 0) { tex.dispose(); return; }
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      const cap = this.renderer?.capabilities;
      if (cap) tex.anisotropy = Math.min(8, cap.getMaxAnisotropy());
      aplicar(tex);
    }, undefined, () => { /* sem textura, a camada fica invisível */ });
  }

  setBase(estilo: "day" | "night") {
    if (!this.base) return;
    this.carregarTextura(estilo === "night" ? TEX_NOITE : TEX_BASE,
      (tex) => { this.base!.material.uniforms.uMap.value = tex; });
  }

  /**
   * DOIS CAMINHOS, e a diferença não é arbitrária.
   *
   * Camadas do GIBS (`sst`, `MODIS_...`) vêm por TILES: o servidor recorta a
   * região pedida e a resolução acompanha o zoom. Campos do GFS chegam como
   * URL pronta (`/api/fields/...`) e são uma imagem global calculada de uma
   * vez — não há pirâmide do outro lado para pedir, e recortá-los não
   * acrescentaria detalhe nenhum, porque a grade de origem é de 0,25°.
   *
   * Tratar os dois igual seria gastar 12 requisições para reconstruir a mesma
   * imagem que uma requisição já entrega.
   */
  setImagery(id: string | null, date: Date, opacity = 0.9) {
    this.imgToken++;
    this.imgOpacidade = opacity;

    if (!id) {
      this.imagem?.visivel(false);
      this.imgFade = 0;
      this.camadaTile = null;
      this.limparTiles();
      return;
    }

    if (id.startsWith("/")) {
      this.camadaTile = null;
      this.limparTiles();
      this.imagemUnica(id, opacity);
      return;
    }

    this.imagem?.visivel(false);
    const dia = date.toISOString().slice(0, 10);
    const nova = `${id}|${dia}`;
    if (nova !== this.camadaTile) {
      this.camadaTile = nova;
      this.limparTiles();
    }
    this.atualizarTiles();
  }

  private imagemUnica(url: string, opacity: number) {
    if (!this.imagem) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: null }, uOpacity: { value: opacity }, uFade: { value: 0 } },
        vertexShader: PLANO_VERT, fragmentShader: RASTER_FRAG,
        transparent: true, depthWrite: false, depthTest: false,
      });
      this.imagem = this.criarRaster(mat, 2);
      this.imagem.visivel(false);
    }
    this.imagem.material.uniforms.uOpacity.value = opacity;

    const meu = this.imgToken;
    this.carregarTextura(url, (tex) => {
      if (meu !== this.imgToken || !this.imagem) { tex.dispose(); return; }
      this.imgTex?.dispose();
      this.imgTex = tex;
      this.imagem.material.uniforms.uMap.value = tex;
      this.imagem.visivel(true);
      this.imgFade = 0;
    });
  }

  setImageryOpacity(o: number) {
    this.imgOpacidade = o;
    if (this.imagem) this.imagem.material.uniforms.uOpacity.value = o;
    for (const t of this.tiles.values()) t.material.uniforms.uOpacity.value = o;
  }

  // -------------------------------------------------------------- pirâmide

  /**
   * Pede os tiles do nível certo para a vista atual.
   *
   * O NÍVEL 0 FICA SEMPRE CARREGADO. São dois tiles, e eles são o piso: sem
   * eles, cada mudança de zoom abriria buracos pretos até o nível novo chegar.
   * Dois tiles permanentes custam menos que o susto.
   *
   * O nível anterior também sobrevive até o novo estar completo. Trocar de
   * nível é a operação mais visível de um mapa por tiles, e a diferença entre
   * "carregou" e "piscou" está aqui.
   */
  private atualizarTiles() {
    if (!this.camadaTile) return;

    const aspecto = this.largura / Math.max(1, this.altura);
    const gw = larguraGraus(this.vista.alturaGraus, aspecto);
    const meia = this.vista.alturaGraus / 2;

    const { z, lista } = planoDeTiles(
      this.vista.lng - gw / 2, this.vista.lat - meia,
      this.vista.lng + gw / 2, this.vista.lat + meia,
      gw, this.largura, this.renderer?.getPixelRatio() ?? 1,
    );
    const alvo = [...tilesEm(-180, -90, 180, 90, 0), ...lista];

    const querido = new Set(alvo.map((t) => t.chave));
    for (const t of alvo) if (!this.tiles.has(t.chave)) this.pedirTile(t);

    // Descarta o que saiu de vista, menos o nível 0 e o nível anterior, que
    // seguram a imagem enquanto o novo carrega.
    const guardar = new Set([0, z, this.nivelAnterior]);
    for (const [chave, item] of this.tiles) {
      if (querido.has(chave)) continue;
      if (guardar.has(item.z) && item.z !== z) continue;
      this.descartarTile(chave);
    }
    if (z !== this.nivelAtual) { this.nivelAnterior = this.nivelAtual; this.nivelAtual = z; }
  }

  private pedirTile(t: Tile) {
    const camada = this.camadaTile;
    if (!camada) return;
    const [id, dia] = camada.split("|");

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uOpacity: { value: this.imgOpacidade }, uFade: { value: 0 } },
      vertexShader: PLANO_VERT, fragmentShader: RASTER_FRAG,
      transparent: true, depthWrite: false, depthTest: false,
    });

    const lado = t.leste - t.oeste;
    const malhas = COPIAS.map((dx) => {
      const m = new THREE.Mesh(this.geoTile, mat);
      m.scale.set(lado, t.norte - t.sul, 1);
      m.position.set((t.oeste + t.leste) / 2 + dx, (t.sul + t.norte) / 2, 2);
      // Nível mais fino desenha por cima do mais grosso. Sem esta ordem, o
      // nível 0 poderia cobrir o detalhe que acabou de chegar.
      m.renderOrder = 2 + t.z * 0.01;
      m.visible = false;
      this.scene.add(m);
      return m;
    });

    const item: ItemTile = { z: t.z, malhas, material: mat, tex: null };
    this.tiles.set(t.chave, item);

    this.carregarTextura(`/api/tile/${id}/${t.z}/${t.y}/${t.x}?date=${dia}`, (tex) => {
      if (this.tiles.get(t.chave) !== item || camada !== this.camadaTile) { tex.dispose(); return; }
      item.tex = tex;
      mat.uniforms.uMap.value = tex;
      mat.uniforms.uFade.value = 1;
      for (const m of item.malhas) m.visible = true;
    });
  }

  private descartarTile(chave: string) {
    const item = this.tiles.get(chave);
    if (!item) return;
    for (const m of item.malhas) this.scene.remove(m);
    item.material.dispose();
    item.tex?.dispose();
    this.tiles.delete(chave);
  }

  private limparTiles() {
    for (const chave of [...this.tiles.keys()]) this.descartarTile(chave);
    this.nivelAtual = -1;
    this.nivelAnterior = -1;
  }

  // ------------------------------------------------------------------ vento

  setWind(grid: WindGrid | null, key = "único") {
    this.windGrid = grid;
    this.windGPU?.setField(grid, key);
    this.vento?.visivel(this.windOn && !!grid);
  }

  setWindVisible(on: boolean) {
    this.windOn = on;
    if (!on) { this.vento?.visivel(false); return; }
    if (!this.renderer) return;

    if (!this.vento) {
      const q = TIERS[this.perf.tier];
      this.windGPU = new WindGPU(this.renderer, 131072);
      this.windGPU.resize(q.trail, this.particulasAlvo(q.particles), q.fadeEvery);
      if (this.windGrid) this.windGPU.setField(this.windGrid);

      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: this.windGPU.texture }, uOpacity: { value: 0.85 } },
        vertexShader: PLANO_VERT, fragmentShader: VENTO_FRAG,
        transparent: true, depthWrite: false, depthTest: false,
      });
      this.vento = this.criarRaster(mat, 5);
    }
    this.vento.visivel(!!this.windGrid);
  }

  setWindDensity(frac: number) {
    this.densidadeVento = Math.max(0.1, Math.min(1, frac));
    if (!this.windGPU) return;
    const q = TIERS[this.perf.tier];
    this.windGPU.resize(q.trail, this.particulasAlvo(q.particles), q.fadeEvery);
  }

  /** piso de 3.000: abaixo disso não é "menos denso", é um campo vazio */
  private particulasAlvo(base: number) {
    return Math.max(3000, Math.round(base * this.densidadeVento));
  }

  setCurrents(grid: WindGrid | null) {
    this.currentGrid = grid;
    if (!grid) { this.correntes?.visivel(false); return; }
    this.garantirCorrentes();
    this.currentGPU?.setField(grid, "hycom");
    this.correntes?.visivel(this.currentsOn);
  }

  setCurrentsVisible(on: boolean) {
    this.currentsOn = on;
    if (!on) { this.correntes?.visivel(false); return; }
    this.garantirCorrentes();
    this.correntes?.visivel(!!this.currentGrid);
  }

  private garantirCorrentes() {
    if (this.correntes || !this.renderer) return;
    this.currentGPU = new WindGPU(this.renderer, 49152);
    this.currentGPU.speed = 0.45;
    this.currentGPU.fade = 0.992;
    if (this.currentGrid) this.currentGPU.setField(this.currentGrid, "hycom");

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.currentGPU.texture }, uOpacity: { value: 0.7 } },
      vertexShader: PLANO_VERT, fragmentShader: VENTO_FRAG,
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.correntes = this.criarRaster(mat, 4);
    this.correntes.visivel(false);
  }

  // ------------------------------------------------------ relevo e batimetria

  setRelevo(on: boolean) {
    this.relevoOn = on;
    if (!on) { this.relevo?.visivel(false); return; }
    if (!this.relevo) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uOpacity: { value: 1 },
          uAtlas: { value: new THREE.Vector4(90, -90, -180, 180) },
          uPasso: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
          uExagero: { value: 1.6 },
        },
        vertexShader: PLANO_VERT, fragmentShader: RELEVO_FRAG,
        transparent: true, depthWrite: false, depthTest: false,
      });
      this.relevo = this.criarRaster(mat, 1.5);
    }
    this.relevo.visivel(!!this.relevoTex);
    void this.atualizarRelevo();
  }

  /**
   * Monta um atlas de tiles de elevação cobrindo a vista.
   *
   * Os tiles são Web Mercator e chegam separados; o shader precisa de uma
   * textura só. Eles são desenhados lado a lado num canvas, na mesma disposição
   * da grade, e o retângulo resultante — em Mercator — vira os limites que o
   * shader usa para reprojetar.
   */
  private async atualizarRelevo() {
    if (!this.relevoOn || this.disposed || !this.relevo) return;

    const aspecto = this.largura / Math.max(1, this.altura);
    const gw = larguraGraus(this.vista.alturaGraus, aspecto);
    const gh = this.vista.alturaGraus;
    let z = nivelRelevo(gw, this.largura);

    const oeste = this.vista.lng - gw / 2;
    const leste = this.vista.lng + gw / 2;
    const sul = Math.max(-LAT_MERC, this.vista.lat - gh / 2);
    const norte = Math.min(LAT_MERC, this.vista.lat + gh / 2);

    // Teto de tiles por atlas. Cada um é uma requisição, e o relevo é o fundo,
    // não o dado que se está lendo — cair um nível é invisível sob o vento e
    // corta o custo em quatro.
    let lista = tilesMercator(oeste, sul, leste, norte, z);
    while (lista.length > 24 && z > 0) { z--; lista = tilesMercator(oeste, sul, leste, norte, z); }
    if (!lista.length) return;

    const chave = lista.map((t) => t.chave).join(";");
    if (chave === this.relevoChave) return;
    this.relevoChave = chave;
    const meu = ++this.relevoToken;

    const cols = [...new Set(lista.map((t) => t.oeste))].sort((a, b) => a - b);
    const rows = [...new Set(lista.map((t) => t.norte))].sort((a, b) => b - a);
    const LADO = 256;

    const cv = document.createElement("canvas");
    cv.width = cols.length * LADO;
    cv.height = rows.length * LADO;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const carregar = (t: Tile) => new Promise<void>((pronto) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        const cx = cols.indexOf(t.oeste), cy = rows.indexOf(t.norte);
        if (cx >= 0 && cy >= 0) ctx.drawImage(im, cx * LADO, cy * LADO, LADO, LADO);
        pronto();
      };
      // Um buraco de cobertura deixa o quadrado preto, que decodifica para
      // -32.768 m. É absurdo o bastante para não ser confundido com dado.
      im.onerror = () => pronto();
      im.src = `/api/terrain/${t.z}/${t.y}/${t.x}`;
    });

    await Promise.all(lista.map(carregar));
    if (meu !== this.relevoToken || this.disposed || !this.relevo) return;

    const tex = new THREE.CanvasTexture(cv);
    // NEAREST, OBRIGATORIAMENTE.
    //
    // A altitude está codificada em três canais: o vermelho vale 256 m por
    // unidade. Interpolar linearmente entre dois texels mistura os canais e
    // produz altitudes que não existem — numa borda onde o vermelho passa de
    // 137 para 138, a interpolação inventa uma rampa de 256 m. Com NEAREST o
    // valor lido é sempre um valor medido.
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;

    const latN = rows[0];
    const latS = lista.find((t) => t.norte === rows[rows.length - 1])!.sul;
    const lngO = cols[0];
    const lngL = lista.find((t) => t.oeste === cols[cols.length - 1])!.leste;

    this.relevoTex?.dispose();
    this.relevoTex = tex;

    const u = this.relevo.material.uniforms;
    u.uMap.value = tex;
    (u.uAtlas.value as THREE.Vector4).set(latN, latS, lngO, lngL);
    (u.uPasso.value as THREE.Vector2).set(1 / cv.width, 1 / cv.height);

    // O plano cobre exatamente o atlas, nem mais nem menos.
    for (let i = 0; i < this.relevo.malhas.length; i++) {
      const m = this.relevo.malhas[i];
      m.scale.set(lngL - lngO, latN - latS, 1);
      m.position.set((lngO + lngL) / 2 + COPIAS[i], (latS + latN) / 2, 1.5);
    }
    this.relevo.visivel(true);

    // Guarda os pixels: é o que transforma isto de sombreamento em DADO.
    try {
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      this.relevoAmostra = {
        dados: img.data, w: cv.width, h: cv.height, latN, latS, lngO, lngL,
      };
    } catch { this.relevoAmostra = null; }
  }

  /**
   * Altitude ou profundidade de um ponto, em metros, lida do MESMO raster que
   * está sombreado na tela.
   *
   * Devolve null fora do atlas carregado — nunca zero. Zero é o nível do mar,
   * e um oceano inteiro respondendo "0 m" pareceria dado.
   */
  alturaEm(lat: number, lng: number): number | null {
    const a = this.relevoAmostra;
    if (!a) return null;

    let x = lng;
    while (x < a.lngO - 180) x += 360;
    while (x > a.lngL + 180) x -= 360;
    if (x < a.lngO || x > a.lngL || lat < a.latS || lat > a.latN) return null;

    const yN = mercY(a.latN), yS = mercY(a.latS);
    const px = Math.floor(((x - a.lngO) / (a.lngL - a.lngO)) * a.w);
    const py = Math.floor(((mercY(lat) - yN) / (yS - yN)) * a.h);
    if (px < 0 || px >= a.w || py < 0 || py >= a.h) return null;

    const i = (py * a.w + px) * 4;
    if (a.dados[i + 3] === 0) return null;      // tile que não carregou
    const m = alturaTerrarium(a.dados[i], a.dados[i + 1], a.dados[i + 2]);
    return m < -32000 ? null : m;
  }

  // --------------------------------------------------------------- vetorial

  /**
   * Emite um segmento nas três cópias do mundo.
   *
   * Um contorno perto do antimeridiano precisa aparecer inteiro tanto na borda
   * esquerda quanto na direita. Como as cópias vetoriais são reconstruídas a
   * cada atualização, sai mais barato triplicar os vértices aqui do que
   * gerenciar três objetos de cena.
   */
  private emitir(pos: number[], lng1: number, lat1: number, lng2: number, lat2: number, z: number) {
    // Um salto de mais de meio mundo é a linha voltando pela emenda, não uma
    // linha atravessando o planeta. Desenhá-la produz o risco horizontal
    // clássico dos mapas mal costurados.
    if (cruzaEmenda(lng1, lng2)) return;
    for (const dx of COPIAS) {
      pos.push(lng1 + dx, lat1, z, lng2 + dx, lat2, z);
    }
  }

  private async carregarFronteiras() {
    try {
      const r = await fetch("/api/boundaries?level=0");
      if (!r.ok || this.disposed) return;
      const gj = await r.json();
      if (this.disposed) return;

      const pos: number[] = [];
      for (const f of (gj.features ?? [])) {
        const g = f?.geometry;
        if (!g) continue;
        const poligonos = g.type === "Polygon" ? [g.coordinates]
          : g.type === "MultiPolygon" ? g.coordinates : [];
        for (const poly of poligonos) {
          for (const anel of poly) {
            for (let i = 0; i < anel.length - 1; i++) {
              this.emitir(pos, anel[i][0], anel[i][1], anel[i + 1][0], anel[i + 1][1], 6);
            }
          }
        }
      }
      if (!pos.length || this.disposed) return;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      this.fronteiras = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false,
      }));
      this.fronteiras.renderOrder = 6;
      this.scene.add(this.fronteiras);
    } catch {
      this.noticeFn?.("fronteiras indisponíveis no mapa 2D");
    }
  }

  setIsobars(data: IsobarSet | null) {
    this.isobarData = data;
    if (this.isobaras) {
      this.scene.remove(this.isobaras);
      this.isobaras.geometry.dispose();
      (this.isobaras.material as THREE.Material).dispose();
      this.isobaras = null;
    }
    if (!data?.contours?.length || !this.isobarsOn) return;

    const pos: number[] = [];
    const cor: number[] = [];
    for (const c of data.contours) {
      const forte = c.major;
      const [r, g, b] = forte ? [0.36, 0.88, 0.69] : [0.62, 0.70, 0.78];
      for (let i = 0; i < c.points.length - 1; i++) {
        const antes = pos.length;
        this.emitir(pos, c.points[i][0], c.points[i][1], c.points[i + 1][0], c.points[i + 1][1], 7);
        // duas cores por segmento emitido, e `emitir` pode ter emitido nenhum
        for (let k = antes; k < pos.length; k += 3) cor.push(r, g, b);
      }
    }
    if (!pos.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cor, 3));
    this.isobaras = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthTest: false,
    }));
    this.isobaras.renderOrder = 7;
    this.scene.add(this.isobaras);
  }

  setIsobarsVisible(on: boolean) {
    this.isobarsOn = on;
    if (!on) {
      if (this.isobaras) this.isobaras.visible = false;
      return;
    }
    if (this.isobaras) { this.isobaras.visible = true; return; }
    this.setIsobars(this.isobarData);
  }

  // -------------------------------------------------------------- marcadores

  setQuakes(list: Quake[]) { this.rawQuakes = list || []; this.refazerPontos(); }

  /**
   * O corte por orçamento é mais simples que o do globo, e por um motivo.
   *
   * Lá, metade do trabalho é descobrir quais focos estão no hemisfério virado
   * para a câmera — num plano, tudo que está na vista está na vista. Sobra só o
   * teto de desempenho do degrau atual.
   */
  setFires(list: Fire[]) {
    this.rawFires = (list || []).slice(0, TIERS[this.perf.tier].fires);
    this.refazerPontos();
  }

  get firesDrawn() { return this.rawFires.length; }
  setOpenAQ(list: unknown[]) { this.rawOpenAQ = (list as any[]) || []; this.refazerPontos(); }
  setHospitals(list: unknown[]) { this.rawHospitals = (list as any[]) || []; this.refazerPontos(); }

  setClickMarker(lat: number | null, lng: number | null) {
    this.clickTarget = lat != null && lng != null ? { lat, lng } : null;
    this.refazerPontos();
  }

  private refazerPontos() {
    const pos: number[] = [], cor: number[] = [], tam: number[] = [];
    const aPos: number[] = [], aCor: number[] = [], aTam: number[] = [],
          aFase: number[] = [], aPer: number[] = [];

    const push = (lng: number, lat: number, z: number, rgb: [number, number, number], t: number) => {
      for (const dx of COPIAS) {
        pos.push(lng + dx, lat, z);
        cor.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
        tam.push(t);
      }
    };

    for (const q of this.rawQuakes) {
      const k = Math.max(0, Math.min(1, (q.mag - 4) / 4));
      const rgb: [number, number, number] = k > 0.5 ? [239, 68, 68] : [249, 115, 22];
      push(q.lng, q.lat, 9, rgb, 5 + k * 9);
      for (const dx of COPIAS) {
        aPos.push(q.lng + dx, q.lat, 8);
        aCor.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
        aTam.push(22 + k * 60);
        aFase.push((q.lat + q.lng) % 1);          // dessincroniza os anéis
        aPer.push(2.6 - k * 1.4);
      }
    }

    for (const f of this.rawFires) {
      const k = Math.min(1, Math.log10(1 + Math.max(0, f.frp)) / 3.2);
      push(f.lng, f.lat, 9, brasa(k) as [number, number, number], 3 + k * 7);
    }
    for (const e of this.rawOpenAQ) {
      if (!Number.isFinite(e?.lat) || !Number.isFinite(e?.lng)) continue;
      push(e.lng, e.lat, 9, [125, 211, 252], 5);
    }
    for (const h of this.rawHospitals) {
      if (!Number.isFinite(h?.lat) || !Number.isFinite(h?.lng)) continue;
      push(h.lng, h.lat, 9, [248, 250, 252], 4);
    }

    this.pontos = this.trocarPontos(this.pontos, pos, cor, tam, PONTO_VERT, PONTO_FRAG, 9);
    this.aneis = this.trocarAneis(aPos, aCor, aTam, aFase, aPer);

    // marcador do clique: um ponto só, no topo de tudo
    const mp: number[] = [], mc: number[] = [], mt: number[] = [];
    if (this.clickTarget) {
      for (const dx of COPIAS) {
        mp.push(this.clickTarget.lng + dx, this.clickTarget.lat, 10);
        mc.push(0.36, 0.88, 0.69);
        mt.push(11);
      }
    }
    this.marcador = this.trocarPontos(this.marcador, mp, mc, mt, PONTO_VERT, PONTO_FRAG, 10);
    this.ajustarCamera();   // reaplica a escala de ponto aos objetos novos
  }

  private trocarPontos(
    velho: THREE.Points | null,
    pos: number[], cor: number[], tam: number[],
    vert: string, frag: string, ordem: number,
  ): THREE.Points | null {
    if (velho) {
      this.scene.remove(velho);
      velho.geometry.dispose();
      (velho.material as THREE.Material).dispose();
    }
    if (!pos.length) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aCor", new THREE.Float32BufferAttribute(cor, 3));
    geo.setAttribute("aTam", new THREE.Float32BufferAttribute(tam, 1));

    const p = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uEscala: { value: 1 } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    p.renderOrder = ordem;
    this.scene.add(p);
    return p;
  }

  private trocarAneis(
    pos: number[], cor: number[], tam: number[], fase: number[], per: number[],
  ): THREE.Points | null {
    if (this.aneis) {
      this.scene.remove(this.aneis);
      this.aneis.geometry.dispose();
      (this.aneis.material as THREE.Material).dispose();
    }
    if (!pos.length) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aCor", new THREE.Float32BufferAttribute(cor, 3));
    geo.setAttribute("aTam", new THREE.Float32BufferAttribute(tam, 1));
    geo.setAttribute("aFase", new THREE.Float32BufferAttribute(fase, 1));
    geo.setAttribute("aPeriodo", new THREE.Float32BufferAttribute(per, 1));

    const p = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uEscala: { value: 1 }, uTempo: { value: 0 } },
      vertexShader: ANEL_VERT, fragmentShader: ANEL_FRAG,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    p.renderOrder = 8;
    this.scene.add(p);
    return p;
  }

  // ------------------------------------------------------------- dia e noite

  setTime = (d: Date) => { this.time = d; this.aplicarSol(); };
  setDayNight = (on: boolean) => { this.dayNight = on; this.aplicarSol(); };

  private aplicarSol() {
    if (!this.noite) return;
    this.noite.visivel(this.dayNight);
    if (!this.dayNight) return;

    const d = this.time;
    const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400e3);
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10));
    const horas = d.getUTCHours() + d.getUTCMinutes() / 60;
    const lngSol = -15 * (horas - 12);

    this.noite.material.uniforms.uDecl.value = (decl * Math.PI) / 180;
    this.noite.material.uniforms.uLngSol.value = (lngSol * Math.PI) / 180;
  }

  /** No plano, "rotação automática" é deriva em longitude. */
  setAutoRotate(on: boolean) { this.girando = on; }

  // ----------------------------------------------------------------- avulsos

  onClick(fn: (lat: number, lng: number) => void) { this.clickFn = fn; }
  onNotice(fn: (msg: string | null) => void) { this.noticeFn = fn; }
  onStats(fn: (s: FrameStats) => void) { this.statsFn = fn; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.assentar != null) window.clearTimeout(this.assentar);
    this.limparTiles();
    this.relevoTex?.dispose();
    this.relevoAmostra = null;
    this.geoTile.dispose();
    this.ro?.disconnect();
    if (this.aoRedimensionar) window.removeEventListener("resize", this.aoRedimensionar);

    this.windGPU?.dispose?.();
    this.currentGPU?.dispose?.();
    this.imgTex?.dispose();

    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.scene.clear();

    const el = this.renderer?.domElement;
    this.renderer?.dispose();
    if (el && this.container?.contains(el)) this.container.removeChild(el);
    this.renderer = null;
    this.container = null;
  }
}
