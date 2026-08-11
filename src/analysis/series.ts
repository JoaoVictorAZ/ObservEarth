// src/analysis/series.ts
// -----------------------------------------------------------------------------
// A MATEMÁTICA DO GRÁFICO — separada do desenho, para poder ser testada.
//
// TRÊS MENTIRAS QUE O GRÁFICO ANTERIOR CONTAVA
//
//   1. O EIXO HORIZONTAL NÃO ERA O TEMPO.
//      O código fazia `data.filter(d => d.y != null)` e depois
//      `x = pad + (i / (valid.length - 1)) * largura`. O eixo era o ÍNDICE DOS
//      PONTOS QUE SOBRARAM. Uma série com 200 dias faltando no meio era
//      desenhada como uma linha contínua e uniformemente espaçada — a lacuna
//      sumia e o resto se esticava para tapar o buraco. O rótulo dizia "tempo".
//
//   2. A LEGENDA ASSOCIAVA O VALOR À DATA ERRADA.
//        Mín: {min} ({valid[0].x})        ← data do PRIMEIRO ponto
//        Máx: {max} ({valid.at(-1).x})    ← data do ÚLTIMO ponto
//      Ela imprimia o mínimo da série ao lado da data de início. Quem lesse
//      "mínima de 3,2 °C em 05/08" estaria lendo duas informações verdadeiras
//      coladas numa afirmação falsa.
//
//   3. DESVIO PADRÃO POPULACIONAL numa série que é amostra.
//
// E UM PROBLEMA DE ESCALA
// Dez anos são 3.652 pontos num traçado de ~700 px. Reduzir pegando um a cada
// N descarta justamente os extremos — o dia de pico de chuva desaparece do
// gráfico e continua no CSV. A redução aqui é por ENVELOPE: cada coluna de
// pixel guarda o mínimo, o máximo e a média do que caiu nela. Nenhum extremo
// se perde; o que se perde é a ordem interna dentro de um pixel, que nenhuma
// tela poderia mostrar de qualquer forma.
// -----------------------------------------------------------------------------

export interface Ponto {
  /** milissegundos desde a época — o eixo é TEMPO, não índice */
  t: number;
  /** null é ausência declarada e permanece null até o traçado */
  v: number | null;
}

export interface Coluna {
  t: number;      // instante do centro da coluna
  min: number;
  max: number;
  media: number;
  n: number;      // quantas observações caíram aqui
}

/** converte a série do servidor (datas ISO + valores) em pontos com tempo real */
export function pontos(tempo: string[], valores: (number | null)[]): Ponto[] {
  return tempo.map((t, i) => {
    const v = valores[i];
    return {
      t: Date.parse(t.length <= 10 ? `${t}T00:00:00Z` : t.endsWith("Z") ? t : `${t}Z`),
      v: v == null || !Number.isFinite(v) ? null : v,
    };
  }).filter((p) => Number.isFinite(p.t));
}

/**
 * Reduz a série a no máximo `colunas` envelopes, preservando extremos.
 *
 * As colunas são fatias iguais de TEMPO, não de índice: um período com
 * amostragem mais densa não ganha mais espaço horizontal do que merece.
 * Coluna sem nenhuma observação simplesmente não existe no resultado — é assim
 * que a lacuna sobrevive até o desenho.
 */
export function envelope(ps: Ponto[], colunas: number): Coluna[] {
  const bons = ps.filter((p) => p.v != null);
  if (bons.length === 0 || colunas < 1) return [];

  const t0 = bons[0].t;
  const t1 = bons[bons.length - 1].t;
  const span = t1 - t0;

  // Poucos pontos, ou todos no mesmo instante: cada um vira sua própria coluna.
  if (span <= 0 || bons.length <= colunas) {
    return bons.map((p) => ({ t: p.t, min: p.v as number, max: p.v as number, media: p.v as number, n: 1 }));
  }

  const acc = new Map<number, { min: number; max: number; soma: number; n: number; tSoma: number }>();
  for (const p of bons) {
    const v = p.v as number;
    // Math.min protege o último ponto, cujo fator é exatamente 1.
    const k = Math.min(colunas - 1, Math.floor(((p.t - t0) / span) * colunas));
    const cur = acc.get(k);
    if (!cur) acc.set(k, { min: v, max: v, soma: v, n: 1, tSoma: p.t });
    else {
      cur.min = Math.min(cur.min, v);
      cur.max = Math.max(cur.max, v);
      cur.soma += v; cur.n += 1; cur.tSoma += p.t;
    }
  }

  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ t: c.tSoma / c.n, min: c.min, max: c.max, media: c.soma / c.n, n: c.n }));
}

export interface Extremo { valor: number; t: number; }

/**
 * Onde o mínimo e o máximo REALMENTE aconteceram.
 *
 * Empate fica com a primeira ocorrência — arbitrário, mas declarado e estável,
 * em vez de depender da ordem de iteração.
 */
export function extremos(ps: Ponto[]): { min: Extremo; max: Extremo } | null {
  let mn: Extremo | null = null;
  let mx: Extremo | null = null;
  for (const p of ps) {
    if (p.v == null) continue;
    if (!mn || p.v < mn.valor) mn = { valor: p.v, t: p.t };
    if (!mx || p.v > mx.valor) mx = { valor: p.v, t: p.t };
  }
  return mn && mx ? { min: mn, max: mx } : null;
}

/**
 * Quebra a série em trechos contínuos, cortando onde há lacuna real.
 *
 * `maxVaoMs` é o intervalo além do qual dois pontos vizinhos deixam de ser
 * vizinhos. Para série diária use algo como 2 dias: dois pontos separados por
 * três meses não podem ser ligados por um segmento reto, porque esse segmento
 * seria um dado que ninguém mediu.
 */
export function trechos<T extends { t: number }>(cols: T[], maxVaoMs: number): T[][] {
  if (!cols.length) return [];
  const out: T[][] = [[cols[0]]];
  for (let i = 1; i < cols.length; i++) {
    if (cols[i].t - cols[i - 1].t > maxVaoMs) out.push([cols[i]]);
    else out[out.length - 1].push(cols[i]);
  }
  return out;
}

/**
 * Escala com folga e passo legível.
 *
 * Uma série achatada (todos os valores iguais) não tem faixa; sem o piso, a
 * divisão por zero mandaria a linha para fora da tela.
 */
export function escala(min: number, max: number): { lo: number; hi: number; passo: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, passo: 1 };
  if (min === max) {
    const d = Math.abs(min) > 1 ? Math.abs(min) * 0.1 : 1;
    return { lo: min - d, hi: max + d, passo: d };
  }
  const bruto = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / mag;
  const passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(min / passo) * passo, hi: Math.ceil(max / passo) * passo, passo };
}

/** marcas do eixo vertical, já na escala arredondada */
export function marcas(lo: number, hi: number, passo: number): number[] {
  const out: number[] = [];
  // Guarda contra passo zero ou negativo: um laço infinito aqui trava a aba.
  if (!(passo > 0) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [lo];
  for (let v = lo, i = 0; v <= hi + passo * 1e-9 && i < 64; v += passo, i++) {
    out.push(+v.toFixed(6));
  }
  return out;
}
