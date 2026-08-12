import assert from "node:assert/strict";
import {
  MUNDO_W, MUNDO_H, COPIAS,
  paraMundo, paraGeo, enrolarLng, travarLat, deltaLng, cruzaEmenda,
  travarVista, larguraGraus, aplicarZoom, daTela,
  ALTURA_MIN, ALTURA_MAX,
} from "../src/projecao.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const perto = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

console.log("\nprojecao equirretangular");

ok("mundo tem 360 por 180 e tres copias", () => {
  assert.equal(MUNDO_W, 360);
  assert.equal(MUNDO_H, 180);
  assert.deepEqual([...COPIAS], [-360, 0, 360]);
});

ok("ida e volta preserva o ponto", () => {
  for (const [lat, lng] of [[0, 0], [-23.55, -46.63], [35.68, 139.65], [89.9, 179.9], [-89.9, -179.9]]) {
    const m = paraMundo(lat, lng);
    const g = paraGeo(m.x, m.y);
    assert.ok(perto(g.lat, lat, 1e-9), `lat ${g.lat} != ${lat}`);
    assert.ok(perto(g.lng, lng, 1e-9), `lng ${g.lng} != ${lng}`);
  }
});

console.log("\nantimeridiano");

ok("longitude enrola para [-180, 180)", () => {
  assert.equal(enrolarLng(0), 0);
  assert.equal(enrolarLng(180), -180);
  assert.equal(enrolarLng(-180), -180);
  assert.equal(enrolarLng(190), -170);
  assert.equal(enrolarLng(-190), 170);
  assert.equal(enrolarLng(360), 0);
  assert.equal(enrolarLng(720 + 45), 45);
  assert.equal(enrolarLng(-720 - 45), -45);
});

// O modulo de JavaScript e negativo para entrada negativa: `-190 % 360` da
// -190, nao 170. Este teste existe porque a implementacao ingenua passa em
// todos os casos positivos e falha em silencio no Pacifico.
ok("entrada negativa nao vaza (a armadilha do % em JS)", () => {
  for (let x = -1080; x <= 1080; x += 7) {
    const r = enrolarLng(x);
    assert.ok(r >= -180 && r < 180, `${x} -> ${r} fora da faixa`);
  }
});

ok("latitude NAO enrola: passar do polo nao leva ao outro lado", () => {
  assert.equal(travarLat(95), 90);
  assert.equal(travarLat(-95), -90);
  assert.equal(travarLat(90), 90);
});

ok("delta pelo caminho curto: 179 -> -179 sao 2 graus", () => {
  assert.equal(deltaLng(179, -179), 2);
  assert.equal(deltaLng(-179, 179), -2);
  assert.equal(deltaLng(0, 90), 90);
});

ok("segmento que salta meio mundo cruzou a emenda", () => {
  assert.equal(cruzaEmenda(179, -179), true);
  assert.equal(cruzaEmenda(-179, 179), true);
  assert.equal(cruzaEmenda(10, 20), false);
  assert.equal(cruzaEmenda(-30, 30), false);
});

ok("valores nao finitos nao viram NaN na tela", () => {
  assert.equal(enrolarLng(NaN), 0);
  assert.equal(enrolarLng(Infinity), 0);
  assert.equal(travarLat(NaN), 0);
});

console.log("\ncamera");

ok("altura fica entre os limites", () => {
  assert.equal(travarVista({ lng: 0, lat: 0, alturaGraus: 5000 }, 1.7).alturaGraus, ALTURA_MAX);
  assert.equal(travarVista({ lng: 0, lat: 0, alturaGraus: 0.01 }, 1.7).alturaGraus, ALTURA_MIN);
});

ok("vendo o mundo inteiro o centro e o equador", () => {
  const v = travarVista({ lng: 0, lat: 70, alturaGraus: 180 }, 1.7);
  assert.equal(v.lat, 0, "sobrou folga onde nao ha");
});

ok("de perto da para centralizar quase no polo", () => {
  const v = travarVista({ lng: 0, lat: 89, alturaGraus: 20 }, 1.7);
  assert.equal(v.lat, 80, "lat " + v.lat);
  // a borda de cima encosta no polo e nao passa
  assert.equal(v.lat + v.alturaGraus / 2, 90);
});

ok("longitude NAO e presa pela camera: ela enrola", () => {
  const v = travarVista({ lng: 200, lat: 0, alturaGraus: 40 }, 1.7);
  assert.equal(v.lng, -160, "lng " + v.lng);
});

ok("largura acompanha a proporcao da tela", () => {
  assert.equal(larguraGraus(90, 2), 180);
  assert.equal(larguraGraus(90, 1), 90);
  assert.equal(larguraGraus(90, 0), 90, "aspecto invalido nao pode zerar a vista");
});

console.log("\nzoom");

ok("zoom e multiplicativo e reversivel", () => {
  const a = 60;
  const perto1 = aplicarZoom(a, -1);
  assert.ok(perto1 < a, "aproximar tem que reduzir a altura");
  assert.ok(perto(aplicarZoom(perto1, 1), a, 1e-9), "ida e volta nao voltou");
});

// Um passo aditivo seria imperceptivel vendo o mundo e violento vendo uma
// cidade. O teste fixa a PROPORCAO, nao o numero de graus.
ok("um passo custa a mesma fracao perto e longe", () => {
  const r1 = aplicarZoom(120, -1) / 120;
  const r2 = aplicarZoom(12, -1) / 12;
  assert.ok(perto(r1, r2, 1e-9), `${r1} != ${r2}`);
});

ok("zoom respeita os limites nos extremos", () => {
  assert.equal(aplicarZoom(ALTURA_MAX, 5), ALTURA_MAX);
  assert.equal(aplicarZoom(ALTURA_MIN, -5), ALTURA_MIN);
});

console.log("\ntela para geografico");

ok("o centro da tela e o centro da vista", () => {
  const v = { lng: -46, lat: -23, alturaGraus: 40 };
  const g = daTela(500, 300, 1000, 600, v);
  assert.ok(perto(g.lng, -46, 1e-9), "lng " + g.lng);
  assert.ok(perto(g.lat, -23, 1e-9), "lat " + g.lat);
});

ok("y da tela cresce para BAIXO, latitude para cima", () => {
  const v = { lng: 0, lat: 0, alturaGraus: 40 };
  const cima = daTela(500, 0, 1000, 600, v);
  const baixo = daTela(500, 600, 1000, 600, v);
  assert.ok(cima.lat > baixo.lat, "o mapa esta de cabeca para baixo");
  assert.ok(perto(cima.lat, 20, 1e-9), "topo " + cima.lat);
  assert.ok(perto(baixo.lat, -20, 1e-9), "base " + baixo.lat);
});

ok("as bordas cobrem exatamente a largura visivel", () => {
  const v = { lng: 0, lat: 0, alturaGraus: 90 };   // aspecto 2 -> 180 de largura
  const esq = daTela(0, 300, 1200, 600, v);
  const dir = daTela(1200, 300, 1200, 600, v);
  assert.ok(perto(esq.lng, -90, 1e-9), "esquerda " + esq.lng);
  assert.ok(perto(dir.lng, 90, 1e-9), "direita " + dir.lng);
});

ok("clicar alem do antimeridiano devolve longitude valida", () => {
  const v = { lng: 170, lat: 0, alturaGraus: 60 };
  const g = daTela(1200, 300, 1200, 600, v);   // bem na borda direita
  assert.ok(g.lng >= -180 && g.lng < 180, "lng " + g.lng);
  assert.ok(g.lng < 0, "deveria ter passado para o hemisferio oeste: " + g.lng);
});

ok("tela de tamanho zero nao produz NaN", () => {
  const g = daTela(0, 0, 0, 0, { lng: 0, lat: 0, alturaGraus: 40 });
  assert.ok(Number.isFinite(g.lat) && Number.isFinite(g.lng));
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
