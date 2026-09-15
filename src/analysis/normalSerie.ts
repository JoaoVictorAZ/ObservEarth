// src/analysis/normalSerie.ts
// -----------------------------------------------------------------------------
// A SÉRIE OBSERVADA CONTRA A FAIXA HISTÓRICA
// -----------------------------------------------------------------------------
// O gráfico de série histórica desenhava uma linha solta. Uma linha de
// temperatura sobe no verão e desce no inverno — e é só isso que ela mostra: a
// estação do ano. Para saber se o ano foi quente é preciso ver o que era
// esperado em cada dia, e sem esse fundo o gráfico é bonito e mudo.
//
// Este módulo casa as duas coisas: para cada data observada, busca o percentil
// 10, a mediana e o percentil 90 daquele dia do ano em 1991–2020, e conta
// quantos dias saíram da faixa. A contagem é a frase que o gráfico não diz
// sozinho — "23 dos 365 dias acima do p90" é uma afirmação; uma linha é um
// desenho.
//
// PURO DE PROPÓSITO: nenhuma referência a SVG, DOM ou React, para que a regra
// (qual dia casa com qual normal, o que conta como fora) seja testável sem
// montar componente.
// -----------------------------------------------------------------------------

/** O que a rota `/api/analysis/clima` devolve por variável. */
export interface EnvelopeVar {
  p10: (number | null)[];
  p50: (number | null)[];
  p90: (number | null)[];
  n: number[];
  unidade: string;
  rotulo: string;
}
export interface Envelope {
  referencia: string;
  anos: number;
  janelaDias: number;
  dias: number;
  fonte: string;
  nota: string;
  variaveis: Record<string, EnvelopeVar>;
}

/**
 * Dia do ano, 1 a 366, a partir de "AAAA-MM-DD".
 *
 * Em UTC, como todo o resto do projeto. Ler a data no fuso local deslocaria o
 * dia inteiro para quem está a oeste de Greenwich, e a normal do dia 1 iria
 * parar no dia 365.
 */
export function diaDoAno(iso: string): number | null {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((t - inicio) / 86400e3) + 1;
}

export interface PontoNormal {
  t: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

/** A faixa histórica alinhada com as datas observadas, uma posição por data. */
export function alinhar(tempo: string[], env: EnvelopeVar | null | undefined): PontoNormal[] {
  if (!env) return [];
  return tempo.map((iso) => {
    const d = diaDoAno(iso);
    const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
    // Fora do intervalo declarado a resposta é ausência, não a posição 0 —
    // que seria a normal de 1º de janeiro colada num dia qualquer.
    const i = d != null && d >= 1 && d <= env.p50.length ? d - 1 : -1;
    if (i < 0) return { t, p10: null, p50: null, p90: null };
    return { t, p10: env.p10[i] ?? null, p50: env.p50[i] ?? null, p90: env.p90[i] ?? null };
  });
}

export interface Contagem {
  /** dias observados que puderam ser comparados */
  comparados: number;
  acima: number;
  abaixo: number;
  dentro: number;
  /** o dia mais extremo do período, e de quanto ele passou da faixa */
  recorde: { t: number; valor: number; margem: number; lado: "acima" | "abaixo" } | null;
}

/**
 * Quantos dias saíram da faixa usual.
 *
 * O critério é passar de p90 ou ficar abaixo de p10 — a faixa em que aquele
 * lugar passa 80% dos dias daquela época. Não é "recorde": um dia acima do p90
 * acontece, por construção, em 10% dos anos. A informação está no NÚMERO de
 * dias, comparado com os 10% que se esperaria.
 *
 * A igualdade conta como dentro. Em precipitação, onde o p10 é zero na maior
 * parte do planeta, tratar `valor <= p10` como "abaixo" faria todo dia seco
 * virar anomalia seca — que é justamente a leitura que o percentil existe para
 * evitar.
 */
export function contar(valores: (number | null)[], faixa: PontoNormal[]): Contagem {
  let comparados = 0, acima = 0, abaixo = 0, dentro = 0;
  let recorde: Contagem["recorde"] = null;

  const n = Math.min(valores.length, faixa.length);
  for (let i = 0; i < n; i++) {
    const v = valores[i];
    const f = faixa[i];
    if (v == null || !Number.isFinite(v) || f.p10 == null || f.p90 == null) continue;
    comparados++;

    if (v > f.p90) {
      acima++;
      const margem = v - f.p90;
      if (!recorde || margem > recorde.margem) recorde = { t: f.t, valor: v, margem, lado: "acima" };
    } else if (v < f.p10) {
      abaixo++;
      const margem = f.p10 - v;
      if (!recorde || margem > recorde.margem) recorde = { t: f.t, valor: v, margem, lado: "abaixo" };
    } else {
      dentro++;
    }
  }
  return { comparados, acima, abaixo, dentro, recorde };
}

/**
 * A frase de leitura.
 *
 * Ela sempre traz o ESPERADO ao lado do observado, porque "23 dias acima do
 * p90" sozinho não diz nada: em 365 dias esperam-se ~37. O número só vira
 * informação ao lado do seu ponto de comparação — e nesse exemplo a leitura
 * correta é que o período foi mais FRIO que o normal, não mais quente.
 */
export function frase(c: Contagem, rotulo: string): string | null {
  if (!c.comparados) return null;
  const esperado = Math.round(c.comparados * 0.1);
  const fora = c.acima + c.abaixo;
  if (!fora) {
    return `${rotulo}: nenhum dos ${c.comparados} dias saiu da faixa usual (esperavam-se ~${esperado * 2}).`;
  }
  return (
    `${rotulo}: ${c.acima} dia${c.acima === 1 ? "" : "s"} acima do p90 e ` +
    `${c.abaixo} abaixo do p10, em ${c.comparados} dias. ` +
    `Numa época típica esperam-se ~${esperado} de cada lado.`
  );
}
