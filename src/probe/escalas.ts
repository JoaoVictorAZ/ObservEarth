// src/probe/escalas.ts
// -----------------------------------------------------------------------------
// COR POR VALOR — não por linha.
//
// O QUE EU FIZ DE ERRADO ANTES
// Numa rodada anterior a sonda tinha dez matizes diferentes, um por linha,
// tirados da paleta do Tailwind. Eu removi todas e escrevi que "cor é DADO,
// não enfeite; dez cores para dez grandezas não informa nada".
//
// O princípio estava certo. A APLICAÇÃO estava errada. Se dez cores fixas não
// informam nada, a resposta não é zero cor — é cor que carrega o valor. Um
// painel todo cinza obriga a ler dez números e comparar de cabeça com faixas
// que só um meteorologista tem decoradas.
//
// Aqui cada grandeza tem a SUA escala, e a cor sai do valor medido:
//   22 °C fica temperado, 38 °C fica quente, −5 °C fica frio
//   10 m/s de vento usa a MESMA rampa do mapa, então painel e globo concordam
//   85% de umidade fica saturado, 20% fica seco
//
// Some a cor e os números continuam lá. É o teste de que ela é redundante com
// o dado, e não a única forma de lê-lo.
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
 * Vento em m/s — a MESMA rampa do mapa.
 *
 * Isto é o que faz painel e globo concordarem: se a partícula está branca no
 * mapa, o número no painel também está. Se as duas escalas divergirem, a tela
 * passa a dizer duas coisas sobre a mesma medida.
 */
export const VENTO: readonly Parada[] = [
  [0, "#6e86c4"], [5, "#7fb4d8"], [10, "#7fd8c4"], [15, "#a8e08a"],
  [21, "#e8e070"], [26, "#fff4d6"],
];

/** rajada: mesma escala do vento, porque é a mesma grandeza física */
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
 *
 * O extremo seco era #5a6478 (3,27:1) — e "sem chuva" é o valor mais comum de
 * todos. Deixar o mais frequente ilegível é o pior lugar para economizar
 * contraste.
 */
export const CHUVA: readonly Parada[] = [
  [0, "#8a94a8"], [0.5, "#7fb4d8"], [2.5, "#7fd88a"], [10, "#e8e070"], [30, "#ff9d6b"], [60, "#ff7a9d"],
];

/**
 * Cobertura de nuvens, em %: luminância pura, como no mapa.
 *
 * O extremo escuro era #4a5568, que dá 2,58:1 contra o fundo do painel —
 * REPROVA no mínimo de 4,5:1 para texto. Céu limpo é o valor mais comum do
 * planeta: era justamente o mais frequente que ficava ilegível.
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
 *
 * A cor sozinha diz "onde nesta escala", mas não diz qual é a escala. A barra
 * mostra a posição do valor dentro da faixa — é o que transforma a cor de
 * enfeite em leitura.
 */
export function posicaoNaFaixa(escala: readonly Parada[], v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const lo = escala[0][0], hi = escala[escala.length - 1][0];
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
