// test/malha-campo.mjs
// -----------------------------------------------------------------------------
// A GEOMETRIA DA GRADE — o teste que sustenta todos os outros.
// -----------------------------------------------------------------------------
// Se o peso de área estiver errado, TUDO que este diretório calcula sai errado
// junto, e sai errado de um jeito plausível: uma média global de 12,8 °C em vez
// de 15,1 °C não parece defeito, parece dado. Por isso o teste central aqui é
// um INVARIANTE, e não uma comparação com um número que eu mesmo produzi.
//
//     Σ (sen φₙ − sen φₛ) = sen(90°) − sen(−90°) = 2
//
// A soma telescópica dos pesos tem que fechar em 2 EXATAMENTE, para qualquer
// ny, porque é a integral de cos φ sobre a esfera inteira. Nenhuma escolha de
// implementação pode passar por esse crivo por acaso.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  pesoDaLinha, pesosDeArea, areaDaCelula, RAIO_TERRA,
  latDaLinha, lngDaColuna, colunaDaLng, indice, amostrar, percorrer, medido,
} from "../src/malha/campo.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ngeometria da grade");

const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

ok("os pesos de área somam 2 — a integral de cos φ na esfera", () => {
  for (const ny of [3, 19, 91, 181, 721]) {
    const w = pesosDeArea(ny);
    let s = 0;
    for (let j = 0; j < ny; j++) s += w[j];
    perto(s, 2, 1e-12, `ny=${ny}`);
  }
});

ok("as linhas polares são MEIAS células", () => {
  const ny = 181;
  const w = pesosDeArea(ny);
  // A linha 0 vai do polo até meio passo abaixo; a linha 1 é inteira. Se o
  // polo fosse tratado como célula cheia, o peso dele seria comparável ao da
  // vizinha em vez de ser uma fração pequena dele.
  assert.ok(w[0] < w[1], "polo pesando mais que a vizinha");
  assert.equal(+w[0].toFixed(12), +w[ny - 1].toFixed(12), "polos assimétricos");
});

ok("o peso é máximo no equador e cai monotonicamente até o polo", () => {
  const ny = 181;
  const w = pesosDeArea(ny);
  const eq = (ny - 1) / 2;
  for (let j = 1; j < eq; j++) {
    assert.ok(w[j] <= w[j + 1] + 1e-15, `peso subindo errado em j=${j}`);
  }
  assert.ok(w[eq] > w[1], "equador não é o mais pesado");
});

ok("uma célula equatorial de 0,25° tem ~773 km², e uma a 88° tem ~27", () => {
  const nx = 1440, ny = 721;
  const eq = areaDaCelula(360, nx, ny) / 1e6;           // linha do equador
  const jAlta = Math.round((90 - 88) / (180 / (ny - 1)));
  const alta = areaDaCelula(jAlta, nx, ny) / 1e6;
  perto(eq, 773, 5, "célula equatorial");
  perto(alta, 27, 3, "célula a 88°");
  // É este fator que a ponderação por área existe para corrigir.
  assert.ok(eq / alta > 25, `razão equador/polo só ${eq / alta}`);
});

ok("a área total das células fecha na área da Terra", () => {
  const nx = 360, ny = 181;
  let total = 0;
  for (let j = 0; j < ny; j++) total += nx * areaDaCelula(j, nx, ny);
  const esfera = 4 * Math.PI * RAIO_TERRA * RAIO_TERRA;
  perto(total / esfera, 1, 1e-12, "área total");
});

console.log("\ncoordenadas");

ok("linha 0 é o polo norte e a última é o polo sul", () => {
  assert.equal(latDaLinha(0, 721), 90);
  assert.equal(latDaLinha(720, 721), -90);
  assert.equal(latDaLinha(360, 721), 0);
});

ok("coluna 0 é −180° e a grade NÃO repete o meridiano", () => {
  assert.equal(lngDaColuna(0, 360), -180);
  assert.equal(lngDaColuna(180, 360), 0);
  // A coluna 360 não existe: seria −180 de novo. É por isso que o divisor de
  // longitude é nx e o de latitude é ny−1.
  assert.equal(lngDaColuna(359, 360), 179);
});

ok("colunaDaLng e lngDaColuna são inversas, inclusive fora de faixa", () => {
  for (const lng of [-180, -179.5, 0, 37.25, 179.75]) {
    perto(lngDaColuna(colunaDaLng(lng, 1440), 1440), lng, 1e-9, `lng=${lng}`);
  }
  // 190° é o mesmo lugar que −170°. Enrolar é obrigação, não conveniência.
  perto(colunaDaLng(190, 360), colunaDaLng(-170, 360), 1e-9, "enrolamento");
});

ok("o índice enrola em longitude e trava em latitude", () => {
  const nx = 360, ny = 181;
  // vizinho leste da última coluna é a primeira
  assert.equal(indice(360, 5, nx, ny), indice(0, 5, nx, ny));
  assert.equal(indice(-1, 5, nx, ny), indice(359, 5, nx, ny));
  // não existe linha acima do polo norte: trava na 0. Enrolar aqui faria o
  // vizinho do polo norte ser o polo sul.
  assert.equal(indice(10, -1, nx, ny), indice(10, 0, nx, ny));
  assert.equal(indice(10, 999, nx, ny), indice(10, ny - 1, nx, ny));
});

console.log("\namostragem");

/** campo f(lat, lng) numa grade nx × ny */
function campoDe(nx, ny, f) {
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = f(latDaLinha(j, ny), lngDaColuna(i, nx));
  }
  return { nx, ny, valores: v, unidade: "u" };
}

ok("um campo linear em latitude é amostrado exatamente", () => {
  // A bilinear é EXATA para funções lineares em cada eixo — se este teste
  // falhar, o erro é de índice, não de interpolação.
  const c = campoDe(360, 181, (lat) => lat);
  for (const lat of [-60, -0.5, 0, 12.3, 89]) {
    perto(amostrar(c, lat, 42), lat, 1e-4, `lat=${lat}`);
  }
});

ok("a amostragem enrola no antimeridiano sem rasgo", () => {
  const c = campoDe(360, 181, (_lat, lng) => Math.cos((lng * Math.PI) / 180));
  // 179,5° cai entre a última coluna (179°) e a primeira (−180°). Sem
  // enrolamento, a interpolação misturaria 179° com… nada.
  perto(amostrar(c, 0, 179.5), Math.cos((179.5 * Math.PI) / 180), 2e-4, "179,5°");
  perto(amostrar(c, 0, -179.5), Math.cos((-179.5 * Math.PI) / 180), 2e-4, "−179,5°");
});

ok("amostrar por cima de um buraco devolve null, nunca zero", () => {
  const c = campoDe(36, 19, () => 20);
  c.valido = new Uint8Array(36 * 19).fill(1);
  const alvo = indice(18, 9, 36, 19);
  c.valido[alvo] = 0;
  // exatamente em cima do buraco
  assert.equal(amostrar(c, latDaLinha(9, 19), lngDaColuna(18, 36)), null);
  // e também na célula ao lado, cuja bilinear TOCA o buraco: interpolar ali
  // preencheria o buraco com o valor dos vizinhos e ninguém saberia.
  assert.equal(amostrar(c, latDaLinha(9, 19) - 3, lngDaColuna(18, 36) - 5), null);
  // longe dele, o valor volta
  perto(amostrar(c, latDaLinha(3, 19), lngDaColuna(3, 36)), 20, 1e-6, "longe do buraco");
});

ok("coordenada não finita não vira ponto no oceano", () => {
  const c = campoDe(36, 19, () => 1);
  assert.equal(amostrar(c, NaN, 0), null);
  assert.equal(amostrar(c, 0, Infinity), null);
});

console.log("\njanelas");

ok("uma faixa que cruza a linha de data tem 20° e não 340°", () => {
  const nx = 360, ny = 181;
  const c = campoDe(nx, ny, () => 1);
  const cols = new Set();
  percorrer(c, { latSul: -1, latNorte: 1, lngOeste: 170, lngLeste: -170 }, (_k, i) => cols.add(i));
  // 170..190 em passo de 1° = 20 colunas distintas. Se o código lesse a faixa
  // como "de 170 até −170 pelo caminho longo", seriam 340.
  assert.equal(cols.size, 20, `colunas: ${cols.size}`);
});

ok("a janela do mundo cobre a grade inteira, uma vez cada", () => {
  const nx = 72, ny = 37;
  const c = campoDe(nx, ny, () => 1);
  const vistos = new Map();
  percorrer(c, { latSul: -90, latNorte: 90, lngOeste: -180, lngLeste: 180 },
    (k) => vistos.set(k, (vistos.get(k) ?? 0) + 1));
  assert.equal(vistos.size, nx * ny, "cobertura incompleta");
  for (const [k, c2] of vistos) assert.equal(c2, 1, `célula ${k} visitada ${c2}x`);
});

ok("`medido` recusa NaN mesmo sem máscara", () => {
  const c = { nx: 2, ny: 2, valores: new Float32Array([1, NaN, 3, 4]) };
  assert.equal(medido(c, 0), true);
  assert.equal(medido(c, 1), false);
});

console.log(`\n  ${n} verificações da geometria da grade\n`);
