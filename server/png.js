// server/png.js
// -----------------------------------------------------------------------------
// CODIFICADOR PNG, SEM DEPENDENCIA.
//
// POR QUE ESCREVER ISTO EM VEZ DE INSTALAR UMA BIBLIOTECA
// O campo do GFS chega como 1.038.240 numeros. Mandar isso ao navegador como
// JSON sao ~16 MB por camada por fatia — inviavel. Como PNG equirretangular,
// o mesmo campo cabe em algumas centenas de kB, e o cliente ja sabe desenhar
// PNG no globo: e exatamente o caminho que as imagens do GIBS ja percorrem.
//
// PNG e um formato simples quando se escreve apenas o subconjunto necessario:
// assinatura, IHDR, IDAT (deflate, que o `node:zlib` faz) e IEND, com CRC-32
// por bloco. Sao ~120 linhas contra uma arvore de dependencias que teria de ser
// auditada e mantida. O projeto ja tomou essa decisao no decodificador GRIB2,
// e pelo mesmo motivo.
//
// Referencia: PNG (Portable Network Graphics) Specification, W3C REC-png-20031110.
// -----------------------------------------------------------------------------

import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Tabela do CRC-32 do PNG (polinomio 0xEDB88320, o mesmo do zip).
 * Precalculada uma vez: sao 256 entradas contra 8 operacoes por byte de imagem.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** bloco PNG: tamanho, tipo, dados, CRC sobre tipo+dados */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/**
 * Aplica o filtro por linha antes do deflate.
 *
 * PNG permite escolher um filtro por SCANLINE. Sem filtro nenhum (tipo 0) o
 * deflate ainda comprime, mas mal: um campo meteorologico varia pouco entre
 * pixels vizinhos, e o que comprime bem nao e o valor absoluto e sim a
 * DIFERENCA.
 *
 * Usamos "Up" (tipo 2), a diferenca em relacao a linha de cima. Campos
 * atmosfericos sao suaves na vertical em escala planetaria, entao a maioria dos
 * bytes vira zero ou proximo de zero — que e onde o deflate brilha. "Sub"
 * (horizontal) daria resultado parecido; "Paeth" comprimiria um pouco mais e
 * custaria bem mais CPU, o que nao compensa num campo que e recalculado a cada
 * 6 h e depois servido do cache.
 */
function filterUp(rows, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    out[o] = 2;                                   // tipo do filtro: Up
    const cur = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const above = y === 0 ? 0 : rows[prev + x];
      out[o + 1 + x] = (rows[cur + x] - above) & 0xff;
    }
  }
  return out;
}

/**
 * Escreve um PNG RGBA de 8 bits.
 *
 * @param {Uint8Array} rgba  w*h*4 bytes, linha por linha, de cima para baixo
 * @param {number} w
 * @param {number} h
 * @param {object} [opts]
 * @param {number} [opts.level]  nivel do deflate (0-9)
 * @param {Record<string,string>} [opts.text]  metadados tEXt, ex. proveniencia
 */
export function encodePNG(rgba, w, h, opts = {}) {
  if (rgba.length !== w * h * 4) {
    throw new Error(`buffer de ${rgba.length} bytes não corresponde a ${w}x${h} RGBA`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;        // bits por canal
  ihdr[9] = 6;        // tipo de cor 6 = RGBA
  ihdr[10] = 0;       // compressao: deflate (unico permitido)
  ihdr[11] = 0;       // filtro: metodo padrao
  ihdr[12] = 0;       // entrelacamento: nenhum

  const parts = [SIGNATURE, chunk("IHDR", ihdr)];

  // tEXt: a proveniencia viaja DENTRO do arquivo. Uma imagem salva da tela
  // continua dizendo de que ciclo do modelo ela veio — sem isso, um PNG solto
  // numa pasta é indistinguível de qualquer outro e não serve de figura citável.
  for (const [k, v] of Object.entries(opts.text ?? {})) {
    parts.push(chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")));
  }

  const filtered = filterUp(rgba, w, h, 4);
  const deflated = zlib.deflateSync(filtered, { level: opts.level ?? 6 });
  parts.push(chunk("IDAT", deflated), chunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(parts);
}

/**
 * Le de volta um PNG produzido aqui. Existe para TESTE: um codificador so esta
 * certo se algo independente conseguir ler o que ele escreveu. Cobre apenas o
 * subconjunto que geramos (RGBA 8 bits, sem entrelacamento).
 */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("assinatura PNG inválida");

  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  const text = {};

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);

    const esperado = crc32(Buffer.concat([Buffer.from(type, "latin1"), data]));
    if (crc !== esperado) throw new Error(`CRC inválido no bloco ${type}`);

    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      if (data[12] !== 0) throw new Error("PNG entrelaçado não suportado");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "tEXt") {
      const s = data.toString("latin1");
      const i = s.indexOf("\0");
      text[s.slice(0, i)] = s.slice(i + 1);
    } else if (type === "IEND") break;

    off += 12 + len;
  }

  if (depth !== 8 || color !== 6) throw new Error(`só RGBA 8 bits (veio ${depth}/${color})`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(stride * h);

  // desfaz os filtros por linha
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;         // esquerda
      const b = y > 0 ? out[dst - stride + x] : 0;          // acima
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      let r;
      switch (ft) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {                                          // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`filtro desconhecido: ${ft}`);
      }
      out[dst + x] = r & 0xff;
    }
  }

  return { width: w, height: h, rgba: out, text };
}
