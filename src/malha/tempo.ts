// src/malha/tempo.ts
// -----------------------------------------------------------------------------
// A QUARTA DIMENSÃO.
// -----------------------------------------------------------------------------
// Um campo é f(λ, φ). Uma pilha de campos do mesmo lugar em instantes
// diferentes é f(λ, φ, t), e quase tudo que interessa de verdade mora na
// derivada em t, não no valor:
//
//   "quanto está fazendo agora"      → um campo basta
//   "quando foi o pico"              → precisa da pilha
//   "onde está esquentando"          → precisa da pilha
//   "isto é normal para a hora?"     → precisa da pilha
//
// A DIFERENÇA ENTRE OS DOIS TIPOS DE EXTREMO precisa ficar dita, porque as
// duas contas são parecidas e as respostas não são:
//
//   EXTREMO POR CÉLULA — cada ponto do mapa guarda o seu próprio máximo ao
//   longo do tempo, e o INSTANTE em que ele ocorreu. O resultado é um campo,
//   não um número: o mapa de "temperatura máxima do período" nunca aconteceu
//   de verdade em nenhum instante único, porque cada célula atingiu o seu pico
//   em um momento diferente. É um mapa de envelope, e usá-lo como se fosse uma
//   fotografia é o erro mais fácil de cometer aqui.
//
//   EXTREMO 4D — um só ponto, o mais extremo do espaço-tempo inteiro. Este sim
//   aconteceu, num lugar e numa hora.
//
// O ACOMPANHAMENTO DA HORA não é enfeite. Um mapa de máxima sem o mapa de
// "quando" mistura o pico das 15h de uma célula com o das 3h da vizinha e
// insinua que os dois são o mesmo evento.
// -----------------------------------------------------------------------------

import {
  type CampoEscalar, type Janela, MUNDO,
  percorrer, medido, latDaLinha, lngDaColuna,
} from "./campo.ts";

/** Um campo com o instante a que se refere. A pilha é uma lista destes. */
export interface Fatia {
  campo: CampoEscalar;
  /** ms desde a época */
  instante: number;
}

function conferirPilha(pilha: Fatia[]): { nx: number; ny: number } {
  if (!pilha.length) throw new Error("pilha vazia");
  const { nx, ny } = pilha[0].campo;
  for (const f of pilha) {
    if (f.campo.nx !== nx || f.campo.ny !== ny) {
      throw new Error(
        `pilha com grades diferentes: ${nx}x${ny} e ${f.campo.nx}x${f.campo.ny}. ` +
        "Reamostrar aqui suavizaria o campo e reduziria a variância temporal " +
        "que estamos justamente tentando medir.",
      );
    }
  }
  return { nx, ny };
}

export interface Agregado {
  media: CampoEscalar;
  desvio: CampoEscalar;
  minimo: CampoEscalar;
  maximo: CampoEscalar;
  /** instante em que cada célula atingiu o seu mínimo, em ms */
  quandoMinimo: Float64Array;
  /** idem para o máximo */
  quandoMaximo: Float64Array;
  /** amplitude = máximo − mínimo, célula a célula */
  amplitude: CampoEscalar;
  /** quantas fatias tinham dado em cada célula */
  contagem: Uint16Array;
  fatias: number;
  intervalo: { de: number; ate: number };
}

/**
 * Estatística temporal célula a célula.
 *
 * Uma única passagem pela pilha, com a variância acumulada por Welford. A
 * fórmula ingênua (E[x²] − E[x]²) cancelaria dígitos onde a média é grande
 * comparada ao desvio — 288 K com desvio de 0,3 K come cinco casas decimais.
 * Welford não subtrai números grandes em momento nenhum e custa a mesma
 * passagem.
 *
 * O desvio é AMOSTRAL (n−1): ao contrário do domínio espacial, que temos
 * inteiro, as horas da pilha são uma amostra do tempo. É a mesma escolha que
 * `server/timeseries.js` faz e pelo mesmo motivo — e o oposto da que
 * `./estatistica` faz no espaço, também pelo mesmo motivo.
 */
export function agregarTempo(pilha: Fatia[]): Agregado {
  const { nx, ny } = conferirPilha(pilha);
  const n = nx * ny;

  const cont = new Uint16Array(n);
  const media = new Float32Array(n);
  const m2 = new Float64Array(n);
  const mini = new Float32Array(n);
  const maxi = new Float32Array(n);
  const tMin = new Float64Array(n);
  const tMax = new Float64Array(n);
  const val = new Uint8Array(n);

  for (const { campo, instante } of pilha) {
    for (let k = 0; k < n; k++) {
      if (!medido(campo, k)) continue;
      const v = campo.valores[k];
      const c = cont[k] + 1;
      cont[k] = c;
      val[k] = 1;
      const d = v - media[k];
      media[k] += d / c;
      m2[k] += d * (v - media[k]);
      if (c === 1 || v < mini[k]) { mini[k] = v; tMin[k] = instante; }
      if (c === 1 || v > maxi[k]) { maxi[k] = v; tMax[k] = instante; }
    }
  }

  const desvio = new Float32Array(n);
  const amplitude = new Float32Array(n);
  // Uma fatia só não tem dispersão. `validoDesvio` separado do resto: o desvio
  // é ausente ali, mas a média e o extremo continuam existindo e valendo.
  const validoDesvio = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!val[k]) continue;
    amplitude[k] = maxi[k] - mini[k];
    if (cont[k] > 1) { desvio[k] = Math.sqrt(m2[k] / (cont[k] - 1)); validoDesvio[k] = 1; }
  }

  const base = pilha[0].campo;
  const molde = (valores: Float32Array, sufixo: string, valido: Uint8Array, unidade = base.unidade) =>
    ({
      nx, ny, valores, valido, unidade,
      titulo: base.titulo ? `${base.titulo} · ${sufixo}` : sufixo,
      dataset: base.dataset,
    }) as CampoEscalar;

  const instantes = pilha.map((f) => f.instante);
  return {
    media: molde(media, "média no período", val),
    desvio: molde(desvio, "desvio no período", validoDesvio),
    minimo: molde(mini, "mínimo no período", val),
    maximo: molde(maxi, "máximo no período", val),
    amplitude: molde(amplitude, "amplitude no período", val),
    quandoMinimo: tMin,
    quandoMaximo: tMax,
    contagem: cont,
    fatias: pilha.length,
    intervalo: { de: Math.min(...instantes), ate: Math.max(...instantes) },
  };
}

export interface Tendencia {
  /** inclinação por hora, na unidade do campo */
  porHora: CampoEscalar;
  /**
   * Erro padrão da inclinação, na mesma unidade. Uma tendência sem incerteza
   * não é uma tendência — é um número. Com ela dá para perguntar se a subida
   * é distinguível de zero.
   */
  erroPadrao: CampoEscalar;
  /** fração da variância temporal explicada pela reta, 0..1 */
  r2: CampoEscalar;
}

/**
 * TENDÊNCIA LINEAR POR CÉLULA, por mínimos quadrados.
 *
 * O modelo é f(t) = α + β t, e a equação normal (XᵀX)c = Xᵀy de um sistema com
 * duas incógnitas tem solução fechada:
 *
 *     β = Σ(t − t̄)(f − f̄) / Σ(t − t̄)²
 *     α = f̄ − β t̄
 *
 * Não há matriz para inverter nem iteração para convergir: para uma reta, a
 * projeção ortogonal sobre o espaço-coluna de X é essa razão de somas.
 *
 * O DENOMINADOR SÓ ZERA se todas as fatias forem do mesmo instante, e aí a
 * tendência não existe — a célula sai marcada como ausente, não como zero.
 * Zero afirmaria "estável", que é uma medida, e não temos medida nenhuma.
 *
 * O erro padrão usa n−2 porque dois parâmetros foram estimados dos mesmos
 * dados. Com duas fatias, n−2 = 0: a reta passa exata pelos dois pontos, o
 * resíduo é zero e a incerteza é indefinida — declarada como ausente, e não
 * como um ajuste perfeito, que é o que o número diria sozinho.
 */
export function tendencia(pilha: Fatia[]): Tendencia {
  const { nx, ny } = conferirPilha(pilha);
  const n = nx * ny;
  const HORA = 3600e3;

  const beta = new Float32Array(n);
  const erro = new Float32Array(n);
  const r2 = new Float32Array(n);
  const valB = new Uint8Array(n);
  const valE = new Uint8Array(n);

  // Tempo em HORAS a partir da primeira fatia. Em milissegundos desde 1970 os
  // desvios ao quadrado passam de 1e24 e o float64 começa a perder o que
  // importa; a origem deslocada mantém tudo em ordens de grandeza sadias.
  const t0 = Math.min(...pilha.map((f) => f.instante));
  const ts = pilha.map((f) => (f.instante - t0) / HORA);

  for (let k = 0; k < n; k++) {
    let cont = 0, st = 0, sf = 0;
    for (let s = 0; s < pilha.length; s++) {
      if (!medido(pilha[s].campo, k)) continue;
      cont++; st += ts[s]; sf += pilha[s].campo.valores[k];
    }
    if (cont < 2) continue;
    const mt = st / cont, mf = sf / cont;

    let stt = 0, stf = 0, sff = 0;
    for (let s = 0; s < pilha.length; s++) {
      if (!medido(pilha[s].campo, k)) continue;
      const dt = ts[s] - mt, df = pilha[s].campo.valores[k] - mf;
      stt += dt * dt; stf += dt * df; sff += df * df;
    }
    if (!(stt > 0)) continue;

    const b = stf / stt;
    beta[k] = b; valB[k] = 1;
    r2[k] = sff > 0 ? (stf * stf) / (stt * sff) : 0;

    if (cont > 2) {
      const residuo = Math.max(0, sff - b * stf);
      erro[k] = Math.sqrt(residuo / (cont - 2) / stt);
      valE[k] = 1;
    }
  }

  const base = pilha[0].campo;
  const u = base.unidade;
  return {
    porHora: {
      nx, ny, valores: beta, valido: valB,
      unidade: u ? `${u}/h` : undefined,
      titulo: base.titulo ? `tendência de ${base.titulo}` : "tendência",
      dataset: base.dataset,
    },
    erroPadrao: {
      nx, ny, valores: erro, valido: valE,
      unidade: u ? `${u}/h` : undefined,
      titulo: "erro padrão da tendência", dataset: base.dataset,
    },
    r2: {
      nx, ny, valores: r2, valido: valB,
      unidade: "", titulo: "R² da tendência", dataset: base.dataset,
    },
  };
}

/**
 * ANOMALIA: o campo menos a sua própria média no período.
 *
 * É a operação que troca "está 31 °C" por "está 4 °C acima do normal desta
 * hora" — e a segunda frase é a que carrega informação, porque a primeira é
 * dominada pelo ciclo diurno e pela latitude, que já se sabia de antemão.
 *
 * A referência é a média DA PRÓPRIA PILHA. Isso é anomalia em relação ao
 * período carregado, e não em relação à climatologia de trinta anos. As duas
 * se chamam "anomalia" na literatura e não significam a mesma coisa: uma
 * anomalia de 4 °C sobre seis horas de previsão é ciclo diurno; sobre trinta
 * anos, é clima. O `titulo` do campo devolvido diz qual das duas é.
 */
export function anomalia(campo: CampoEscalar, referencia: CampoEscalar): CampoEscalar {
  if (campo.nx !== referencia.nx || campo.ny !== referencia.ny) {
    throw new Error("anomalia exige campo e referência na mesma grade");
  }
  const n = campo.nx * campo.ny;
  const out = new Float32Array(n);
  const val = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!medido(campo, k) || !medido(referencia, k)) continue;
    out[k] = campo.valores[k] - referencia.valores[k];
    val[k] = 1;
  }
  return {
    nx: campo.nx, ny: campo.ny, valores: out, valido: val,
    unidade: campo.unidade,
    titulo: campo.titulo
      ? `anomalia de ${campo.titulo} · referência: ${referencia.titulo ?? "média da pilha"}`
      : "anomalia",
    dataset: campo.dataset, instante: campo.instante,
  };
}

export interface Extremo4D {
  valor: number;
  lat: number; lng: number;
  instante: number;
  /** índice da fatia na pilha */
  fatia: number;
}

/**
 * O extremo do ESPAÇO-TEMPO: um lugar e uma hora, que existiram de verdade.
 *
 * Diferente do mapa de máximas do `agregarTempo`, que é um envelope montado de
 * pedaços de instantes distintos e portanto nunca aconteceu.
 */
export function extremos4D(
  pilha: Fatia[], jan: Janela = MUNDO,
): { minimo: Extremo4D; maximo: Extremo4D } | null {
  conferirPilha(pilha);
  let mn: Extremo4D | null = null;
  let mx: Extremo4D | null = null;

  pilha.forEach(({ campo, instante }, fatia) => {
    percorrer(campo, jan, (k, i, j) => {
      if (!medido(campo, k)) return;
      const v = campo.valores[k];
      const onde = () => ({
        valor: v, lat: latDaLinha(j, campo.ny), lng: lngDaColuna(i, campo.nx), instante, fatia,
      });
      if (!mn || v < mn.valor) mn = onde();
      if (!mx || v > mx.valor) mx = onde();
    });
  });

  return mn && mx ? { minimo: mn, maximo: mx } : null;
}
