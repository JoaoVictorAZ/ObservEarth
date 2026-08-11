// test/model-names.mjs
// -----------------------------------------------------------------------------
// Traducao de identificador da NASA para nome de fenomeno.
//
// O risco aqui nao e o nome sair feio: e sair AMBIGUO. Dois produtos diferentes
// com o mesmo rotulo na tela transformam a escolha da camada em sorteio, e o
// erro nao aparece em lugar nenhum — o mapa carrega normalmente, so nao e o que
// a pessoa pediu.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { describeModelLayer, sortModelLayers } from "../server/modelNames.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nnomes de fenômeno");

ok("nível vertical no INÍCIO do corpo é detectado", () => {
  // O caso real: `MERRA2_2m_...` não tem underscore antes do "2m", e a regexp
  // que exigia um deixava a camada sem nível.
  assert.equal(describeModelLayer("MERRA2_2m_Air_Temperature_Monthly").title,
    "Temperatura do ar · 2 m");
  assert.equal(describeModelLayer("MERRA2_10m_Wind_Speed_Monthly").level, "10 m");
});

ok("nível no meio do identificador continua funcionando", () => {
  assert.equal(describeModelLayer("MERRA2_Ozone_Mixing_Ratio_50hPa_Monthly").title,
    "Razão de mistura de ozônio · 50 hPa");
  assert.equal(describeModelLayer("MERRA2_Wind_Speed_10m_Monthly").title,
    "Velocidade do vento · 10 m");
});

ok("qualificador de produto não some", () => {
  const a = describeModelLayer("MERRA2_2m_Air_Temperature_Monthly");
  const b = describeModelLayer("MERRA2_2m_Air_Temperature_Assimilated_Monthly");
  assert.notEqual(a.title, b.title, "dois produtos distintos com o mesmo rótulo");
  assert.match(b.title, /assimilado/);
  assert.match(describeModelLayer("MERRA2_Precipitation_Bias_Corrected_Monthly").title,
    /viés corrigido/);
});

ok("procedência é metadado, nunca título", () => {
  const d = describeModelLayer("MERRA2_Surface_Skin_Temperature_Monthly");
  assert.equal(d.title, "Temperatura de superfície");
  assert.equal(d.detail, "Reanálise MERRA-2 · mensal");
  assert.equal(d.agency, "NASA GMAO");
  assert.equal(d.raw, "MERRA2_Surface_Skin_Temperature_Monthly");
  assert.ok(!/MERRA/.test(d.title), "o título não deve exigir decorar nomenclatura");
});

ok("GEOS é assimilação, não reanálise", () => {
  const d = describeModelLayer("GEOS_Total_Column_Ozone");
  assert.equal(d.title, "Ozônio em coluna total");
  assert.match(d.detail, /Assimilação GEOS/);
});

ok("termo mais longo vence o mais curto", () => {
  assert.equal(describeModelLayer("MERRA2_Sea_Surface_Temperature_Monthly").title,
    "Temperatura da superfície do mar");
});

ok("identificador desconhecido degrada de forma legível", () => {
  const d = describeModelLayer("MERRA2_Alguma_Coisa_Nova_Monthly");
  assert.ok(d.title.length > 0);
  assert.ok(!d.title.includes("_"), `sobrou underscore: ${d.title}`);
  assert.equal(d.cadence, "mensal");
});

ok("um catálogo realista não produz títulos duplicados", () => {
  const ids = [
    "MERRA2_2m_Air_Temperature_Monthly",
    "MERRA2_2m_Air_Temperature_Assimilated_Monthly",
    "MERRA2_Air_Temperature_250hPa_Monthly",
    "MERRA2_Air_Temperature_500hPa_Monthly",
    "MERRA2_Surface_Skin_Temperature_Monthly",
    "MERRA2_Sea_Surface_Temperature_Monthly",
    "MERRA2_Wind_Speed_10m_Monthly",
    "MERRA2_Wind_Speed_50m_Monthly",
    "MERRA2_Ozone_Mixing_Ratio_50hPa_Monthly",
    "MERRA2_Ozone_Mixing_Ratio_500hPa_Monthly",
    "MERRA2_Total_Column_Ozone_Monthly",
  ];
  const titles = sortModelLayers(ids.map((i) => describeModelLayer(i))).map((d) => d.title);
  const dup = titles.filter((t, i) => titles.indexOf(t) !== i);
  assert.equal(dup.length, 0, `títulos ambíguos: ${[...new Set(dup)].join(" | ")}`);
});

console.log(`\n  ${n} verificações de nomenclatura\n`);
export default n;
