// test/malha-altura.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/malha-altura.mjs
//
// A ALTURA TEM QUE SER A DA SUPERFÍCIE DESENHADA.
//
// Tudo que marca LUGAR no globo — topônimo, marcador de clique, anel de sismo,
// foco de incêndio, cartão ancorado — pergunta a altura do relevo e pousa ali.
// Se a conta não for a mesma que o vértice usou, o objeto flutua ou afunda.
//
// A diferença é pequena e constante, que é o pior tipo: nunca chega a parecer
// defeito, e o globo só fica "meio solto" sem ninguém saber nomear por quê.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { amostrar, amostrarNaMalha, lngDaColuna, latDaLinha } from "../src/malha/campo.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

/**
 * Uma grade minúscula com TORÇÃO máxima no primeiro quadrilátero.
 *
 *     j=0:  0   10   ...
 *     j=1: 10    0   ...
 *
 * Torção = (v(0,0) + v(1,1) − v(1,0) − v(0,1)) / 4 = (0 + 0 − 10 − 10)/4 = −5.
 * É o caso em que bilinear e triângulo mais divergem.
 */
const nx = 4, ny = 3;
const valores = new Float32Array(nx * ny);
valores[0 * nx + 0] = 0;   valores[0 * nx + 1] = 10;
valores[1 * nx + 0] = 10;  valores[1 * nx + 1] = 0;
const CAMPO = { nx, ny, valores };

const latMeio = (a, b) => (a + b) / 2;

console.log("\nos cantos concordam sempre");

ok("nos quatro vértices, triângulo e bilinear dão o mesmo", () => {
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const lat = latDaLinha(j, ny), lng = lngDaColuna(i, nx);
    const t = amostrarNaMalha(CAMPO, lat, lng);
    const b = amostrar(CAMPO, lat, lng);
    assert.ok(Math.abs(t - b) < 1e-9, `(${i},${j}): ${t} vs ${b}`);
    assert.ok(Math.abs(t - valores[j * nx + i]) < 1e-9, `(${i},${j}) não deu o valor do vértice`);
  }
});

console.log("\nno meio da célula elas divergem, e a diferença é a torção");

ok("o centro do quadrilátero difere de bilinear em exatamente torção/1", () => {
  const lat = latMeio(latDaLinha(0, ny), latDaLinha(1, ny));
  const lng = latMeio(lngDaColuna(0, nx), lngDaColuna(1, nx));

  const tri = amostrarNaMalha(CAMPO, lat, lng);
  const bil = amostrar(CAMPO, lat, lng);

  // bilinear no centro = media dos quatro = (0+10+10+0)/4 = 5
  assert.ok(Math.abs(bil - 5) < 1e-6, `bilinear deu ${bil}`);
  // sobre a diagonal a-c, o triangulo da a media de a e c = (0+0)/2 = 0
  assert.ok(Math.abs(tri - 0) < 1e-6, `triangulo deu ${tri}`);

  const torcao = (valores[0] + valores[nx + 1] - valores[1] - valores[nx]) / 4;
  assert.ok(Math.abs((tri - bil) - torcao) < 1e-6,
            `diferença ${tri - bil} não bate com a torção ${torcao}`);
});

console.log("\na superfície é contínua na diagonal");

// A diagonal a-c e' a fronteira entre os dois triangulos. Se os dois nao
// concordarem ali, a malha tem uma fenda -- e um marcador que cruze a linha
// salta de altura.
ok("os dois triângulos concordam sobre a diagonal", () => {
  for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const lat0 = latDaLinha(0, ny), lat1 = latDaLinha(1, ny);
    const lng0 = lngDaColuna(0, nx), lng1 = lngDaColuna(1, nx);
    const eps = 1e-7;
    const lat = lat0 + (lat1 - lat0) * s;
    const lng = lng0 + (lng1 - lng0) * s;
    const a = amostrarNaMalha(CAMPO, lat + eps, lng - eps);
    const b = amostrarNaMalha(CAMPO, lat - eps, lng + eps);
    assert.ok(Math.abs(a - b) < 1e-3, `em s=${s}: ${a} vs ${b}`);
  }
});

console.log("\nlimitar por vértice não é o mesmo que limitar no fim");

// A malha faz clamp em CADA VERTICE e so' entao interpola. Quem interpola
// primeiro e limita depois erra em toda celula com um canto saturado.
ok("o clamp por vértice muda o resultado onde há canto saturado", () => {
  const limitar = (v) => Math.max(0, Math.min(1, v / 10));
  const lat = latMeio(latDaLinha(0, ny), latDaLinha(1, ny));
  const lng = lngDaColuna(0, nx) + (lngDaColuna(1, nx) - lngDaColuna(0, nx)) * 0.25;

  const porVertice = amostrarNaMalha(CAMPO, lat, lng, limitar);
  const noFim = limitar(amostrarNaMalha(CAMPO, lat, lng));

  assert.ok(Number.isFinite(porVertice) && Number.isFinite(noFim));
  // Com esta grade os dois caminhos coincidem (nada satura); o que este teste
  // fixa e' que a ordem e' a do VERTICE -- ver abaixo o caso que separa.
  const saturado = { nx: 2, ny: 2, valores: new Float32Array([0, 50, 0, 0]) };
  const l = latMeio(latDaLinha(0, 2), latDaLinha(1, 2));
  const g = lngDaColuna(0, 2) + (lngDaColuna(1, 2) - lngDaColuna(0, 2)) * 0.5;
  const a = amostrarNaMalha(saturado, l, g, limitar);
  const b = limitar(amostrarNaMalha(saturado, l, g));
  assert.notEqual(a, b, "a ordem do clamp precisava fazer diferença aqui");
});

console.log("\nausência continua sendo ausência");

ok("um canto sem dado devolve null, e não uma altura plausível", () => {
  const valido = new Uint8Array(nx * ny).fill(1);
  valido[1] = 0;                          // apaga o vértice (1,0)
  const comBuraco = { ...CAMPO, valido };
  const lat = latMeio(latDaLinha(0, ny), latDaLinha(1, ny));
  const lng = latMeio(lngDaColuna(0, nx), lngDaColuna(1, nx));
  assert.equal(amostrarNaMalha(comBuraco, lat, lng), null);
});

ok("coordenada não finita devolve null", () => {
  assert.equal(amostrarNaMalha(CAMPO, NaN, 0), null);
  assert.equal(amostrarNaMalha(CAMPO, 0, Infinity), null);
});

console.log("\na longitude enrola, como na malha");

ok("o quadrilátero que cruza o antimeridiano é amostrável", () => {
  const cheio = { nx, ny, valores: new Float32Array(nx * ny).fill(7) };
  const lat = latDaLinha(1, ny);
  // entre a ultima coluna e a primeira -- e' o quadrilatero que `i1 = (i+1)%nx`
  // fecha na malha
  const v = amostrarNaMalha(cheio, lat, 179.9);
  assert.ok(Math.abs(v - 7) < 1e-9, String(v));
});

console.log("\nas duas pontas continuam amarradas");

// Se alguem trocar a diagonal em malha3d.ts, a conta daqui passa a descrever
// outra superficie -- e o defeito volta com o sinal invertido, sem nenhum
// teste geometrico reclamar. Esta checagem e' grosseira de proposito: ela so
// pergunta se a ordem dos indices continua sendo a que este arquivo assume.
ok("malha3d.ts ainda monta os triângulos como a,c,b / a,d,c", () => {
  const src = readFileSync(join(RAIZ, "src", "malha", "malha3d.ts"), "utf8");
  assert.ok(
    /idx\.push\(\s*a,\s*c,\s*b,\s*a,\s*d,\s*c\s*\)/.test(src),
    "a triangulação mudou; `amostrarNaMalha` assume a diagonal a–c e precisa ser revista junto",
  );
});

console.log(`\n  ${n} verificacoes\n`);
