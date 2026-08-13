// src/windGPU.ts
// -----------------------------------------------------------------------------
// Sistema de simulação de partículas de vento em GPU (WebGL GPGPU + RK2).
// -----------------------------------------------------------------------------

import * as THREE from "three";

export interface WindField {
  nx: number; ny: number;
  u: number[] | Float32Array;
  v: number[] | Float32Array;
  valid?: number[] | Uint8Array;
}

export interface WindFrame {
  key: string;
  field: WindField;
}

/** teto de plausibilidade física para ARMAZENAR: vento de 10 m acima disso não
 *  existe na Terra, e o que passar é erro de desempacotamento. */
const TETO_FISICO = 120;

/** referência da RAMPA DE COR — o valor do backup, preservado. */
const SPEED_MAX = 40;
const FRAME_CACHE = 3;

// Resolução da textura de rastro
const TRAIL_W = 4096;
const TRAIL_H = 2048;

// ---------------------------------------------------------------- avanço --
const UPDATE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uState;
  uniform sampler2D uWind;
  uniform sampler2D uWindB;
  uniform float uMix;
  uniform float uDt;
  uniform float uSpeed;
  uniform float uTime;
  uniform float uDrop;
  uniform vec4 uJanela;   // x0, y0, largura, altura — em UV GLOBAL
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // As partículas continuam guardando posição em UV GLOBAL, mesmo quando a
  // janela é um recorte. É de propósito: a amostragem do campo de vento e a
  // conta de latitude ficam idênticas ao caso do mundo inteiro, e a janela vira
  // um detalhe de onde nascer, onde morrer e onde desenhar.
  bool mundoInteiro() { return uJanela.z > 0.999 && uJanela.w > 0.999; }

  /** Distância para leste desde a borda oeste da janela, com a volta do mundo. */
  float dxNaJanela(float x) { return fract(x - uJanela.x + 1.0); }

  bool foraDaJanela(vec2 p) {
    if (mundoInteiro()) return false;
    return dxNaJanela(p.x) > uJanela.z
        || p.y < uJanela.y
        || p.y > uJanela.y + uJanela.w;
  }

  vec2 getWindVector(vec2 p) {
    vec3 a = texture2D(uWind, p).xyz;
    vec3 b = texture2D(uWindB, p).xyz;
    return mix(a.xy, b.xy, uMix);
  }

  // A APARÊNCIA NÃO PODE DEPENDER DO ZOOM.
  //
  // As partículas guardam posição em UV GLOBAL, mas são desenhadas dentro da
  // janela: a fração de TELA percorrida por segundo é o deslocamento global
  // dividido pelo tamanho da janela. Numa vista de 3°, a janela é 1/58 do
  // mundo — e as partículas atravessavam a tela 58 vezes mais rápido. Como o
  // rastro esmaece a uma taxa fixa por quadro, os riscos também ficavam 58
  // vezes mais longos. Era exatamente isso que virava sopa ao aproximar.
  //
  // Multiplicar o deslocamento pelo tamanho da janela cancela a divisão. Por
  // eixo, e não por um fator único: a janela é mais larga que alta em relação
  // ao mundo (o mundo é 2:1, a tela é 16:9), e um fator só deixaria o
  // movimento vertical ~11% fora.
  //
  // Com a janela no mundo inteiro, uJanela.zw = (1,1) e nada disto muda —
  // é por isso que o globo continua idêntico.
  //
  // O que se perde: a velocidade na tela deixa de ser comparável ENTRE zooms
  // diferentes. Dentro de uma mesma vista continua exata, e a velocidade
  // absoluta é lida na cor e na espessura, que não mexemos.
  vec2 moveRK2(vec2 p, float dt) {
    vec2 v1 = getWindVector(p);
    float lat1 = (0.5 - p.y) * 180.0;
    float cosLat1 = max(cos(radians(lat1)), 0.15);

    // Meio passo (midpoint)
    vec2 d1 = vec2(
      (v1.x * uSpeed * dt * 0.5) / (360.0 * cosLat1) * uJanela.z,
      -(v1.y * uSpeed * dt * 0.5) / 180.0 * uJanela.w
    );
    vec2 mid = vec2(fract(p.x + d1.x + 1.0), clamp(p.y + d1.y, 0.001, 0.999));

    // Amostra no ponto médio para derivar a curvatura real
    vec2 v2 = getWindVector(mid);
    float lat2 = (0.5 - mid.y) * 180.0;
    float cosLat2 = max(cos(radians(lat2)), 0.15);

    vec2 d2 = vec2(
      (v2.x * uSpeed * dt) / (360.0 * cosLat2) * uJanela.z,
      -(v2.y * uSpeed * dt) / 180.0 * uJanela.w
    );

    return vec2(fract(p.x + d2.x + 1.0), clamp(p.y + d2.y, 0.001, 0.999));
  }

  void main() {
    vec4 st = texture2D(uState, vUv);
    vec2 pos = st.xy;
    float age = st.w;

    vec2 wind = getWindVector(pos);
    float spd = length(wind);

    // Atualização curvilínea RK2
    pos = moveRK2(pos, uDt);

    age -= uDt * 0.22;

    float r = hash(vUv * 51.7 + uTime);
    bool dead = age <= 0.0
             || pos.y < 0.015 || pos.y > 0.985
             || spd < 0.05
             || r < uDrop
             // Saiu do recorte: continuar simulando seria gastar partícula em
             // lugar que ninguém está vendo. Renascer dentro da janela mantém
             // TODAS as N partículas úteis, e é o que faz a densidade crescer
             // sozinha ao aproximar em vez de rarear.
             || foraDaJanela(pos);

    if (dead) {
      vec2 cand = vec2(0.5);
      float found = 0.0;
      for (int k = 0; k < 6; k++) {
        float fk = float(k);
        float a1 = hash(vUv * 13.3 + uTime * 1.7 + fk * 7.1);
        float a2 = hash(vUv * 71.9 - uTime * 0.9 + fk * 3.7);

        // No mundo inteiro o y vem de um arco-cosseno: sorteio uniforme em UV
        // amontoaria partículas nos polos, onde a projeção comprime a área.
        // Dentro de um recorte pequeno essa distorção é desprezível e o
        // sorteio uniforme é o certo — usar o arco-cosseno ali empurraria tudo
        // para a borda superior da janela.
        vec2 tryPos = mundoInteiro()
          ? vec2(a1, acos(clamp(1.0 - 2.0 * a2, -1.0, 1.0)) / 3.14159265)
          : vec2(fract(uJanela.x + a1 * uJanela.z), uJanela.y + a2 * uJanela.w);

        if (found < 0.5 && length(getWindVector(tryPos)) > 0.05) {
          cand = tryPos;
          found = 1.0;
        }
      }
      pos = cand;
      age = found > 0.5 ? (0.60 + hash(vUv + uTime * 2.3) * 0.40) : -1.0;
    }

    gl_FragColor = vec4(pos, clamp(spd / ${SPEED_MAX}.0, 0.0, 1.0), age);
  }
`;

// -------------------------------------------------------------- esmaecer --
const FADE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uFade;
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, uFade);
  }
`;

// -------------------------------------------------------------- desenhar --
const DRAW_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uState;
  uniform float uScale;
  uniform float uPonto;    // escala extra por zoom, decidida pelo motor
  uniform vec4 uJanela;
  attribute vec2 aRef;
  varying float vSpeed;
  varying float vAge;

  void main() {
    vec4 st = texture2D(uState, aRef);
    vSpeed = st.z;
    vAge = st.w;

    // A posição é global; o rastro cobre só a janela. Esta divisão é a razão
    // de o zoom deixar de produzir borrão: antes, uma textura de 4096 px do
    // mundo inteiro era ampliada 17x para caber numa vista de 10° e cada
    // partícula virava um quadrado parado na tela. Agora o rastro tem sempre a
    // resolução da vista, e a partícula continua do tamanho de uma partícula.
    float nx = fract(st.x - uJanela.x + 1.0) / uJanela.z;
    float ny = (st.y - uJanela.y) / uJanela.w;

    gl_Position = vec4(nx * 2.0 - 1.0, ny * 2.0 - 1.0, 0.0, 1.0);
    // Linhas expressivas proporcionais à velocidade real do vento
    gl_PointSize = (1.2 + vSpeed * 2.5) * uScale * uPonto;
  }
`;

// RAMPA DE CORES VIBRANTE ESTILO WINDY
const DRAW_FRAG = /* glsl */ `
  precision highp float;
  varying float vSpeed;
  varying float vAge;

  vec3 ramp(float t) {
    vec3 c0 = vec3(0.04, 0.12, 0.45);  // azul escuro profundo
    vec3 c1 = vec3(0.10, 0.55, 0.90);  // elétrico ciano
    vec3 c2 = vec3(0.12, 0.88, 0.60);  // verde esmeralda
    vec3 c3 = vec3(0.65, 0.95, 0.15);  // verde limão neon
    vec3 c4 = vec3(0.98, 0.82, 0.10);  // âmbar brilhante
    vec3 c5 = vec3(0.98, 0.32, 0.12);  // fogo alaranjado
    vec3 c6 = vec3(0.92, 0.12, 0.65);  // magenta/púrpura intenso

    float s = t * 6.0;
    if (s < 1.0) return mix(c0, c1, s);
    if (s < 2.0) return mix(c1, c2, s - 1.0);
    if (s < 3.0) return mix(c2, c3, s - 2.0);
    if (s < 4.0) return mix(c3, c4, s - 3.0);
    if (s < 5.0) return mix(c4, c5, s - 4.0);
    return mix(c5, c6, s - 5.0);
  }

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d) * 4.0;
    if (r2 > 1.0) discard;

    float core = exp(-r2 * 4.5);
    float a = clamp(core, 0.0, 1.0);

    if (vAge <= 0.0) discard;
    float fade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.55, vAge);

    vec3 col = ramp(vSpeed);
    col += vec3(0.6, 0.7, 0.85) * core * 0.45;

    gl_FragColor = vec4(col, a * fade * 0.88);
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class WindGPU {
  get texture(): THREE.Texture { return this.trail.texture; }

  private renderer: THREE.WebGLRenderer;
  private size: number;
  private count: number;
  private pos: THREE.WebGLRenderTarget[] = [];
  private trail!: THREE.WebGLRenderTarget;
  private cur = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private updateMat: THREE.ShaderMaterial;
  private fadeMat: THREE.ShaderMaterial;
  private drawMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private points: THREE.Points;
  private windTex: THREE.DataTexture | null = null;
  private frameTex = new Map<string, THREE.DataTexture>();
  /** pico real do último campo, em m/s, antes do corte */
  lastPeakMs = 0;
  private clock = 0;
  private disposed = false;
  private trailW = TRAIL_W;
  private trailH = TRAIL_H;
  private fadeEvery = 1;
  private fadeTick = 0;

  /** graus por segundo por m/s — movimento fluido natural */
  speed = 0.12;
  /** Decaimento suave de rastro nítido curvilíneo */
  fade = 0.985;

  constructor(renderer: THREE.WebGLRenderer, particles = 131072) {
    if (!renderer) throw new Error("[windGPU] renderer é obrigatório");
    if (!particles || particles <= 0) {
      console.warn("[windGPU] particles inválido, usando padrão 131072");
      particles = 131072;
    }
    this.renderer = renderer;
    this.size = Math.max(1, Math.ceil(Math.sqrt(particles)));
    this.count = this.size * this.size;

    this.updateMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: UPDATE_FRAG,
      uniforms: {
        uState: { value: null },
        uWind: { value: null },
        uWindB: { value: null },
        uMix: { value: 0 },
        uDt: { value: 0 },
        uSpeed: { value: this.speed },
        uTime: { value: 0 },
        uDrop: { value: 0.002 },
        uJanela: { value: new THREE.Vector4(0, 0, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FADE_FRAG,
      uniforms: { uFade: { value: this.fade } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });

    this.drawMat = new THREE.ShaderMaterial({
      vertexShader: DRAW_VERT,
      fragmentShader: DRAW_FRAG,
      uniforms: {
        uState: { value: null },
        uScale: { value: 1 },
        uPonto: { value: 1 },
        uJanela: { value: new THREE.Vector4(0, 0, 1, 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMat);
    this.quad.frustumCulled = false;
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.drawMat);
    this.points.frustumCulled = false;

    this.build();
    this.seed();
  }

  private build() {
    if (this.size <= 0) throw new Error(`[windGPU] size inválido: ${this.size}`);
    if (this.trailW <= 0 || this.trailH <= 0) {
      throw new Error(`[windGPU] trail dimensões inválidas: ${this.trailW}x${this.trailH}`);
    }
    const rtOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.pos = [
      new THREE.WebGLRenderTarget(this.size, this.size, rtOpts),
      new THREE.WebGLRenderTarget(this.size, this.size, rtOpts),
    ];

    const trailOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.trail = new THREE.WebGLRenderTarget(this.trailW, this.trailH, trailOpts);
    this.trail.texture.wrapS = THREE.RepeatWrapping;
    this.trail.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.drawMat.uniforms.uScale.value = this.trailW / 1024;

    const refs = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      refs[i * 2] = ((i % this.size) + 0.5) / this.size;
      refs[i * 2 + 1] = (Math.floor(i / this.size) + 0.5) / this.size;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("aRef", new THREE.BufferAttribute(refs, 2));
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    this.points = new THREE.Points(geo, this.drawMat);
    this.points.frustumCulled = false;
  }

  private seed() {
    if (this.size <= 0 || this.count <= 0) {
      console.warn("[windGPU] seed chamado com dimensões inválidas, skip");
      return;
    }
    const data = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      data[i * 4] = Math.random();
      data[i * 4 + 1] = Math.acos(1 - 2 * Math.random()) / Math.PI;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = Math.random();
    }
    const tex = new THREE.DataTexture(data, this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(q);

    const prev = this.renderer.getRenderTarget();
    for (const rt of this.pos) {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(s, this.camera);
    }
    this.renderer.setRenderTarget(this.trail);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);

    tex.dispose();
    mat.dispose();
    q.geometry.dispose();
  }

  /**
   * Recorta a simulação a uma janela do mundo, em UV global.
   *
   * `x0` pode ser qualquer número: ele é trazido para [0,1) e a janela pode
   * atravessar a emenda do antimeridiano — é o caso normal quando se olha o
   * Pacífico. Passar (0, 0, 1, 1) volta ao mundo inteiro, que é o que o globo
   * usa e por onde tudo isto continua idêntico ao que era.
   *
   * O RASTRO É APAGADO a cada mudança. Ele é uma acumulação amarrada a uma
   * região: mantê-lo ao trocar de janela arrastaria os riscos do lugar antigo
   * por cima do novo. Por isso quem chama deve esperar a vista PARAR antes de
   * rejanelar — durante o movimento, o plano do vento acompanha o mapa em
   * coordenada de mundo e continua correto.
   */
  setJanela(x0: number, y0: number, w: number, h: number) {
    const largura = Math.max(0.002, Math.min(1, w));
    const altura = Math.max(0.002, Math.min(1, h));
    const oeste = ((x0 % 1) + 1) % 1;
    const sul = Math.max(0, Math.min(1 - altura, y0));

    const atual = this.updateMat.uniforms.uJanela.value as THREE.Vector4;
    if (atual.x === oeste && atual.y === sul && atual.z === largura && atual.w === altura) return;

    atual.set(oeste, sul, largura, altura);
    (this.drawMat.uniforms.uJanela.value as THREE.Vector4).set(oeste, sul, largura, altura);
    this.limparRastro();
  }

  /** Escala extra do ponto, para o motor encolher a partícula ao aproximar. */
  set escalaPonto(v: number) {
    this.drawMat.uniforms.uPonto.value = Math.max(0.2, Math.min(3, v));
  }

  private limparRastro() {
    const prev = this.renderer.getRenderTarget();
    const cor = new THREE.Color();
    this.renderer.getClearColor(cor);
    const alfa = this.renderer.getClearAlpha();

    this.renderer.setRenderTarget(this.trail);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);

    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(cor, alfa);
  }

  setField(field: WindField | null, key = "único") {
    if (!field) { this.setFrames(null, null, 0); return; }
    this.setFrames({ key, field }, null, 0);
  }

  setFrames(a: WindFrame | null, b: WindFrame | null, mix: number) {
    if (a && (!a.field || !a.field.nx || !a.field.ny || !a.field.u || !a.field.v)) {
      console.warn("[windGPU] frame A com campo inválido, ignorando");
      return;
    }
    if (b && (!b.field || !b.field.nx || !b.field.ny || !b.field.u || !b.field.v)) {
      console.warn("[windGPU] frame B com campo inválido, tratando como nulo");
      b = null;
    }
    const uni = this.updateMat.uniforms;

    if (!a) {
      this.windTex = null;
      uni.uWind.value = null;
      uni.uWindB.value = null;
      uni.uMix.value = 0;
      this.evict(new Set());
      return;
    }

    const texA = this.textureFor(a);
    const texB = b ? this.textureFor(b) : texA;

    this.windTex = texA;
    uni.uWind.value = texA;
    uni.uWindB.value = texB;
    uni.uMix.value = b ? Math.max(0, Math.min(1, mix)) : 0;

    this.evict(new Set([a.key, b?.key].filter(Boolean) as string[]));
  }

  setMix(mix: number) {
    this.updateMat.uniforms.uMix.value = Math.max(0, Math.min(1, mix));
  }

  private textureFor(frame: WindFrame): THREE.DataTexture {
    const hit = this.frameTex.get(frame.key);
    if (hit) {
      this.frameTex.delete(frame.key);
      this.frameTex.set(frame.key, hit);
      return hit;
    }
    const tex = this.buildTexture(frame.field);
    this.frameTex.set(frame.key, tex);
    return tex;
  }

  private evict(keep: Set<string>) {
    for (const [key, tex] of [...this.frameTex]) {
      if (this.frameTex.size <= FRAME_CACHE) break;
      if (keep.has(key)) continue;
      tex.dispose();
      this.frameTex.delete(key);
    }
  }

  private buildTexture(field: WindField): THREE.DataTexture {
    const { nx, ny, u, v } = field;
    if (!nx || !ny || nx <= 0 || ny <= 0) {
      throw new Error(`[windGPU] dimensões de campo inválidas: ${nx}x${ny}`);
    }
    if (!u || !v || u.length < nx * ny || v.length < nx * ny) {
      throw new Error(`[windGPU] arrays u/v incompletos para ${nx}x${ny}`);
    }

    const S = Math.max(1, Math.min(8, Math.round(1440 / nx)));
    const ox = nx * S, oy = ny * S;

    const at = (arr: ArrayLike<number>, x: number, y: number) => {
      const xi = ((x % nx) + nx) % nx;
      const yi = y < 0 ? 0 : y >= ny ? ny - 1 : y;
      return arr[yi * nx + xi] ?? 0;
    };
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (
        2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
      );
    };
    const sample = (arr: ArrayLike<number>, fx: number, fy: number) => {
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const c: number[] = [];
      for (let j = -1; j <= 2; j++) {
        c.push(cr(at(arr, x0 - 1, y0 + j), at(arr, x0, y0 + j), at(arr, x0 + 1, y0 + j), at(arr, x0 + 2, y0 + j), tx));
      }
      return cr(c[0], c[1], c[2], c[3], ty);
    };

    /** pico REAL antes de qualquer corte: distingue ciclone de GRIB quebrado */
    let picoBruto = 0;
    const buf = new Uint16Array(ox * oy * 4);
    const h = THREE.DataUtils.toHalfFloat;
    for (let y = 0; y < oy; y++) {
      const fy = (y + 0.5) / S - 0.5;
      for (let x = 0; x < ox; x++) {
        const fx = (x + 0.5) / S - 0.5;
        const i = (y * ox + x) * 4;

        // O corte é pelo TETO FÍSICO, não pela referência de cor. Eram o mesmo
        // número, e por isso o núcleo de um ciclone (67,8 m/s medidos em
        // 29/07) era aplainado em 40 na ENTRADA — o gradiente da parede do olho
        // desaparecia antes de chegar à tela. A cor continua saturando em 40;
        // o dado não.
        const ru = sample(u, fx, fy), rv = sample(v, fx, fy);
        const mag = Math.hypot(ru, rv);
        if (Number.isFinite(mag) && mag > picoBruto) picoBruto = mag;
        const uu = Math.max(-TETO_FISICO, Math.min(TETO_FISICO, ru));
        const vv = Math.max(-TETO_FISICO, Math.min(TETO_FISICO, rv));
        buf[i] = h(uu);
        buf[i + 1] = h(vv);

        if (field.valid) {
          const vx = Math.round(fx), vy = Math.round(fy);
          buf[i + 2] = h(at(field.valid, vx, vy) ? 1 : 0);
        } else {
          buf[i + 2] = h(1);
        }
        buf[i + 3] = h(1);
      }
    }

    this.lastPeakMs = +picoBruto.toFixed(1);

    const tex = new THREE.DataTexture(buf, ox, oy, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  resize(trailW: number, particles: number, fadeEvery = 1) {
    if (!trailW || trailW <= 0 || !particles || particles <= 0) {
      console.warn(`[windGPU] resize ignorado: trailW=${trailW}, particles=${particles}`);
      return;
    }
    this.fadeEvery = Math.max(1, fadeEvery);
    const size = Math.max(1, Math.ceil(Math.sqrt(particles)));
    const trailH = Math.max(1, Math.round(trailW / 2));
    if (size === this.size && trailW === this.trailW) return;

    for (const rt of this.pos) rt.dispose();
    this.trail?.dispose();
    this.points.geometry.dispose();

    this.size = size;
    this.count = size * size;
    this.trailW = trailW;
    this.trailH = trailH;
    this.build();
    this.seed();
  }

  step(dt: number) {
    if (this.disposed || !this.windTex) return;
    const d = Math.min(dt, 0.05);
    this.clock += d;
    this.fadeTick++;

    const prevRT = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;

    const nxt = 1 - this.cur;

    // 1. avanço das partículas com amostragem corrigida Y e RK2
    this.updateMat.uniforms.uState.value = this.pos[this.cur].texture;
    this.updateMat.uniforms.uDt.value = d;
    this.updateMat.uniforms.uSpeed.value = this.speed;
    this.updateMat.uniforms.uTime.value = this.clock;
    this.quad.material = this.updateMat;
    this.scene.clear();
    this.scene.add(this.quad);
    this.renderer.setRenderTarget(this.pos[nxt]);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);

    // 2. rastro: decai por mistura e recebe as partículas
    this.renderer.setRenderTarget(this.trail);

    const doFade = this.fadeTick % this.fadeEvery === 0;
    if (doFade) {
      this.fadeMat.uniforms.uFade.value = this.fade;
      this.quad.material = this.fadeMat;
      this.scene.clear();
      this.scene.add(this.quad);
      this.renderer.render(this.scene, this.camera);
    }

    this.drawMat.uniforms.uState.value = this.pos[nxt].texture;
    this.scene.clear();
    this.scene.add(this.points);
    this.renderer.render(this.scene, this.camera);

    this.renderer.autoClear = prevAuto;
    this.renderer.setRenderTarget(prevRT);
    this.cur = nxt;
  }

  dispose() {
    this.disposed = true;
    for (const rt of this.pos) rt.dispose();
    this.trail?.dispose();
    for (const tex of this.frameTex.values()) tex.dispose();
    this.frameTex.clear();
    this.windTex = null;
    this.updateMat.dispose();
    this.fadeMat.dispose();
    this.drawMat.dispose();
    this.quad.geometry.dispose();
    this.points.geometry.dispose();
  }
}