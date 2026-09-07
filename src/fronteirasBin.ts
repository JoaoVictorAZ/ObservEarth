// src/fronteirasBin.ts
// -----------------------------------------------------------------------------
// LEITURA DAS FRONTEIRAS BINÁRIAS — o lado do navegador.
// -----------------------------------------------------------------------------
// O formato está descrito em `server/fronteiras.js`, que é quem escreve. Aqui
// só se lê, e a leitura aponta para dentro do buffer recebido: comprimentos,
// classes e coordenadas viram vistas tipadas sem cópia, do mesmo jeito que
// `src/windBin.ts` e `src/campoBin.ts` fazem com as grades.
//
// A diferença é o que vem depois. Uma grade é consumida como está; uma
// polilinha precisa virar PARES DE PONTOS para o `LineSegments` do three.js.
// Essa expansão é o único laço deste arquivo, e ela acontece uma vez por tile
// — não por quadro.
// -----------------------------------------------------------------------------

const MAGICA = 0x5246454f;   // "OEFR"
const VERSAO = 1;
const CABECALHO = 16;

/** classes de linha, iguais às de `server/fronteiras.js` */
export const COSTA = 0;
export const PAIS = 1;
export const ESTADO = 2;

export interface Fronteiras {
  /** comprimento de cada polilinha, em pontos */
  comprimentos: Uint32Array;
  /** classe de cada polilinha: costa, país ou estado */
  classes: Uint8Array;
  /** coordenadas intercaladas: lng, lat, lng, lat… */
  coordenadas: Float32Array;
  linhas: number;
  pontos: number;
  meta: Record<string, unknown>;
}

const alinhar4 = (n: number) => (n + 3) & ~3;

export function lerFronteiras(buf: ArrayBuffer): Fronteiras {
  if (buf.byteLength < CABECALHO) throw new Error("resposta de fronteira truncada");
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGICA) throw new Error("assinatura de fronteira não confere");

  const versao = dv.getUint16(4, true);
  if (versao !== VERSAO) throw new Error(`fronteira versão ${versao} desconhecida`);

  const metaLen = dv.getUint16(6, true);
  const linhas = dv.getUint32(8, true);
  const pontos = dv.getUint32(12, true);

  let off = CABECALHO + metaLen;
  const esperado = off + linhas * 4 + alinhar4(linhas) + pontos * 8;
  if (buf.byteLength < esperado) {
    throw new Error(`fronteira truncada: ${buf.byteLength} bytes, esperados ${esperado}`);
  }

  const bruto = new TextDecoder().decode(new Uint8Array(buf, CABECALHO, metaLen));
  const meta = JSON.parse(bruto.replace(/\0+$/, "") || "{}") as Record<string, unknown>;

  const comprimentos = new Uint32Array(buf, off, linhas);
  off += linhas * 4;
  const classes = new Uint8Array(buf, off, linhas);
  off += alinhar4(linhas);
  const coordenadas = new Float32Array(buf, off, pontos * 2);

  return { comprimentos, classes, coordenadas, linhas, pontos, meta };
}

/**
 * Quantos SEGMENTOS uma coleção de polilinhas produz.
 *
 * Uma linha de N pontos tem N−1 segmentos. Guardar polilinha em vez de segmento
 * solto é o que evita duplicar cada vértice interno na rede — e esta conta é o
 * preço, pago uma vez por tile.
 */
export function contarSegmentos(comprimentos: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < comprimentos.length; i++) n += Math.max(0, comprimentos[i] - 1);
  return n;
}

export async function buscarFronteiras(url: string): Promise<Fronteiras> {
  const r = await fetch(url);
  if (!r.ok) {
    let detalhe = `HTTP ${r.status}`;
    try {
      const j = await r.json() as { error?: string };
      if (j?.error) detalhe = j.error;
    } catch { /* corpo não era JSON; fica o status */ }
    throw new Error(detalhe);
  }
  return lerFronteiras(await r.arrayBuffer());
}
