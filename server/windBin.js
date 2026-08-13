// server/windBin.js
// -----------------------------------------------------------------------------
// A GRADE DE VENTO EM BINÁRIO
// -----------------------------------------------------------------------------
// MEDIDO, não estimado. Uma grade do GFS a 0,25° tem 1440×721 = 1.038.240
// pontos por componente:
//
//   JSON      39,6 MB   ·  401 ms para serializar  ·  256 ms para o navegador ler
//   binário    8,3 MB   ·  ~0 ms                   ·  ~0 ms
//
// Os 256 ms não são "lentidão": são o thread principal do navegador PARADO,
// sem responder a mouse nem desenhar quadro, uma vez a cada troca de hora na
// linha do tempo. E os 39,6 MB atravessam a rede para transportar dígitos
// decimais em texto — "-7.234375" ocupa nove bytes onde quatro bastam.
//
// O ganho vem de dois lugares. Texto vira número (79% menos bytes), e a
// travessia deixa de existir: no cliente, os componentes viram
// `Float32Array` apontando para dentro do próprio buffer recebido, sem cópia e
// sem laço.
//
// FORMATO (tudo little-endian, que é o que Intel, AMD e ARM usam)
//
//   0  "OEWD"                 4 bytes, para não decodificar lixo por engano
//   4  versão                 uint16
//   6  bytes de metadados     uint16
//   8  nx                     uint32
//  12  ny                     uint32
//  16  metadados              JSON UTF-8, COMPLETADO até múltiplo de 4
//   …  u                      float32 × nx·ny
//   …  v                      float32 × nx·ny
//   …  valid                  uint8   × nx·ny   (só se declarado nos metadados)
//
// O COMPLETO ATÉ MÚLTIPLO DE 4 não é capricho. `new Float32Array(buffer, off)`
// lança RangeError se `off` não for múltiplo de 4, e o tamanho do JSON de
// metadados varia com o nome do provedor. Sem o alinhamento, a decodificação
// quebraria em algumas respostas e funcionaria em outras — o pior tipo de bug.
// -----------------------------------------------------------------------------

export const MAGICA = 0x4457454f;   // "OEWD" lido como uint32 little-endian
export const VERSAO = 1;
export const CABECALHO = 16;

/** Arredonda para cima até o próximo múltiplo de 4. */
export const alinhar4 = (n) => (n + 3) & ~3;

/**
 * Serializa uma grade. Devolve Buffer.
 *
 * Aceita array comum ou TypedArray nos componentes: o servidor monta a grade
 * com `Array.from(...)` em alguns caminhos e com Float32Array em outros.
 */
export function empacotar(grade) {
  const nx = Number(grade?.nx), ny = Number(grade?.ny);
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx <= 0 || ny <= 0) {
    throw new Error(`grade inválida: nx=${grade?.nx} ny=${grade?.ny}`);
  }
  const n = nx * ny;
  if (!grade.u || !grade.v || grade.u.length < n || grade.v.length < n) {
    throw new Error(`u/v não cobrem ${n} pontos`);
  }

  const temValid = !!grade.valid && grade.valid.length >= n;

  // Tudo que NÃO é grade vai como metadados. Inclusive a procedência, que a
  // tela precisa ler para não afirmar uma fonte que não é a que chegou.
  const { u: _u, v: _v, valid: _valid, nx: _nx, ny: _ny, ...resto } = grade;
  const meta = Buffer.from(JSON.stringify({ ...resto, temValid }), "utf8");
  const metaAlinhado = alinhar4(meta.length);

  const bytes = CABECALHO + metaAlinhado + n * 4 + n * 4 + (temValid ? n : 0);
  const buf = Buffer.alloc(bytes);

  buf.writeUInt32LE(MAGICA, 0);
  buf.writeUInt16LE(VERSAO, 4);
  buf.writeUInt16LE(metaAlinhado, 6);
  buf.writeUInt32LE(nx, 8);
  buf.writeUInt32LE(ny, 12);
  meta.copy(buf, CABECALHO);

  let off = CABECALHO + metaAlinhado;
  const u = new Float32Array(buf.buffer, buf.byteOffset + off, n);
  for (let i = 0; i < n; i++) u[i] = grade.u[i];
  off += n * 4;
  const v = new Float32Array(buf.buffer, buf.byteOffset + off, n);
  for (let i = 0; i < n; i++) v[i] = grade.v[i];
  off += n * 4;

  if (temValid) {
    const val = new Uint8Array(buf.buffer, buf.byteOffset + off, n);
    for (let i = 0; i < n; i++) val[i] = grade.valid[i] ? 1 : 0;
  }
  return buf;
}

/**
 * Desempacota — existe para o TESTE poder conferir a ida e a volta sem
 * navegador. O cliente tem a sua própria versão, em `src/windBin.ts`, e
 * `test/wind-bin.mjs` compara as duas.
 */
export function desempacotar(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < CABECALHO) throw new Error("buffer curto demais");
  if (dv.getUint32(0, true) !== MAGICA) throw new Error("assinatura não confere");
  const versao = dv.getUint16(4, true);
  if (versao !== VERSAO) throw new Error(`versão ${versao} desconhecida`);

  const metaLen = dv.getUint16(6, true);
  const nx = dv.getUint32(8, true);
  const ny = dv.getUint32(12, true);
  const n = nx * ny;

  const meta = JSON.parse(
    Buffer.from(buf.buffer, buf.byteOffset + CABECALHO, metaLen)
      .toString("utf8").replace(/\0+$/, ""),
  );

  let off = CABECALHO + metaLen;
  const u = new Float32Array(buf.buffer, buf.byteOffset + off, n); off += n * 4;
  const v = new Float32Array(buf.buffer, buf.byteOffset + off, n); off += n * 4;
  const valid = meta.temValid
    ? new Uint8Array(buf.buffer, buf.byteOffset + off, n)
    : undefined;

  const { temValid: _t, ...resto } = meta;
  return { nx, ny, u, v, valid, ...resto };
}
