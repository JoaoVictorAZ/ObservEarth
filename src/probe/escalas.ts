// src/probe/escalas.ts
// -----------------------------------------------------------------------------
// Escalas de cores e gradientes de mapeamento meteorológico por grandeza.
// -----------------------------------------------------------------------------

export type Parada = readonly [valor: number, cor: string];

/** interpola numa escala de paradas ordenadas por valor */
export function corDe(escala: readonly Parada[], v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= escala[0][0]) return escala[0][1];
  const ult = escala[escala.length - 1];
  if (v >= ult[0]) return ult[1];

  for (let i = 1; i < escala.length; i++) {
    const [v1, c1] = escala[i - 1], [v2, c2] = escala[i];
    if (v > v2) continue;
    const t = (v - v1) / (v2 - v1);
    return mistura(c1, c2, t);
  }
  return ult[1];
}

function hex(c: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

function mistura(a: string, b: string, t: number): string {
  const A = hex(a), B = hex(b);
  const p = A.map((x, i) => Math.round(x + (B[i] - x) * Math.min(1, Math.max(0, t))));
  return "#" + p.map((x) => x.toString(16).padStart(2, "0")).join("");
}

// -----------------------------------------------------------------------------
// As escalas. Todas as paradas foram medidas para ficarem acima de 4,5:1 contra
// o fundo do aplicativo — é texto, não decoração, e precisa ser legível.
// -----------------------------------------------------------------------------

/** temperatura do ar, em °C: convenção de carta sinótica */
export const TEMPERATURA: readonly Parada[] = [
  [-30, "#a5b8ff"], [-10, "#7fd4ff"], [0, "#8ee6e0"],
  [10, "#7fe0b0"], [20, "#cfe36b"], [28, "#ffc46b"], [35, "#ff9d7a"], [45, "#ff8080"],
];

/** ponto de orvalho: mesma escala física, é uma temperatura */
export const ORVALHO = TEMPERATURA;

/**
 * Vento em m/s
 */
export const VENTO: readonly Parada[] = [
  [0, "#6e86c4"], [5, "#7fb4d8"], [10, "#7fd8c4"], [15, "#a8e08a"],
  [21, "#e8e070"], [26, "#fff4d6"],
];

/** rajada: mesma escala do vento */
export const RAJADA = VENTO;

/** umidade relativa, em %: seco a saturado */
export const UMIDADE: readonly Parada[] = [
  [0, "#e8c48a"], [30, "#d8d88a"], [55, "#9fd8b8"], [80, "#7fc8e0"], [100, "#8ab4f0"],
];

/** pressão à superfície, em hPa: baixa é tempestade, alta é bloqueio */
export const PRESSAO: readonly Parada[] = [
  [960, "#ff9d8a"], [995, "#ffc46b"], [1013, "#a8b4c2"], [1025, "#9fd0e8"], [1050, "#8ab4f0"],
];

/**
 * Precipitação em mm/h: convenção de radar.
 */
export const CHUVA: readonly Parada[] = [
  [0, "#8a94a8"], [0.5, "#7fb4d8"], [2.5, "#7fd88a"], [10, "#e8e070"], [30, "#ff9d6b"], [60, "#ff7a9d"],
];

/**
 * Cobertura de nuvens, em %: luminância pura
 */
export const NUVEM: readonly Parada[] = [
  [0, "#8593a8"], [50, "#b4c0cf"], [100, "#e8eef5"],
];

/** índice UV: as cores da escala oficial da OMS */
export const UV: readonly Parada[] = [
  [0, "#7fd8a8"], [3, "#e8e070"], [6, "#ffb45a"], [8, "#ff8a7a"], [11, "#d89ae8"],
];

/** elevação em m: nível do mar a alta montanha */
export const ELEVACAO: readonly Parada[] = [
  [0, "#7fc8d8"], [500, "#a8d8a0"], [1500, "#d8c890"], [3000, "#d8a890"], [6000, "#e8e0e0"],
];

/**
 * Faixa de referência para a barrinha de posição.
 */
export function posicaoNaFaixa(escala: readonly Parada[], v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const lo = escala[0][0], hi = escala[escala.length - 1][0];
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
