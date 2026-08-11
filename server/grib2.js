class BitReader {
  constructor(buf, byteOffset = 0) {
    if (!buf || !(buf instanceof Uint8Array)) {
      throw new TypeError("BitReader espera Uint8Array");
    }
    this.buf = buf;
    this.pos = byteOffset * 8;
  }

  read(n) {
    if (n <= 0) return 0;
    if (n > 53) {
      // acima de 2^53 o próprio Number deixa de representar inteiro exato
      throw new Error(`BitReader: ${n} bits excede a precisão de inteiro do JS`);
    }
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = this.pos >> 3;
      if (byteIdx >= this.buf.length) {
        throw new Error(`BitReader: leitura além do buffer (pos=${this.pos}, len=${this.buf.length})`);
      }
      const b = this.buf[byteIdx];
      // MULTIPLICAR POR 2, NUNCA `v << 1`.
      //
      // Os operadores de deslocamento do JavaScript convertem para inteiro de
      // 32 bits COM SINAL. No 32º bit, `v << 1` estoura e o valor vira
      // negativo: uma leitura de 32 bits com todos os bits em 1 devolve -1 em
      // vez de 4.294.967.295. A aritmética de ponto flutuante é exata até 2^53
      // e não tem esse limite.
      //
      // Não é hipotético: larguras de 32 bits aparecem em contagens de pontos
      // e em comprimentos de seção de arquivos globais.
      v = v * 2 + ((b >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }

  align() {
    if (this.pos & 7) this.pos = (this.pos | 7) + 1;
  }

  get bytePos() {
    return this.pos >> 3;
  }
}

/**
 * Inteiro com SINAL-MAGNITUDE — a convenção do GRIB2, não complemento de dois.
 *
 * WMO FM 92, Regulamento 92.1.4: o bit mais significativo é o SINAL e os
 * demais são a MAGNITUDE. Não há complemento.
 *
 *   0x802A  ->  sinal negativo, magnitude 0x2A  ->  -42
 *
 * Lido como complemento de dois, o mesmo valor daria -32726. Isso não gera
 * erro em lugar nenhum: entra silenciosamente nos fatores de escala da seção 5
 * (valor = (R + X·2^E) / 10^D). Um expoente E = -2, corriqueiro no GFS, seria
 * lido como -32766, e 2^-32766 é zero — o campo inteiro sai zerado, e a tela
 * mostra "sem dado" como se fosse a atmosfera que estivesse vazia.
 *
 * `v * 256` em vez de `v << 8` pela mesma razão do BitReader: o deslocamento
 * trunca em 32 bits com sinal.
 */
function signedFromBytes(buf, off, len) {
  if (!len || len > 6) throw new Error(`signedFromBytes: len inválido ${len}`);
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  const signBit = Math.pow(2, len * 8 - 1);
  return v >= signBit ? -(v - signBit) : v;
}

function u8(b, o)  { return b[o]; }
function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
// `>>> 0` é obrigatório: sem ele, qualquer valor com o bit 31 ligado sai
// NEGATIVO (0xFF000010 vira -16.777.200). Comprimento de mensagem e número de
// pontos passam por aqui, e um negativo faz a varredura de seções sair do lugar
// — o sintoma foi "grade lida 4x0", uma grade sem linhas.
function u32(b, o) { return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0); }
function i16(b, o) { return signedFromBytes(b, o, 2); }
function i32(b, o) { return signedFromBytes(b, o, 4); }

function f32(b, o) {
  return new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
}

function readMessage(buf, start) {
  if (buf.length - start < 16) {
    throw new Error("buffer muito curto para header GRIB");
  }
  if (buf.toString("latin1", start, start + 4) !== "GRIB") {
    throw new Error("assinatura GRIB ausente");
  }
  const edition = u8(buf, start + 7);
  if (edition !== 2) throw new Error(`GRIB edição ${edition}, esperado 2`);
  const total = u32(buf, start + 12);
  if (total <= 16 || start + total > buf.length) {
    throw new Error(`comprimento GRIB inválido: ${total}`);
  }
  const end = start + total;
  const sec = {};
  let off = start + 16;

  while (off < end - 4) {
    if (buf.toString("latin1", off, off + 4) === "7777") break;
    const len = u32(buf, off);
    const num = u8(buf, off + 4);
    if (len <= 5 || off + len > end) {
      throw new Error(`seção ${num} com comprimento inválido ${len} em offset ${off}`);
    }
    sec[num] = { off, len };
    off += len;
  }
  return { start, end, total, sec };
}

// ⬅️ BUGFIX CRÍTICO: offsets corrigidos para GRIB2 Section 3 Template 0
function parseGrid(buf, s) {
  const o = s.off;
  // -------------------------------------------------------------------------
  // OCTETO É 1-BASED; DESLOCAMENTO É 0-BASED.
  //
  // A norma WMO numera os octetos a partir de 1, então o octeto N está em
  // `o + N - 1`. Ler o comentário "octetos 31-34" e escrever `o + 34` desloca
  // tudo em quatro bytes — e é uma confusão fácil, porque o número do último
  // octeto do campo parece o deslocamento do primeiro.
  //
  // Mapeamento conferido contra FM 92, Seção 3 e Gabarito 3.0:
  //
  //   nPoints   octetos  7-10  ->  o + 6
  //   template  octetos 13-14  ->  o + 12
  //   Ni        octetos 31-34  ->  o + 30
  //   Nj        octetos 35-38  ->  o + 34
  //   La1       octetos 47-50  ->  o + 46
  //   Lo1       octetos 51-54  ->  o + 50
  //   La2       octetos 56-59  ->  o + 55
  //   Lo2       octetos 60-63  ->  o + 59
  //   Di        octetos 64-67  ->  o + 63
  //   Dj        octetos 68-71  ->  o + 67
  //   scanMode  octeto     72  ->  o + 71
  // -------------------------------------------------------------------------
  const nPoints = u32(buf, o + 6);
  const tpl = u16(buf, o + 12);
  if (tpl !== 0) {
    throw new Error(`gabarito de grade 3.${tpl} não suportado (esperado 3.0, lat/lon regular)`);
  }
  const ni = u32(buf, o + 30);
  const nj = u32(buf, o + 34);
  const la1 = i32(buf, o + 46) / 1e6;
  const lo1 = i32(buf, o + 50) / 1e6;
  const la2 = i32(buf, o + 55) / 1e6;
  const lo2 = i32(buf, o + 59) / 1e6;
  const di = u32(buf, o + 63) / 1e6;
  const dj = u32(buf, o + 67) / 1e6;
  const scanMode = u8(buf, o + 71);

  return {
    ni, nj, nPoints, la1, lo1, la2, lo2, di, dj, scanMode,
    iNegative: !!(scanMode & 0x80),
    // Tabela de Bandeiras 3.4, bit 2 (0x40):
    //   0 = varredura em -j  (norte -> sul, primeira linha já é o norte)
    //   1 = varredura em +j  (sul -> norte, precisa inverter as linhas)
    // Portanto BIT LIGADO significa +j. A leitura invertida deixa o campo de
    // cabeça para baixo: o mapa continua plausível, só que com a Antártida no
    // topo — e num campo de vento oceânico isso passa despercebido.
    jPositive: !!(scanMode & 0x40),
    consecutiveJ: !!(scanMode & 0x20),
  };
}

function parseDrs(buf, s) {
  const o = s.off;
  const nValues = u32(buf, o + 5);
  const tpl = u16(buf, o + 9);
  const d = {
    tpl,
    nValues,
    R: f32(buf, o + 11),
    E: i16(buf, o + 15),
    D: i16(buf, o + 17),
    bits: u8(buf, o + 19),
    originalType: u8(buf, o + 20),
  };
  if (tpl === 0) return d;
  if (tpl !== 2 && tpl !== 3) {
    throw new Error(
      `gabarito de empacotamento 5.${tpl} não suportado ` +
      `(suportados: 5.0 simples, 5.2 complexo, 5.3 complexo com diferenciação)`
    );
  }
  d.groupSplit = u8(buf, o + 21);
  d.missingMgmt = u8(buf, o + 22);
  d.ng = u32(buf, o + 31);
  d.refGroupWidth = u8(buf, o + 35);
  d.bitsGroupWidth = u8(buf, o + 36);
  d.refGroupLength = u32(buf, o + 37);
  d.lengthIncrement = u8(buf, o + 41);
  d.lastGroupLength = u32(buf, o + 42);
  d.bitsGroupLength = u8(buf, o + 46);
  if (tpl === 3) {
    d.spatialOrder = u8(buf, o + 47);
    d.extraOctets = u8(buf, o + 48);
  }
  return d;
}

function unpackSimple(buf, s7, drs) {
  const br = new BitReader(buf, s7.off + 5);
  const out = new Float32Array(drs.nValues);
  const scaleE = Math.pow(2, drs.E);
  const scaleD = Math.pow(10, -drs.D);
  if (drs.bits === 0) {
    out.fill(drs.R * scaleD);
    return out;
  }
  for (let i = 0; i < drs.nValues; i++) {
    out[i] = (drs.R + br.read(drs.bits) * scaleE) * scaleD;
  }
  return out;
}

function unpackComplex(buf, s7, drs) {
  const br = new BitReader(buf, s7.off + 5);
  let ival1 = 0, ival2 = 0, minsd = 0;
  if (drs.tpl === 3 && drs.extraOctets > 0) {
    const nb = drs.extraOctets * 8;
    // REVERTIDO A PEDIDO: volta ao complemento de dois.
    //
    // ------------------------------------------------------------------------
    // REGISTRO DA DISCORDÂNCIA, para não se perder.
    //
    // Estes três valores semeiam a reconstrução por diferenciação espacial:
    // `ival1`/`ival2` são os primeiros pontos e `minsd` é o mínimo global das
    // diferenças. A reconstrução é uma RECORRÊNCIA — x[i] += 2·x[i-1] − x[i-2] —
    // então um erro na semente NÃO fica local: propaga linearmente ao longo de
    // 1.038.240 pontos e vira uma rampa que cresce sem limite.
    //
    // A norma (WMO FM 92, Reg. 92.1.4) especifica sinal-magnitude para inteiro
    // com sinal no GRIB2, e a g2clib do próprio NCEP lê estes campos assim:
    // um bit de sinal, depois (n−1) bits de magnitude, negando se o bit estiver
    // ligado. Foi por isso que troquei.
    //
    // Se o vento melhorar com o complemento de dois, a explicação provável é
    // que o problema esteja em OUTRO ponto do desempacotamento — largura de
    // grupo, comprimento de grupo ou alinhamento — e a semente errada estivesse
    // compensando parcialmente. Vale conferir com /api/wind/grib-debug antes de
    // fechar a questão.
    // ------------------------------------------------------------------------
    // SINAL-MAGNITUDE. Agora com prova, não com argumento de autoridade.
    //
    // `test/grib53.mjs` codifica um campo conhecido no gabarito 5.3 conforme a
    // norma e manda decodificar. Com complemento de dois, um `minsd` de −3 é
    // lido como −2.147.483.645, e a recorrência estoura o Int32Array em
    // −2.147.483.648 — o mesmo valor que aparecia no campo inteiro.
    //
    // Foi por isto que os testes nunca pegaram: eles cobriam só o gabarito 5.0
    // (empacotamento simples), que o GFS não usa. O caminho que roda em
    // produção não tinha teste nenhum.
    const rawSigned = (bits) => {
      const v = br.read(bits);
      const signBit = Math.pow(2, bits - 1);
      return v >= signBit ? -(v - signBit) : v;
    };
    ival1 = rawSigned(nb);
    if (drs.spatialOrder === 2) ival2 = rawSigned(nb);
    minsd = rawSigned(nb);
  }

  const refs = new Int32Array(drs.ng);
  for (let i = 0; i < drs.ng; i++) refs[i] = br.read(drs.bits);
  br.align();

  const widths = new Int32Array(drs.ng);
  for (let i = 0; i < drs.ng; i++) widths[i] = drs.refGroupWidth + br.read(drs.bitsGroupWidth);
  br.align();

  const lengths = new Int32Array(drs.ng);
  for (let i = 0; i < drs.ng; i++) {
    lengths[i] = drs.refGroupLength + br.read(drs.bitsGroupLength) * drs.lengthIncrement;
  }
  lengths[drs.ng - 1] = drs.lastGroupLength;
  br.align();

  const x = new Int32Array(drs.nValues);
  let k = 0;
  for (let g = 0; g < drs.ng; g++) {
    const w = widths[g];
    const n = Math.min(lengths[g], drs.nValues - k);
    if (w === 0) {
      for (let i = 0; i < n; i++) x[k++] = refs[g];
    } else {
      for (let i = 0; i < n; i++) x[k++] = refs[g] + br.read(w);
    }
    if (k >= drs.nValues) break;
  }

  if (drs.tpl === 3 && drs.spatialOrder > 0) {
    for (let i = 0; i < drs.nValues; i++) x[i] += minsd;
    if (drs.spatialOrder === 1) {
      x[0] = ival1;
      for (let i = 1; i < drs.nValues; i++) x[i] += x[i - 1];
    } else {
      x[0] = ival1;
      x[1] = ival2;
      for (let i = 2; i < drs.nValues; i++) x[i] += 2 * x[i - 1] - x[i - 2];
    }
  }

  const out = new Float32Array(drs.nValues);
  const scaleE = Math.pow(2, drs.E);
  const scaleD = Math.pow(10, -drs.D);
  for (let i = 0; i < drs.nValues; i++) out[i] = (drs.R + x[i] * scaleE) * scaleD;
  return out;
}

function applyBitmap(buf, s6, values, nPoints) {
  if (!s6) return values;
  const indicator = u8(buf, s6.off + 5);
  if (indicator === 255) return values;
  const br = new BitReader(buf, s6.off + 6);
  const out = new Float32Array(nPoints);
  let j = 0;
  for (let i = 0; i < nPoints; i++) {
    out[i] = br.read(1) ? values[j++] : NaN;
  }
  return out;
}

// ⬅️ BUGFIX: shift só para grades 0..360; não shifta grades já em -180..180
function reorient(values, grid) {
  const { ni, nj } = grid;
  const out = new Float32Array(ni * nj);
  const half = Math.round(180 / grid.di);
  // Grade 0..360 → converter para -180..180
  const needsShift = grid.lo1 >= 0 && grid.lo2 > 180;

  for (let row = 0; row < nj; row++) {
    const dstRow = grid.jPositive ? nj - 1 - row : row;
    for (let col = 0; col < ni; col++) {
      const srcCol = grid.iNegative ? ni - 1 - col : col;
      const src = grid.consecutiveJ ? srcCol * nj + row : row * ni + srcCol;
      const dstCol = needsShift ? (col + half) % ni : col;
      out[dstRow * ni + dstCol] = values[src];
    }
  }
  return out;
}

export function decodeGrib2(buf) {
  if (!buf || buf.length < 16) {
    throw new Error("buffer GRIB2 muito curto ou nulo");
  }
  const out = [];
  let off = 0;
  while (off < buf.length - 8) {
    if (buf.toString("latin1", off, off + 4) !== "GRIB") {
      off++;
      continue;
    }
    const msg = readMessage(buf, off);
    const grid = parseGrid(buf, msg.sec[3]);
    const drs = parseDrs(buf, msg.sec[5]);
    const s7 = msg.sec[7];
    if (!s7) throw new Error("mensagem sem seção 7 (dados)");

    let values = drs.tpl === 0 ? unpackSimple(buf, s7, drs) : unpackComplex(buf, s7, drs);
    values = applyBitmap(buf, msg.sec[6], values, grid.nPoints);

    const s4 = msg.sec[4];
    const discipline = u8(buf, msg.start + 6);
    const category = s4 ? u8(buf, s4.off + 9) : -1;
    const parameter = s4 ? u8(buf, s4.off + 10) : -1;

    // Estatísticas do campo ANTES de reorientar, para diagnóstico.
    // Custa uma passada linear e responde de imediato a pergunta que hoje só se
    // responde por tentativa: a escala está certa, ou o desempacotamento está?
    let vmin = Infinity, vmax = -Infinity, nan = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }

    out.push({
      discipline, category, parameter,
      grid,
      values: reorient(values, grid),
      packing: `5.${drs.tpl}`,
      /** parâmetros de escala e faixa observada — ver /api/wind/grib-debug */
      drs: {
        R: drs.R, E: drs.E, D: drs.D, bits: drs.bits,
        tpl: drs.tpl, ng: drs.ng ?? null,
        spatialOrder: drs.spatialOrder ?? null,
        extraOctets: drs.extraOctets ?? null,
        min: Number.isFinite(vmin) ? +vmin.toFixed(3) : null,
        max: Number.isFinite(vmax) ? +vmax.toFixed(3) : null,
        nan,
      },
    });
    off = msg.end;
  }
  if (!out.length) throw new Error("nenhuma mensagem GRIB2 encontrada");
  return out;
}

export const _internal = { BitReader, signedFromBytes, reorient };