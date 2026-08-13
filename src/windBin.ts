// src/windBin.ts
// -----------------------------------------------------------------------------
// LEITURA DA GRADE BINÁRIA — o lado do navegador.
// -----------------------------------------------------------------------------
// O formato está descrito em `server/windBin.js`, que é quem escreve. Aqui só
// se lê, e a leitura é quase inteiramente de graça: `u` e `v` viram
// `Float32Array` APONTANDO PARA DENTRO do buffer que a rede entregou. Não há
// cópia, não há laço, não há `JSON.parse`.
//
// É essa ausência que importa. A versão em JSON custava 256 ms de thread
// principal parado por troca de hora — sem responder ao mouse e sem desenhar
// quadro. O `forecastPlayer` já convertia para Float32Array logo depois de
// receber, então o trabalho de montar um milhão de objetos `number` e desmontá-
// los de novo era puro desperdício.
// -----------------------------------------------------------------------------

import type { WindGrid } from "./tipos";

const MAGICA = 0x4457454f;   // "OEWD"
const VERSAO = 1;
const CABECALHO = 16;

/** Reconhece a resposta binária sem tentar decodificá-la. */
export function ehBinario(buf: ArrayBuffer): boolean {
  if (buf.byteLength < CABECALHO) return false;
  return new DataView(buf).getUint32(0, true) === MAGICA;
}

export function lerGradeBinaria(buf: ArrayBuffer): WindGrid {
  const dv = new DataView(buf);
  if (buf.byteLength < CABECALHO) throw new Error("resposta de vento truncada");
  if (dv.getUint32(0, true) !== MAGICA) throw new Error("assinatura de vento não confere");

  const versao = dv.getUint16(4, true);
  if (versao !== VERSAO) throw new Error(`formato de vento versão ${versao} desconhecido`);

  const metaLen = dv.getUint16(6, true);
  const nx = dv.getUint32(8, true);
  const ny = dv.getUint32(12, true);
  const n = nx * ny;

  if (nx <= 0 || ny <= 0) throw new Error(`grade inválida: ${nx}x${ny}`);

  const bruto = new TextDecoder().decode(new Uint8Array(buf, CABECALHO, metaLen));
  const meta = JSON.parse(bruto.replace(/\0+$/, "")) as Record<string, unknown> & { temValid?: boolean };

  let off = CABECALHO + metaLen;
  const esperado = off + n * 8 + (meta.temValid ? n : 0);
  if (buf.byteLength < esperado) {
    throw new Error(`vento truncado: ${buf.byteLength} bytes, esperados ${esperado}`);
  }

  // ZERO CÓPIA. O deslocamento é múltiplo de 4 porque o servidor completa os
  // metadados até o alinhamento — sem isso, isto aqui lançaria RangeError em
  // algumas respostas e funcionaria em outras.
  const u = new Float32Array(buf, off, n); off += n * 4;
  const v = new Float32Array(buf, off, n); off += n * 4;
  const valid = meta.temValid ? new Uint8Array(buf, off, n) : undefined;

  const { temValid: _t, ...resto } = meta;
  return { nx, ny, u, v, valid, ...resto } as WindGrid;
}

/**
 * Busca uma grade pedindo binário e aceitando JSON.
 *
 * O recuo não é decoração: se o servidor for mais antigo que o cliente — ou se
 * um intermediário reescrever a resposta — é melhor pagar os 256 ms do que não
 * mostrar vento nenhum.
 */
export async function buscarGrade(url: string): Promise<WindGrid> {
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}fmt=bin`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("application/octet-stream")) {
    return lerGradeBinaria(await r.arrayBuffer());
  }
  return (await r.json()) as WindGrid;
}
