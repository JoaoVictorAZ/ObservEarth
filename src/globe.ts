// src/globe.ts
// -----------------------------------------------------------------------------
// Motor visual 3D do globo (Three.js / globe.gl integration).
// -----------------------------------------------------------------------------

import Globe from "globe.gl";
import * as THREE from "three";
import { WindGPU } from "./windGPU";
import { PerfMonitor, TIERS, type QualityTier, type FrameStats } from "./perf";

const TEX = {
  day: "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
  night: "https://unpkg.com/three-globe/example/img/earth-night.jpg",
  bump: "https://unpkg.com/three-globe/example/img/earth-topology.png",
  stars: "https://unpkg.com/three-globe/example/img/night-sky.png",
  water: "https://unpkg.com/three-globe/example/img/earth-water.png",
};

export interface Quake {
  lat: number; lng: number; mag: number; depth: number; place: string; time: number;
}
// u/v aceitam Float32Array: o cliente converte o JSON assim que ele chega, o
// que corta pela metade a memória de cada campo (ver src/forecastPlayer.ts).
export interface WindGrid {
  nx: number; ny: number;
  u: number[] | Float32Array;
  v: number[] | Float32Array;
  valid?: number[] | Uint8Array;

  /** Procedência declarada pelo servidor. A tela tem que LER isto, não supor.
   *  Havia um literal "NOAA GFS 0.25° · 100% medido" fixo na view, que
   *  continuava afirmando GFS quando o campo vinha do recuo de 3°. */
  provider?: string;
  dataset?: string;
  /** passo da grade em graus: 0,25 no GFS, 3 no recuo — 144x mais grosso */
  stepDeg?: number;
  measuredPct?: number;
  builtAt?: string;
}

interface PolyFeature {
  type: string;
  properties: { rank?: number; name?: string };
  geometry: unknown;
  /** centroide unitario, calculado uma vez para filtrar por hemisferio visivel */
  _v?: [number, number, number];
}

export interface PlaceLabel { name: string; lat: number; lng: number; rank?: number; pop?: number; admin?: string }
/** rotulo pronto para o DOM: `tier` escolhe o estilo em index.css */
type LabelDatum = PlaceLabel & {
  tier: "country" | "country-dim" | "state" | "state-dim" | "city";
  alt: number;
  /** opacidade por centralidade: 1 no centro da vista, ~0,3 na borda do foco */
  op: number;
};
export interface LabelSets { countries: PlaceLabel[]; states: PlaceLabel[]; cities: PlaceLabel[] }

/**
 * NIVEIS DE ZOOM
 */
const LOD = {
  regional: 1.15,
  local: 0.45,
} as const;

/** isóbaras e centros de pressão, vindos de /api/isobars */
export interface IsobarSet {
  step: number;
  unit: string;
  min: number;
  max: number;
  dataset?: string;
  forecastHour?: number;
  points?: number;
  /** resolução da grade em que o contorno foi traçado, em graus */
  stepDeg?: number;
  contours: { hPa: number; major: boolean; points: [number, number][] }[];
  centers: { lat: number; lng: number; hPa: number; kind: "H" | "L" }[];
}


function llToVec3(lat: number, lng: number, r: number) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const c = Math.cos(la);
  return new THREE.Vector3(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
}

/** foco de calor do NASA FIRMS. `frp` = Fire Radiative Power em MW. */
export interface Fire {
  lat: number; lng: number; frp: number;
  brightness: number; confidence: string; acqDate: string; daynight: string;
}

/**
 * FOCOS DE CALOR 
 */
const EMBER: [number, [number, number, number]][] = [
  [0.00, [176, 42, 16]],     // brasa: vermelho escuro, visível mas contido
  [0.35, [236, 108, 24]],    // laranja
  [0.68, [255, 190, 74]],    // amarelo-âmbar
  [1.00, [255, 248, 232]],   // branco incandescente
];

const FIRE = {
  /**
   * Teto de ANÉIS
   */
  maxRings: 40,
  /** FRP mínimo, em MW, para um foco merecer anel */
  ringMinFrp: 120,
  budget: { planetary: 600, regional: 1800, local: 4000 },
  norm: (frp: number) => Math.min(1, Math.log10(1 + Math.max(0, frp)) / 3.2),
};

/** interpola a rampa de brasa; devolve [r,g,b] em 0..255 */
function emberColor(k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, k));
  if (t <= EMBER[0][0]) return EMBER[0][1];
  for (let i = 1; i < EMBER.length; i++) {
    const [v1, c1] = EMBER[i];
    if (t > v1) continue;
    const [v0, c0] = EMBER[i - 1];
    const f = (t - v0) / (v1 - v0);
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * f),
      Math.round(c0[1] + (c1[1] - c0[1]) * f),
      Math.round(c0[2] + (c1[2] - c0[2]) * f),
    ];
  }
  return EMBER[EMBER.length - 1][1];
}

const rgbCss = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;

/** anel pulsante. `rgb` ausente = laranja padrão dos sismos */
interface RingDatum {
  lat: number; lng: number;
  maxR: number; speed: number; period: number; strength: number;
  rgb?: string;
}

/**
 * Rótulo do foco
 */
function fireLabel(f: Fire): string {
  const conf = /^h/i.test(f.confidence) ? "alta"
             : /^n/i.test(f.confidence) ? "nominal"
             : /^l/i.test(f.confidence) ? "baixa"
             : f.confidence || "—";
  const linhas = [
    `<b>${f.frp.toFixed(0)} MW</b> · potência radiativa`,
    f.brightness ? `${f.brightness.toFixed(0)} K · temperatura de brilho` : null,
    `confiança ${conf}`,
    `${f.acqDate}${f.daynight === "N" ? " · passagem noturna" : " · passagem diurna"}`,
    `VIIRS 375 m · NASA FIRMS`,
  ].filter(Boolean);
  return `<div class="fire-tip">${linhas.join("<br>")}</div>`;
}

// ---------------------------------------------------------------- imagery
const IMG_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    vPos = normalize(position);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const IMG_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uFade;
  varying vec3 vPos;
  varying vec3 vN;
  const float PI = 3.14159265359;

  void main() {
    float lat = asin(clamp(vPos.y, -1.0, 1.0));
    float lng = atan(vPos.x, vPos.z);
    vec2 uv = vec2(lng / (2.0 * PI) + 0.5, 0.5 - lat / PI);

    vec4 c = texture2D(uMap, uv);
    if (c.a < 0.05) discard;

    vec3 col = c.rgb;
    float rim = pow(1.0 - abs(vN.z), 3.0);
    col += vec3(0.08, 0.12, 0.18) * rim * 0.35;

    gl_FragColor = vec4(col, c.a * uOpacity * uFade);
  }
`;

const WIND_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec3 vPos;
  varying vec3 vN;
  const float PI = 3.14159265359;

  void main() {
    float lat = asin(clamp(vPos.y, -1.0, 1.0));
    float lng = atan(vPos.x, vPos.z);
    vec2 uv = vec2(lng / (2.0 * PI) + 0.5, 0.5 - lat / PI);

    vec4 c = texture2D(uMap, uv);
    if (c.a < 0.015) discard;

    // vN.z ~ 1 de frente para a camera, ~ 0 no limbo
    float facing = abs(vN.z);
    float limb = smoothstep(0.16, 0.42, facing);
    if (limb <= 0.001) discard;

    // Perto dos polos a projecao equiretangular comprime longitude ao extremo e
    // o rastro vira leque. Reduzimos ali em vez de exibir o artefato.
    float polar = 1.0 - smoothstep(0.86, 0.985, abs(vPos.y));

    gl_FragColor = vec4(c.rgb, c.a * uOpacity * limb * polar);
  }
`;

export class GlobeEngine {
  private g: any = null;
  private raf = 0;
  // (o tempo de quadro agora vive no loop; ver PerfMonitor)
  private onResize: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private disposed = false;

  private time = new Date();
  private dayNight = true;

  // imagery
  private imgMesh: THREE.Mesh | null = null;
  private imgMat: THREE.ShaderMaterial | null = null;
  private imgTex: THREE.Texture | null = null;
  private imgFade = 0;
  private imgToken = 0;

  // vento — agora inteiramente em GPU (ver src/windGPU.ts)
  private windGPU: WindGPU | null = null;
  // correntes oceânicas: sistema SEPARADO do vento (ver setCurrents)
  private currentGPU: WindGPU | null = null;
  private currentMesh: THREE.Mesh | null = null;
  private currentMat: THREE.ShaderMaterial | null = null;
  private currentGrid: WindGrid | null = null;
  private currentsOn = false;
  private windMesh: THREE.Mesh | null = null;
  private windMat: THREE.ShaderMaterial | null = null;
  private windGrid: WindGrid | null = null;
  private windOn = false;

  // isóbaras: uma única malha de segmentos para todas as curvas
  private isobarLines: THREE.LineSegments | null = null;
  private isobarData: IsobarSet | null = null;
  private isobarsOn = false;

  private clickFn: ((lat: number, lng: number) => void) | null = null;

  // rotulos e fronteiras com nivel de detalhe
  private labelData: LabelSets | null = null;
  private labelRaf = 0;
  private viewKey = "";
  // vetores unitarios pre-calculados: sem isso cada atualizacao de camera
  // refazia seno e cosseno para milhares de rotulos
  private lblVec = new Map<PlaceLabel, [number, number, number]>();
  private bounds0: PolyFeature[] = [];
  private bounds1: PolyFeature[] = [];
  private statesRequested = false;
  private statesLoading = false;
  private statesFailed = 0;
  private noticeFn: ((msg: string | null) => void) | null = null;
  private lodTier = -1;

  // desempenho
  readonly perf = new PerfMonitor();
  /** fração de partículas escolhida pelo usuário; sobrevive à troca de degrau */
  private densidadeVento = 1;
  private idle = 0;                 // quadros sem nada para animar
  private paused = false;
  private interacting = false;
  private baseDpr = 1;
  private statsFn: ((s: FrameStats) => void) | null = null;
  private rawFiresAll: Fire[] = [];

  // ------------------------------------------------------------- ciclo
  mount(container: HTMLElement) {
    this.g = (Globe as any)()(container)
      .globeImageUrl(TEX.day)
      .bumpImageUrl(TEX.bump)
      .backgroundImageUrl(TEX.stars)
      .showAtmosphere(true)
      .atmosphereColor("#8ab4e8")
      .atmosphereAltitude(0.17)
      .pointLat("lat").pointLng("lng").pointColor("color")
      .pointAltitude("alt").pointRadius("radius").pointLabel("label")
      .ringLat("lat").ringLng("lng").ringMaxRadius("maxR")
      .ringPropagationSpeed("speed").ringRepeatPeriod("period")
      // `d.rgb` deixa cada anel herdar a cor do que ele marca: brasa para foco
      // de calor, laranja padrão para sismo. Sem isso todo anel sairia laranja
      // e um foco branco-incandescente ganharia um halo de outra temperatura.
      .ringColor((d: RingDatum) => (t: number) =>
        `rgba(${d.rgb ?? "249,115,22"},${(1 - t) * d.strength})`)
      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => "rgba(255,255,255,0.30)")
      .polygonAltitude(0.003);

    this.g.onGlobeClick(({ lat, lng }: { lat: number; lng: number }) =>
      this.clickFn?.(lat, lng)
    );


    this.g.onPolygonClick((_p: unknown, _e: unknown, coords: { lat: number; lng: number }) => {
      if (coords && Number.isFinite(coords.lat)) this.clickFn?.(coords.lat, coords.lng);
    });

    const size = () => {
      if (!this.g || this.disposed) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      if (w > 0 && h > 0) this.g.width(w).height(h);
    };
    size();
    requestAnimationFrame(size);
    this.ro = new ResizeObserver(size);
    this.ro.observe(container);
    this.onResize = size;
    window.addEventListener("resize", size);

    this.g.pointOfView({ lat: -15, lng: -48, altitude: 1.70 });
    const c = this.g.controls();
    c.autoRotate = false;
    c.autoRotateSpeed = 0.35;
    c.enableDamping = true;

    c.addEventListener("change", () => { this.wake(); this.scheduleLOD(); });
    c.addEventListener("start", () => {
      this.interacting = true;
      const rnd = this.g?.renderer?.();
      rnd?.setPixelRatio(Math.min(this.baseDpr, TIERS[this.perf.tier].dpr) * 0.7);
      this.wake();
    });
    c.addEventListener("end", () => {
      this.interacting = false;
      const rnd = this.g?.renderer?.();
      rnd?.setPixelRatio(Math.min(this.baseDpr, TIERS[this.perf.tier].dpr));
    });

    this.tuneRenderer();
    this.applyOcean();
    this.applySun();
    this.loop();
    this.loadBoundaries();
    this.loadLabels();
  }

  private tuneRenderer() {
    const rnd = this.g?.renderer?.();
    if (!rnd) return;
    rnd.sortObjects = true;
    rnd.logarithmicDepthBuffer = true;
    this.baseDpr = window.devicePixelRatio || 1;
    rnd.setPixelRatio(Math.min(this.baseDpr, TIERS[this.perf.tier].dpr));
    this.perf.onTierChange((t) => this.applyTier(t));
    const maxA = rnd.capabilities?.getMaxAnisotropy?.() ?? 1;
    const globeMat = this.g?.globeMaterial?.();
    if (globeMat?.map) globeMat.map.anisotropy = Math.min(8, maxA);
  }

  /**
   * Oceano
   */
  private applyOcean() {
    const mat = this.g?.globeMaterial?.();
    if (!mat) return;
    new THREE.TextureLoader().load(TEX.water, (tex) => {
      if (this.disposed) { tex.dispose(); return; }
      // DEFESA: rejeita texturas com dimensões inválidas
      if (!tex.image || tex.image.width <= 0 || tex.image.height <= 0) {
        console.warn("[globe] máscara de água com dimensões inválidas, ignorando");
        tex.dispose(); return;
      }
      tex.colorSpace = THREE.NoColorSpace;
      mat.specularMap = tex;
      mat.specular = new THREE.Color(0x2a4a63);
      mat.shininess = 12;
      mat.bumpScale = 6;
      mat.needsUpdate = true;
    }, undefined, (err) => {
      console.warn("[globe] falha ao carregar máscara de água:", err);
    });
  }

  private loop() {
    let prev = 0;
    const step = (t: number) => {
      if (this.disposed) return;
      this.perf.begin();
      const dt = prev ? Math.min((t - prev) / 1000, 0.05) : 0;
      prev = t;

      this.tickImagery(dt);
      this.tickWind(dt);
      this.tickCurrents(dt);

      const animating = this.windOn || this.currentsOn || this.imgFade < 1 || this.interacting;
      if (animating) {
        this.idle = 0;
        if (this.paused) { this.g?.resumeAnimation?.(); this.paused = false; }
      } else if (++this.idle > 90 && !this.paused) {
        this.g?.pauseAnimation?.();
        this.paused = true;
      }

      this.perf.end(t, this.g?.renderer?.());
      if (this.statsFn) this.statsFn(this.perf.stats);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private wake() {
    this.idle = 0;
    if (this.paused) { this.g?.resumeAnimation?.(); this.paused = false; }
  }

  onStats(fn: (s: FrameStats) => void) { this.statsFn = fn; }

  /** null volta ao automatico */
  setQuality(t: QualityTier | null) { this.perf.lock(t); }

  /**
   * Aplica um degrau de qualidade. Os tres parametros que realmente pesam:
   * resolucao de render (quadratica no custo), tamanho do alvo de rastro do
   * vento e numero de particulas.
   */
  private applyTier(t: QualityTier) {
    const q = TIERS[t];
    if (!q) { console.warn(`[globe] tier inválido: ${t}`); return; }
    const rnd = this.g?.renderer?.();
    if (rnd) rnd.setPixelRatio(Math.min(this.baseDpr, q.dpr));
    // Respeita a densidade escolhida: o degrau muda o TETO, não a escolha.
    this.windGPU?.resize(q.trail, this.particulasAlvo(q.particles), q.fadeEvery);
    if (this.rawFiresAll.length) this.setFires(this.rawFiresAll);
    this.wake();
  }

  // ------------------------------------------------ fronteiras e rotulos

  private vecOf(lat: number, lng: number): [number, number, number] {
    const la = (lat * Math.PI) / 180, ln = (lng * Math.PI) / 180;
    return [Math.cos(la) * Math.cos(ln), Math.sin(la), Math.cos(la) * Math.sin(ln)];
  }

  /** centroide aproximado da feicao, so para teste de visibilidade */
  private featureVec(f: PolyFeature): [number, number, number] {
    const g = f.geometry as { type?: string; coordinates?: number[][][][] | number[][][] };
    const polys = g?.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : (g?.coordinates as number[][][][]) ?? [];
    let sx = 0, sy = 0, n = 0;
    for (const poly of polys) {
      const ring = poly?.[0];
      if (!ring) continue;
      const step = Math.max(1, Math.floor(ring.length / 12));
      for (let i = 0; i < ring.length; i += step) { sx += ring[i][0]; sy += ring[i][1]; n++; }
    }
    return n ? this.vecOf(sy / n, sx / n) : [0, 0, 0];
  }

  private async loadBoundaries() {
    try {
      const r = await fetch("/api/boundaries?level=0");
      if (!r.ok || this.disposed) return;
      const gj = await r.json();
      if (this.disposed) return;
      this.bounds0 = (gj.features ?? []) as PolyFeature[];
      for (const f of this.bounds0) f._v = this.featureVec(f);

      this.g
        ?.polygonStrokeColor((d: PolyFeature) =>
          d?.properties?.rank === 1 ? "rgba(190,215,245,0.65)" : "rgba(255,255,255,0.85)"
        )
        .polygonAltitude((d: PolyFeature) => (d?.properties?.rank === 1 ? 0.0036 : 0.0042));

      this.applyLOD(true);
    } catch { /* fronteiras sao enfeite: sem elas o globo continua util */ }
  }


  private async ensureStates() {
    if (this.statesRequested || this.statesLoading) return;
    if (this.statesFailed >= 3) return;              // desiste após 3, mas AVISA
    this.statesLoading = true;
    try {
      const r = await fetch("/api/boundaries?level=1");
      if (this.disposed) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const gj = await r.json();
      if (this.disposed) return;

      const feats = (gj.features ?? []) as PolyFeature[];
      if (!feats.length) throw new Error("resposta sem feições");

      this.bounds1 = feats;
      for (const f of this.bounds1) f._v = this.featureVec(f);
      this.statesRequested = true;                   // só agora: houve sucesso
      this.statesFailed = 0;
      this.noticeFn?.(null);
      this.applyLOD(true);
    } catch (e) {
      this.statesFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      this.noticeFn?.(
        this.statesFailed >= 3
          ? `contornos estaduais indisponíveis (${msg}) — só países no mapa`
          : `contornos estaduais falharam (${msg}); tentando de novo`
      );
      // nova tentativa com espera crescente: falha de CDN costuma ser passageira
      if (this.statesFailed < 3) {
        setTimeout(() => { if (!this.disposed) void this.ensureStates(); },
          1500 * this.statesFailed);
      }
    } finally {
      this.statesLoading = false;
    }
  }

  /** canal para a barra de status contar o que deu errado no globo */
  onNotice(fn: (msg: string | null) => void) { this.noticeFn = fn; }

  private async loadLabels() {
    try {
      const r = await fetch("/api/labels");
      if (!r.ok || this.disposed) return;
      const sets: LabelSets = await r.json();
      if (this.disposed) return;
      this.labelData = sets;
      for (const g of [sets.countries, sets.states, sets.cities]) {
        for (const p of g) this.lblVec.set(p, this.vecOf(p.lat, p.lng));
      }


      this.g
        ?.htmlLat("lat").htmlLng("lng").htmlAltitude("alt")
        .htmlTransitionDuration(0)
        .htmlElement((d: LabelDatum) => {
          const el = document.createElement("div");
          el.className = `geo-label geo-label--${d.tier}`;
          el.textContent = d.name;       // textContent: nunca interpreta HTML
          el.style.opacity = String(d.op);
          return el;
        });

      this.applyLOD(true);
    } catch { /* sem rotulos o globo continua utilizavel */ }
  }

  private scheduleLOD = () => {
    if (this.disposed || !this.g) return;
    if (this.labelRaf) return;
    this.labelRaf = requestAnimationFrame(() => {
      this.labelRaf = 0;
      if (this.disposed || !this.g) return;
      this.applyLOD(false);
    });
  };

  /**
   * Recalcula rótulos e fronteiras para a câmera atual.
   */
  private applyLOD = (force: boolean) => {
    if (!this.g || this.disposed) return;
    const pov = this.g.pointOfView();
    const alt: number = pov?.altitude ?? 2;
    const lat: number = pov?.lat ?? 0;
    const lng: number = pov?.lng ?? 0;

    const key = `${Math.round(lat / 6)}:${Math.round(lng / 6)}:${Math.round(alt * 20)}`;
    if (!force && key === this.viewKey) return;
    this.viewKey = key;

    const [cx, cy, cz] = this.vecOf(lat, lng);

    // ---- focos de calor ---------------------------------------------------
    if (this.rawFiresAll.length) {
      this.selectFires();
      this.refreshPointsAndRings();
    }

    // ---- fronteiras -------------------------------------------------------
    const tier = alt > LOD.regional ? 0 : alt > LOD.local ? 1 : 2;
    if (tier >= 1) void this.ensureStates();

    if (force || tier !== this.lodTier || tier >= 1) {
      const polys: PolyFeature[] = tier === 0
        ? this.bounds0
        : [...this.bounds0, ...this.bounds1];
      this.g.polygonsData(polys);
      this.lodTier = tier;
    }

    // ---- rotulos ----------------------------------------------------------
    if (!this.labelData) return;

    const out: LabelDatum[] = [];
    type Cand = { p: PlaceLabel; tier: LabelDatum["tier"]; alt: number; imp: number; v: [number, number, number]; dot: number };
    const cand: Cand[] = [];

    // raio do cone de foco: mais fechado quanto mais perto, porque a area visivel encolhe e a densidade de rotulos por pixel cresce
    const focusDot = alt > 1.5 ? 0.42 : alt > 0.7 ? 0.66 : 0.86;

    const consider = (p: PlaceLabel, tier: LabelDatum["tier"], a: number, imp: number) => {
      const v = this.lblVec.get(p);
      if (!v) return;
      const d = v[0] * cx + v[1] * cy + v[2] * cz;
      if (d < focusDot) return;                 // fora do cone de foco
      cand.push({ p, tier, alt: a, imp, v, dot: d });
    };

    if (alt > LOD.local) {
      const regional = alt <= LOD.regional;
      for (const c of this.labelData.countries) {
        if (regional && (c.rank ?? 5) > 3) continue;
        consider(c, regional ? "country-dim" : "country", 0.008, (c.rank ?? 5) * 0.4);
      }
    }
    if (alt <= LOD.regional) {
      for (const st of this.labelData.states) {
        consider(st, alt <= LOD.local ? "state-dim" : "state", 0.006, 3);
      }
    }
    if (alt <= LOD.local) {
      const maxRank = alt < 0.18 ? 8 : alt < 0.3 ? 6 : 4;
      for (const c of this.labelData.cities) {
        if ((c.rank ?? 10) > maxRank) continue;
        consider(c, "city", 0.004, (c.rank ?? 10) * 0.25);
      }
    }

    // centralidade pesa mais que importancia: o pedido e destacar o centro
    cand.sort((a, b) => (b.dot * 3 - b.imp) - (a.dot * 3 - a.imp));

    // separacao minima em graus, proporcional a altitude: de longe o globo inteiro cabe na tela e 1 grau e quase nada; de perto, 1 grau e enorme
    const sepDeg = Math.max(0.45, alt * 3.2);
    const minSep = Math.cos((sepDeg * Math.PI) / 180);

    const kept: Cand[] = [];
    for (const c of cand) {
      let clash = false;
      for (const k of kept) {
        if (c.v[0] * k.v[0] + c.v[1] * k.v[1] + c.v[2] * k.v[2] > minSep) { clash = true; break; }
      }
      if (clash) continue;
      kept.push(c);
      if (kept.length >= 90) break;             // teto duro de elementos no DOM
    }

    for (const c of kept) {
      // desbota em direcao a borda do cone: o centro fica nitido, a periferia
      const t = (c.dot - focusDot) / (1 - focusDot);
      const op = 0.30 + 0.70 * Math.min(1, Math.max(0, t)) ** 0.65;
      out.push({ ...c.p, tier: c.tier, alt: c.alt, op: +op.toFixed(2) });
    }

    if (this.isobarsOn) {
      const pov = this.g?.pointOfView?.();
      if (pov) {
        const [cx, cy, cz] = this.vecOf(pov.lat ?? 0, pov.lng ?? 0);
        let count = 0;
        for (const c of this.isobarData?.centers ?? []) {
          const [x, y, z] = this.vecOf(c.lat, c.lng);
          const dot = x * cx + y * cy + z * cz;
          if (dot > 0.65 && count < 8) {
            count++;
            out.push({
              name: `${c.kind === "L" ? "B" : "A"} ${Math.round(c.hPa)}`,
              lat: c.lat, lng: c.lng,
              tier: c.kind === "L" ? "iso-low" : "iso-high",
              alt: 0.014,
              op: 1,
            } as unknown as LabelDatum & { alt: number; op: number });
          }
        }
      }
    }

    this.g.htmlElementsData(out);
  }

  onClick(fn: (lat: number, lng: number) => void) { this.clickFn = fn; }
  setAutoRotate(on: boolean) { if (this.g) this.g.controls().autoRotate = on; }
  flyTo(lat: number, lng: number, altitude = 1.6) {
    this.g?.pointOfView({ lat, lng, altitude }, 900);
  }

  // --------------------------------------------------------- dia e noite
  setTime = (d: Date) => { this.time = d; this.applySun(); };
  setDayNight = (on: boolean) => { this.dayNight = on; this.applySun(); };

  private applySun = () => {
    if (!this.g || this.disposed) return;
    const lights: any[] = this.g.lights ? this.g.lights() : [];
    const dir = lights.find((l) => l.type === "DirectionalLight");
    const amb = lights.find((l) => l.type === "AmbientLight");

    if (!this.dayNight) {
      if (dir) dir.intensity = 0.55;
      if (amb) amb.intensity = 1.35;
      return;
    }
    // ponto subsolar aproximado: onde o Sol está a pino nesta data e hora
    const d = this.time;
    const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400e3);
    const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10));
    const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
    const lng = -15 * (hours - 12);
    const p = this.g.getCoords(decl, lng, 2);
    if (dir) { dir.position.set(p.x, p.y, p.z); dir.intensity = 1.5; }
    if (amb) amb.intensity = 0.12;
  };

  setBase(style: "day" | "night") {
    this.g?.globeImageUrl(style === "night" ? TEX.night : TEX.day);
  }

  // ------------------------------------------------------------ imagery
  setImagery(id: string | null, date: Date, opacity = 0.9) {
    this.imgToken++;
    if (!id) { this.clearImagery(); return; }
    if (!this.g) return;

    if (!this.imgMesh) {
      this.imgMat = new THREE.ShaderMaterial({
        vertexShader: IMG_VERT,
        fragmentShader: IMG_FRAG,
        uniforms: {
          uMap: { value: null },
          uOpacity: { value: opacity },
          uFade: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const geo = new THREE.SphereGeometry(this.g.getGlobeRadius() * 1.001, 128, 64);
      this.imgMesh = new THREE.Mesh(geo, this.imgMat);
      this.imgMesh.renderOrder = 2;
      this.imgMesh.visible = false;
      this.g.scene().add(this.imgMesh);
    }
    if (this.imgMat) this.imgMat.uniforms.uOpacity.value = opacity;

    const my = this.imgToken;
    const day = date.toISOString().slice(0, 10);
    // `id` pode ser um identificador de camada OU uma URL pronta. Campos do GFS
    // dependem de data E HORA e vêm de outra rota; carregar a textura é
    // idêntico nos dois casos, então quem sabe montar o endereço é o chamador.
    const url = id.startsWith("/")
      ? id
      : `/api/imagery/${id}?date=${day}&width=4096`;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed || my !== this.imgToken || !this.imgMat || !this.imgMesh) { tex.dispose(); return; }
        // DEFESA: rejeita texturas com dimensões inválidas (imagem vazia/quebrada)
        if (!tex.image || tex.image.width <= 0 || tex.image.height <= 0) {
          console.warn("[globe] imagem com dimensões inválidas:", tex.image);
          tex.dispose();
          if (my === this.imgToken) this.clearImagery();
          return;
        }
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const rnd = this.g?.renderer?.();
        if (rnd?.capabilities) {
          tex.anisotropy = Math.min(8, rnd.capabilities.getMaxAnisotropy());
        }

        this.imgTex?.dispose();
        this.imgTex = tex;
        this.imgMat.uniforms.uMap.value = tex;
        this.imgMesh.visible = true;
        this.imgFade = 0;
      },
      undefined,
      () => { if (my === this.imgToken) this.clearImagery(); }
    );
  }

  // ------------------------------------------------- sobreposicao termica
  setThermalOverlay(on: boolean, date: Date) {
    if (!on) { this.clearImagery(); return; }
    this.setImagery("temperature", date, 0.85);
  }

  setImageryOpacity(o: number) {
    if (this.imgMat) this.imgMat.uniforms.uOpacity.value = o;
  }

  private clearImagery() {
    if (this.imgMesh) this.imgMesh.visible = false;
    this.imgFade = 0;
  }

  private tickImagery(dt: number) {
    if (!this.imgMat || !this.imgMesh?.visible || this.imgFade >= 1) return;
    this.imgFade = Math.min(1, this.imgFade + dt * 2.5);
    this.imgMat.uniforms.uFade.value = this.imgFade;
  }

  // ---------------------------------------------------------------- vento

  setWind(grid: WindGrid | null, key = "único") {
    this.windGrid = grid;
    this.windGPU?.setField(grid, key);
    // sem campo, esconde a malha: melhor nada do que um rastro congelado do
    // dia anterior fingindo ser o dia pedido
    if (this.windMesh) this.windMesh.visible = this.windOn && !!grid;
    this.wake();
  }

  setWindFrames(
    a: { key: string; grid: WindGrid } | null,
    b: { key: string; grid: WindGrid } | null,
    mix: number
  ) {
    this.windGrid = a?.grid ?? null;
    this.windGPU?.setFrames(
      a ? { key: a.key, field: a.grid } : null,
      b ? { key: b.key, field: b.grid } : null,
      mix
    );
    if (this.windMesh) this.windMesh.visible = this.windOn && !!a;
    this.wake();
  }

  /** so move a fracao entre os dois quadros ja carregados */
  setWindMix(mix: number) {
    this.windGPU?.setMix(mix);
    this.wake();
  }

  // -------------------------------------------------------------- isóbaras
  setIsobars(data: IsobarSet | null) {
    this.isobarData = data;

    if (this.isobarLines) {
      this.g?.scene().remove(this.isobarLines);
      this.isobarLines.geometry.dispose();
      (this.isobarLines.material as THREE.Material).dispose();
      this.isobarLines = null;
    }
    if (!data?.contours?.length || !this.g || !this.isobarsOn) { this.wake(); return; }

    const R = this.g.getGlobeRadius() * 1.014;   // acima da imagem e polígonos, abaixo do vento
    const pos: number[] = [];
    const col: number[] = [];

    for (const c of data.contours) {
      const forte = c.major;
      const [r, g, b] = forte ? [0.36, 0.88, 0.69] : [0.62, 0.70, 0.78];
      const a = forte ? 1 : 0.55;

      for (let i = 0; i < c.points.length - 1; i++) {
        const p1 = llToVec3(c.points[i][1], c.points[i][0], R);
        const p2 = llToVec3(c.points[i + 1][1], c.points[i + 1][0], R);

        if (p1.distanceToSquared(p2) > (R * 0.5) ** 2) continue;

        pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        col.push(r, g, b, a, r, g, b, a);
      }
    }

    if (!pos.length) { this.refreshIsobarLabels(); this.wake(); return; }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.isobarLines = new THREE.LineSegments(geo, mat);
    this.isobarLines.renderOrder = 3;
    this.g.scene().add(this.isobarLines);

    this.refreshIsobarLabels();
    this.wake();
  }

  setIsobarsVisible(on: boolean) {
    this.isobarsOn = on;
    if (!on) {
      if (this.isobarLines) this.isobarLines.visible = false;
      this.refreshIsobarLabels();
    } else if (this.isobarData) {
      this.setIsobars(this.isobarData);
    }
    this.wake();
  }


  private refreshIsobarLabels = () => {
    if (this.disposed || !this.g) return;
    this.applyLOD(true);
  };

  setWindVisible(on: boolean) {
    this.windOn = on;
    if (!on) {
      if (this.windMesh) this.windMesh.visible = false;
      return;
    }
    if (!this.g) return;

    if (!this.windMesh) {
      const rnd = this.g.renderer?.();
      if (!rnd) return;

      this.windGPU = new WindGPU(rnd, 131072);
      if (this.windGrid) this.windGPU.setField(this.windGrid);

      this.windMat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.windGPU.texture },
          uOpacity: { value: 0.85 },
        },
        vertexShader: IMG_VERT,
        fragmentShader: WIND_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const geo = new THREE.SphereGeometry(this.g.getGlobeRadius() * 1.002, 128, 64);
      this.windMesh = new THREE.Mesh(geo, this.windMat);
      this.windMesh.renderOrder = 5;
      this.g.scene().add(this.windMesh);
    }
    this.windMesh.visible = !!this.windGrid;
  }

  // ------------------------------------------------------ correntes oceânicas
 
  setCurrents(grid: WindGrid | null) {
    this.currentGrid = grid;
    if (!grid) {
      if (this.currentMesh) this.currentMesh.visible = false;
      this.wake();
      return;
    }
    this.ensureCurrentMesh();
    this.currentGPU?.setField(grid, "hycom");
    if (this.currentMesh) this.currentMesh.visible = this.currentsOn;
    this.wake();
  }

  setCurrentsVisible(on: boolean) {
    this.currentsOn = on;
    if (!on) {
      if (this.currentMesh) this.currentMesh.visible = false;
      this.wake();
      return;
    }
    this.ensureCurrentMesh();
    if (this.currentMesh) this.currentMesh.visible = !!this.currentGrid;
    this.wake();
  }

  private ensureCurrentMesh() {
    if (this.currentMesh || !this.g) return;
    const rnd = this.g.renderer?.();
    if (!rnd) return;


    this.currentGPU = new WindGPU(rnd, 49152);
    this.currentGPU.speed = 0.45;
    this.currentGPU.fade = 0.992;

    if (this.currentGrid) this.currentGPU.setField(this.currentGrid, "hycom");

    this.currentMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.currentGPU.texture },
        uOpacity: { value: 0.7 },
      },
      vertexShader: IMG_VERT,
      fragmentShader: WIND_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const geo = new THREE.SphereGeometry(this.g.getGlobeRadius() * 1.0012, 128, 64);
    this.currentMesh = new THREE.Mesh(geo, this.currentMat);
    this.currentMesh.renderOrder = 4;
    this.currentMesh.visible = false;
    this.g.scene().add(this.currentMesh);
  }

  setWindSpeed(v: number) { if (this.windGPU) this.windGPU.speed = v; this.wake(); }
  setWindTrail(v: number) { if (this.windGPU) this.windGPU.fade = v; this.wake(); }


  setWindOpacity(v: number) {
    if (this.windMat) this.windMat.uniforms.uOpacity.value = v;
    this.wake();
  }

  /**
   * Densidade: fração das partículas do degrau atual.
   */
  setWindDensity(frac: number) {
    this.densidadeVento = Math.max(0.1, Math.min(1, frac));
    if (!this.windGPU) return;
    const q = TIERS[this.perf.tier];
    this.windGPU.resize(q.trail, this.particulasAlvo(q.particles), q.fadeEvery);
    this.wake();
  }

  /** piso de 3.000: abaixo disso não é "menos denso", é um campo vazio */
  private particulasAlvo(base: number) {
    return Math.max(3000, Math.round(base * this.densidadeVento));
  }

  private tickWind(dt: number) {
    if (!this.windOn || !this.windGPU || !this.windGrid) return;
    this.windGPU.step(dt);
    // o alvo de rastro alterna a cada quadro (ping-pong): reaponta o uniform
    if (this.windMat) this.windMat.uniforms.uMap.value = this.windGPU.texture;
  }

  /**
   * Avanço das correntes
   */
  private tickCurrents(dt: number) {
    if (!this.currentsOn || !this.currentGPU || !this.currentGrid) return;
    this.currentGPU.step(dt);
    if (this.currentMat) this.currentMat.uniforms.uMap.value = this.currentGPU.texture;
  }

  private rawQuakes: Quake[] = [];
  private rawFires: Fire[] = [];
  private rawOpenAQ: any[] = [];
  private rawHospitals: any[] = [];
  private clickTarget: { lat: number; lng: number } | null = null;

  setOpenAQ(list: any[]) {
    this.rawOpenAQ = list || [];
    this.refreshPointsAndRings();
    this.wake();
  }

  clearOpenAQ() {
    this.rawOpenAQ = [];
    this.refreshPointsAndRings();
  }

  setHospitals(list: any[]) {
    this.rawHospitals = list || [];
    this.refreshPointsAndRings();
    this.wake();
  }

  clearHospitals() {
    this.rawHospitals = [];
    this.refreshPointsAndRings();
  }

  // ------------------------------------------------------------------ fogo
  setFires(list: Fire[]) {
    this.rawFiresAll = list || [];
    this.selectFires();
    this.refreshPointsAndRings();
    this.wake();
  }

  clearFires() {
    this.rawFiresAll = [];
    this.rawFires = [];
    this.refreshPointsAndRings();
  }


  get firesDrawn() { return this.rawFires.length; }
  private selectFires() {
    const todos = this.rawFiresAll;
    if (!todos.length) { this.rawFires = []; return; }

    const pov = this.g?.pointOfView?.();
    const alt: number = pov?.altitude ?? 2;

    // O teto é o MENOR entre o orçamento de leitura (zoom) e o de desempenho
    // (tier). Um não substitui o outro: zoom cuida de não virar mancha, tier
    // cuida de não derrubar o quadro numa máquina modesta.
    const porZoom = alt > LOD.regional ? FIRE.budget.planetary
                  : alt > LOD.local ? FIRE.budget.regional
                  : FIRE.budget.local;
    const cap = Math.min(porZoom, TIERS[this.perf.tier].fires);

    if (!pov || todos.length <= cap) {
      this.rawFires = todos.slice(0, cap);
      return;
    }

    const [cx, cy, cz] = this.vecOf(pov.lat ?? 0, pov.lng ?? 0);
    // Cone um pouco mais largo que o visível: sem folga, um foco entra e sai da
    // lista a cada grau de rotação e pisca na borda do disco.
    const minDot = alt > LOD.regional ? 0.0 : alt > LOD.local ? 0.30 : 0.60;

    const visiveis: Fire[] = [];
    for (const f of todos) {
      const [x, y, z] = this.vecOf(f.lat, f.lng);
      if (x * cx + y * cy + z * cz > minDot) visiveis.push(f);
    }

    // `todos` já vem ordenado por FRP decrescente do servidor e o filtro
    // preserva a ordem, então o corte já entrega os mais intensos do recorte.
    this.rawFires = (visiveis.length ? visiveis : todos).slice(0, cap);
  }

  // --------------------------------------------------------- marcador de clique & terremotos
  setClickMarker(lat: number | null, lng: number | null) {
    this.clickTarget = lat != null && lng != null ? { lat, lng } : null;
    this.refreshPointsAndRings();
  }

  setQuakes(list: Quake[]) {
    this.rawQuakes = list || [];
    this.refreshPointsAndRings();
  }

  clearQuakes() {
    this.rawQuakes = [];
    this.refreshPointsAndRings();
  }

  private refreshPointsAndRings() {
    if (!this.g) return;
    const rings: RingDatum[] = this.rawQuakes.map((q) => {
      const k = Math.max(0, Math.min(1, (q.mag - 4) / 4));
      return {
        lat: q.lat, lng: q.lng,
        maxR: 1.5 + k * 7,
        speed: 0.8 + k * 3,
        period: 2600 - k * 1400,
        strength: 0.45 + k * 0.55,
      };
    });

    const points = this.rawQuakes.map((q) => {
      const k = Math.max(0, Math.min(1, (q.mag - 4) / 4));
      return {
        lat: q.lat, lng: q.lng,
        color: k > 0.5 ? "#ef4444" : "#f97316",
        alt: 0.008 + k * 0.02,
        radius: 0.14 + k * 0.22,
        label: `M ${q.mag.toFixed(1)} — ${q.place ?? ""}`,
      };
    });

    // ---- estações de qualidade do ar OpenAQ — 5-TIER AREA HALOS ---------------
    // 5 tiers: light green (bom), green-yellow (moderado), amber (insalubre sensíveis),
    //          red (insalubre), dark-red (muito insalubre/perigoso)
    for (const s of this.rawOpenAQ) {
      const aqi = s.aqi ?? 0;
      // 5-level color ramp matching EPA AQI breakpoints
      let coreColor: string, haloColor: string, tierName: string;
      if (aqi <= 50) {
        coreColor = "#4ade80"; haloColor = "#86efac"; tierName = "BOM";           // light green
      } else if (aqi <= 100) {
        coreColor = "#a3e635"; haloColor = "#d9f99d"; tierName = "MODERADO";      // green-yellow
      } else if (aqi <= 150) {
        coreColor = "#fbbf24"; haloColor = "#fde68a"; tierName = "SENSÍVEIS";     // amber
      } else if (aqi <= 200) {
        coreColor = "#f43f5e"; haloColor = "#fda4af"; tierName = "INSALUBRE";     // red
      } else {
        coreColor = "#991b1b"; haloColor = "#fca5a5"; tierName = "PERIGOSO";      // dark red
      }

      // Tier-based sizing: worse air = larger presence
      const severity = Math.min(1, aqi / 250);
      const coreRadius = 0.15 + severity * 0.25;       // 0.15 → 0.40
      const haloRadius = 0.35 + severity * 0.45;       // 0.35 → 0.80

      // Outer halo (large, translucent area showing pollution zone)
      points.push({
        lat: s.lat, lng: s.lng,
        color: haloColor,
        alt: 0.006,
        radius: haloRadius,
        label: "",
      });

      // Mid ring (medium, showing tier color)
      points.push({
        lat: s.lat, lng: s.lng,
        color: coreColor,
        alt: 0.009,
        radius: coreRadius,
        label: `🌫 ${s.name} — AQI ${aqi} (${tierName}) | PM2.5: ${s.pm25 ?? "?"} µg/m³`,
      });

      // Center dot (bright, small)
      points.push({
        lat: s.lat, lng: s.lng,
        color: "#ffffff",
        alt: 0.013,
        radius: 0.08,
        label: "",
      });

      // Pulsing ring — speed and size proportional to severity
      rings.push({
        lat: s.lat, lng: s.lng,
        maxR: 1.5 + severity * 4.5,           // bigger pulse for worse air
        speed: 1.2 + severity * 3.0,           // faster pulse for worse air
        period: 2800 - severity * 1600,         // shorter period = more urgent
        strength: 0.35 + severity * 0.55,
      });
    }

    // ---- hospitais OSM -------------------------------------------------------
    for (const h of this.rawHospitals) {
      const color = h.emergency ? "#22d3ee" : "#60a5fa"; // cyan for emergency, blue for regular
      const bedStr = h.beds ? ` · ${h.beds} leitos` : "";
      points.push({
        lat: h.lat, lng: h.lng,
        color,
        alt: 0.010,
        radius: 0.20,
        label: `🏥 ${h.name}${bedStr}${h.emergency ? " · EMERGÊNCIA" : ""}`,
      });
    }

    // ---- focos de calor -----------------------------------------------------
    let aneis = 0;
    for (const f of this.rawFires) {
      const k = FIRE.norm(f.frp);                                  // 0..1
      const cor = emberColor(k);

      points.push({
        lat: f.lat, lng: f.lng,
        color: rgbCss(cor),
        // Altitude proporcional: o foco intenso "sai" da esfera e ganha
        // silhueta contra o limbo, que e o que o faz ser notado de longe.
        alt: 0.006 + k * 0.014,
        radius: 0.05 + k * 0.22,
        label: fireLabel(f),
      });

      // ---- anel pulsante -------------------------------------------------
      if (aneis < FIRE.maxRings && f.frp >= FIRE.ringMinFrp) {
        aneis++;
        rings.push({
          lat: f.lat, lng: f.lng,
          maxR: 1.2 + k * 5.5,
          speed: 3.4 - k * 2.1,
          period: 900 + k * 2600,
          strength: 0.35 + k * 0.5,
          rgb: `${cor[0]},${cor[1]},${cor[2]}`,
        });
      }
    }

    if (this.clickTarget) {
      rings.push({
        lat: this.clickTarget.lat,
        lng: this.clickTarget.lng,
        maxR: 3.5,
        speed: 4.5,
        period: 900,
        strength: 1.0,
      });
      points.push({
        lat: this.clickTarget.lat,
        lng: this.clickTarget.lng,
        color: "#38bdf8",
        alt: 0.015,
        radius: 0.35,
        label: `Ponto selecionado (${this.clickTarget.lat.toFixed(2)}°, ${this.clickTarget.lng.toFixed(2)}°)`,
      });
    }

    this.g.ringsData(rings);
    this.g.pointsData(points);
  }

  // ------------------------------------------------------------ destruir
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.labelRaf) cancelAnimationFrame(this.labelRaf);
    this.ro?.disconnect();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.imgTex?.dispose();
    this.windGPU?.dispose();
    this.windMat?.dispose();
    this.currentGPU?.dispose();
    this.currentMat?.dispose();
    if (this.isobarLines) {
      this.isobarLines.geometry.dispose();
      (this.isobarLines.material as THREE.Material).dispose();
      this.isobarLines = null;
    }
    if (this.g?._destructor) this.g._destructor();
    this.g = null;
  }
}