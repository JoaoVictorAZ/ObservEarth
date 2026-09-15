// src/globo/terra.ts
// -----------------------------------------------------------------------------
// A SUPERFÍCIE DA TERRA — dia, noite e a linha entre os dois
// -----------------------------------------------------------------------------
// O globo usava o material padrão do three-globe: um MeshPhong com a textura de
// dia e uma luz direcional apontada para o ponto subsolar. Funciona, e produz
// uma Terra que parece uma bola de bilhar iluminada por um abajur — o lado
// noturno some no preto, o terminador é uma borda dura de sombreamento de
// Lambert, e as luzes das cidades só existiam como uma troca de textura INTEIRA,
// que apagava o dia do outro lado do planeta.
//
// Este material faz as três coisas que aquele não fazia:
//
// 1. MISTURA dia e noite pelo ângulo solar, com uma banda de crepúsculo de
//    largura declarada, em vez de trocar a textura do planeta todo.
// 2. Acende as LUZES DE CIDADE só onde é noite, e as apaga progressivamente na
//    banda do crepúsculo — que é o que acontece de verdade.
// 3. Dá ao mar um GLINT especular na direção do Sol, usando a máscara de água
//    que o projeto já baixava para outra coisa. É o reflexo que faz o oceano
//    parecer líquido em vez de azul chapado.
//
// E acrescenta relevo por gradiente da topografia, calculado no shader: a
// diferença entre alturas vizinhas vira uma inclinação, e a inclinação escurece
// ou clareia conforme a direção do Sol. É a mesma informação do `bumpMap` do
// Phong, mas continua valendo no lado noturno e não custa uma passada extra.
//
// TUDO AQUI É ILUMINAÇÃO, NÃO DADO. Nenhuma medida do projeto passa por este
// arquivo: as camadas de dado desenham em cascas próprias, acima desta. O que
// esta superfície informa é uma coisa só, e ela é real — onde é noite agora.
// -----------------------------------------------------------------------------

import * as THREE from "three";

/**
 * Meia-largura do crepúsculo, em cosseno do ângulo zenital.
 *
 * O crepúsculo civil vai até 6° abaixo do horizonte e o náutico até 12°;
 * sin(9°) ≈ 0,156 põe a transição entre os dois, que é onde o céu de fato passa
 * de claro a escuro. Um valor muito menor devolve a borda dura que este arquivo
 * existe para eliminar; muito maior faz o planeta inteiro virar penumbra.
 */
export const CREPUSCULO = 0.156;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vUv = uv;
    // Normal em espaço de mundo: o globo é girado pelo three-globe para alinhar
    // a textura, e usar a normal de objeto deixaria o terminador preso à malha
    // em vez de ao Sol.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 p = modelMatrix * vec4(position, 1.0);
    vPosW = p.xyz;
    gl_Position = projectionMatrix * viewMatrix * p;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uDia;
  uniform sampler2D uNoite;
  uniform sampler2D uAgua;      // máscara: branco = água
  uniform sampler2D uRelevo;    // topografia, para o gradiente
  uniform vec3  uSol;           // direção do ponto subsolar, unitária, em mundo
  uniform vec3  uCamera;
  uniform float uCiclo;         // 1 = terminador vivo, 0 = tudo iluminado
  uniform float uCidades;       // intensidade das luzes de cidade
  uniform float uRelevoForca;
  uniform float uCrepusculo;
  uniform float uAtenuar;   // 0 = normal, 1 = fundo de análise
  uniform vec2  uTexel;         // 1/tamanho da textura de relevo

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSol);
    vec3 V = normalize(uCamera - vPosW);

    vec3 dia = texture2D(uDia, vUv).rgb;
    vec3 noite = texture2D(uNoite, vUv).rgb;
    float agua = texture2D(uAgua, vUv).r;

    // ---- relevo -----------------------------------------------------------
    // Gradiente central da topografia. As derivadas são em espaço de textura,
    // então precisam da direção leste/norte na superfície para virar uma
    // inclinação no espaço do mundo.
    float hL = texture2D(uRelevo, vUv - vec2(uTexel.x, 0.0)).r;
    float hR = texture2D(uRelevo, vUv + vec2(uTexel.x, 0.0)).r;
    float hD = texture2D(uRelevo, vUv - vec2(0.0, uTexel.y)).r;
    float hU = texture2D(uRelevo, vUv + vec2(0.0, uTexel.y)).r;
    vec3 leste = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    vec3 norte = normalize(cross(N, leste));
    // O cosseno da latitude comprime os texels em longitude perto dos polos;
    // sem isso o relevo vira listras horizontais na Groenlândia e na Antártida.
    float coslat = max(0.15, sqrt(max(0.0, 1.0 - N.y * N.y)));
    vec3 Nr = normalize(N
      - leste * ((hR - hL) / coslat) * uRelevoForca
      - norte * (hU - hD) * uRelevoForca);

    // ---- terminador -------------------------------------------------------
    float bruto = dot(Nr, L);
    // A mistura usa a normal GEOMÉTRICA, não a do relevo: o terminador é uma
    // linha astronômica e não pode serrilhar em cima de cada cordilheira.
    float dia01 = smoothstep(-uCrepusculo, uCrepusculo, dot(N, L));
    dia01 = mix(1.0, dia01, uCiclo);

    // Lambert com meia-envolvente: sem isso a borda do disco fica preta e o
    // planeta perde volume justamente onde a silhueta o define.
    //
    // O PISO SUBIU DE 0,16 PARA 0,26. Com 0,16 o hemisfério noturno virava um
    // buraco preto onde só as fronteiras apareciam, e a penumbra em volta do
    // terminador ficava ilegível. A Terra vista do espaço não é preta no lado
    // escuro: há luz de lua, brilho estelar e espalhamento da própria
    // atmosfera. Um piso baixo demais não é realismo, é perda de leitura.
    float lambert = clamp((bruto + 0.42) / 1.42, 0.0, 1.0);
    vec3 cor = dia * (0.26 + 0.80 * lambert);

    // ---- glint no mar -----------------------------------------------------
    // POTÊNCIA 220, E NÃO 90. Com 90 o lóbulo especular cobria um pedaço
    // grande do oceano e virava um BORRÃO BRANCO — apareceu na tela como uma
    // mancha leitosa a leste. O reflexo do Sol na água é pequeno; grande, ele
    // deixa de ser reflexo e vira véu.
    //
    // E ele morre no modo análise: uma mancha branca por baixo de uma
    // superfície de dado não é reflexo, é ruído.
    vec3 H = normalize(L + V);
    float esp = pow(max(dot(Nr, H), 0.0), 220.0) * agua * dia01;
    cor += vec3(0.85, 0.92, 1.0) * esp * 0.45 * (1.0 - uAtenuar);

    // ---- crepúsculo -------------------------------------------------------
    // O laranja só existe NA banda: é máximo onde o Sol raspa o horizonte e
    // desaparece nos dois lados: dia01 * (1 - dia01) é exatamente isso.
    float banda = dia01 * (1.0 - dia01) * 4.0;
    cor += vec3(1.0, 0.45, 0.18) * banda * 0.30 * uCiclo;

    // ---- luzes de cidade --------------------------------------------------
    // Só no lado noturno, e com a textura elevada ao quadrado: ela tem um véu
    // acinzentado sobre continentes inteiros que, somado direto, faz a terra
    // firme brilhar mais que as cidades.
    vec3 luzes = noite * noite * 1.7;
    cor += luzes * (1.0 - dia01) * uCidades;

    // MODO ANÁLISE. Com a malha 3D levantada acima do planeta, a superfície
    // deixa de ser o assunto e vira o CHÃO da leitura. Atenuada, ela continua
    // dando referência geográfica — costa, relevo, onde é noite — sem competir
    // com a superfície de análise que está por cima.
    //
    // Dessaturar antes de escurecer, e não só escurecer: um azul-marinho escuro
    // continua sendo azul e ainda briga com a rampa de cor da malha.
    //
    // MUITO MAIS SUAVE DO QUE ERA. Com 0,55 de luminância o planeta virava uma
    // bola quase preta com fronteiras brancas — e como a malha agora é OPACA e
    // tapa o que está atrás, quase nada disto aparece de qualquer forma. O que
    // sobra visível é o anel no limbo e os buracos onde falta dado, e esses
    // dois precisam continuar legíveis como Terra.
    float cinza = dot(cor, vec3(0.2126, 0.7152, 0.0722));
    cor = mix(cor, vec3(cinza) * 0.78, uAtenuar * 0.75);

    gl_FragColor = vec4(cor, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface OpcoesTerra {
  dia: THREE.Texture;
  noite: THREE.Texture;
  agua: THREE.Texture;
  relevo: THREE.Texture;
}

/**
 * O material da superfície.
 *
 * Os uniformes ficam expostos porque quem os move é o relógio da aplicação —
 * a linha do tempo do projeto varre horas e dias, e o terminador tem que
 * acompanhar sem reconstruir material nenhum.
 */
export function materialTerra(o: OpcoesTerra): THREE.ShaderMaterial {
  // O tamanho real da textura de relevo: o gradiente amostra os texels
  // vizinhos, e um passo errado devolve relevo borrado ou serrilhado.
  const img = o.relevo.image as { width?: number; height?: number } | undefined;
  const w = img?.width || 2048;
  const h = img?.height || 1024;

  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDia: { value: o.dia },
      uNoite: { value: o.noite },
      uAgua: { value: o.agua },
      uRelevo: { value: o.relevo },
      uSol: { value: new THREE.Vector3(0, 0, 1) },
      uCamera: { value: new THREE.Vector3() },
      uCiclo: { value: 1 },
      uCidades: { value: 1 },
      uRelevoForca: { value: 0.75 },
      uCrepusculo: { value: CREPUSCULO },
      uAtenuar: { value: 0 },
      uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
    },
  });
}

/**
 * Fração iluminada de um ponto, para a mesma conta poder ser feita fora do
 * shader — em teste, e por qualquer parte da tela que precise dizer se um ponto
 * está no dia, na noite ou no crepúsculo, com o MESMO limiar.
 *
 * Duplicar essa regra em JavaScript e em GLSL com números diferentes é como um
 * rótulo passa a discordar do pixel.
 */
export function fracaoDiurna(cosZenital: number, crepusculo = CREPUSCULO): number {
  const t = (cosZenital + crepusculo) / (2 * crepusculo);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c); // smoothstep, igual ao do GLSL
}

export type Momento = "dia" | "crepúsculo" | "noite";

export function momentoDe(cosZenital: number, crepusculo = CREPUSCULO): Momento {
  if (cosZenital > crepusculo) return "dia";
  if (cosZenital < -crepusculo) return "noite";
  return "crepúsculo";
}
