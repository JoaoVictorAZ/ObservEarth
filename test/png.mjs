// test/png.mjs
// -----------------------------------------------------------------------------
// Codificador PNG proprio.
//
// Um codificador so esta certo se algo INDEPENDENTE conseguir ler o que ele
// escreveu. Aqui a independencia vem de tres lados:
//
//   - o `node:zlib` descomprime o IDAT (nao e codigo nosso);
//   - o CRC-32 e conferido contra o vetor de teste padrao do CRC-32 IEEE,
//     que existe fora deste projeto;
//   - a desfiltragem no decodificador usa os quatro tipos de filtro do
//     formato, nao so o que o codificador emite.
//
// Sem isso, o teste seria "meu codigo concorda com meu codigo".
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import zlib from "node:zlib";
import { encodePNG, decodePNG, crc32 } from "../server/png.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ncodificador PNG");

ok("CRC-32 bate com o vetor de teste padrão", () => {
  // valor de conferência canônico do CRC-32/ISO-HDLC para a cadeia "123456789",
  // publicado no catálogo de CRCs e independente deste projeto
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

ok("cabeçalho tem assinatura e IHDR corretos", () => {
  const png = encodePNG(new Uint8Array(4 * 4 * 4), 4, 4);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 4);      // largura
  assert.equal(png.readUInt32BE(20), 4);      // altura
  assert.equal(png[24], 8, "8 bits por canal");
  assert.equal(png[25], 6, "tipo de cor RGBA");
  assert.equal(png.toString("latin1", png.length - 8, png.length - 4), "IEND");
});

ok("ida e volta preserva cada pixel, exatamente", () => {
  const w = 61, h = 37;                        // primos: pega erro de stride
  const src = new Uint8Array(w * h * 4);
  for (let i = 0; i < src.length; i++) src[i] = (i * 37 + (i >> 5)) & 0xff;

  const back = decodePNG(encodePNG(src, w, h));
  assert.equal(back.width, w);
  assert.equal(back.height, h);
  assert.deepEqual([...back.rgba], [...src], "algum pixel mudou na ida e volta");
});

ok("o zlib externo lê nosso IDAT", () => {
  // A prova de que o fluxo comprimido é deflate válido não pode vir do nosso
  // decodificador: vem do zlib do Node, que não é código deste projeto.
  const w = 16, h = 8;
  const src = new Uint8Array(w * h * 4).fill(0x7f);
  const png = encodePNG(src, w, h);

  let off = 8, idat = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") { idat = png.subarray(off + 8, off + 8 + len); break; }
    off += 12 + len;
  }
  assert.ok(idat, "IDAT não encontrado");
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, (w * 4 + 1) * h, "tamanho do fluxo cru não confere");
  assert.equal(raw[0], 2, "primeira linha deveria usar o filtro Up");
});

ok("CRC corrompido é detectado", () => {
  const png = encodePNG(new Uint8Array(2 * 2 * 4), 2, 2);
  const ruim = Buffer.from(png);
  ruim[ruim.length - 6] ^= 0xff;              // mexe nos dados do IEND/IDAT
  assert.throws(() => decodePNG(ruim), /CRC inválido|filtro desconhecido/);
});

ok("dimensões inconsistentes são recusadas na entrada", () => {
  assert.throws(() => encodePNG(new Uint8Array(10), 4, 4), /não corresponde/);
});

ok("metadados tEXt sobrevivem", () => {
  const png = encodePNG(new Uint8Array(4), 1, 1, {
    text: { Source: "NOAA GFS 0.25 2026080618 +006h", Software: "observatorio" },
  });
  const back = decodePNG(png);
  assert.equal(back.text.Source, "NOAA GFS 0.25 2026080618 +006h");
  assert.equal(back.text.Software, "observatorio");
});

ok("transparência é preservada (alfa 0 continua 0)", () => {
  // Importante para nuvem e chuva: onde não há fenômeno o pixel tem de sumir,
  // não virar preto sobre o globo.
  const src = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 9, 9, 9, 0]);
  const back = decodePNG(encodePNG(src, 2, 2));
  assert.deepEqual([...back.rgba], [...src]);
  assert.equal(back.rgba[3], 0);
  assert.equal(back.rgba[7], 128);
});

ok("campo suave comprime de verdade", () => {
  // Se o filtro Up estiver errado, o PNG fica do tamanho do buffer cru e o
  // ganho de banda — a razão de existir deste módulo — desaparece.
  const w = 720, h = 360;
  const src = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round(127 + 120 * Math.sin(x / 40) * Math.cos(y / 30));
      src[i] = v; src[i + 1] = v; src[i + 2] = 255 - v; src[i + 3] = 200;
    }
  }
  const png = encodePNG(src, w, h);
  const razao = src.length / png.length;
  assert.ok(razao > 4, `compressão fraca demais: ${razao.toFixed(1)}x`);
  assert.deepEqual([...decodePNG(png).rgba], [...src], "compressão não é sem perdas");
  console.log(`      (${(src.length / 1024).toFixed(0)} kB cru -> ${(png.length / 1024).toFixed(0)} kB PNG, ${razao.toFixed(1)}x)`);
});

console.log(`\n  ${n} verificações do PNG\n`);
export default n;
