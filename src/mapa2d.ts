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

  setImagery(id: string | null, date: Date, opacity = 0.9) {
    this.imgToken++;
    if (!id) { this.imagem?.visivel(false); this.imgFade = 0; return; }

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
    const dia = date.toISOString().slice(0, 10);
    const url = id.startsWith("/") ? id : `/api/imagery/${id}?date=${dia}&width=4096`;

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
    if (this.imagem) this.imagem.material.uniforms.uOpacity.value = o;
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
