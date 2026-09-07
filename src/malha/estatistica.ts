// src/malha/estatistica.ts
// -----------------------------------------------------------------------------
// MOMENTOS ESPACIAIS, PONDERADOS PELA ÁREA QUE CADA CÉLULA OCUPA.
// -----------------------------------------------------------------------------
// POR QUE `n−1` AQUI SERIA ERRADO, SE EM `server/timeseries.js` ESTÁ CERTO
//
// Aquele módulo divide por n−1, e a justificativa está escrita lá: a série
// observada é uma AMOSTRA do clima, não a população. Dez anos de temperatura
// diária são dez anos entre os infinitos que poderiam ter ocorrido, e o
// estimador amostral corrige o viés dessa amostragem.
//
// Aqui a situação é a oposta. A grade do GFS não é uma amostra da região: é a
// região INTEIRA, célula por célula, sem nenhuma faltando. A variância que
// queremos é a variância real do campo sobre o domínio —
//
//     σ² = (1/A) ∫∫ (f − f̄)² dA
//
// — e o divisor dela é a área total, não a área menos uma célula. Usar n−1
// aqui não corrigiria viés nenhum; só inflaria o número por um fator
// A/(A−ΔA) sem nada por trás.
//
// Os dois módulos discordam de propósito, e a discordância é a parte correta.
//
// A PONDERAÇÃO É O QUE FAZ A CONTA VALER. Sem ela, a média "global" de
// temperatura do GFS sai vários graus fria: as 1.440 células da linha de
// 89,75° cobrem 27 km² cada e recebem o mesmo voto que as 1.440 do equador,
// que cobrem 773 km². A grade dá aos polos, que são o lugar mais frio do
// planeta, um peso vinte e oito vezes maior do que a Terra dá.
// -----------------------------------------------------------------------------

import {
  type CampoEscalar, type Janela, MUNDO,
  percorrer, medido, latDaLinha, lngDaColuna, areaDaCelula,
} from "./campo.ts";

/** Um extremo com o LUGAR onde ocorre — o número sozinho não serve para nada. */
export interface Extremo {
  valor: number;
  lat: number;
  lng: number;
  /** índice linear na grade, para quem quiser voltar ao dado bruto */
  k: number;
}

export interface Momentos {
  /** média ponderada por área */
  media: number;
  /** desvio padrão POPULACIONAL sobre o domínio — ver o cabeçalho */
  desvio: number;
  variancia: number;
  minimo: Extremo;
  maximo: Extremo;
  /** amplitude = máximo − mínimo */
  amplitude: number;
  /** quantas células entraram na conta */
  n: number;
  /** quantas foram recusadas por ausência de dado */
  ausentes: number;
  /** área efetivamente coberta, em km² */
  areaKm2: number;
  /** fração do domínio pedido que tinha dado, em 0..1 */
  cobertura: number;
  unidade?: string;
}

/**
 * Momentos de um campo numa janela.
 *
 * Devolve `null` quando NENHUMA célula tinha dado. Não devolve zeros: um
 * resumo com média 0 e mínimo 0 é indistinguível de uma região realmente
 * congelada, e quem lê a tela não teria como saber a diferença.
 *
 * A soma acumula em `number` (float64) mesmo com o campo em float32. Somar um
 * milhão de float32 num acumulador float32 perde os últimos dígitos quando o
 * acumulador cresce muito acima do termo — o erro é da ordem de n·ε e vira
 * décimos de grau numa média global.
 */
export function momentos(c: CampoEscalar, jan: Janela = MUNDO): Momentos | null {
  let soma = 0, pesoTotal = 0, n = 0, ausentes = 0, area = 0;
  let mn: Extremo | null = null;
  let mx: Extremo | null = null;

  percorrer(c, jan, (k, i, j, w) => {
    if (!medido(c, k)) { ausentes++; return; }
    const v = c.valores[k];
    soma += v * w;
    pesoTotal += w;
    area += areaDaCelula(j, c.nx, c.ny);
    n++;
    if (!mn || v < mn.valor) mn = { valor: v, lat: latDaLinha(j, c.ny), lng: lngDaColuna(i, c.nx), k };
    if (!mx || v > mx.valor) mx = { valor: v, lat: latDaLinha(j, c.ny), lng: lngDaColuna(i, c.nx), k };
  });

  if (!n || pesoTotal <= 0 || !mn || !mx) return null;

  const media = soma / pesoTotal;

  // Segunda passagem. A fórmula de um passo (E[x²] − E[x]²) cancela dígitos
  // significativos quando a média é grande perto do desvio — temperatura em
  // kelvin, por exemplo, onde 288 K ± 0,3 K faria a subtração comer cinco
  // casas. Duas passagens custam o dobro de leitura e nenhuma precisão.
  let soma2 = 0;
  percorrer(c, jan, (k, _i, _j, w) => {
    if (!medido(c, k)) return;
    const d = c.valores[k] - media;
    soma2 += d * d * w;
  });
  const variancia = soma2 / pesoTotal;

  return {
    media,
    variancia,
    desvio: Math.sqrt(variancia),
    minimo: mn, maximo: mx,
    amplitude: (mx as Extremo).valor - (mn as Extremo).valor,
    n, ausentes,
    areaKm2: area / 1e6,
    cobertura: n / (n + ausentes),
    unidade: c.unidade,
  };
}

/**
 * Quantis ponderados por área.
 *
 * A mediana espacial responde a uma pergunta que a média não responde:
 * "metade da ÁREA desta região está acima de quanto?". Numa distribuição
 * assimétrica — precipitação é o caso extremo, com a maior parte do mapa em
 * zero e uma faixa estreita em 80 mm — média e mediana ficam a uma ordem de
 * grandeza de distância, e é a mediana que descreve o que se vê.
 *
 * `qs` em 0..1. A interpolação é pela posição acumulada de ÁREA, não pelo
 * índice — pelo índice, uma célula polar valeria tanto quanto uma equatorial.
 */
export function quantis(
  c: CampoEscalar, qs: number[], jan: Janela = MUNDO,
): Record<string, number> | null {
  const pares: { v: number; w: number }[] = [];
  percorrer(c, jan, (k, _i, _j, w) => {
    if (!medido(c, k)) return;
    pares.push({ v: c.valores[k], w });
  });
  if (!pares.length) return null;

  pares.sort((a, b) => a.v - b.v);
  const total = pares.reduce((s, p) => s + p.w, 0);
  if (!(total > 0)) return null;

  const saida: Record<string, number> = {};
  for (const q of qs) {
    const alvo = Math.max(0, Math.min(1, q)) * total;
    let acc = 0;
    let achou = pares[pares.length - 1].v;
    for (let i = 0; i < pares.length; i++) {
      const antes = acc;
      acc += pares[i].w;
      if (acc >= alvo) {
        // Onde dentro desta célula o corte cai. Com uma célula só, ou com o
        // corte na borda exata, `t` degenera para 0 e o valor é o dela.
        const t = pares[i].w > 0 ? (alvo - antes) / pares[i].w : 0;
        const anterior = i > 0 ? pares[i - 1].v : pares[i].v;
        achou = anterior + (pares[i].v - anterior) * Math.min(1, Math.max(0, t));
        break;
      }
    }
    saida[String(q)] = achou;
  }
  return saida;
}

// -----------------------------------------------------------------------------
// COMPARAÇÃO ENTRE DOIS CAMPOS
// -----------------------------------------------------------------------------

export interface Comparacao {
  /** média de (a − b), ponderada por área. Positivo = `a` maior */
  vies: number;
  /** raiz do erro quadrático médio */
  eqm: number;
  /** erro absoluto médio */
  eam: number;
  covariancia: number;
  /** correlação de Pearson, em −1..1 */
  correlacao: number;
  /**
   * Coeficiente da reta a ≈ α + β·b por mínimos quadrados ponderados.
   * β = cov(a,b)/var(b) é a solução fechada da equação normal.
   */
  inclinacao: number;
  intercepto: number;
  /** fração da variância de `a` explicada pela reta */
  r2: number;
  /** eixos principais da nuvem (a,b): autovalores da matriz de covariância */
  eixoPrincipal: { direcaoGraus: number; autovalorMaior: number; autovalorMenor: number };
  n: number;
  /** onde os dois mais discordam; `valor` é a diferença assinada */
  maiorDiferenca: Extremo;
}

/**
 * Compara dois campos sobre a MESMA grade.
 *
 * Recusa grades diferentes em vez de reamostrar. Reamostrar aqui pareceria
 * gentileza e seria armadilha: a interpolação suaviza o campo mais fino, o que
 * REDUZ a variância dele, o que aumenta artificialmente a correlação entre os
 * dois. O número sairia melhor do que a realidade — o pior tipo de erro numa
 * ferramenta cujo propósito é medir discordância.
 *
 * A MATRIZ DE COVARIÂNCIA e seus autovalores respondem o que a correlação
 * sozinha não responde. Correlação é adimensional e diz só quão fina é a
 * nuvem; os autovetores dizem em que DIREÇÃO ela se alonga. Dois modelos cujo
 * eixo principal está a 45° discordam de AMPLITUDE — um é uma versão esticada
 * do outro. Dois cujo eixo foge dos 45° discordam de PADRÃO. São diagnósticos
 * diferentes e pedem correções diferentes.
 */
export function comparar(
  a: CampoEscalar, b: CampoEscalar, jan: Janela = MUNDO,
): Comparacao | null {
  if (a.nx !== b.nx || a.ny !== b.ny) {
    throw new Error(
      `grades diferentes: ${a.nx}x${a.ny} e ${b.nx}x${b.ny}. ` +
      "Reamostrar aqui inflaria a correlação — peça os dois campos na mesma grade.",
    );
  }

  let sw = 0, sa = 0, sb = 0, n = 0;
  percorrer(a, jan, (k, _i, _j, w) => {
    if (!medido(a, k) || !medido(b, k)) return;
    sw += w; sa += a.valores[k] * w; sb += b.valores[k] * w; n++;
  });
  if (!n || sw <= 0) return null;

  const ma = sa / sw, mb = sb / sw;

  let saa = 0, sbb = 0, sab = 0, sd = 0, sd2 = 0, sabs = 0;
  let pior: Extremo | null = null;
  percorrer(a, jan, (k, i, j, w) => {
    if (!medido(a, k) || !medido(b, k)) return;
    const va = a.valores[k], vb = b.valores[k];
    const da = va - ma, db = vb - mb;
    saa += da * da * w; sbb += db * db * w; sab += da * db * w;
    const d = va - vb;
    sd += d * w; sd2 += d * d * w; sabs += Math.abs(d) * w;
    if (!pior || Math.abs(d) > Math.abs(pior.valor)) {
      pior = { valor: d, lat: latDaLinha(j, a.ny), lng: lngDaColuna(i, a.nx), k };
    }
  });

  const vaa = saa / sw, vbb = sbb / sw, cov = sab / sw;

  // CAMPO CONSTANTE: a correlação não existe, e o teste não pode ser `> 0`.
  //
  // A variância de um campo genuinamente constante não sai zero em ponto
  // flutuante — sai da ordem de (média · ε)², positiva. Com `vbb > 0` a
  // divisão seria feita, e cov/√(vaa·vbb) devolveria um número de aparência
  // respeitável construído inteiramente com ruído de arredondamento. Uma
  // correlação de 4,5e−17 é honesta; uma de 0,83 saída do mesmo ruído não
  // seria, e é o que acontece quando os dois campos são constantes.
  //
  // O piso é relativo à escala do próprio campo, porque ε é relativo: 1e−12
  // fica muitas ordens de grandeza acima do ruído do float64 e muitas abaixo
  // de qualquer variação física que se queira medir.
  const constante = (v: number, m: number) =>
    Math.sqrt(Math.max(0, v)) <= 1e-12 * Math.max(1, Math.abs(m));

  const semVariacao = constante(vaa, ma) || constante(vbb, mb);
  const correlacao = semVariacao ? NaN : cov / Math.sqrt(vaa * vbb);
  const inclinacao = constante(vbb, mb) ? NaN : cov / vbb;

  // Autovalores de [[vaa, cov], [cov, vbb]]. Simétrica e real, então o
  // discriminante nunca é negativo de verdade — o max(0, …) é contra ruído de
  // ponto flutuante, que devolve −1e−18 numa nuvem perfeitamente circular.
  const tr = vaa + vbb;
  const det = vaa * vbb - cov * cov;
  const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
  const l1 = (tr + disc) / 2, l2 = (tr - disc) / 2;
  // Direção do autovetor dominante. `atan2(2c, vaa−vbb)/2` é a forma estável;
  // a expressão com `atan((l1−vaa)/cov)` explode quando cov → 0.
  const direcaoGraus = (Math.atan2(2 * cov, vaa - vbb) / 2) * (180 / Math.PI);

  return {
    vies: sd / sw,
    eqm: Math.sqrt(sd2 / sw),
    eam: sabs / sw,
    covariancia: cov,
    correlacao,
    inclinacao,
    intercepto: Number.isFinite(inclinacao) ? ma - inclinacao * mb : NaN,
    r2: Number.isFinite(correlacao) ? correlacao * correlacao : NaN,
    eixoPrincipal: { direcaoGraus, autovalorMaior: l1, autovalorMenor: l2 },
    n,
    maiorDiferenca: pior as unknown as Extremo,
  };
}
