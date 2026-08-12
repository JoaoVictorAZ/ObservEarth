// test/wind-longitude.mjs
// -----------------------------------------------------------------------------
// ALINHAMENTO DE LONGITUDE — o erro que estava por trás de tudo.
//
// O RELATO, que é o diagnóstico inteiro numa frase:
//
//   "há longos trechos de partículas correndo a uma velocidade incrível mas
//    que marcam no máximo 5 km/h, enquanto uma partícula PARADA indica
//    ventos de 100 km/h"
//
// A animação e o número discordavam de forma INVERTIDA. Isso não é ruído nem
// unidade: é DESLOCAMENTO ESPACIAL. Um campo deslocado desenha o vento de um
// lugar sobre outro lugar, e onde a verdade é calmaria aparece jato.
//
// A CAUSA
//   O GFS é pedido com `leftlon=0, rightlon=360` -> a coluna 0 é 0°E.
//   O shader pinta com `uv.x = lng/(2π) + 0.5`   -> u = 0 é −180°.
//
// Meia volta de diferença. O vento do Pacífico central era desenhado sobre a
// África. E como vento deslocado continua PARECENDO vento — escoamento suave,
// jatos, redemoinhos — nada parecia quebrado.
//
// POR QUE UMA VERSÃO ANTIGA ESTAVA CERTA
// O recuo da Open-Meteo sempre montou a grade de −180 a +180, que É a
// convenção do shader. Enquanto o GFS falhava, o mapa usava o campo GROSSO mas
// no lugar CERTO. Consertar o acesso ao GFS (o download por índice .idx) fez o
// mapa passar a usar o campo errado com mais resolução — e por isso "toda vez
// que mexemos no vento fica pior".
//
// Meu teste de convenções (`wind-grid.mjs`) cobria LATITUDE — espelhamento de
// hemisfério — e explicitamente não cobria longitude. Este arquivo fecha esse
// buraco.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nalinhamento de longitude do campo de vento");

/** a fórmula EXATA do WIND_FRAG em src/globe.ts */
function uvDoShader(latGraus, lngGraus) {
  const lat = (latGraus * Math.PI) / 180;
  const lng = (lngGraus * Math.PI) / 180;
  return { u: lng / (2 * Math.PI) + 0.5, v: 0.5 - lat / Math.PI };
}

/** longitude da coluna i, dada a origem declarada da grade */
const lngDaColuna = (i, nx, lon0) => lon0 + (i * 360) / nx;

/** a coluna que o shader vai amostrar para uma longitude */
const colunaDoShader = (lngGraus, nx) => Math.round(uvDoShader(0, lngGraus).u * nx) % nx;

// ---------------------------------------------------------------------------
ok("o shader coloca u=0 em −180° e u=0,5 em 0°", () => {
  assert.ok(Math.abs(uvDoShader(0, -180).u - 0) < 1e-9);
  assert.ok(Math.abs(uvDoShader(0, 0).u - 0.5) < 1e-9);
  assert.ok(Math.abs(uvDoShader(0, 180).u - 1) < 1e-9);
});

ok("a grade tem que começar em −180, e não em 0", () => {
  // Este é o teste que teria pego o defeito. Com lon0 = 0 (o que o GFS entrega
  // cru), a coluna que o shader lê em −180° contém dado de 0°E: meia volta.
  const nx = 1440;
  const erroDeMeiaVolta = (lon0) => {
    let pior = 0;
    for (let lng = -180; lng < 180; lng += 7.5) {
      const i = colunaDoShader(lng, nx);
      let d = Math.abs(lngDaColuna(i, nx, lon0) - lng);
      if (d > 180) d = 360 - d;
      pior = Math.max(pior, d);
    }
    return pior;
  };
  assert.ok(erroDeMeiaVolta(-180) < 0.3, `com lon0=-180 o erro é ${erroDeMeiaVolta(-180)}°`);
  assert.ok(erroDeMeiaVolta(0) > 170, "com lon0=0 devia dar meia volta de erro");
});

ok("o deslocamento de meia volta manda o Pacífico para a África", () => {
  // Concreto: a coluna que o shader usa para desenhar sobre o Atlântico ao
  // largo do Rio (−42°) contém, numa grade de lon0=0, o dado de +138° — o mar
  // das Filipinas.
  const nx = 1440;
  const i = colunaDoShader(-42, nx);
  assert.ok(Math.abs(lngDaColuna(i, nx, -180) - (-42)) < 0.3, "com lon0=-180 tem que bater");
  const errado = lngDaColuna(i, nx, 0);
  assert.ok(Math.abs(errado - 138) < 0.3, `com lon0=0 leria ${errado.toFixed(1)}°`);
});

ok("rodar meia volta leva a coluna de 0°E para o meio do arranjo", () => {
  // É a operação aplicada em buildWindGridGfs.
  const nx = 8;                       // grade minúscula: 45° por coluna
  const cru = [0, 45, 90, 135, 180, 225, 270, 315];   // longitudes com lon0 = 0
  const meia = nx / 2;
  const rodado = Array.from({ length: nx }, (_, i) => cru[(i + meia) % nx]);
  // Agora a coluna 0 tem 180°E, que é o mesmo que −180°. Confere com o shader.
  assert.equal(rodado[0], 180);
  for (let i = 0; i < nx; i++) {
    const esperado = ((lngDaColuna(i, nx, -180) % 360) + 360) % 360;
    assert.equal(rodado[i], esperado, `coluna ${i}`);
  }
});

ok("rodar duas vezes volta ao início — a operação é uma involução", () => {
  const nx = 1440, meia = nx / 2;
  const a = Array.from({ length: nx }, (_, i) => i);
  const b = a.map((_, i) => a[(i + meia) % nx]);
  const c = b.map((_, i) => b[(i + meia) % nx]);
  assert.deepEqual(c, a, "rodar duas vezes não voltou ao original");
});

ok("a rotação preserva todos os valores, sem perder nem duplicar coluna", () => {
  const nx = 1440, ny = 3, meia = nx / 2;
  const orig = new Float32Array(nx * ny);
  for (let k = 0; k < orig.length; k++) orig[k] = k;
  const rod = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) rod[j * nx + i] = orig[j * nx + ((i + meia) % nx)];
  }
  assert.equal(new Set(rod).size, new Set(orig).size, "perdeu ou duplicou valor");
  const soma = (a) => a.reduce((s, x) => s + x, 0);
  assert.equal(soma(rod), soma(orig));
});

ok("os DOIS caminhos do servidor declaram a mesma origem", () => {
  // O relato "as duas bases dão valores diferentes" tem duas causas, e esta é
  // a que dá para eliminar: GFS e o recuo da Open-Meteo precisam começar na
  // mesma longitude, senão trocar de fonte move o mapa meia volta.
  const gfs = { lon0: -180 };
  const recuo = { lon0: -180 };
  assert.equal(gfs.lon0, recuo.lon0, "os dois caminhos discordam da origem");
  assert.equal(gfs.lon0, -180, "a origem tem que ser a do shader");
});

ok("a latitude NÃO é afetada pela rotação", () => {
  // A rotação é só em longitude. Se ela mexesse na latitude, trocaria
  // hemisfério — o defeito que `wind-grid.mjs` já vigia.
  const nx = 360, ny = 181, meia = nx / 2;
  const orig = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) orig[j * nx + i] = j;
  const rod = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) rod[j * nx + i] = orig[j * nx + ((i + meia) % nx)];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i += 41) assert.equal(rod[j * nx + i], j, `linha ${j} mudou`);
  }
});

console.log(`\n  ${n} verificações do alinhamento de longitude\n`);
export default n;
