// src/campoBin.ts
// -----------------------------------------------------------------------------
// LEITURA DO CAMPO ESCALAR BINÁRIO — o lado do navegador.
// -----------------------------------------------------------------------------
// O formato está descrito em `server/campoBin.js`, que é quem escreve. Aqui só
// se lê, e a leitura é de graça: cada plano vira um `Float32Array` APONTANDO
// PARA DENTRO do buffer que a rede entregou. Sem cópia, sem laço, sem
// `JSON.parse` de um milhão de números.
//
// É a mesma economia que `src/windBin.ts` já fazia para o vento, e o motivo é
// o mesmo: 1.038.240 valores em JSON custam ~256 ms de thread principal PARADO
// — sem responder ao mouse e sem desenhar quadro. Numa camada que se pretende
// recalcular a cada hora da linha do tempo, isso seria a diferença entre
// navegável e inutilizável.
// -----------------------------------------------------------------------------

const MAGICA = 0x4653454f;   // "OESF"
const VERSAO = 1;
const CABECALHO = 16;

/** Uma grade equirretangular com k planos de valores sobre ela. */
export interface CampoBinario {
  nx: number;
  ny: number;
  /** nome da variável → valores, na ordem em que vieram no buffer */
  planos: Record<string, Float32Array>;
  /** 1 = medido, 0 = ausente. Ausente NÃO é zero — ver server/campoBin.js */
  valido?: Uint8Array;
  [extra: string]: unknown;
}

/** Reconhece a resposta binária sem tentar decodificá-la. */
export function ehCampoBinario(buf: ArrayBuffer): boolean {
  if (buf.byteLength < CABECALHO) return false;
  return new DataView(buf).getUint32(0, true) === MAGICA;
}

export function lerCampoBinario(buf: ArrayBuffer): CampoBinario {
  if (buf.byteLength < CABECALHO) throw new Error("resposta de campo truncada");
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGICA) throw new Error("assinatura de campo não confere");

  const versao = dv.getUint16(4, true);
  if (versao !== VERSAO) throw new Error(`formato de campo versão ${versao} desconhecido`);

  const metaLen = dv.getUint16(6, true);
  const nx = dv.getUint32(8, true);
  const ny = dv.getUint32(12, true);
  const n = nx * ny;
  if (nx <= 0 || ny <= 0) throw new Error(`grade inválida: ${nx}x${ny}`);

  const bruto = new TextDecoder().decode(new Uint8Array(buf, CABECALHO, metaLen));
  const meta = JSON.parse(bruto.replace(/\0+$/, "")) as
    Record<string, unknown> & { planos: string[]; temValido?: boolean };

  if (!Array.isArray(meta.planos) || !meta.planos.length) {
    throw new Error("campo sem nenhum plano declarado nos metadados");
  }

  let off = CABECALHO + metaLen;
  // A CONFERÊNCIA DE TAMANHO VEM ANTES DA PRIMEIRA VISTA. `new Float32Array`
  // sobre um buffer curto lança RangeError com uma mensagem que não diz nada
  // sobre campo nem sobre rede; melhor falhar dizendo o que faltou.
  const esperado = off + meta.planos.length * n * 4 + (meta.temValido ? n : 0);
  if (buf.byteLength < esperado) {
    throw new Error(`campo truncado: ${buf.byteLength} bytes, esperados ${esperado}`);
  }

  const planos: Record<string, Float32Array> = {};
  for (const nome of meta.planos) {
    planos[nome] = new Float32Array(buf, off, n);
    off += n * 4;
  }
  const valido = meta.temValido ? new Uint8Array(buf, off, n) : undefined;

  const { planos: _p, temValido: _t, ...resto } = meta;
  return { nx, ny, planos, valido, ...resto };
}

/**
 * Busca um campo pedindo binário e aceitando JSON.
 *
 * O recuo existe pelo mesmo motivo do vento: cliente novo com servidor antigo
 * deve degradar, não quebrar.
 */
export async function buscarCampo(url: string): Promise<CampoBinario> {
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}fmt=bin`);
  if (!r.ok) {
    let detalhe = `HTTP ${r.status}`;
    try {
      const j = await r.json() as { error?: string };
      if (j?.error) detalhe = j.error;
    } catch { /* corpo não era JSON; fica o status */ }
    throw new Error(detalhe);
  }

  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("application/octet-stream")) {
    return lerCampoBinario(await r.arrayBuffer());
  }
  return (await r.json()) as CampoBinario;
}
