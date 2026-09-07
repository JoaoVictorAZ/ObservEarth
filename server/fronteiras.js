import { alinhar4 } from "./windBin.js";

const CDN = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson";
const FONTES = {
  "110m": {
    costa: `${CDN}/ne_110m_coastline.geojson`,
    paises: `${CDN}/ne_110m_admin_0_boundary_lines_land.geojson`,
    estados: null,
  },
  "50m": {
    costa: `${CDN}/ne_50m_coastline.geojson`,
    paises: `${CDN}/ne_50m_admin_0_boundary_lines_land.geojson`,
    estados: `${CDN}/ne_50m_admin_1_states_provinces_lines.geojson`,
  },
  "10m": {
    costa: `${CDN}/ne_10m_coastline.geojson`,
    paises: `${CDN}/ne_10m_admin_0_boundary_lines_land.geojson`,
    estados: `${CDN}/ne_50m_admin_1_states_provinces_lines.geojson`,
  },
};

export const COSTA = 0;
export const PAIS = 1;
export const ESTADO = 2;

export function planoDoNivel(z) {
  const bruto = Number(z);
  const nz = Number.isFinite(bruto) ? Math.max(0, Math.min(7, Math.floor(bruto))) : 0;
  const res = nz <= 2 ? "110m" : nz <= 4 ? "50m" : "10m";
  const grausPorPixel = 360 / (2 ** (nz + 1) * 512);
  return { res, tol: grausPorPixel * 0.5, estados: nz >= 3 };
}

export function simplificar(pontos, tol) {
  if (pontos.length < 3 || tol <= 0) return pontos;

  const manter = new Uint8Array(pontos.length);
  manter[0] = 1;
  manter[pontos.length - 1] = 1;

  const pilha = [[0, pontos.length - 1]];
  const tol2 = tol * tol;

  while (pilha.length) {
    const [ini, fim] = pilha.pop();
    if (fim - ini < 2) continue;

    const [ax, ay] = pontos[ini];
    const [bx, by] = pontos[fim];
    const dx = bx - ax, dy = by - ay;
    const den = dx * dx + dy * dy;

    let pior = 0, idx = -1;
    for (let i = ini + 1; i < fim; i++) {
      const [px, py] = pontos[i];
      let d;
      if (den === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / den;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > pior) { pior = d; idx = i; }
    }

    if (pior > tol2 && idx > 0) {
      manter[idx] = 1;
      pilha.push([ini, idx], [idx, fim]);
    }
  }

  const fora = [];
  for (let i = 0; i < pontos.length; i++) if (manter[i]) fora.push(pontos[i]);
  return fora;
}

/** Extrai as polilinhas de uma geometria GeoJSON de linha. */
function linhasDe(geom) {
  if (!geom) return [];
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

const memFonte = new Map();     // url -> GeoJSON
const memNivel = new Map();     // "res|tol" -> [{ classe, pontos, bbox }]

async function baixar(fetchImpl, url) {
  if (memFonte.has(url)) return memFonte.get(url);
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Natural Earth HTTP ${r.status} em ${url}`);
  const gj = await r.json();
  memFonte.set(url, gj);
  return gj;
}

function bboxDaLinha(pontos) {
  let o = Infinity, l = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of pontos) {
    if (x < o) o = x; if (x > l) l = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [o, s, l, n];
}

export async function conjuntoDoNivel(fetchImpl, z) {
  const { res, tol, estados } = planoDoNivel(z);
  const chave = `${res}|${tol.toFixed(6)}|${estados ? 1 : 0}`;
  if (memNivel.has(chave)) return memNivel.get(chave);

  const f = FONTES[res];
  const pedidos = [
    [COSTA, f.costa],
    [PAIS, f.paises],
    ...(estados && f.estados ? [[ESTADO, f.estados]] : []),
  ];

  const saida = [];
  for (const [classe, url] of pedidos) {
    const gj = await baixar(fetchImpl, url);
    for (const feicao of gj.features ?? []) {
      for (const bruta of linhasDe(feicao.geometry)) {
        const pontos = simplificar(bruta, tol);
        // Uma linha de um ponto só não desenha nada e ocupa banda.
        if (pontos.length < 2) continue;
        saida.push({ classe, pontos, bbox: bboxDaLinha(pontos) });
      }
    }
  }

  memNivel.set(chave, saida);
  return saida;
}

export function recortar(linhas, bbox, margem = 0) {
  const [o0, s0, l0, n0] = bbox;
  const o = o0 - margem, s = s0 - margem, l = l0 + margem, n = n0 + margem;
  const fora = [];

  for (const linha of linhas) {
    const [lo, ls, ll, ln] = linha.bbox;
    if (ll < o || lo > l || ln < s || ls > n) continue;    // nem encosta

    const p = linha.pontos;
    let corrente = null;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      const cruza = Math.max(ax, bx) >= o && Math.min(ax, bx) <= l
        && Math.max(ay, by) >= s && Math.min(ay, by) <= n;
      if (cruza) {
        if (!corrente) { corrente = [p[i]]; }
        corrente.push(p[i + 1]);
      } else if (corrente) {
        fora.push({ classe: linha.classe, pontos: corrente });
        corrente = null;
      }
    }
    if (corrente) fora.push({ classe: linha.classe, pontos: corrente });
  }
  return fora;
}

export const MAGICA = 0x5246454f;   // "OEFR"
export const VERSAO = 1;
export const CABECALHO = 16;

export function empacotarFronteiras(linhas, meta = {}) {
  const nLinhas = linhas.length;
  let nPontos = 0;
  for (const l of linhas) nPontos += l.pontos.length;

  const metaBuf = Buffer.from(JSON.stringify(meta), "utf8");
  const metaAl = alinhar4(metaBuf.length);
  const compAl = nLinhas * 4;
  const classeAl = alinhar4(nLinhas);

  const bytes = CABECALHO + metaAl + compAl + classeAl + nPontos * 8;
  const buf = Buffer.alloc(bytes);

  buf.writeUInt32LE(MAGICA, 0);
  buf.writeUInt16LE(VERSAO, 4);
  buf.writeUInt16LE(metaAl, 6);
  buf.writeUInt32LE(nLinhas, 8);
  buf.writeUInt32LE(nPontos, 12);
  metaBuf.copy(buf, CABECALHO);

  let off = CABECALHO + metaAl;
  const comp = new Uint32Array(buf.buffer, buf.byteOffset + off, nLinhas);
  off += compAl;
  const classes = new Uint8Array(buf.buffer, buf.byteOffset + off, nLinhas);
  off += classeAl;
  const coords = new Float32Array(buf.buffer, buf.byteOffset + off, nPontos * 2);

  let p = 0;
  for (let i = 0; i < nLinhas; i++) {
    comp[i] = linhas[i].pontos.length;
    classes[i] = linhas[i].classe;
    for (const [x, y] of linhas[i].pontos) {
      coords[p++] = x;
      coords[p++] = y;
    }
  }
  return buf;
}

/** Existe para o TESTE conferir a ida e a volta; o cliente tem a sua versão. */
export function desempacotarFronteiras(buf) {
  if (buf.byteLength < CABECALHO) throw new Error("buffer curto demais");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGICA) throw new Error("assinatura não confere");
  const versao = dv.getUint16(4, true);
  if (versao !== VERSAO) throw new Error(`versão ${versao} desconhecida`);

  const metaLen = dv.getUint16(6, true);
  const nLinhas = dv.getUint32(8, true);
  const nPontos = dv.getUint32(12, true);

  const meta = JSON.parse(
    Buffer.from(buf.buffer, buf.byteOffset + CABECALHO, metaLen)
      .toString("utf8").replace(/\0+$/, "") || "{}",
  );

  let off = CABECALHO + metaLen;
  const comp = new Uint32Array(buf.buffer, buf.byteOffset + off, nLinhas);
  off += nLinhas * 4;
  const classes = new Uint8Array(buf.buffer, buf.byteOffset + off, nLinhas);
  off += alinhar4(nLinhas);
  const coords = new Float32Array(buf.buffer, buf.byteOffset + off, nPontos * 2);

  const linhas = [];
  let p = 0;
  for (let i = 0; i < nLinhas; i++) {
    const pontos = [];
    for (let k = 0; k < comp[i]; k++) { pontos.push([coords[p], coords[p + 1]]); p += 2; }
    linhas.push({ classe: classes[i], pontos });
  }
  return { linhas, meta, nPontos };
}

/** Monta o tile pronto para a rota. */
export async function construirTile(fetchImpl, z, bbox, margem) {
  const conjunto = await conjuntoDoNivel(fetchImpl, z);
  const linhas = recortar(conjunto, bbox, margem);
  const plano = planoDoNivel(z);
  let pontos = 0;
  for (const l of linhas) pontos += l.pontos.length;
  return empacotarFronteiras(linhas, {
    z,
    resolucao: plano.res,
    toleranciaGraus: +plano.tol.toFixed(6),
    comEstados: plano.estados,
    linhas: linhas.length,
    pontos,
    fonte: "Natural Earth via jsDelivr",
  });
}
