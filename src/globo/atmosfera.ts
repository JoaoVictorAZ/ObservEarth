// src/globo/atmosfera.ts
// -----------------------------------------------------------------------------
// O LIMBO — a borda que dá volume ao planeta
// -----------------------------------------------------------------------------
// Terceira versão, e as duas primeiras erraram a mesma coisa por motivos
// diferentes. Vale registrar as duas, porque o erro é instrutivo.
//
// V1 — o halo do three-globe: cor única, opacidade constante. Igual no meio-dia
//      e na meia-noite, igual em cima do terminador. Não é um limbo, é um
//      contorno.
//
// V2 — Fresnel sobre a normal da casca: `pow(1 - dot(N, V), p)`. A intuição
//      estava certa (o limbo é onde a linha de visada atravessa mais ar) e o
//      resultado, não. O motivo aparece na captura de tela e não na conta:
//
//        `1 - dot(N, V)` vale 1 na SILHUETA DA CASCA, que é a borda EXTERNA da
//        geometria. O brilho, portanto, é máximo exatamente onde o triângulo
//        acaba — e ali ele é cortado a pique. O resultado é um ANEL com borda
//        externa dura, uma faixa recortada contra o preto. Parece o aro de uma
//        tigela, não o ar em volta de um planeta.
//
// V3 — esta. O brilho não vem da normal: vem do PARÂMETRO DE IMPACTO.
//
// ---------------------------------------------------------------------------
// O PARÂMETRO DE IMPACTO
// ---------------------------------------------------------------------------
// Para cada fragmento, a linha de visada que passa por ele tem uma distância
// mínima até o centro do planeta. Chamando essa distância de `b`:
//
//   b = R          a visada raspa a superfície — é o limbo, e é onde o
//                  caminho dentro da atmosfera é mais longo. Brilho máximo.
//   b > R          a visada passa por fora; quanto mais longe, menos ar
//                  atravessado. O brilho cai.
//   b = R·(1+h)    a visada saiu da casca. Brilho ZERO, e por isso não há
//                  borda dura: a geometria acaba onde o brilho já acabou.
//
// `b` é `|P × V|` com o centro na origem, e é isto que a V2 não usava. O
// decaimento é exponencial porque a densidade do ar cai exponencialmente com a
// altura — a única parte disto que é física de verdade.
//
// O QUE ISTO CONTINUA NÃO SENDO: um modelo de Rayleigh. Não há integração ao
// longo do raio, não há coeficiente por comprimento de onda, não há Mie. Nada
// aqui deve ser lido como medida de nada.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { ORDEM } from "../ordemDesenho.ts";

/**
 * Altura da casca, em raios terrestres.
 *
 * Agora ela é só o LIMITE da geometria: o brilho já chega a zero nela, então
 * o número deixou de decidir a espessura aparente do anel — quem decide é
 * `QUEDA`. É por isso que 0,08 aqui não desenha uma faixa de 8%: desenha um
 * degradê que morre bem antes.
 */
export const ALTURA = 0.08;

/**
 * Quão rápido o brilho cai do limbo para fora.
 *
 * A atmosfera terrestre tem altura de escala de ~8,5 km contra 6.371 de raio:
 * o brilho cai por `e` a cada 0,13% de raio. Reproduzir isso literalmente
 * desenharia um fio de meio pixel. 5,5 sobre a espessura da casca dá um
 * degradê que se lê como ar e não como aro.
 */
export const QUEDA = 5.5;

const VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 p = modelMatrix * vec4(position, 1.0);
    vPosW = p.xyz;
    gl_Position = projectionMatrix * viewMatrix * p;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3  uSol;
  uniform vec3  uCamera;
  uniform vec3  uAzul;
  uniform vec3  uQuente;
  uniform float uQueda;
  uniform float uForca;
  uniform float uCiclo;
  uniform float uRaio;        // raio do planeta
  uniform float uRaioCasca;   // raio da casca

  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamera - vPosW);
    vec3 L = normalize(uSol);

    // Parâmetro de impacto: a menor distância entre a linha de visada e o
    // centro do planeta. Com o centro na origem, é o módulo do produto
    // vetorial — e é ele, e não a normal, que diz quanto ar a visada atravessa.
    float b = length(cross(vPosW, V));
    float t = clamp((b - uRaio) / max(1e-4, uRaioCasca - uRaio), 0.0, 1.0);

    // Exponencial porque a densidade do ar é exponencial na altura. O fator
    // (1 - t) força o zero na borda da casca: sem ele a exponencial ainda
    // valeria algo ali, e a geometria voltaria a cortar o brilho a pique.
    float perfil = exp(-t * uQueda) * (1.0 - t);

    float sol = dot(N, L);
    float aceso = smoothstep(-0.25, 0.30, sol);
    aceso = mix(1.0, aceso, uCiclo);

    // O vermelho do crepúsculo depende de HAVER crepúsculo. Sem ciclo
    // dia/noite não existe terminador, e pintar de laranja o pé do disco de um
    // planeta uniformemente iluminado é enfeite — foi o que apareceu na tela.
    float rasante = (1.0 - smoothstep(0.0, 0.42, abs(sol))) * aceso * uCiclo;

    vec3 cor = mix(uAzul, uQuente, rasante * 0.45);
    float a = perfil * aceso * uForca;

    gl_FragColor = vec4(cor * a, a);
    #include <colorspace_fragment>
  }
`;

export interface OpcoesAtmosfera {
  /** raio do globo, nas unidades da cena */
  raio: number;
  azul?: THREE.ColorRepresentation;
  quente?: THREE.ColorRepresentation;
  forca?: number;
}

export interface Atmosfera {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  descartar(): void;
}

export function criarAtmosfera(o: OpcoesAtmosfera): Atmosfera {
  const raioCasca = o.raio * (1 + ALTURA);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSol: { value: new THREE.Vector3(0, 0, 1) },
      uCamera: { value: new THREE.Vector3() },
      uAzul: { value: new THREE.Color(o.azul ?? "#6ea8ff") },
      uQuente: { value: new THREE.Color(o.quente ?? "#ff8a3d") },
      uQueda: { value: QUEDA },
      uForca: { value: o.forca ?? 0.85 },
      uCiclo: { value: 1 },
      uRaio: { value: o.raio },
      uRaioCasca: { value: raioCasca },
    },
    // POR DENTRO: a casca é vista do lado de fora, mas o que interessa é o
    // anel que sobra ao redor do planeta. Desenhando as faces de trás, o
    // planeta opaco esconde a metade da frente e o resultado é o halo.
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    // Sem escrever profundidade: o halo é luz somada, não superfície, e
    // gravá-lo no buffer faria ele recortar tudo que for desenhado depois —
    // partículas de vento, marcadores, a malha.
    depthWrite: false,
  });

  const geometry = new THREE.SphereGeometry(raioCasca, 96, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = ORDEM.ATMOSFERA;

  return {
    mesh,
    material,
    descartar() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

/**
 * As mesmas curvas do shader, em JavaScript.
 *
 * Existem para poder ser verificadas: um limbo que não chega a zero na borda
 * da casca volta a ser um aro recortado, e isso é exatamente o defeito que só
 * apareceu numa captura de tela — captura de tela não reprova numa suíte.
 *
 * `t` é a posição entre o limbo do planeta (0) e a borda da casca (1).
 */
export function perfilLimbo(t: number, queda = QUEDA): number {
  const c = Math.max(0, Math.min(1, t));
  return Math.exp(-c * queda) * (1 - c);
}

/** `t` a partir do parâmetro de impacto, do raio do planeta e do da casca. */
export function posicaoNoLimbo(b: number, raio: number, raioCasca: number): number {
  return Math.max(0, Math.min(1, (b - raio) / Math.max(1e-9, raioCasca - raio)));
}

const suave = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function aceso(cosSol: number): number {
  return suave(-0.25, 0.30, cosSol);
}

export function rasancia(cosSol: number): number {
  return (1 - suave(0, 0.42, Math.abs(cosSol))) * aceso(cosSol);
}
