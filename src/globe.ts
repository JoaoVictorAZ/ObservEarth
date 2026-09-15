// src/globe.ts
// -----------------------------------------------------------------------------
// Motor visual 3D do globo (Three.js / globe.gl integration).
// -----------------------------------------------------------------------------

import Globe from "globe.gl";
import * as THREE from "three";
import { WindGPU } from "./windGPU";
import { PerfMonitor, TIERS, type QualityTier, type FrameStats } from "./perf";
import { EstadoAnimacao } from "./pausa";
import { PiramideGlobo } from "./piramideGlobo";
import { FronteirasGlobo } from "./fronteiras";
import { calotaVisivel } from "./calota";
import { ORDEM } from "./ordemDesenho";
import { MalhaEscalar, type Escala as EscalaMalha } from "./malha/malha3d";
import { materialTerra } from "./globo/terra.ts";
import { vetorSolar } from "./globo/sol.ts";
import { criarAtmosfera, type Atmosfera } from "./globo/atmosfera.ts";
import { criarVoo, deveAnimar, fadeDoVento, PARTIDA, CHEGADA, type Voo } from "./globo/entrada.ts";
import { intersectarRelevo } from "./malha/picking.ts";
import type { CampoEscalar } from "./malha/campo";
import type { PontoCritico } from "./malha/extremos";

const TEX = {
  day: "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
  night: "https://unpkg.com/three-globe/example/img/earth-night.jpg",
  bump: "https://unpkg.com/three-globe/example/img/earth-topology.png",
  stars: "https://unpkg.com/three-globe/example/img/night-sky.png",
  water: "https://unpkg.com/three-globe/example/img/earth-water.png",
};

// Os tipos de dado moram em `./tipos` desde que o motor 2D nasceu — assim o
// mapa plano não precisa importar globe.gl só para saber o que é um WindGrid.
// A reexportação mantém funcionando tudo que já importava daqui.
import type {
  Quake, WindGrid, PlaceLabel, LabelSets, IsobarSet, Fire,
} from "./tipos";
export type { Quake, WindGrid, PlaceLabel, LabelSets, IsobarSet, Fire };

/** rotulo pronto para o DOM: `tier` escolhe o estilo em index.css */
type LabelDatum = PlaceLabel & {
  tier: "country" | "country-dim" | "state" | "state-dim" | "city";
  alt: number;
  /** opacidade por centralidade: 1 no centro da vista, ~0,3 na borda do foco */
  op: number;
};

/**
 * NIVEIS DE ZOOM
 */
const LOD = {
  regional: 1.15,
  local: 0.45,
} as const;



function llToVec3(lat: number, lng: number, r: number) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const c = Math.cos(la);
  return new THREE.Vector3(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
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
  /** altura sobre a esfera: acompanha o relevo quando a malha 3D está no ar */
  alt: number;
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
  // A PIRÂMIDE é a resolução que acompanha o zoom; ver src/piramideGlobo.ts.
  // A textura única continua existindo como PISO: ela cobre o planeta inteiro
  // de uma vez e segura a imagem enquanto os tiles do nível novo não chegam.
  //
  // Quem sabe qual camada está escolhida é a própria pirâmide. Havia uma cópia
  // do dia aqui (`imgDia`) só para uma guarda que deixou de existir quando as
  // fronteiras passaram a usar esta mesma atualização de câmera.
  private piramide: PiramideGlobo | null = null;
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

  // malha 3D do campo escalar: a camada de análise (ver src/malha/malha3d.ts)
  private malha: MalhaEscalar | null = null;
  private malhaOn = false;

  private clickFn: ((lat: number, lng: number) => void) | null = null;

  // rotulos e fronteiras com nivel de detalhe
  private labelData: LabelSets | null = null;
  private labelRaf = 0;
  private viewKey = "";
  // vetores unitarios pre-calculados: sem isso cada atualizacao de camera
  // refazia seno e cosseno para milhares de rotulos
  private lblVec = new Map<PlaceLabel, [number, number, number]>();
  /**
   * As fronteiras deixaram de ser polígonos do three-globe.
   *
   * Eram 470 feições trianguladas e extrudadas para desenhar apenas o
   * contorno — as duas faces preenchidas eram pintadas de transparente. Agora
   * são linhas numa pirâmide de tiles, com resolução que acompanha o zoom.
   * Ver `src/fronteiras.ts`.
   */
  private fronteiras: FronteirasGlobo | null = null;
  private noticeFn: ((msg: string | null) => void) | null = null;

  // desempenho
  readonly perf = new PerfMonitor();
  /** fração de partículas escolhida pelo usuário; sobrevive à troca de degrau */
  private densidadeVento = 1;
  /**
   * Dormir, acordar e ceder a GPU — em `./pausa`, com teste próprio.
   *
   * Eram três booleanos soltos aqui, e a ordem entre eles derrubou a aplicação
   * inteira com estouro de pilha: `resumeAnimation` do globe.gl reentra pelo
   * evento "change" do OrbitControls. O mesmo defeito existia em DOIS lugares
   * deste arquivo, escrito de duas formas diferentes.
   */
  private readonly anim = new EstadoAnimacao({
    retomar: () => this.g?.resumeAnimation?.(),
    pausar: () => this.g?.pauseAnimation?.(),
  });
  private interacting = false;
  private hoverFn: ((p: { lat: number; lng: number } | null) => void) | null = null;
  private hoverRaf = 0;
  private hoverXY: { x: number; y: number } | null = null;
  private baseDpr = 1;
  private statsFn: ((s: FrameStats) => void) | null = null;
  private rawFiresAll: Fire[] = [];
  /** o material da superfície; null enquanto as texturas não chegam */
  private terra: THREE.ShaderMaterial | null = null;
  private atmosfera: Atmosfera | null = null;
  /** o voo de abertura; null quando não há ou já acabou */
  private voo: Voo | null = null;
  /** opacidade pedida pela interface, para o fade de entrada não sobrescrevê-la */
  private opacidadeVento = 1;
  /** com a malha 3D levantada, tudo que não é ela recua */
  private modoAnalise = false;

  // ------------------------------------------------------------- ciclo
  mount(container: HTMLElement) {
    this.g = (Globe as any)()(container)
      .globeImageUrl(TEX.day)
      .bumpImageUrl(TEX.bump)
      .backgroundImageUrl(TEX.stars)
      // O HALO DO THREE-GLOBE FICA DESLIGADO. Ele é cor única e opacidade
      // constante: igual no meio-dia, na meia-noite e em cima do terminador,
      // que é justamente onde a atmosfera é mais visível de verdade. O que
      // entra no lugar está em ./globo/atmosfera.ts.
      .showAtmosphere(false)
      .pointLat("lat").pointLng("lng").pointColor("color")
      .pointAltitude("alt").pointRadius("radius").pointLabel("label")
      .ringLat("lat").ringLng("lng").ringMaxRadius("maxR").ringAltitude("alt")
      .ringPropagationSpeed("speed").ringRepeatPeriod("period")
      // `d.rgb` deixa cada anel herdar a cor do que ele marca: brasa para foco
      // de calor, laranja padrão para sismo. Sem isso todo anel sairia laranja
      // e um foco branco-incandescente ganharia um halo de outra temperatura.
      .ringColor((d: RingDatum) => (t: number) =>
        `rgba(${d.rgb ?? "249,115,22"},${(1 - t) * d.strength})`)
;

    // O CLIQUE NÃO PODE SER O DO globe.gl.
    //
    // `onGlobeClick` intersecta a ESFERA — foi assim que ele nasceu, e é o
    // certo enquanto não há nada em cima dela. Com o relevo levantado ele
    // devolve a coordenada errada, e a correção de `geoNoPonto` não chegaria
    // ao clique se ele continuasse vindo de lá.
    //
    // O limiar de arrasto é o mesmo cuidado que o mapa plano já toma: sem ele,
    // todo giro do planeta terminaria abrindo a sonda num ponto que ninguém
    // escolheu.
    {
      let px = 0, py = 0, andou = 0, apertado = false;
      // SÓ O CANVAS CONTA COMO "O PLANETA".
      //
      // O cartão ancorado mora DENTRO do palco — precisa morar, porque a
      // posição que `projetar` devolve é relativa a este contêiner. Sem esta
      // guarda, clicar no botão "Análise completa" do cartão borbulharia até
      // aqui e sondaria o ponto que está por baixo dele. Os topônimos não dão
      // problema porque já são `pointer-events: none`.
      const noPlaneta = (e: Event) => e.target instanceof HTMLCanvasElement;

      container.addEventListener("pointerdown", (e: PointerEvent) => {
        if (e.button !== 0 || !noPlaneta(e)) return;
        apertado = true; andou = 0; px = e.clientX; py = e.clientY;
      });
      container.addEventListener("pointermove", (e: PointerEvent) => {
        if (!apertado) return;
        andou += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
        px = e.clientX; py = e.clientY;
      });
      container.addEventListener("pointerup", (e: PointerEvent) => {
        if (!apertado) return;
        apertado = false;
        if (andou > 5) return;
        const p = this.geoNoPonto(container, e.clientX, e.clientY);
        if (p) this.clickFn?.(p.lat, p.lng);
      });
      container.addEventListener("pointercancel", () => { apertado = false; });
    }

    // ---- COORDENADA SOB O PONTEIRO ----------------------------------------
    //
    // O globe.gl expõe clique e não expõe hover, então o raio é lançado à mão.
    // Contra uma ESFERA ANALÍTICA, e não contra a malha: a interseção
    // raio–esfera é uma equação de segundo grau, custa nanossegundos e não
    // depende da resolução da geometria — enquanto um raycast na malha
    // percorreria os milhares de triângulos do globo a cada movimento.
    //
    // Coalescido por quadro. O ponteiro dispara dezenas de eventos por
    // segundo e a régua só é redesenhada uma vez por quadro; processar todos
    // seria trabalho jogado fora.
    const geoNoPonteiro = () => {
      this.hoverRaf = 0;
      const xy = this.hoverXY;
      if (!xy || !this.hoverFn) return;
      const p = this.geoNoPonto(container, xy.x, xy.y);
      // FORA DO DISCO NÃO EXISTE COORDENADA. Manter a última faria a leitura
      // mostrar um valor de um lugar onde o cursor não está.
      this.hoverFn(p);
      container.style.cursor = p ? "crosshair" : "";
    };

    container.addEventListener("pointermove", (e: PointerEvent) => {
      if (!this.hoverFn) return;
      // Sobre o cartão, a leitura contínua PARA em vez de reportar o ponto que
      // está escondido atrás dele. Um número que muda enquanto você lê o
      // cartão é pior que um número que espera.
      if (!(e.target instanceof HTMLCanvasElement)) { this.hoverFn(null); return; }
      this.hoverXY = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(geoNoPonteiro);
    });
    container.addEventListener("pointerleave", () => {
      this.hoverXY = null;
      this.hoverFn?.(null);
      container.style.cursor = "";
    });

    // ---- AFORDÂNCIA E SEGUNDO VERBO ---------------------------------------
    //
    // O globo tinha UM verbo: clicar. Nada na tela dizia que ele era clicável,
    // e não havia como se aproximar de um ponto sem arrastar e rolar até
    // acertar. Duas adições pequenas, e as duas são convenção de mapa:
    //
    //   cursor        muda sobre o planeta e volta ao normal fora dele
    //   clique duplo  aproxima no ponto, como em qualquer mapa
    //
    // O cursor sai do MESMO cálculo do hover, então ele custa zero: a
    // coordenada já foi resolvida para a leitura contínua da régua.
    container.addEventListener("dblclick", (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const p = this.geoNoPonto(container, e.clientX, e.clientY);
      if (!p) return;
      // Metade da altitude por vez, com piso: pular direto para o chão a cada
      // duplo clique tira a noção de onde se estava. `flyTo` já interpola.
      const alt = this.g?.pointOfView?.()?.altitude ?? 1.7;
      this.flyTo(p.lat, p.lng, Math.max(0.14, alt * 0.5));
    });


    // `onPolygonClick` foi removido junto com os polígonos. Ele existia porque
    // as feições cobriam a esfera e engoliam o clique antes de `onGlobeClick`
    // ver — de brinde, sondar um ponto no meio do oceano nunca funcionou como
    // sondar um ponto em terra. Sem polígonos, todo clique chega ao globo.

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

    // A PRIMEIRA VISTA. Ver ./globo/entrada.ts: a câmera nasce longe, com o
    // planeta inteiro contra as estrelas, e desce até a altitude de trabalho.
    // Qualquer interação cancela; `prefers-reduced-motion` nem começa.
    const reduzido = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const jaViu = (() => {
      try { return sessionStorage.getItem("obs:entrada") === "1"; } catch { return false; }
    })();

    if (deveAnimar({ reduzido, jaViu })) {
      this.g.pointOfView(PARTIDA);
      this.voo = criarVoo(performance.now());
      try { sessionStorage.setItem("obs:entrada", "1"); } catch { /* sem persistência, segue */ }
    } else {
      this.g.pointOfView(CHEGADA);
    }

    const c = this.g.controls();
    c.autoRotate = false;
    c.autoRotateSpeed = 0.35;
    c.enableDamping = true;

    c.addEventListener("change", () => { this.wake(); this.scheduleLOD(); });
    c.addEventListener("start", () => {
      // O PRIMEIRO TOQUE MANDA. Uma abertura que ignora a pessoa por dois
      // segundos e meio é indistinguível de uma tela travada.
      this.cancelarEntrada();
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
    const raio = this.g.getGlobeRadius();
    this.piramide = new PiramideGlobo(this.g.scene(), { raio });
    this.fronteiras = new FronteirasGlobo(this.g.scene(), { raio });
    this.fronteiras.onAviso((m) => this.noticeFn?.(m));
    this.malha = new MalhaEscalar(this.g.scene(), { raio });
    this.atmosfera = criarAtmosfera({ raio });
    this.g.scene().add(this.atmosfera.mesh);

    this.applySuperficie();
    this.applySun();
    this.loop();
    // As fronteiras entram pela pirâmide, junto com a câmera. Ver atualizarPiramide.
    this.atualizarPiramide(true);
    this.loadLabels();
  }

  private tuneRenderer() {
    const rnd = this.g?.renderer?.();
    if (!rnd) return;
    rnd.sortObjects = true;
    rnd.logarithmicDepthBuffer = true;

    // TONE MAPPING — a peça que faltava no fim do pipeline.
    //
    // Sem ela o renderizador CORTA tudo que passa de 1,0. O glint do mar, as
    // luzes de cidade e os topos das rampas de cor não ficavam "brilhantes":
    // ficavam BRANCOS CHAPADOS, sem forma, porque três canais saturados são
    // sempre a mesma cor. É por isso que o reflexo no oceano parecia uma
    // mancha e não um reflexo.
    //
    // ACES faz o ombro da curva: o realce comprime em vez de cortar, e volta a
    // ter desenho. A exposição em 1,05 compensa o leve escurecimento que a
    // própria curva introduz nos tons médios.
    //
    // ISTO MUDA A APARÊNCIA DE TODAS AS RAMPAS DE COR, e não só dos realces.
    // Uma escala calibrada por contraste medido precisa ser reconferida — a
    // curva é aplicada depois do shader, sobre o resultado de qualquer camada.
    rnd.toneMapping = THREE.ACESFilmicToneMapping;
    rnd.toneMappingExposure = 1.05;
    this.baseDpr = window.devicePixelRatio || 1;
    rnd.setPixelRatio(Math.min(this.baseDpr, TIERS[this.perf.tier].dpr));
    this.perf.onTierChange((t) => this.applyTier(t));
    const maxA = rnd.capabilities?.getMaxAnisotropy?.() ?? 1;
    const globeMat = this.g?.globeMaterial?.();
    if (globeMat?.map) globeMat.map.anisotropy = Math.min(8, maxA);
  }

  /**
   * A SUPERFÍCIE.
   *
   * Substitui o MeshPhong padrão do three-globe por um shader que mistura dia e
   * noite pelo ângulo solar, acende as luzes de cidade no lado escuro e dá
   * glint ao mar. Ver `./globo/terra.ts` para o porquê de cada parte.
   *
   * SE ALGUMA TEXTURA FALHAR, NADA ACONTECE: o material antigo continua no
   * lugar e o globo fica com a aparência anterior. Uma tela preta porque um
   * PNG não veio seria pior que uma tela sem crepúsculo.
   */
  private applySuperficie() {
    const carregar = (url: string, srgb: boolean) =>
      new Promise<THREE.Texture>((ok, erro) => {
        new THREE.TextureLoader().load(url, (tex) => {
          if (!tex.image || tex.image.width <= 0) { tex.dispose(); erro(new Error(`textura vazia: ${url}`)); return; }
          // As máscaras (água, relevo) são DADO e não cor: passá-las por sRGB
          // aplicaria uma curva gama a um número que não é luminância.
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = 8;
          ok(tex);
        }, undefined, () => erro(new Error(`falha ao carregar ${url}`)));
      });

    Promise.all([
      carregar(TEX.day, true),
      carregar(TEX.night, true),
      carregar(TEX.water, false),
      carregar(TEX.bump, false),
    ]).then(([dia, noite, agua, relevo]) => {
      if (this.disposed || !this.g) {
        for (const t of [dia, noite, agua, relevo]) t.dispose();
        return;
      }
      const mat = materialTerra({ dia, noite, agua, relevo });
      this.terra = mat;
      this.g.globeMaterial(mat);
      this.applySun();
      this.wake();
    }).catch((e) => {
      // Declarado, não silencioso: sem isto a Terra volta a ser uma bola de
      // bilhar e ninguém sabe por quê.
      console.warn("[globe] superfície em modo simples:", e.message);
      this.applyOceanSimples();
    });
  }

  /**
   * O caminho antigo, mantido como rede: especular no Phong padrão.
   */
  private applyOceanSimples() {
    const mat = this.g?.globeMaterial?.() as any;
    if (!mat || mat.isShaderMaterial) return;
    new THREE.TextureLoader().load(TEX.water, (tex) => {
      if (this.disposed) { tex.dispose(); return; }
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

      // GPU cedida ao modelo de linguagem: nada de partículas, e o globe.gl
      // fica com a própria animação suspensa. Ver `setPausado` em tipos.ts.
      if (this.anim.cedendoGpu) {
        this.perf.end(t, this.g?.renderer?.());
        this.raf = requestAnimationFrame(step);
        return;
      }

      // A CÂMERA ENTRA NO SHADER: o glint do mar é especular, e especular
      // depende de onde se olha. Sem isto o reflexo fica cravado num ponto e
      // parece uma mancha na textura.
      const cam = (this.terra || this.atmosfera) ? this.g?.camera?.() : null;
      if (cam) {
        this.terra?.uniforms.uCamera.value.copy(cam.position);
        this.atmosfera?.material.uniforms.uCamera.value.copy(cam.position);
      }

      this.tickEntrada(t);
      this.tickImagery(dt);
      this.tickWind(dt);
      this.tickCurrents(dt);

      const animating = this.windOn || this.currentsOn || this.imgFade < 1 || this.interacting
        || !!this.voo;
      if (animating) this.anim.animando();
      else this.anim.ocioseou(90);

      this.perf.end(t, this.g?.renderer?.());
      if (this.statsFn) this.statsFn(this.perf.stats);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Dormir e acordar moram em `./pausa`, com teste próprio. */
  private wake() { this.anim.despertar(); }

  onStats(fn: (s: FrameStats) => void) { this.statsFn = fn; }

  setPausado(on: boolean) { this.anim.cederGpu(on); }

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

    // A PIRÂMIDE VEM ANTES DO CORTE POR `viewKey`. Aquela chave é quantizada em
    // 6° de latitude e longitude, granularidade pensada para rótulo — que não
    // muda com um arrasto pequeno. Tile muda: no nível 7 um tile tem 1,4° de
    // lado, e esperar 6° de movimento deixaria metade da tela sem imagem.
    this.atualizarPiramide();

    const key = `${Math.round(lat / 6)}:${Math.round(lng / 6)}:${Math.round(alt * 20)}`;
    if (!force && key === this.viewKey) return;
    this.viewKey = key;

    const [cx, cy, cz] = this.vecOf(lat, lng);

    // ---- focos de calor ---------------------------------------------------
    if (this.rawFiresAll.length) {
      this.selectFires();
      this.refreshPointsAndRings();
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
    // Separação MAIOR e teto MENOR do que antes, e os dois números vieram de
    // olhar a tela: com 3,2 e 90 o hemisfério africano inteiro aparecia
    // rotulado de uma vez, e os nomes longos — "República Democrática do
    // Congo" — atravessavam o disco por cima do campo de vento.
    //
    // Topônimo é REFERÊNCIA, não dado. Ele existe para dizer onde a pessoa
    // está olhando, e um mapa em que a referência disputa atenção com a medida
    // trocou o assunto de lugar.
    const sepDeg = Math.max(0.45, alt * (this.modoAnalise ? 7.0 : 4.6));
    const minSep = Math.cos((sepDeg * Math.PI) / 180);

    const kept: Cand[] = [];
    for (const c of cand) {
      let clash = false;
      for (const k of kept) {
        if (c.v[0] * k.v[0] + c.v[1] * k.v[1] + c.v[2] * k.v[2] > minSep) { clash = true; break; }
      }
      if (clash) continue;
      kept.push(c);
      if (kept.length >= (this.modoAnalise ? 24 : 55)) break;   // teto duro no DOM
    }

    for (const c of kept) {
      // desbota em direcao a borda do cone: o centro fica nitido, a periferia
      const t = (c.dot - focusDot) / (1 - focusDot);
      const op = 0.30 + 0.70 * Math.min(1, Math.max(0, t)) ** 0.65;
      // O RÓTULO SOBE PARA O RELEVO. Com a malha levantada, um topônimo na
      // altitude da esfera fica ENTERRADO debaixo de uma superfície opaca — e
      // era exatamente essa a queixa: "os nomes ficam atrás".
      //
      // A altura própria do rótulo (`c.alt`) continua somando: ela é o
      // afastamento que impede o texto de rasar a superfície e sumir por
      // profundidade em algumas placas.
      out.push({
        ...c.p, tier: c.tier,
        alt: c.alt + this.alturaRelevoEm(c.p.lat, c.p.lng),
        op: +op.toFixed(2),
      });
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
              alt: 0.014 + this.alturaRelevoEm(c.lat, c.lng),
              op: 1,
            } as unknown as LabelDatum & { alt: number; op: number });
          }
        }
      }
    }

    this.g.htmlElementsData(out);
  }

  /**
   * A coordenada sob um ponto da tela, ou `null` fora do disco do planeta.
   *
   * Contra uma ESFERA ANALÍTICA, e não contra a malha: a interseção
   * raio–esfera é uma equação de segundo grau, custa nanossegundos e não
   * depende da resolução da geometria — enquanto um raycast na malha
   * percorreria os milhares de triângulos do globo a cada movimento.
   */
  private geoNoPonto(el: HTMLElement, cx: number, cy: number): { lat: number; lng: number } | null {
    if (!this.g || this.disposed) return null;
    const cam = this.g.camera?.();
    if (!cam) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;

    const ndc = new THREE.Vector2(
      ((cx - r.left) / r.width) * 2 - 1,
      -(((cy - r.top) / r.height) * 2 - 1),
    );
    const raio = new THREE.Raycaster();
    raio.setFromCamera(ndc, cam);

    const R = this.g.getGlobeRadius();

    // O RELEVO VEM PRIMEIRO, e é por isso que este método existe.
    //
    // Com a malha 3D levantada, o raio atravessava o pico que a pessoa estava
    // mirando e ia bater na esfera lá atrás — que naquela direção é outro
    // lugar do planeta. Mirando uma alta sobre a Argentina em vista oblíqua, a
    // sonda abria no Atlântico. Ver `src/malha/picking.ts` para por que a
    // solução é marcha no raio e não `Raycaster` na malha.
    if (this.malhaOn && this.malha) {
      const acerto = intersectarRelevo(
        {
          o: [raio.ray.origin.x, raio.ray.origin.y, raio.ray.origin.z],
          d: [raio.ray.direction.x, raio.ray.direction.y, raio.ray.direction.z],
        },
        {
          raio: R,
          exagero: this.malha.exageroAtual,
          alturaEm: (lat, lng) => this.malha!.alturaEm(lat, lng),
        },
      );
      if (acerto) return { lat: acerto.lat, lng: acerto.lng };
    }

    // Plano B: a esfera lisa. Vale quando a malha está desligada, quando o
    // raio passa por cima de todo o relevo, e quando o trecho que ele
    // atravessa não tem dado — os três casos em que não existe superfície de
    // análise para acertar.
    const esfera = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R);
    const ponto = new THREE.Vector3();
    if (!raio.ray.intersectSphere(esfera, ponto)) return null;
    const g = this.g.toGeoCoords(ponto);
    return { lat: g.lat, lng: g.lng };
  }

  /**
   * A ALTURA DO RELEVO NUM PONTO, em fração do raio. Zero com a malha desligada.
   *
   * ---------------------------------------------------------------------------
   * POR QUE ISTO EXISTE, E O QUE ELE CONSERTA
   * ---------------------------------------------------------------------------
   * Com a malha 3D levantada, TUDO que mora no raio da esfera fica enterrado
   * debaixo dela: os topônimos, as fronteiras, o marcador do clique, os anéis
   * de sismo, os focos. A superfície de análise é opaca, então o que está por
   * baixo simplesmente some — e o sintoma é o pior possível, porque o rótulo
   * continua "existindo" e ninguém entende por que não aparece.
   *
   * Uma função só, consultada por todo mundo que precisa marcar um LUGAR. Duas
   * cópias dessa conta em lugares diferentes seria como o rótulo passa a flutuar
   * um pouco acima ou abaixo da superfície que ele deveria tocar.
   *
   * NÃO se aplica a camadas de CAMPO — vento, correntes, imagem. Elas
   * descrevem o que acontece na superfície do planeta, não na altura de uma
   * isóbara desenhada; levantá-las seria afirmar uma geometria que o dado não
   * tem. Ver o inventário no cabeçalho de `src/malha/picking.ts`.
   */
  alturaRelevoEm(lat: number, lng: number): number {
    if (!this.malhaOn || !this.malha) return 0;
    const h = this.malha.alturaEm(lat, lng);
    if (h == null || !Number.isFinite(h)) return 0;
    return Math.max(0, Math.min(1, h)) * this.malha.exageroAtual;
  }

  onClick(fn: (lat: number, lng: number) => void) { this.clickFn = fn; }
  onHover(fn: (p: { lat: number; lng: number } | null) => void) { this.hoverFn = fn; }

  /**
   * Projeção de coordenada para pixel, com teste de horizonte.
   *
   * A VISIBILIDADE NÃO É `z < 1` DO NDC. Um ponto do outro lado do planeta
   * projeta dentro da tela e passa no teste de profundidade do clip — ele só
   * não é visto porque a Terra é opaca, e o clip não sabe disso.
   *
   * A condição certa é geométrica: com a câmera a distância `d` do centro e o
   * planeta de raio `R`, um ponto da superfície está do lado de cá do horizonte
   * quando `p̂ · ĉ > R / d`. É o cosseno do ângulo em que a linha de visada
   * tangencia a esfera.
   */
  projetar(lat: number, lng: number) {
    if (!this.g || this.disposed) return null;
    const cam = this.g.camera?.();
    const el = this.g.renderer?.()?.domElement as HTMLCanvasElement | undefined;
    if (!cam || !el) return null;
    const w = el.clientWidth, h = el.clientHeight;
    if (w <= 0 || h <= 0) return null;

    const R = this.g.getGlobeRadius();
    // O CARTÃO ANCORADO TEM QUE POUSAR NO RELEVO, e não na esfera abaixo dele.
    // Sem isto, marcar um pico deixava o cartão flutuando deslocado — visível
    // em vista oblíqua, que é justamente quando o relevo importa.
    const Rp = R * (1 + this.alturaRelevoEm(lat, lng));
    const p = llToVec3(lat, lng, Rp);
    const d = cam.position.length();
    // O horizonte continua sendo o da ESFERA: é ela que oclui. Um ponto
    // levantado pode estar visível além do horizonte geométrico do planeta, e
    // por isso o teste usa o raio do ponto e não o da esfera.
    const visivel = d > R && p.dot(cam.position) / (Rp * d) > R / d;

    const ndc = p.clone().project(cam);
    return {
      x: (ndc.x * 0.5 + 0.5) * w,
      y: (-ndc.y * 0.5 + 0.5) * h,
      visivel,
    };
  }
  setAutoRotate(on: boolean) { if (this.g) this.g.controls().autoRotate = on; }
  flyTo(lat: number, lng: number, altitude = 1.6) {
    this.g?.pointOfView({ lat, lng, altitude }, 900);
  }

  // --------------------------------------------------------- dia e noite
  setTime = (d: Date) => { this.time = d; this.applySun(); };
  setDayNight = (on: boolean) => { this.dayNight = on; this.applySun(); };

  private applySun = () => {
    if (!this.g || this.disposed) return;

    // A CONTA DO SOL MORA EM `./globo/sol.ts`, com teste próprio contra os
    // solstícios e os equinócios. Estava aqui dentro, escrita à mão, e por isso
    // nunca tinha sido verificada contra o calendário.
    const [sx, sy, sz] = vetorSolar(this.time);

    // Caminho novo: o terminador é do shader.
    if (this.terra) {
      const u = this.terra.uniforms;
      u.uSol.value.set(sx, sy, sz);
      u.uCiclo.value = this.dayNight ? 1 : 0;
      // Sem ciclo dia/noite não há lado noturno, e luzes de cidade acesas sobre
      // um planeta inteiramente iluminado seriam sujeira, não informação.
      u.uCidades.value = this.dayNight ? 1 : 0;
      if (this.atmosfera) {
        this.atmosfera.material.uniforms.uSol.value.set(sx, sy, sz);
        this.atmosfera.material.uniforms.uCiclo.value = this.dayNight ? 1 : 0;
      }

      // As luzes do three-globe continuam existindo para as OUTRAS cascas —
      // marcadores, malha, imagens. Neutraliza-se a direcional para que ela não
      // sombreie duas vezes o que o shader já resolveu.
      const lights: any[] = this.g.lights ? this.g.lights() : [];
      for (const l of lights) {
        if (l.type === "DirectionalLight") l.intensity = 0.35;
        if (l.type === "AmbientLight") l.intensity = 0.9;
      }
      this.wake();
      return;
    }

    // Caminho antigo, enquanto as texturas não chegam ou se elas falharem.
    const lights: any[] = this.g.lights ? this.g.lights() : [];
    const dir = lights.find((l) => l.type === "DirectionalLight");
    const amb = lights.find((l) => l.type === "AmbientLight");

    if (!this.dayNight) {
      if (dir) dir.intensity = 0.55;
      if (amb) amb.intensity = 1.35;
      return;
    }
    const R = this.g.getGlobeRadius() * 2;
    if (dir) { dir.position.set(sx * R, sy * R, sz * R); dir.intensity = 1.5; }
    if (amb) amb.intensity = 0.12;
  };

  /**
   * Base clara ou escura.
   *
   * Com o shader instalado isto deixou de trocar a textura do planeta inteiro
   * — o que apagava o dia do outro lado do mundo — e passou a mexer só na
   * intensidade das luzes de cidade.
   */
  setBase(style: "day" | "night") {
    if (this.terra) {
      this.terra.uniforms.uCidades.value = style === "night" ? 1.6 : 1;
      this.wake();
      return;
    }
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
      this.imgMesh.renderOrder = ORDEM.IMAGEM;
      this.imgMesh.visible = false;
      this.g.scene().add(this.imgMesh);
    }
    if (this.imgMat) this.imgMat.uniforms.uOpacity.value = opacity;

    const my = this.imgToken;
    const day = date.toISOString().slice(0, 10);

    // A PIRÂMIDE SÓ VALE PARA IMAGEM DE SATÉLITE, e a distinção é de dado, não
    // de conveniência. O MODIS tem 250 m nativos e o VIIRS 375 m: uma textura
    // global de 4096 px joga fora 97% desse detalhe, e recortar recupera. Um
    // campo do GFS tem 0,25°, ou seja 1440 colunas — a textura de 4096 já
    // amostra o campo quase três vezes acima da resolução dele. Pedir tiles
    // ali seria ampliar pixel inventado e gastar cota para isso.
    //
    // `id` começando com "/" é uma URL pronta de campo; ver o comentário acima.
    this.piramide?.definirCamada(id.startsWith("/") ? null : id, day);
    this.piramide?.definirOpacidade(opacity);
    this.atualizarPiramide(true);
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

        // Só a textura ANTERIOR desta camada é descartada aqui.
        //
        // Havia neste ponto, coladas por uma substituição em bloco que errou o
        // alvo, as linhas que destroem a pirâmide de tiles, as fronteiras e a
        // malha — o conteúdo do `dispose()`. Elas rodavam a CADA imagem de
        // satélite carregada: ligar uma camada de imagem apagava os tiles de
        // detalhe e as fronteiras, e como tudo virava `null` sem erro, o
        // sintoma era "as fronteiras somem quando eu ligo o MODIS". Foram
        // devolvidas para o `dispose()`, que era de onde tinham saído.
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

  // ------------------------------------------------------------- malha 3D
  // A camada de análise. Ver `src/malha/malha3d.ts` para o porquê de altura E
  // cor, e `src/malha/extremos.ts` para o que os pinos marcam.

  setMalha(campo: CampoEscalar | null, escala: EscalaMalha | null) {
    this.malha?.definirCampo(campo, escala);
    this.malha?.definirVisivel(this.malhaOn && !!campo);
    // Campo novo é relevo novo: trocar de variável ou de hora muda a altura de
    // cada ponto do planeta, e quem já está desenhado precisa acompanhar.
    this.sincronizarRelevo();
    this.wake();
  }

  setMalhaVisivel(on: boolean) {
    this.malhaOn = on;
    this.malha?.definirVisivel(on);
    this.aplicarModoAnalise(on);
    this.sincronizarRelevo();
    this.wake();
  }

  /**
   * MODO ANÁLISE — o que fazer quando existe uma superfície levantada.
   *
   * Com a malha 3D no ar, a tela passa a ter DUAS superfícies a poucos
   * milésimos de raio uma da outra, mais um campo de partículas entre elas,
   * mais os topônimos por cima de tudo. É informação demais no mesmo lugar, e
   * o sintoma é exatamente o que se sente ao girar: não dá para saber o que
   * está na frente.
   *
   * A saída não é apagar coisas — é DECIDIR QUEM É O ASSUNTO. Levantada a
   * malha, ela é. A superfície do planeta recua para cinza escuro e continua
   * dando referência geográfica; o vento quase some, porque um campo de
   * partículas atrás de um relevo translúcido é ruído puro; e os topônimos
   * ficam pela metade.
   *
   * Nada é desligado de fato: baixar a malha devolve tudo como estava, e a
   * preferência de quem mexeu nos controles sobrevive à ida e à volta.
   */
  /**
   * Reapresenta o relevo a quem desenha LINHAS sobre a esfera.
   *
   * Pontos e rótulos consultam `alturaRelevoEm` na hora de serem montados, e
   * por isso se corrigem sozinhos na próxima atualização. As fronteiras são
   * geometria persistida: elas precisam ser AVISADAS, senão continuam no raio
   * antigo até o próximo recarregamento de tile.
   */
  private sincronizarRelevo() {
    this.fronteiras?.definirRelevo(
      this.malhaOn && this.malha ? (lat, lng) => this.alturaRelevoEm(lat, lng) : null,
    );
    // Isóbaras são geometria persistida como as fronteiras, mas sem caminho de
    // reposicionamento incremental: refazê-las é uma passada sobre alguns
    // milhares de pontos, e acontece só quando o relevo muda — não por quadro.
    if (this.isobarsOn && this.isobarData) this.setIsobars(this.isobarData);
    this.refreshPointsAndRings();
    this.applyLOD(true);
  }

  private aplicarModoAnalise(on: boolean) {
    if (this.modoAnalise === on) return;
    this.modoAnalise = on;
    if (this.terra) this.terra.uniforms.uAtenuar.value = on ? 1 : 0;
    this.aplicarOpacidadeVento();
    this.applyLOD(true);
  }

  /** altura máxima como fração do raio; 0 achata a malha sobre a esfera */
  setMalhaExagero(x: number) {
    this.malha?.definirExagero(x);
    // Tudo que marca lugar sobe junto: arrastar o controle de relevo sem isto
    // deixaria fronteiras e rótulos parados enquanto a superfície se afasta.
    this.sincronizarRelevo();
    this.wake();
  }
  setMalhaArame(on: boolean) { this.malha?.definirArame(on); this.wake(); }
  setMalhaOpacidade(o: number) { this.malha?.definirOpacidade(o); this.wake(); }

  /** pinos de mínimo, máximo e sela, no ponto refinado sub-célula */
  setExtremos(pontos: PontoCritico[]) { this.malha?.marcarExtremos(pontos); this.wake(); }

  // ------------------------------------------------- sobreposicao termica
  setThermalOverlay(on: boolean, date: Date) {
    if (!on) { this.clearImagery(); return; }
    this.setImagery("temperature", date, 0.85);
  }

  setImageryOpacity(o: number) {
    if (this.imgMat) this.imgMat.uniforms.uOpacity.value = o;
    this.piramide?.definirOpacidade(o);
  }

  private clearImagery() {
    if (this.imgMesh) this.imgMesh.visible = false;
    this.imgFade = 0;
    this.piramide?.definirCamada(null, "");
  }

  /**
   * Repõe os tiles para a câmera atual.
   *
   * Chamado a cada mudança de câmera, e por isso precisa ser barato quando não
   * há nada a fazer: a `PiramideGlobo` sai na primeira linha se não houver
   * camada, e `planoDeTiles` é aritmética sobre meia dúzia de números.
   */
  private atualizarPiramide(force = false) {
    if (!this.g || this.disposed || !this.piramide) return;
    // SEM GUARDA DE CAMADA AQUI, e isso mudou.
    //
    // Antes esta função saía cedo quando não havia imagem escolhida. As
    // fronteiras existem SEMPRE, inclusive sobre o globo nu, e a guarda as
    // congelaria no nível em que estivessem. Quem sabe se tem o que pedir é
    // cada pirâmide: a de imagem sai na primeira linha do `atualizar` dela.

    const pov = this.g.pointOfView?.();
    const cam = this.g.camera?.();
    if (!pov || !cam) return;

    const vista = calotaVisivel(
      pov.lat ?? 0, pov.lng ?? 0, pov.altitude ?? 2,
      cam.fov ?? 50, cam.aspect ?? 16 / 9,
    );
    const rnd = this.g.renderer?.();
    const larguraPx = rnd?.domElement?.clientWidth || window.innerWidth;
    const dpr = rnd?.getPixelRatio?.() ?? 1;
    this.piramide.atualizar(vista, larguraPx, dpr);
    // As fronteiras usam a MESMA janela e o MESMO plano de tiles da imagem.
    // Duas pirâmides desalinhadas pediriam níveis diferentes para a mesma
    // vista, e a linha ficaria mais grossa ou mais fina que o mapa embaixo.
    this.fronteiras?.atualizar(vista, larguraPx, dpr);
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

    const R0 = this.g.getGlobeRadius() * 1.014;   // acima da imagem, abaixo do vento
    const Rbase = this.g.getGlobeRadius();
    const pos: number[] = [];
    const col: number[] = [];

    // AS ISÓBARAS TAMBÉM SOBEM. Elas são linhas de estrutura como as
    // fronteiras: com a malha 3D no ar e opaca, uma isóbara no raio da esfera
    // fica enterrada. E há um bônus quando o campo levantado é a própria
    // pressão — a isóbara passa a correr SOBRE o relevo que ela descreve, e
    // uma baixa vira uma cratera com as linhas contornando a parede.
    const raioEm = (lat: number, lng: number) =>
      R0 + Rbase * this.alturaRelevoEm(lat, lng);
    const R = R0;   // usado só no corte de emenda, que é uma distância relativa

    for (const c of data.contours) {
      const forte = c.major;
      const [r, g, b] = forte ? [0.36, 0.88, 0.69] : [0.62, 0.70, 0.78];
      const a = forte ? 1 : 0.55;

      for (let i = 0; i < c.points.length - 1; i++) {
        const p1 = llToVec3(c.points[i][1], c.points[i][0], raioEm(c.points[i][1], c.points[i][0]));
        const p2 = llToVec3(c.points[i + 1][1], c.points[i + 1][0], raioEm(c.points[i + 1][1], c.points[i + 1][0]));

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
    this.isobarLines.renderOrder = ORDEM.ISOBARAS;
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
      this.windMesh.renderOrder = ORDEM.VENTO;
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
    this.currentMesh.renderOrder = ORDEM.CORRENTES;
    this.currentMesh.visible = false;
    this.g.scene().add(this.currentMesh);
  }

  setWindSpeed(v: number) { if (this.windGPU) this.windGPU.speed = v; this.wake(); }
  setWindTrail(v: number) { if (this.windGPU) this.windGPU.fade = v; this.wake(); }


  setWindOpacity(v: number) {
    // A INTERFACE MANDA NO VALOR, a entrada manda no fator.
    //
    // Guardar o pedido separado do que vai para o shader é o que impede o fade
    // de abertura de sobrescrever a preferência: se a pessoa mexer no controle
    // durante os dois segundos e meio, o valor dela sobrevive ao fim do voo.
    this.opacidadeVento = v;
    this.aplicarOpacidadeVento();
    this.wake();
  }

  private aplicarOpacidadeVento() {
    if (!this.windMat) return;
    const fator = this.voo ? fadeDoVento(this.voo.progresso) : 1;
    // 0,18 e não 0: o escoamento continua legível como contexto por trás da
    // malha, e desligá-lo de vez faria a camada "sumir" ao levantar o relevo —
    // que é indistinguível de um defeito para quem acabou de ligar as duas.
    const analise = this.modoAnalise ? 0.18 : 1;
    this.windMat.uniforms.uOpacity.value = this.opacidadeVento * fator * analise;
  }

  /**
   * Um passo do voo de abertura.
   *
   * `pointOfView` sem duração escreve a posição direto, sem a transição interna
   * do globe.gl — que é o certo aqui: quem interpola é esta função, e duas
   * interpolações concorrentes sobre a mesma câmera brigam.
   */
  private tickEntrada(agora: number) {
    if (!this.voo || !this.g) return;
    const q = this.voo.passo(agora);
    if (!q) { this.voo = null; return; }
    this.g.pointOfView(q);
    this.aplicarOpacidadeVento();
    if (!this.voo.ativo) { this.voo = null; this.aplicarOpacidadeVento(); }
  }

  /** Cancela a abertura onde ela estiver. Idempotente. */
  private cancelarEntrada() {
    if (!this.voo) return;
    this.voo.cancelar();
    this.voo = null;
    this.aplicarOpacidadeVento();
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
  private rawEstacoes: any[] = [];
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

  // --------------------------------------------------- estações do INMET
  setEstacoes(list: any[]) {
    this.rawEstacoes = list || [];
    this.refreshPointsAndRings();
    this.wake();
  }

  clearEstacoes() {
    this.rawEstacoes = [];
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
        alt: this.alturaRelevoEm(q.lat, q.lng),
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
        alt: 0.008 + k * 0.02 + this.alturaRelevoEm(q.lat, q.lng),
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
        alt: 0.006 + this.alturaRelevoEm(s.lat, s.lng),
        radius: haloRadius,
        label: "",
      });

      // Mid ring (medium, showing tier color)
      points.push({
        lat: s.lat, lng: s.lng,
        color: coreColor,
        alt: 0.009 + this.alturaRelevoEm(s.lat, s.lng),
        radius: coreRadius,
        label: `🌫 ${s.name} — AQI ${aqi} (${tierName}) | PM2.5: ${s.pm25 ?? "?"} µg/m³`,
      });

      // Center dot (bright, small)
      points.push({
        lat: s.lat, lng: s.lng,
        color: "#ffffff",
        alt: 0.013 + this.alturaRelevoEm(s.lat, s.lng),
        radius: 0.08,
        label: "",
      });

      // Pulsing ring — speed and size proportional to severity
      rings.push({
        lat: s.lat, lng: s.lng,
        alt: this.alturaRelevoEm(s.lat, s.lng),
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
        alt: 0.010 + this.alturaRelevoEm(h.lat, h.lng),
        radius: 0.20,
        label: `🏥 ${h.name}${bedStr}${h.emergency ? " · EMERGÊNCIA" : ""}`,
      });
    }

    // ---- estações do INMET --------------------------------------------------
    //
    // PONTO PEQUENO E DE UMA COR SÓ, de propósito.
    //
    // Toda outra camada de ponto deste globo codifica uma GRANDEZA na cor e no
    // tamanho: magnitude do sismo, AQI da estação de ar, potência radiativa do
    // foco. Aqui não há grandeza nenhuma — uma estação é um LUGAR onde se mede,
    // e nada mais. Pintar por altitude ou por anos de série inventaria uma
    // leitura onde só existe posição, e o olho passaria a procurar padrão numa
    // escala que não significa nada.
    //
    // O que varia é só a opacidade, com os anos de série, porque isso é
    // procedência e não medida: uma estação de 2023 sabe menos sobre o passado
    // do que uma de 2010, e é honesto que ela apareça mais discreta.
    for (const e of this.rawEstacoes) {
      const anos = Number(e.anos_com_dado) || 0;
      const maturidade = Math.max(0.35, Math.min(1, anos / 15));
      const alt = Number(e.altitude_m);
      points.push({
        lat: e.lat, lng: e.lng,
        color: `rgba(226,232,240,${(0.45 + 0.5 * maturidade).toFixed(2)})`,
        alt: 0.006 + this.alturaRelevoEm(e.lat, e.lng),
        radius: 0.09,
        label: `${e.estacao_id} · ${e.nome ?? ""} (${e.uf ?? ""})`
          + (Number.isFinite(alt) ? ` · ${Math.round(alt)} m` : "")
          + (anos ? ` · ${anos} ano${anos > 1 ? "s" : ""} de série` : "")
          // Ilha oceânica e base antártica aparecem longe de tudo. Sem dizer
          // isso no rótulo, um ponto solitário no Atlântico Sul parece defeito
          // de coordenada — e a primeira reação certa seria desconfiar dele.
          + (e.fora_do_continente ? " · fora do Brasil continental" : ""),
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
        alt: 0.006 + k * 0.014 + this.alturaRelevoEm(f.lat, f.lng),
        radius: 0.05 + k * 0.22,
        label: fireLabel(f),
      });

      // ---- anel pulsante -------------------------------------------------
      if (aneis < FIRE.maxRings && f.frp >= FIRE.ringMinFrp) {
        aneis++;
        rings.push({
          lat: f.lat, lng: f.lng,
          alt: this.alturaRelevoEm(f.lat, f.lng),
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
        alt: this.alturaRelevoEm(this.clickTarget.lat, this.clickTarget.lng),
        maxR: 3.5,
        speed: 4.5,
        period: 900,
        strength: 1.0,
      });
      points.push({
        lat: this.clickTarget.lat,
        lng: this.clickTarget.lng,
        color: "#38bdf8",
        // O MARCADOR DO CLIQUE SOBE JUNTO. Ele existe para dizer "foi AQUI", e
        // um marcador enterrado sob a superfície de análise não diz nada.
        alt: 0.015 + this.alturaRelevoEm(this.clickTarget.lat, this.clickTarget.lng),
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
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.ro?.disconnect();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.piramide?.dispose();
    this.piramide = null;
    this.fronteiras?.dispose();
    this.fronteiras = null;
    this.malha?.dispose();
    this.malha = null;
    this.atmosfera?.descartar();
    this.atmosfera = null;
    if (this.terra) {
      // As texturas são deste material e de mais ninguém: o three-globe passou
      // a não ter mapa nenhum quando o material foi trocado.
      for (const k of ["uDia", "uNoite", "uAgua", "uRelevo"]) {
        (this.terra.uniforms[k]?.value as THREE.Texture | null)?.dispose();
      }
      this.terra.dispose();
      this.terra = null;
    }
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