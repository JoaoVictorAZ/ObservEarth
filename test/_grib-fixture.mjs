// test/_grib-fixture.mjs
// -----------------------------------------------------------------------------
// CONSTRUTOR DE MENSAGENS GRIB2 SINTETICAS, para teste.
//
// Estava dentro de test/grib2.mjs. Foi extraido quando um segundo teste (o dos
// campos escalares) passou a precisar do mesmo construtor: duas copias do
// gerador de fixtures divergem na primeira vez que alguem corrige um
// deslocamento de secao num lado so — e o teste que ficou para tras passa a
// validar um formato que nao existe.
//
// Escreve o gabarito 5.0 (empacotamento simples). O 5.2/5.3 (complexo, com
// diferenciacao espacial) e exercitado com dados reais em producao; aqui o que
// interessa e ter um GRIB2 valido e barato de montar.
// -----------------------------------------------------------------------------

export const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
export const be16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
/** GRIB2 usa sinal-magnitude, NAO complemento de dois */
export const sm16 = (n) => be16(n < 0 ? (Math.abs(n) | 0x8000) : n);
export const f32be = (v) => { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; };

/** empacota inteiros de largura fixa num fluxo de bits */
export function packBits(values, bits) {
  const out = [];
  let acc = 0, n = 0;
  for (const v of values) {
    for (let i = bits - 1; i >= 0; i--) {
      acc = (acc << 1) | ((v >> i) & 1);
      if (++n === 8) { out.push(acc & 0xff); acc = 0; n = 0; }
    }
  }
  if (n) out.push((acc << (8 - n)) & 0xff);
  return Buffer.from(out);
}

/**
 * Monta uma mensagem GRIB2 com empacotamento simples (gabarito 5.0).
 *
 * @param {number} ni  colunas
 * @param {number} nj  linhas
 * @param {ArrayLike<number>} ints  valores JA em inteiro empacotado
 * @param {object} [o]
 * @param {number} [o.category]   categoria do parametro (2 = momento, 6 = nuvem)
 * @param {number} [o.parameter]  numero do parametro dentro da categoria
 */
export function buildGrib(ni, nj, ints, o = {}) {
  const {
    bits = 12, R = 0, E = 0, D = 0, scanMode = 0, lo1 = 0,
    category = 2, parameter = 2,
  } = o;
  const n = ni * nj;

  const s3 = Buffer.concat([
    be32(72), Buffer.from([3]), Buffer.from([0]), be32(n),
    Buffer.from([0, 0]), be16(0),                 // gabarito 3.0
    Buffer.from([6]),                              // forma da Terra
    Buffer.from([0]), be32(0), Buffer.from([0]), be32(0), Buffer.from([0]), be32(0),
    be32(ni), be32(nj), be32(0), be32(0),
    be32(90e6), be32(lo1 * 1e6),                   // La1, Lo1
    Buffer.from([48]),                             // flags de resolucao
    be32(-90e6 >>> 0), be32(359e6),                // La2, Lo2
    be32(Math.round((360 / ni) * 1e6)),            // Di
    be32(Math.round((180 / (nj - 1)) * 1e6)),      // Dj
    Buffer.from([scanMode]),
  ]);

  const s4 = Buffer.concat([
    be32(35), Buffer.from([4]), be16(0), be16(0),
    Buffer.from([category, parameter]),
    Buffer.alloc(24),
  ]);

  const s5 = Buffer.concat([
    be32(21), Buffer.from([5]), be32(n), be16(0),  // gabarito 5.0
    f32be(R), sm16(E), sm16(D), Buffer.from([bits]), Buffer.from([0]),
  ]);

  const s6 = Buffer.concat([be32(6), Buffer.from([6]), Buffer.from([255])]);
  const data = packBits(ints, bits);
  const s7 = Buffer.concat([be32(5 + data.length), Buffer.from([7]), data]);

  const body = Buffer.concat([s3, s4, s5, s6, s7]);
  const total = 16 + body.length + 4;
  const s0 = Buffer.concat([
    Buffer.from("GRIB"), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([2]),
    be32(0), be32(total),
  ]);
  return Buffer.concat([s0, body, Buffer.from("7777")]);
}
