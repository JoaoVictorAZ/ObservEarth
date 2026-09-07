// test/bloco-relevo.mjs
// -----------------------------------------------------------------------------
// O TERRENO DO BLOCO, EM METROS.
// -----------------------------------------------------------------------------
// O bloco 3D existe para mostrar a vertical, e a vertical dele vem daqui. Um
// erro nesta amostragem não produz erro nenhum: produz um terreno plausível no
// lugar errado, ou um degrau de 256 m onde não existe degrau.
//
// Os dois riscos específicos que este arquivo tranca:
//
//   A REPROJEÇÃO. Os tiles de elevação só existem em Mercator Web e o bloco é
//   construído em lat/lng. Uma conversão errada desloca o relevo em relação à
//   imagem, e o deslocamento CRESCE com a latitude — perfeito no equador,
//   quilômetros fora na Escandinávia.
//
//   A ORDEM DA DECODIFICAÇÃO. O canal vermelho do formato `terrarium` vale 256
//   metros por unidade. Interpolar os PIXELS e decodificar depois inventa uma
//   rampa de 256 m em toda borda onde o vermelho troca de valor. Decodificar
//   primeiro e interpolar depois não tem esse problema, porque metro é
//   contínuo e byte não é.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  pixelNoTile, nivelDoBloco, alturaEm, caixaEmVolta, tamanhoKm,
  latDaLinhaDoBloco, lngDaColunaDoBloco,
} from "../src/bloco/relevo.ts";
import { mercY, alturaTerrarium, TILE_PX } from "../src/tiles.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

console.log("\npixel dentro do tile mercator");

ok("o canto noroeste do tile 0/0/0 é o pixel (0,0)", () => {
  const p = pixelNoTile(85.0511287798066, -180, 0, 0, 0, 256);
  assert.ok(p, "o canto do mundo caiu fora do tile do mundo");
  perto(p.ix, 0, 1e-6, "ix");
  perto(p.iy, 0, 1e-6, "iy");
});

ok("o equador em 0° cai no CENTRO do tile do mundo", () => {
  const p = pixelNoTile(0, 0, 0, 0, 0, 256);
  perto(p.ix, 128, 1e-6, "ix");
  perto(p.iy, 128, 1e-6, "iy");
});

ok("a conversão usa MERCATOR, e não latitude linear", () => {
  // A 60° de latitude, Mercator ja esta bem longe da linear: mercY(60) = 0,2904
  // contra 0,1667 de uma escala linear. Um tile de nivel 2 tem 4 linhas, entao
  // 60N cai na linha 1 em Mercator e na linha 0 numa conversao linear.
  const linear = (90 - 60) / 180;      // 0,1667
  const merc = mercY(60);              // 0,2904
  assert.ok(Math.abs(merc - linear) > 0.10, "o teste de referência não separa as duas");

  const linhaMerc = Math.floor(merc * 4);
  const linhaLinear = Math.floor(linear * 4);
  assert.notEqual(linhaMerc, linhaLinear, "as duas conversões cairiam no mesmo tile");

  const p = pixelNoTile(60, 0, 2, 2, linhaMerc, 256);
  assert.ok(p, `60°N devia cair na linha ${linhaMerc} do nível 2`);
  assert.equal(pixelNoTile(60, 0, 2, 2, linhaLinear, 256), null,
    "60°N caiu também na linha da conversão linear — a reprojeção está errada");
});

ok("um ponto fora do tile devolve null, e não um pixel travado na borda", () => {
  // Travar preencheria a região vizinha com a última coluna do tile errado, e
  // o efeito é uma faixa de montanha esticada com aparência de dado.
  assert.equal(pixelNoTile(0, 100, 2, 0, 2, 256), null, "longitude de outro tile");
  assert.equal(pixelNoTile(80, 0, 2, 2, 2, 256), null, "latitude de outro tile");
});

ok("a longitude ENROLA: 190° é o mesmo lugar que −170°", () => {
  // Um bloco que atravessa o antimeridiano tem lng > 180 nas bordas.
  const a = pixelNoTile(0, 190, 1, 0, 1, 256);
  const b = pixelNoTile(0, -170, 1, 0, 1, 256);
  assert.ok(a && b, "um dos dois caiu fora");
  perto(a.ix, b.ix, 1e-9, "ix");
  perto(a.iy, b.iy, 1e-9, "iy");
});

console.log("\nnível do bloco");

ok("bloco menor pede nível mais fino", () => {
  let anterior = -1;
  for (const graus of [30, 10, 3, 1, 0.3, 0.1]) {
    const z = nivelDoBloco(graus, 256);
    assert.ok(z >= anterior, `nível caiu de ${anterior} para ${z} num bloco menor`);
    anterior = z;
  }
});

ok("o nível entrega pelo menos a resolução pedida", () => {
  for (const graus of [20, 5, 1, 0.25]) {
    const z = nivelDoBloco(graus, 256);
    const amostras = graus / (360 / (2 ** z * TILE_PX));
    assert.ok(amostras >= 256 * 0.98,
      `${graus}° no nível ${z} dá ${amostras.toFixed(0)} amostras, menos que as 256 pedidas`);
  }
});

ok("o teto de 14 segura o zoom além do dado de origem", () => {
  // A Mapzen serve SRTM a 30 m, que é o nível 13. Passar disso amplia pixel
  // interpolado e gasta requisição sem acrescentar informação.
  assert.equal(nivelDoBloco(0.0001, 4096), 14);
  assert.equal(nivelDoBloco(0, 256), 0, "largura zero não pode virar nível 14");
});

console.log("\naltitude a partir dos pixels");

/** tile sintético em que a altitude é uma função conhecida do pixel */
function tileFalso(z, x, y, px, f) {
  const dados = new Uint8ClampedArray(px * px * 4);
  for (let iy = 0; iy < px; iy++) {
    for (let ix = 0; ix < px; ix++) {
      const m = f(ix, iy);
      const bruto = Math.round((m + 32768) * 256);   // metros → unidades de B
      const k = (iy * px + ix) * 4;
      dados[k] = (bruto >> 16) & 255;
      dados[k + 1] = (bruto >> 8) & 255;
      dados[k + 2] = bruto & 255;
      dados[k + 3] = 255;
    }
  }
  return { tile: { z, x, y }, dados, largura: px };
}

ok("a ida e volta do formato terrarium preserva o metro", () => {
  for (const m of [-11000, -400, -1, 0, 1, 850, 4200, 8848]) {
    const bruto = Math.round((m + 32768) * 256);
    const r = (bruto >> 16) & 255, g = (bruto >> 8) & 255, b = bruto & 255;
    perto(alturaTerrarium(r, g, b), m, 0.01, `${m} m`);
  }
});

ok("um platô devolve o valor do platô, sem ondulação", () => {
  const t = tileFalso(0, 0, 0, 64, () => 1500);
  for (const [lat, lng] of [[0, 0], [40, -70], [-30, 120]]) {
    perto(alturaEm(lat, lng, [t]), 1500, 0.02, `(${lat},${lng})`);
  }
});

ok("A DECODIFICAÇÃO VEM ANTES DA INTERPOLAÇÃO — o degrau de 256 m", () => {
  // O defeito que este teste tranca: numa borda onde o canal vermelho troca de
  // 137 para 138, interpolar os BYTES e decodificar depois produziria um salto
  // de 256 m. Aqui a altitude cresce 1 m por pixel, e atravessa exatamente uma
  // dessas fronteiras — o valor lido tem que subir 1 m por pixel, e não pular.
  const base = 137 * 256 - 32768;            // altitude onde R vale 137
  const t = tileFalso(0, 0, 0, 64, (ix) => base + ix);

  const amostras = [];
  for (let ix = 28; ix <= 36; ix++) {
    // centro do pixel ix, na linha do equador do tile do mundo
    const lng = -180 + ((ix + 0.5) / 64) * 360;
    amostras.push(alturaEm(0, lng, [t]));
  }
  for (let i = 1; i < amostras.length; i++) {
    const d = amostras[i] - amostras[i - 1];
    perto(d, 1, 0.05, `salto entre pixels vizinhos (${amostras[i - 1]} → ${amostras[i]})`);
  }
});

ok("alfa zero é buraco de cobertura, não nível do mar", () => {
  // A Mapzen marca ausência com alfa 0. Ler isso como 0 m poria uma planície
  // ao nível do mar no meio de um bloco alpino, com aparência perfeitamente
  // normal.
  const t = tileFalso(0, 0, 0, 32, () => 900);
  for (let k = 3; k < t.dados.length; k += 4) t.dados[k] = 0;
  assert.equal(alturaEm(0, 0, [t]), null);
});

ok("sem tile nenhum a resposta é null, e não zero", () => {
  assert.equal(alturaEm(0, 0, []), null);
});

console.log("\ngeometria da caixa");

ok("um bloco de 100 km tem 100 km — em qualquer latitude", () => {
  // A largura em longitude é dividida por cos(lat). Sem isso, um bloco de
  // "100 km" sobre Reykjavík sairia com 50 km de largura e 100 de altura, e a
  // pessoa leria como terreno o que é distorção de projeção.
  for (const lat of [0, 23.5, 45, 60, 71]) {
    const t = tamanhoKm(caixaEmVolta(lat, -20, 100));
    perto(t.largura, 100, 2.5, `largura em ${lat}°`);
    perto(t.altura, 100, 0.5, `altura em ${lat}°`);
  }
});

ok("a caixa é centrada no ponto pedido", () => {
  const cx = caixaEmVolta(-23.55, -46.63, 60);
  perto((cx.latNorte + cx.latSul) / 2, -23.55, 1e-9, "centro em latitude");
  perto((cx.lngOeste + cx.lngLeste) / 2, -46.63, 1e-9, "centro em longitude");
});

ok("a grade do bloco é registrada em PONTO: as bordas são exatas", () => {
  // A malha do terreno e a do campo precisam usar a MESMA convenção, senão as
  // duas superfícies do bloco ficam meia célula deslocadas uma da outra —
  // visível como uma montanha que não bate com a nuvem em cima dela.
  const cx = { latSul: -10, lngOeste: 20, latNorte: 10, lngLeste: 40 };
  perto(latDaLinhaDoBloco(0, 5, cx), 10, 1e-12, "primeira linha é o norte");
  perto(latDaLinhaDoBloco(4, 5, cx), -10, 1e-12, "última linha é o sul");
  perto(lngDaColunaDoBloco(0, 5, cx), 20, 1e-12, "primeira coluna é o oeste");
  perto(lngDaColunaDoBloco(4, 5, cx), 40, 1e-12, "última coluna é o leste");
  perto(latDaLinhaDoBloco(2, 5, cx), 0, 1e-12, "meio");
});

ok("a caixa não estoura os polos", () => {
  const cx = caixaEmVolta(84, 0, 900);
  assert.ok(cx.latNorte <= 85, `norte em ${cx.latNorte}`);
  assert.ok(cx.latSul >= -85, `sul em ${cx.latSul}`);
});

console.log(`\n  ${n} verificações do terreno do bloco\n`);
