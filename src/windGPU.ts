// src/windGPU.ts
// -----------------------------------------------------------------------------
// SISTEMA DE VENTO EM GPU — advecção RK2 sobre campo GRIB2.
//
// SOBRE A LATITUDE (o comentário que estava aqui descrevia código inexistente)
//
// A versão anterior deste cabeçalho afirmava que `getWindVector` invertia o
// eixo Y com `1.0 - p.y`. Ele não inverte — não há inversão nenhuma no
// amostrador, e nunca houve nesta versão do arquivo.
//
// O sentido está correto por outro caminho: `buildTexture` escreve a linha 0 do
// campo (90°N, porque o GFS varre de norte para sul) na linha 0 da textura, que
// em WebGL é v = 0; e o shader lê `lat = (0.5 - p.y) * 180`, que em p.y = 0
// também dá +90. Os dois concordam.
//
// Mas isso é sorte documentada, não garantia. Um comentário descrevendo uma
// correção que não existe é pior que nenhum comentário: ele faz a próxima
// pessoa procurar o defeito no lugar errado. As três convenções agora vivem em
// `src/windGrid.ts` e são MEDIDAS em `test/wind-grid.mjs`, que reprova qualquer
// espelhamento de hemisfério e mantém a discordância conhecida (meia célula,
// 0,125° no GFS 0,25°) dentro de um limite fixo.
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

// -----------------------------------------------------------------------------
// DUAS CONSTANTES QUE ERAM UMA SÓ — e isso estava decepando ciclone.
//
// `SPEED_MAX = 40` fazia DOIS trabalhos diferentes ao mesmo tempo:
//
//   1. o teto de armazenamento da textura (o clamp em buildTexture)
//   2. a referência da rampa de cor (spd / SPEED_MAX)
//
// São grandezas distintas, e juntá-las num número tem uma consequência
// concreta. O campo do GFS de 29/07/2026 tem máximo de 67,8 m/s — um ciclone
// tropical de categoria 4 ou 5, que é exatamente o tipo de coisa que alguém
// abre este mapa para ver. Com o teto em 40, o NÚCLEO DELE ERA CORTADO: os
// 67,8 m/s viravam 40, o gradiente interno da parede do olho desaparecia, e o
// que sobrava era um platô chapado.
//
// Agora separadas:
//
//   TETO_FISICO  limite de plausibilidade, não de estética. Vento de 10 m
//                acima de ~120 m/s não existe na Terra; o que passa disso é
//                erro de desempacotamento, e o contador de saturação continua
//                servindo de alarme para isso.
//
//   REF_COR      onde a rampa chega ao branco. Fica em 40 m/s de propósito:
//                é vendaval forte, e acima disso a leitura "é extremo" já foi
//                dada. O que muda é que agora o dado ACIMA de 40 continua no
//                campo — para o traçado, para a sonda e para a estatística —
//                em vez de ser aplainado na entrada.
// -----------------------------------------------------------------------------
const TETO_FISICO = 120;
const REF_COR = 40;
const FRAME_CACHE = 3;

// -----------------------------------------------------------------------------
// RAMPA DE VELOCIDADE
//
// A rampa anterior tinha dois defeitos, e o segundo é o grave.
//
// 1. UM ERRO DE ÍNDICE PINTAVA FORA DO GAMUT.
//    A terceira faixa era `mix(c2, c3, s - 1.0)` onde devia ser `s - 2.0`.
//    Para s entre 2 e 3 o fator ia de 1 a 2, e `mix` do GLSL NÃO satura: a cor
//    extrapolava para R = 1,047 e B = −0,187. O driver corta na escrita, então
//    aparecia um estouro branco-amarelado que voltava de repente ao verde —
//    uma emenda dura numa velocidade específica do vento, em todo o planeta.
//
// 2. O VENTO MAIS FORTE ERA O MAIS ESCURO.
//    Luminância medida ao longo da rampa: subia até 0,93 perto de t = 0,46 e
//    despencava para 0,213 em t = 1,0. Doze quedas de luminância no percurso.
//    Ou seja: a corrente de jato — o dado mais importante do mapa — RECUAVA
//    visualmente, enquanto o vento médio brilhava. Exatamente o contrário do
//    que a tela precisa dizer. É o mesmo defeito que a paleta de focos de calor
//    tinha, e a correção é a mesma: monotonicidade em luminância.
//
// Aqui a velocidade lê como BRILHO. Some a cor e a leitura sobrevive — que é o
// teste de que a codificação é a grandeza, e não enfeite.
//
// Os valores vivem aqui, em TypeScript, e são INJETADOS no shader. O teste lê
// esta mesma constante. Uma paleta transcrita à mão para dentro de uma string
// GLSL é uma paleta que vai divergir do que se acredita estar pintando.
// -----------------------------------------------------------------------------
export const RAMPA_VENTO: readonly [number, number, number][] = [
  [0.043, 0.114, 0.302],   // #0b1a4d  calmaria: quase o fundo do espaço
  [0.098, 0.294, 0.541],   // #194b8a  brisa
  [0.165, 0.561, 0.659],   // #2a8fa8  vento moderado
  [0.373, 0.788, 0.561],   // #5fc98f  vento forte
  [0.812, 0.890, 0.420],   // #cfe36b  vendaval
  [1.000, 0.984, 0.910],   // #fffbe8  jato: branco quente
];

const glsl3 = (c: readonly number[]) => `vec3(${c.map((x) => x.toFixed(4)).join(", ")})`;

/**
 * Gradiente por mistura sucessiva.
 *
 * Cada termo é `clamp(s - k, 0, 1)` com k igual ao próprio índice: 0 antes do
 * seu trecho, 0→1 dentro dele, 1 depois. Isso dá exatamente a interpolação
 * linear por partes, mas de um jeito em que o erro de índice de cima é
 * IMPOSSÍVEL de escrever — e o `clamp` remove a extrapolação fora do gamut na
 * raiz, em vez de depender de o driver cortar.
 */
function rampaGLSL(stops: readonly (readonly number[])[]): string {
  const n = stops.length - 1;
  const linhas = stops.slice(1).map((c, k) =>
    `    c = mix(c, ${glsl3(c)}, clamp(s - ${k.toFixed(1)}, 0.0, 1.0));`).join("\n");
  return `  vec3 ramp(float t) {
    float s = clamp(t, 0.0, 1.0) * ${n.toFixed(1)};
    vec3 c = ${glsl3(stops[0])};
${linhas}
    return c;
  }`;
}

// Resolução da textura de rastro
const TRAIL_W = 2048;
const TRAIL_H = 1024;

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
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec2 getWindVector(vec2 p) {
    vec3 a = texture2D(uWind, p).xyz;
    vec3 b = texture2D(uWindB, p).xyz;
    return mix(a.xy, b.xy, uMix);
  }

  // Integrador Runge-Kutta de 2ª Ordem (RK2 / Midpoint)
  vec2 moveRK2(vec2 p, float dt) {
    vec2 v1 = getWindVector(p);
    float lat1 = (0.5 - p.y) * 180.0;
    float cosLat1 = max(cos(radians(lat1)), 0.15);

    // Meio passo (midpoint)
    vec2 d1 = vec2(
      (v1.x * uSpeed * dt * 0.5) / (360.0 * cosLat1),
      -(v1.y * uSpeed * dt * 0.5) / 180.0
    );
    vec2 mid = vec2(fract(p.x + d1.x + 1.0), clamp(p.y + d1.y, 0.001, 0.999));

    // Amostra no ponto médio para derivar a curvatura real
    vec2 v2 = getWindVector(mid);
    float lat2 = (0.5 - mid.y) * 180.0;
    float cosLat2 = max(cos(radians(lat2)), 0.15);

    vec2 d2 = vec2(
      (v2.x * uSpeed * dt) / (360.0 * cosLat2),
      -(v2.y * uSpeed * dt) / 180.0
    );

    return vec2(fract(p.x + d2.x + 1.0), clamp(p.y + d2.y, 0.001, 0.999));
  }

  void main() {
    vec4 st = texture2D(uState, vUv);
    vec2 pos = st.xy;
    float age = st.w;

    // Velocidade da posição ANTERIOR, guardada só para o teste de calmaria:
    // um ponto que já estava parado deve morrer, mesmo que o passo o tenha
    // jogado para dentro de um jato.
    float spdAntes = length(getWindVector(pos));

    // Atualização curvilínea RK2
    pos = moveRK2(pos, uDt);

    // A cor é amostrada DEPOIS do passo. Antes ela vinha da posição velha, e a
    // partícula chegava ao jato ainda pintada com a cor da calmaria de onde
    // saiu — um quadro inteiro de atraso, visível como um rastro que troca de
    // cor atrás da própria ponta.
    float spd = length(getWindVector(pos));

    age -= uDt * 0.22;

    float r = hash(vUv * 51.7 + uTime);
    bool dead = age <= 0.0
             || pos.y < 0.015 || pos.y > 0.985
             || spdAntes < 0.05
             || r < uDrop;

    if (dead) {
      vec2 cand = vec2(0.5);
      float found = 0.0;
      for (int k = 0; k < 6; k++) {
        float fk = float(k);
        float a1 = hash(vUv * 13.3 + uTime * 1.7 + fk * 7.1);
        float a2 = hash(vUv * 71.9 - uTime * 0.9 + fk * 3.7);
        vec2 tryPos = vec2(a1, acos(clamp(1.0 - 2.0 * a2, -1.0, 1.0)) / 3.14159265);
        if (found < 0.5 && length(getWindVector(tryPos)) > 0.05) {
          cand = tryPos;
          found = 1.0;
        }
      }
      pos = cand;
      // VIDA ESPALHADA. A faixa era 0,60 a 1,00 — uma variação de só 40%, o
      // que faz as partículas nascerem e morrerem quase juntas. O efeito é uma
      // pulsação: o campo inteiro clareia e apaga em ondas, e as trajetórias
      // saem em pentes paralelos porque toda a leva começou no mesmo instante.
      // De 0,15 a 1,00 a leva se dispersa e o escoamento fica contínuo.
      age = found > 0.5 ? (0.15 + hash(vUv + uTime * 2.3) * 0.85) : -1.0;
    }

    // ---- ESCALA PERCEPTUAL DE VELOCIDADE ---------------------------------
    //
    // A normalização era linear sobre 40 m/s. Mas 40 m/s é rajada
    // de ciclone: o vento de superfície do planeta vive entre 3 e 12 m/s, o
    // que caía em t = 0,08 a 0,30 — o terço inferior da rampa, todo azul
    // escuro. Praticamente o mapa inteiro ficava na mesma cor, e só os
    // quarentões rugidores acendiam. É o que se vê na tela: um globo quase
    // apagado com duas manchas.
    //
    // O expoente 0,6 é uma escala perceptual, não um enfeite: espalha a faixa
    // comum pelo meio da rampa mantendo a ordem intacta (5 m/s -> 0,31;
    // 10 -> 0,47; 20 -> 0,71; 40 -> 1,0). É o mesmo raciocínio de um eixo
    // logarítmico — a monotonicidade se preserva, então nenhuma comparação
    // muda de sinal, e a legenda diz qual velocidade é qual.
    float t = pow(clamp(spd / ${REF_COR}.0, 0.0, 1.0), 0.6);

    gl_FragColor = vec4(pos, t, age);
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
  attribute vec2 aRef;
  varying float vSpeed;
  varying float vAge;

  void main() {
    vec4 st = texture2D(uState, aRef);
    vSpeed = st.z;
    vAge = st.w;
    vec2 clip = vec2(st.x * 2.0 - 1.0, st.y * 2.0 - 1.0);
    gl_Position = vec4(clip, 0.0, 1.0);

    // COMPENSAÇÃO DE LATITUDE.
    //
    // O rastro é pintado numa textura equirretangular que depois se enrola na
    // esfera. Nessa projeção, um ponto de N pixels de largura na latitude φ
    // vira, na esfera, um arco proporcional a cos(φ). Perto dos polos isso
    // tende a zero: a partícula existe, anda e é pintada — e some.
    //
    // O resultado era que a circulação polar, que é justamente onde o vento é
    // mais organizado e mais rápido, ficava invisível. Não era escolha
    // estética; era dado sumindo por causa da projeção.
    //
    // O teto de 2,8 existe porque gl_PointSize é isotrópico: sem limite, a
    // compensação certa em longitude vira um borrão alto demais em latitude.
    // Mesma convenção do UPDATE_FRAG: p.y = 0 é o norte. (Para cos() o sinal
    // não muda nada, mas um rótulo trocado engana quem ler depois.)
    float lat = (0.5 - st.y) * 180.0;
    float compensa = min(1.0 / max(cos(radians(lat)), 0.12), 2.8);

    gl_PointSize = (0.8 + vSpeed * 0.9) * uScale * compensa;
  }
`;

const DRAW_FRAG = /* glsl */ `
  precision highp float;
  varying float vSpeed;
  varying float vAge;

${rampaGLSL(RAMPA_VENTO)}

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d) * 4.0;
    if (r2 > 1.0) discard;
    if (vAge <= 0.0) discard;

    float core = exp(-r2 * 4.5);
    float fade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.55, vAge);

    // O clarão branco somado à cor foi removido. Ele adicionava até +0,45 de
    // cada canal no centro de TODA partícula, o que achatava a rampa
    // justamente onde ela precisa discriminar: uma brisa com miolo claro
    // ficava parecida com um vendaval. O brilho agora vem da rampa, que é onde
    // a velocidade está codificada.
    vec3 col = ramp(vSpeed);

    // ---- TINTA PROPORCIONAL À DISTÂNCIA PERCORRIDA ------------------------
    //
    // ESTE É O CONSERTO DA "CALMARIA QUE PARECE FURACÃO".
    //
    // O rastro é um acúmulo: cada quadro a textura inteira é multiplicada por
    // uFade (0,985) e as partículas pintam por cima. Uma partícula PARADA
    // pinta o MESMO texel todo quadro, e o acúmulo converge para
    //
    //     alfa / (1 - uFade)  =  alfa / 0,015  =  67 x alfa
    //
    // ou seja, satura em branco quase imediatamente. Uma partícula RÁPIDA
    // atravessa dez texels por quadro, pinta cada um UMA vez, e cada um já
    // começa a apagar.
    //
    // O resultado era o inverso do que o mapa precisa dizer: a região calma
    // ficava sólida e brilhante, e como campo calmo é laminar, o lento
    // arrastar traçava um risco reto, longo e cheio — o "furacão de outro
    // mundo" onde não venta quase nada. O vento forte, que se espalha, ficava
    // mais apagado que ele.
    //
    // O NÚMERO QUE FECHA O CASO: com o piso de 0,24 que estava aqui, o rastro a
    // 2 m/s e o rastro a 25 m/s tinham AMBOS brilho 1,000 e levavam AMBOS 259
    // quadros (4,3 s) para apagar. Calmaria e vendaval eram, pixel a pixel, a
    // mesma marca — e a calma, sendo laminar, desenhava a versão reta e longa
    // dela.
    //
    // A correção é a de uma caneta: para traçar uma linha de densidade
    // constante, a tinta sai proporcional à velocidade da mão; parada, a caneta
    // não pode borrar.
    //
    // E aí a medição mostrou algo que eu tinha errado: com tinta proporcional à
    // distância, o brilho NÃO PODE codificar velocidade — os dois efeitos se
    // cancelam exatamente. Quem carrega a velocidade é a COR (a rampa) e o
    // COMPRIMENTO do traço. O brilho fica uniforme, que é o que faz parecer um
    // campo de escoamento em vez de borrões. Ver src/windInk.ts.
    //
    // vSpeed chega perceptual (elevado a 0,6) para a cor; a tinta desfaz a
    // curva, porque distância percorrida é grandeza física e não herda a curva
    // que existe só para a leitura.
    float vLinear = pow(vSpeed, 1.6667);
    float tinta = 0.01 + vLinear * 0.30;

    gl_FragColor = vec4(col, core * fade * tinta);
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
  /** % do último campo que estourou o teto de velocidade — ver buildTexture */
  lastSaturatedPct = 0;
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
  /**
   * Decaimento do rastro por quadro.
   *
   * Era 0,985, que dá um teto de acúmulo de 1/(1−0,985) = 67 repinturas: um
   * texel saturava e depois levava 259 quadros (4,3 s) para apagar. Rastro de
   * quatro segundos é o que fazia tudo virar cabelo comprido, e o que fazia a
   * calmaria — que repinta o mesmo lugar — encorpar num risco sólido.
   *
   * 0,975 dá teto 40 e rastro de ~2,3 s. Curto o bastante para o traço seguir
   * a curvatura do escoamento em vez de acumular vários minutos de história.
   */
  fade = 0.975;

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
      uniforms: { uState: { value: null }, uScale: { value: 1 } },
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

    const buf = new Uint16Array(ox * oy * 4);
    const h = THREE.DataUtils.toHalfFloat;

    // O CLAMP PRECISA CONFESSAR.
    //
    // Ele existe por um motivo legítimo: meia-precisão satura e um valor
    // extremo isolado não deve estourar a textura. Mas quando o campo INTEIRO
    // está fora de escala — um desempacotamento GRIB2 quebrado, por exemplo —
    // o clamp leva todo nó para exatamente ±TETO_FISICO. O resultado é um campo
    // CONSTANTE, que a tela mostra como listras diagonais paralelas perfeitas:
    // convincente, estável, e completamente inventado.
    //
    // Contar quantos nós ele tocou é a diferença entre "o vento está estranho"
    // e "97% do campo foi saturado, o dado está errado antes de chegar aqui".
    let saturados = 0;
    // Guarda o pico REAL do campo, antes de qualquer corte. É o número que
    // distingue "ciclone categoria 5" (68 m/s) de "desempacotamento quebrado"
    // (2 x 10^7 m/s) — e antes ele se perdia dentro do clamp.
    let picoBruto = 0;

    for (let y = 0; y < oy; y++) {
      const fy = (y + 0.5) / S - 0.5;
      for (let x = 0; x < ox; x++) {
        const fx = (x + 0.5) / S - 0.5;
        const i = (y * ox + x) * 4;

        const ru = sample(u, fx, fy);
        const rv = sample(v, fx, fy);
        const mag = Math.hypot(ru, rv);
        if (Number.isFinite(mag) && mag > picoBruto) picoBruto = mag;
        if (Math.abs(ru) > TETO_FISICO || Math.abs(rv) > TETO_FISICO) saturados++;

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

    // Acima de 5% saturado não é rajada extrema: é escala errada. Avisa uma vez
    // por campo, com número, em vez de deixar a tela mentir bonito.
    this.lastSaturatedPct = +((saturados / (ox * oy)) * 100).toFixed(1);
    this.lastPeakMs = +picoBruto.toFixed(1);
    if (this.lastSaturatedPct > 5) {
      console.warn(
        `[vento] ${this.lastSaturatedPct}% do campo passou de ±${TETO_FISICO} m/s. ` +
        `Campo quase constante — provável erro de desempacotamento, não meteorologia.`
      );
    }

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