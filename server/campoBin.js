import { alinhar4 } from "./windBin.js";

export const MAGICA = 0x4653454f;   // "OESF" lido como uint32 little-endian
export const VERSAO = 1;
export const CABECALHO = 16;

/**
 * Serializa um campo de k planos sobre a MESMA grade. Devolve Buffer.
 *
 * @param {{nx:number, ny:number, planos:Record<string, ArrayLike<number>>,
 *          valido?:ArrayLike<number>}} campo
 */
export function empacotarCampo(campo) {
  const nx = Number(campo?.nx), ny = Number(campo?.ny);
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx <= 0 || ny <= 0) {
    throw new Error(`grade inválida: nx=${campo?.nx} ny=${campo?.ny}`);
  }
  const n = nx * ny;

  const nomes = Object.keys(campo.planos ?? {});
  if (!nomes.length) throw new Error("campo sem nenhum plano");
  for (const nome of nomes) {
    const p = campo.planos[nome];
    if (!p || p.length < n) {
      throw new Error(`plano "${nome}" não cobre ${n} pontos (tem ${p?.length ?? 0})`);
    }
  }

  const temValido = !!campo.valido && campo.valido.length >= n;
  const { planos: _p, valido: _v, nx: _nx, ny: _ny, ...resto } = campo;
  const meta = Buffer.from(
    JSON.stringify({ ...resto, planos: nomes, temValido }), "utf8",
  );
  const metaAlinhado = alinhar4(meta.length);

  const bytes = CABECALHO + metaAlinhado + nomes.length * n * 4 + (temValido ? n : 0);
  const buf = Buffer.alloc(bytes);

  buf.writeUInt32LE(MAGICA, 0);
  buf.writeUInt16LE(VERSAO, 4);
  buf.writeUInt16LE(metaAlinhado, 6);
  buf.writeUInt32LE(nx, 8);
  buf.writeUInt32LE(ny, 12);
  meta.copy(buf, CABECALHO);

  let off = CABECALHO + metaAlinhado;
  for (const nome of nomes) {
    const origem = campo.planos[nome];
    const destino = new Float32Array(buf.buffer, buf.byteOffset + off, n);
    for (let i = 0; i < n; i++) destino[i] = origem[i];
    off += n * 4;
  }

  if (temValido) {
    const val = new Uint8Array(buf.buffer, buf.byteOffset + off, n);
    for (let i = 0; i < n; i++) val[i] = campo.valido[i] ? 1 : 0;
  }
  return buf;
}

export function desempacotarCampo(buf) {
  if (buf.byteLength < CABECALHO) throw new Error("buffer curto demais");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
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
  const planos = {};
  for (const nome of meta.planos) {
    planos[nome] = new Float32Array(buf.buffer, buf.byteOffset + off, n);
    off += n * 4;
  }
  const valido = meta.temValido
    ? new Uint8Array(buf.buffer, buf.byteOffset + off, n)
    : undefined;

  const { planos: _p, temValido: _t, ...resto } = meta;
  return { nx, ny, planos, valido, ...resto };
}
