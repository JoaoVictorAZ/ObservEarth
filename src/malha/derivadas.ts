// src/malha/derivadas.ts
// -----------------------------------------------------------------------------
// CÁLCULO DIFERENCIAL SOBRE A ESFERA.
// -----------------------------------------------------------------------------
// A grade é regular em GRAU, e o planeta não é regular em METRO. Um passo de
// 0,25° em longitude vale 27,8 km no equador e 1,0 km a 88° de latitude. Toda
// derivada calculada aqui divide pelo comprimento físico do passo, nunca pelo
// passo angular — senão o gradiente de temperatura de um campo perfeitamente
// suave apareceria vinte e oito vezes mais forte perto dos polos, e a tela
// mostraria uma frente meteorológica onde só há a projeção.
//
// A BASE LOCAL é ortonormal e tangente à esfera:
//
//     x̂ para LESTE      dx = R cos φ dλ
//     ŷ para NORTE      dy = R dφ
//
// donde
//
//     ∂f/∂x = (1 / (R cos φ)) ∂f/∂λ
//     ∂f/∂y = (1 / R) ∂f/∂φ
//
// O SINAL DA LATITUDE. A linha j = 0 é +90° e a latitude DECRESCE com j, então
// ∂f/∂φ ∝ (f[j−1] − f[j+1]), com o norte primeiro. É o mesmo cuidado que
// `server/vorticidade.js` documenta, e trocar a ordem espelha o campo inteiro
// no hemisfério — um vale vira crista.
//
// OS POLOS. Onde cos φ → 0 a divisão explode: a 89,75° o fator 1/cos φ vale
// 229, e a derivada em longitude de qualquer ruído numérico vira um número
// enorme. Acima do limite a resposta é `null`, não zero. Zero afirmaria campo
// plano no lugar exato onde a grade lat/lng deixa de sustentar a conta, e é
// justamente ali que fica o vórtice polar.
// -----------------------------------------------------------------------------

import { type CampoEscalar, RAIO_TERRA, latDaLinha, indice, medido } from "./campo.ts";

/**
 * Cosseno mínimo da latitude para que a derivada em longitude tenha sentido.
 * 0,09 corresponde a ±84,8°, o mesmo corte de `server/vorticidade.js` — dois
 * módulos que resolvem o mesmo problema físico devem desistir no mesmo lugar.
 */
export const COS_MIN = 0.09;

/** Vetor no plano tangente, em unidades de [unidade do campo] por metro. */
export interface Gradiente {
  /** componente para LESTE */
  dx: number;
  /** componente para NORTE */
  dy: number;
  /** módulo — é este que localiza frentes e cortantes */
  modulo: number;
  /** direção de maior crescimento, em graus a partir do norte, sentido horário */
  azimute: number;
}

/** Passos angulares da grade, em radianos. */
function passos(nx: number, ny: number) {
  return {
    dLam: (2 * Math.PI) / nx,
    dPhi: ny > 1 ? Math.PI / (ny - 1) : Math.PI,
  };
}

/**
 * Gradiente por diferenças centradas na célula (i, j).
 *
 * Devolve `null` quando algum dos quatro vizinhos falta ou quando a latitude
 * passou do limite polar. Diferença centrada precisa dos DOIS lados: cair para
 * diferença lateral na borda de um buraco de dado daria um número com metade
 * da ordem de convergência e nenhum aviso de que é outro estimador.
 *
 * Ordem de erro O(h²), com h o passo da grade.
 */
export function gradienteEm(c: CampoEscalar, i: number, j: number): Gradiente | null {
  const { nx, ny } = c;
  if (j <= 0 || j >= ny - 1) return null;          // não há linha além do polo

  const lat = latDaLinha(j, ny);
  const cosPhi = Math.cos((lat * Math.PI) / 180);
  if (Math.abs(cosPhi) < COS_MIN) return null;

  const { dLam, dPhi } = passos(nx, ny);

  const kL = indice(i - 1, j, nx, ny), kR = indice(i + 1, j, nx, ny);
  const kN = indice(i, j - 1, nx, ny), kS = indice(i, j + 1, nx, ny);
  if (!medido(c, kL) || !medido(c, kR) || !medido(c, kN) || !medido(c, kS)) return null;

  const dfdLam = (c.valores[kR] - c.valores[kL]) / (2 * dLam);
  // Norte menos sul: a latitude decresce com j.
  const dfdPhi = (c.valores[kN] - c.valores[kS]) / (2 * dPhi);

  const dx = dfdLam / (RAIO_TERRA * cosPhi);
  const dy = dfdPhi / RAIO_TERRA;
  const modulo = Math.hypot(dx, dy);
  // Azimute meteorológico: 0° = norte, 90° = leste. `atan2(leste, norte)`.
  const azimute = (Math.atan2(dx, dy) * 180) / Math.PI;

  return { dx, dy, modulo, azimute: (azimute + 360) % 360 };
}

/**
 * Campo do MÓDULO do gradiente, em [unidade]/m.
 *
 * É o campo que responde "onde muda depressa". Numa temperatura, os máximos
 * dele são frentes; num geopotencial, são jatos. Células sem gradiente
 * calculável ficam marcadas em `valido = 0` — não em zero, que significaria
 * "campo plano aqui".
 */
export function campoGradiente(c: CampoEscalar): CampoEscalar {
  const { nx, ny } = c;
  const out = new Float32Array(nx * ny);
  const val = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const g = gradienteEm(c, i, j);
      const k = j * nx + i;
      if (!g) continue;
      out[k] = g.modulo;
      val[k] = 1;
    }
  }
  return {
    nx, ny, valores: out, valido: val,
    unidade: c.unidade ? `${c.unidade}/m` : undefined,
    titulo: c.titulo ? `|∇| de ${c.titulo}` : undefined,
    dataset: c.dataset, instante: c.instante,
  };
}

/**
 * Matriz Hessiana no plano tangente, simétrica 2×2.
 *
 * POR QUE ISTO PODE IGNORAR OS SÍMBOLOS DE CHRISTOFFEL
 *
 * Numa variedade curva a Hessiana covariante é
 *
 *     (Hess f)_ab = ∂a ∂b f − Γᶜ_ab ∂c f
 *
 * e os termos de conexão Γ não são desprezíveis numa esfera. Só que este
 * módulo usa a Hessiana para UMA coisa: classificar PONTOS CRÍTICOS. Num ponto
 * crítico, por definição, ∂c f = 0 — e o termo inteiro com Γ desaparece. A
 * matriz das segundas derivadas parciais na base ortonormal É a Hessiana
 * covariante ali, exatamente, sem aproximação.
 *
 * Fora de um ponto crítico esta matriz continua sendo uma curvatura útil de
 * campo, mas deixa de ser um objeto geométrico invariante. Quem a usar longe
 * de um extremo precisa saber disso.
 */
export interface Hessiana {
  fxx: number; fxy: number; fyy: number;
  /** traço = fxx + fyy = laplaciano cartesiano local */
  traco: number;
  determinante: number;
  /** autovalores, sempre reais: a matriz é simétrica */
  lambda1: number;   // o de maior módulo
  lambda2: number;
  /** direção do autovetor de λ1, em graus a partir do norte */
  direcaoGraus: number;
}

export function hessianaEm(c: CampoEscalar, i: number, j: number): Hessiana | null {
  const { nx, ny } = c;
  if (j <= 0 || j >= ny - 1) return null;

  const lat = latDaLinha(j, ny);
  const cosPhi = Math.cos((lat * Math.PI) / 180);
  if (Math.abs(cosPhi) < COS_MIN) return null;

  const { dLam, dPhi } = passos(nx, ny);
  const k = indice(i, j, nx, ny);
  const kL = indice(i - 1, j, nx, ny), kR = indice(i + 1, j, nx, ny);
  const kN = indice(i, j - 1, nx, ny), kS = indice(i, j + 1, nx, ny);
  const kNE = indice(i + 1, j - 1, nx, ny), kNO = indice(i - 1, j - 1, nx, ny);
  const kSE = indice(i + 1, j + 1, nx, ny), kSO = indice(i - 1, j + 1, nx, ny);

  for (const kk of [k, kL, kR, kN, kS, kNE, kNO, kSE, kSO]) {
    if (!medido(c, kk)) return null;
  }

  const f = c.valores;
  const d2Lam = (f[kR] - 2 * f[k] + f[kL]) / (dLam * dLam);
  const d2Phi = (f[kN] - 2 * f[k] + f[kS]) / (dPhi * dPhi);
  // Cruzada: (NE − NO − SE + SO) / (4 ΔλΔφ). Norte é j−1, então o sinal de φ
  // já sai certo com o norte no numerador positivo.
  const dLamPhi = (f[kNE] - f[kNO] - f[kSE] + f[kSO]) / (4 * dLam * dPhi);

  const R = RAIO_TERRA;
  const fxx = d2Lam / (R * R * cosPhi * cosPhi);
  const fyy = d2Phi / (R * R);
  const fxy = dLamPhi / (R * R * cosPhi);

  const traco = fxx + fyy;
  const determinante = fxx * fyy - fxy * fxy;
  const disc = Math.sqrt(Math.max(0, traco * traco - 4 * determinante));
  const a = (traco + disc) / 2, b = (traco - disc) / 2;
  const [lambda1, lambda2] = Math.abs(a) >= Math.abs(b) ? [a, b] : [b, a];
  const direcaoGraus =
    ((Math.atan2(2 * fxy, fxx - fyy) / 2) * (180 / Math.PI) + 360) % 360;

  return { fxx, fxy, fyy, traco, determinante, lambda1, lambda2, direcaoGraus };
}

/**
 * Laplaciano de Laplace–Beltrami, o operador correto na esfera:
 *
 *     Δf = (1/R²)[ ∂²f/∂φ² − tan φ · ∂f/∂φ ] + (1/(R² cos²φ)) ∂²f/∂λ²
 *
 * O termo com tan φ é a diferença entre isto e "somar as duas segundas
 * derivadas". Ele vem de ∂/∂φ(cos φ ∂f/∂φ) e representa a convergência dos
 * meridianos: em 60° de latitude ele já responde por 1,7 vezes o próprio
 * gradiente meridional. Ignorá-lo é o erro mais comum em código de grade, e
 * ele NÃO some com refinamento — é modelo errado, não discretização grossa.
 *
 * Onde o laplaciano é negativo o campo é côncavo (topo, cume de pressão); onde
 * é positivo, convexo (cavado, centro de baixa).
 */
export function laplacianoEm(c: CampoEscalar, i: number, j: number): number | null {
  const { nx, ny } = c;
  if (j <= 0 || j >= ny - 1) return null;

  const lat = latDaLinha(j, ny);
  const rad = (lat * Math.PI) / 180;
  const cosPhi = Math.cos(rad);
  if (Math.abs(cosPhi) < COS_MIN) return null;

  const { dLam, dPhi } = passos(nx, ny);
  const k = indice(i, j, nx, ny);
  const kL = indice(i - 1, j, nx, ny), kR = indice(i + 1, j, nx, ny);
  const kN = indice(i, j - 1, nx, ny), kS = indice(i, j + 1, nx, ny);
  for (const kk of [k, kL, kR, kN, kS]) if (!medido(c, kk)) return null;

  const f = c.valores;
  const d2Lam = (f[kR] - 2 * f[k] + f[kL]) / (dLam * dLam);
  const d2Phi = (f[kN] - 2 * f[k] + f[kS]) / (dPhi * dPhi);
  const dPhi1 = (f[kN] - f[kS]) / (2 * dPhi);

  const R2 = RAIO_TERRA * RAIO_TERRA;
  return (d2Phi - Math.tan(rad) * dPhi1) / R2 + d2Lam / (R2 * cosPhi * cosPhi);
}

/** O laplaciano como campo inteiro, em [unidade]/m². */
export function campoLaplaciano(c: CampoEscalar): CampoEscalar {
  const { nx, ny } = c;
  const out = new Float32Array(nx * ny);
  const val = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const l = laplacianoEm(c, i, j);
      if (l == null) continue;
      const k = j * nx + i;
      out[k] = l;
      val[k] = 1;
    }
  }
  return {
    nx, ny, valores: out, valido: val,
    unidade: c.unidade ? `${c.unidade}/m²` : undefined,
    titulo: c.titulo ? `∇² de ${c.titulo}` : undefined,
    dataset: c.dataset, instante: c.instante,
  };
}
