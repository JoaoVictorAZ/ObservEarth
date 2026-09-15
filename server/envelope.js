// server/envelope.js
// -----------------------------------------------------------------------------
// O ENVELOPE CLIMATOLÓGICO — a normal de TODOS os 366 dias do ano
// -----------------------------------------------------------------------------
// A aba de série histórica desenhava uma linha solta. Uma linha de temperatura
// sobe no verão e desce no inverno, e é isso que ela mostra: a estação do ano.
// Para saber se o ano foi quente é preciso saber o que era esperado em cada
// dia — e sem esse fundo o gráfico é bonito e mudo.
//
// Este módulo produz o fundo: para cada dia do ano, o p10, a mediana e o p90 de
// 1991–2020 naquele ponto. Desenhado atrás da série, ele transforma a leitura.
// A pergunta deixa de ser "quanto fez?" e passa a ser "quantos dias saíram da
// faixa em que esse lugar passa 80% do tempo?".
//
// CUSTO: ZERO REQUISIÇÃO
//
// É a mesma coisa que a sonda usa. `baixarArquivo` tem uma chave de cache só —
// grade de 0,25°, um ano de validade — e a sonda já pode tê-la aquecido. Aqui
// não há rede: é aritmética sobre um arquivo que já está em disco.
//
// O CUSTO REAL É DE CPU, E ELE FOI MEDIDO
//
// A versão ingênua percorre os 10.958 dias do arquivo para cada um dos 366 dias
// do ano: 4 milhões de comparações de janela, por variável, a cada pedido. Em
// vez disso os índices são agrupados por dia do ano UMA vez, e cada dia-alvo
// junta os 15 baldes da sua janela. São 366 × 450 valores no total, e o trabalho
// que sobra é a ordenação de cada amostra — inevitável, porque quantil é
// posição em lista ordenada.
// -----------------------------------------------------------------------------

import { diaDoAno, dentroDaJanela, quantis, VARIAVEIS, JANELA_DIAS, REF_INICIO, REF_FIM } from "./climatologia.js";

/** Dias do ano com normal: 1 a 366. */
export const DIAS = 366;

/**
 * Índices do arquivo agrupados por dia do ano.
 *
 * Feito uma vez e reaproveitado pelas cinco variáveis e pelos 366 dias — é o
 * que separa uma conta de milissegundos de uma de segundos.
 */
export function baldes(tempos) {
  const b = Array.from({ length: DIAS + 1 }, () => []);
  for (let i = 0; i < tempos.length; i++) {
    const d = diaDoAno(tempos[i]);
    if (d != null && d >= 1 && d <= DIAS) b[d].push(i);
  }
  return b;
}

/** Os dias que caem na janela de ±`janela` em torno de `alvo`, com a volta. */
export function vizinhos(alvo, janela = JANELA_DIAS) {
  const out = [];
  for (let d = 1; d <= DIAS; d++) if (dentroDaJanela(d, alvo, janela)) out.push(d);
  return out;
}

/**
 * Envelope de uma variável: três séries de 366 posições, indexadas por
 * dia do ano menos um.
 *
 * Posições sem amostra viram `null` e nunca zero — o dia 366 num ponto cuja
 * série não tem nenhum ano bissexto é o caso real, e uma faixa desabando para
 * zero no último dia do ano seria lida como um evento climático.
 */
export function envelopeDe(col, bal, janela = JANELA_DIAS) {
  const p10 = new Array(DIAS).fill(null);
  const p50 = new Array(DIAS).fill(null);
  const p90 = new Array(DIAS).fill(null);
  const n = new Array(DIAS).fill(0);

  for (let alvo = 1; alvo <= DIAS; alvo++) {
    const amostra = [];
    for (const d of vizinhos(alvo, janela)) {
      for (const i of bal[d]) {
        const v = col[i];
        if (v != null && Number.isFinite(v)) amostra.push(v);
      }
    }
    if (!amostra.length) continue;
    const { q } = quantis(amostra);
    p10[alvo - 1] = q[2];
    p50[alvo - 1] = q[10];
    p90[alvo - 1] = q[18];
    n[alvo - 1] = amostra.length;
  }
  return { p10, p50, p90, n };
}

export function montarEnvelope(diario, janela = JANELA_DIAS) {
  const tempos = diario?.time ?? [];
  if (!tempos.length) throw Object.assign(new Error("arquivo sem série diária"), { status: 502 });

  const bal = baldes(tempos);
  const anos = new Set(tempos.map((t) => String(t).slice(0, 4))).size;

  const variaveis = {};
  for (const [nome, cfg] of Object.entries(VARIAVEIS)) {
    const col = diario[nome];
    if (!Array.isArray(col)) continue;
    const e = envelopeDe(col, bal, janela);
    variaveis[nome] = { ...e, unidade: cfg.unidade, feitio: cfg.feitio, rotulo: cfg.rotulo };
  }

  return {
    referencia: `${REF_INICIO.slice(0, 4)}–${REF_FIM.slice(0, 4)}`,
    anos,
    janelaDias: janela,
    dias: DIAS,
    fonte: "ERA5 via Open-Meteo Archive",
    nota:
      `Faixa de ${REF_INICIO.slice(0, 4)}–${REF_FIM.slice(0, 4)} entre o percentil 10 e o 90, ` +
      `por dia do ano, com janela de ±${janela} dias. A linha do meio é a mediana histórica.`,
    variaveis,
  };
}
