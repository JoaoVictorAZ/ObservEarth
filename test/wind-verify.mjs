// test/wind-verify.mjs
// -----------------------------------------------------------------------------
// Amostragem do campo e convenção de rumo.
//
// A convenção METEOROLÓGICA de direção é "de onde o vento VEM". A convenção
// oposta ("para onde vai") difere exatamente 180°. Trocar uma pela outra produz
// um mapa que parece impecável — escoamento suave, ciclones fechando — e está
// de ponta-cabeça. É por isso que a conferência contra a sonda só vale se o
// rumo for calculado do jeito certo dos dois lados.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { sampleField, dirFromUV, angleDiff, diagnose } from "../server/windVerify.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nconferência do vento");

/** grade uniforme com u,v constantes */
const uniforme = (u, v, nx = 72, ny = 37) => ({
  nx, ny,
  u: new Float32Array(nx * ny).fill(u),
  v: new Float32Array(nx * ny).fill(v),
});

ok("rumo meteorológico: vento de oeste é 270°", () => {
  // sopra PARA leste  ->  u > 0, v = 0  ->  vem DE oeste  ->  270°
  assert.equal(Math.round(dirFromUV(10, 0)), 270);
});

ok("rumo meteorológico: vento de sul é 180°", () => {
  // sopra PARA norte  ->  v > 0  ->  vem DE sul  ->  180°
  assert.equal(Math.round(dirFromUV(0, 10)), 180);
});

ok("rumo meteorológico: norte 0°, leste 90°", () => {
  assert.equal(Math.round(dirFromUV(0, -10)) % 360, 0);   // sopra para o sul
  assert.equal(Math.round(dirFromUV(-10, 0)), 90);        // sopra para oeste
});

ok("a convenção oposta seria detectada — difere 180°", () => {
  // "para onde vai" = atan2(u,v); guarda de regressão explícita
  const paraOndeVai = (u, v) => ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  for (const [u, v] of [[10, 0], [0, 10], [-7, 3], [4, -9]]) {
    assert.equal(Math.round(angleDiff(dirFromUV(u, v), paraOndeVai(u, v))), 180);
  }
});

ok("amostragem devolve o valor do campo uniforme em qualquer ponto", () => {
  const g = uniforme(8, -6);
  for (const [lat, lng] of [[0, 0], [45, -30], [-60, 170], [80, -179], [-89, 12]]) {
    const s = sampleField(g, lat, lng);
    assert.ok(Math.abs(s.u - 8) < 1e-4, `u=${s.u} em ${lat},${lng}`);
    assert.ok(Math.abs(s.v + 6) < 1e-4, `v=${s.v} em ${lat},${lng}`);
    assert.ok(Math.abs(s.speed - 10) < 1e-4, `|V|=${s.speed}`);
  }
});

ok("LATITUDE não está espelhada: linha 0 é o norte", () => {
  // campo que só existe no hemisfério norte
  const nx = 72, ny = 37;
  const u = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = 90 - j * (180 / (ny - 1));
    for (let i = 0; i < nx; i++) u[j * nx + i] = lat > 0 ? 20 : 0;
  }
  const g = { nx, ny, u, v: new Float32Array(nx * ny) };
  assert.ok(sampleField(g, 60, 0).speed > 15, "norte deveria ter vento");
  assert.ok(sampleField(g, -60, 0).speed < 1, "sul deveria estar calmo");
});

ok("LONGITUDE não está deslocada: coluna 0 é −180°", () => {
  const nx = 72, ny = 37;
  const u = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lng = -180 + i * (360 / nx);
      u[j * nx + i] = lng < -90 ? 20 : 0;
    }
  }
  const g = { nx, ny, u, v: new Float32Array(nx * ny) };
  assert.ok(sampleField(g, 0, -150).speed > 15, "−150° deveria ter vento");
  assert.ok(sampleField(g, 0, 150).speed < 1, "+150° deveria estar calmo");
});

ok("longitude dá a volta: +190° é o mesmo que −170°", () => {
  const nx = 72, ny = 37;
  const u = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lng = -180 + i * (360 / nx);
      u[j * nx + i] = Math.abs(lng + 170) < 10 ? 20 : 0;
    }
  }
  const g = { nx, ny, u, v: new Float32Array(nx * ny) };
  assert.ok(Math.abs(sampleField(g, 0, 190).u - sampleField(g, 0, -170).u) < 1e-4);
});

// ---------------------------------------------------------------------------
console.log("\ndiagnóstico do desacordo");

const par = (fDir, pDir, spd = 10) => ({
  field: { speed: spd, direction: fDir },
  probe: { speed: spd, direction: pDir },
});

ok("concordância boa é reconhecida como boa", () => {
  const d = diagnose([par(270, 275), par(180, 190), par(90, 78), par(0, 12)]);
  assert.match(d.veredito, /dentro do esperado/);
  assert.ok(d.erroMedioRumo < 20, `erro médio ${d.erroMedioRumo}°`);
});

ok("sinal invertido tem assinatura própria (~180°)", () => {
  const d = diagnose([par(270, 90), par(180, 0), par(45, 225), par(0, 180)]);
  assert.match(d.veredito, /SINAL INVERTIDO/);
  assert.ok(d.fracaoOposta > 0.9, `fração oposta ${d.fracaoOposta}`);
});

ok("eixos trocados tem assinatura própria (~90°)", () => {
  const d = diagnose([par(270, 180), par(180, 90), par(90, 0), par(0, 270)]);
  assert.match(d.veredito, /EIXOS TROCADOS/);
});

ok("vento fraco não gera acusação falsa de erro de rumo", () => {
  // em calmaria o rumo é ruído; comparar produziria alarme sem causa
  const d = diagnose([
    { field: { speed: 0.4, direction: 10 }, probe: { speed: 0.3, direction: 200 } },
    { field: { speed: 0.2, direction: 300 }, probe: { speed: 0.5, direction: 40 } },
  ]);
  assert.equal(d.nRumo, 0, "não deveria comparar rumo em vento fraco");
  assert.match(d.veredito, /fraco demais/);
});

ok("viés e RMSE de velocidade são reportados", () => {
  const d = diagnose([
    { field: { speed: 12, direction: 270 }, probe: { speed: 10, direction: 272 } },
    { field: { speed: 8, direction: 180 }, probe: { speed: 6, direction: 175 } },
  ]);
  assert.equal(d.viesVelocidade, 2, "o campo está 2 m/s acima da sonda");
  assert.ok(d.rmseVelocidade >= 2);
});

console.log(`\n  ${n} verificações da conferência\n`);
export default n;
