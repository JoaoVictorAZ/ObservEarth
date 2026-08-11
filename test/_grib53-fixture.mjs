// test/_grib53-fixture.mjs
// -----------------------------------------------------------------------------
// CODIFICADOR GRIB2 GABARITO 5.3 — empacotamento complexo com diferenciação
// espacial. É o formato que o GFS realmente usa.
//
// POR QUE ISTO PRECISA EXISTIR
// Os testes cobriam apenas o gabarito 5.0 (empacotamento simples). Nenhuma
// mensagem do GFS usa 5.0. Ou seja: o caminho de código que roda em produção —
// `unpackComplex`, com grupos e recorrência — nunca foi exercitado por teste
// nenhum. Todo defeito ali só aparecia como pixel estranho na tela, dias
// depois, e era diagnosticado por adivinhação.
//
// Um codificador é a única forma honesta de testar um decodificador sem rede:
// gera-se dado conhecido, codifica, decodifica e compara. Se não voltar
// idêntico, o defeito está no decodificador — e o teste diz em qual etapa.
//
// ESTRUTURA DA SEÇÃO 7 PARA O GABARITO 7.3
//   1. octetos extras: ival1, [ival2], minsd   (sinal-magnitude)
//   2. NG referências de grupo,   `bits` cada        -> alinha em octeto
//   3. NG larguras de grupo,      `bitsGW` cada      -> alinha
//   4. NG comprimentos escalados, `bitsGL` cada      -> alinha
//   5. os valores, grupo a grupo, `width[g]` bits cada
// -----------------------------------------------------------------------------

import { be32, be16, sm16, f32be } from "./_grib-fixture.mjs";

/** escreve inteiros de largura variável num fluxo de bits */
class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  write(v, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((Math.floor(v / Math.pow(2, i))) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc & 0xff); this.acc = 0; this.n = 0; }
    }
  }
  /** sinal-magnitude, a convenção do GRIB2 */
  writeSigned(v, bits) {
    const mag = Math.abs(v);
    this.write(v < 0 ? mag + Math.pow(2, bits - 1) : mag, bits);
  }
  align() { if (this.n) { this.bytes.push((this.acc << (8 - this.n)) & 0xff); this.acc = 0; this.n = 0; } }
  buffer() { this.align(); return Buffer.from(this.bytes); }
}

const bitsPara = (v) => (v <= 0 ? 0 : Math.ceil(Math.log2(v + 1)));

/**
 * Monta uma mensagem GRIB2 5.3 a partir de valores INTEIROS já escalados.
 *
 * @param {number} ni
 * @param {number} nj
 * @param {Int32Array|number[]} ints   valores em ordem de varredura
 * @param {object} [o]
 * @param {number} [o.spatialOrder]    1 ou 2
 * @param {number} [o.groupLen]        tamanho fixo de grupo
 * @param {number} [o.category]
 * @param {number} [o.parameter]
 */
export function buildGrib53(ni, nj, ints, o = {}) {
  const spatialOrder = o.spatialOrder ?? 2;
  const groupLen = o.groupLen ?? 64;
  const category = o.category ?? 2;
  const parameter = o.parameter ?? 2;
  const n = ni * nj;

  // ---- 1. diferenciação espacial ----------------------------------------
  // ordem 2: d[i] = x[i] − 2·x[i−1] + x[i−2]
  const d = new Int32Array(n);
  const ival1 = ints[0];
  const ival2 = spatialOrder === 2 ? ints[1] : 0;
  const inicio = spatialOrder === 2 ? 2 : 1;
  for (let i = inicio; i < n; i++) {
    d[i] = spatialOrder === 2
      ? ints[i] - 2 * ints[i - 1] + ints[i - 2]
      : ints[i] - ints[i - 1];
  }

  // mínimo global das diferenças; subtrai-se para tudo ficar não negativo
  let minsd = 0;
  for (let i = inicio; i < n; i++) if (d[i] < minsd) minsd = d[i];
  const dd = new Int32Array(n);
  for (let i = inicio; i < n; i++) dd[i] = d[i] - minsd;
  // as posições de semente carregam zero: o decodificador as sobrescreve
  for (let i = 0; i < inicio; i++) dd[i] = 0;

  // ---- 2. grupos ---------------------------------------------------------
  const grupos = [];
  for (let k = 0; k < n; k += groupLen) {
    const fim = Math.min(k + groupLen, n);
    let lo = Infinity, hi = -Infinity;
    for (let i = k; i < fim; i++) { if (dd[i] < lo) lo = dd[i]; if (dd[i] > hi) hi = dd[i]; }
    grupos.push({ ini: k, len: fim - k, ref: lo, width: bitsPara(hi - lo) });
  }

  const ng = grupos.length;
  const bits = Math.max(1, bitsPara(Math.max(...grupos.map((g) => g.ref))));
  const maxW = Math.max(...grupos.map((g) => g.width));
  const bitsGW = Math.max(1, bitsPara(maxW));
  const lastGroupLength = grupos[ng - 1].len;
  // comprimento fixo: todo grupo tem `groupLen`, então o campo escalado é 0
  const refGroupLength = groupLen;
  const lengthIncrement = 1;
  const bitsGL = 1;

  // ---- 3. seção 7 --------------------------------------------------------
  const extraOctets = 4;
  const bw = new BitWriter();
  bw.writeSigned(ival1, extraOctets * 8);
  if (spatialOrder === 2) bw.writeSigned(ival2, extraOctets * 8);
  bw.writeSigned(minsd, extraOctets * 8);
  bw.align();

  for (const g of grupos) bw.write(g.ref, bits);
  bw.align();
  for (const g of grupos) bw.write(g.width, bitsGW);
  bw.align();
  for (const g of grupos) bw.write(0, bitsGL);      // comprimento escalado = 0
  bw.align();

  for (const g of grupos) {
    if (g.width === 0) continue;                    // grupo constante: nada a gravar
    for (let i = g.ini; i < g.ini + g.len; i++) bw.write(dd[i] - g.ref, g.width);
  }
  const dados = bw.buffer();

  // ---- 4. seções ---------------------------------------------------------
  const s3 = Buffer.concat([
    be32(72), Buffer.from([3]), Buffer.from([0]), be32(n),
    Buffer.from([0, 0]), be16(0), Buffer.from([6]),
    Buffer.from([0]), be32(0), Buffer.from([0]), be32(0), Buffer.from([0]), be32(0),
    be32(ni), be32(nj), be32(0), be32(0),
    be32(90e6), be32(0), Buffer.from([48]),
    be32(-90e6 >>> 0), be32(359e6),
    be32(Math.round((360 / ni) * 1e6)),
    be32(Math.round((180 / (nj - 1)) * 1e6)),
    Buffer.from([0]),
  ]);

  const s4 = Buffer.concat([
    be32(35), Buffer.from([4]), be16(0), be16(0),
    Buffer.from([category, parameter]), Buffer.alloc(24),
  ]);

  // Seção 5, gabarito 5.3 — 49 octetos.
  // Os deslocamentos aqui são o espelho exato do que `parseDrs` lê.
  const s5 = Buffer.concat([
    be32(49), Buffer.from([5]), be32(n), be16(3),   // gabarito 5.3
    f32be(0),                                        // R
    sm16(0), sm16(0),                                // E, D
    Buffer.from([bits]),                             // bits da referência de grupo
    Buffer.from([0]),                                // tipo do campo original
    Buffer.from([1]),                                // método de divisão em grupos
    Buffer.from([0]),                                // gestão de ausentes: nenhuma
    be32(0), be32(0),                                // substitutos de ausente
    be32(ng),                                        // NG
    Buffer.from([0]),                                // referência das larguras
    Buffer.from([bitsGW]),
    be32(refGroupLength),
    Buffer.from([lengthIncrement]),
    be32(lastGroupLength),
    Buffer.from([bitsGL]),
    Buffer.from([spatialOrder]),
    Buffer.from([extraOctets]),
  ]);

  const s6 = Buffer.concat([be32(6), Buffer.from([6]), Buffer.from([255])]);
  const s7 = Buffer.concat([be32(5 + dados.length), Buffer.from([7]), dados]);

  const corpo = Buffer.concat([s3, s4, s5, s6, s7]);
  const s0 = Buffer.concat([
    Buffer.from("GRIB"), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([2]),
    be32(0), be32(16 + corpo.length + 4),
  ]);
  return Buffer.concat([s0, corpo, Buffer.from("7777")]);
}
