// test/malha-rampa.mjs
// -----------------------------------------------------------------------------
// A MALHA E O PNG TÊM QUE PINTAR A MESMA COR.
// -----------------------------------------------------------------------------
// São duas implementações da mesma escala em duas linguagens: `rampColor` e
// `stepColor` em `server/fields.js`, `corDaRampa` e `corDaFaixa` em
// `src/malha/rampa.ts`. Elas existem separadas porque uma roda no Node com o
// GRIB2 na mão e a outra na GPU com o binário — mas o resultado precisa ser
// idêntico, byte a byte.
//
// Uma divergência aqui não daria erro em lugar nenhum. Daria um globo em que
// o mesmo campo tem uma cor quando é textura e outra quando é relevo, e a
// pessoa olhando teria que escolher em qual acreditar. Por isso a comparação
// é EXATA, sem tolerância: se um arredondamento mudar de lugar, este teste cai.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { FIELDS, fieldCatalog, _internal } from "../server/fields.js";
import { corDaRampa, corDaFaixa, corDoValor, sRGBparaLinear } from "../src/malha/rampa.ts";

const { rampColor, stepColor } = _internal;

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ncoerência de cor entre o PNG e a malha");

ok("as duas implementações concordam EXATAMENTE, em todos os campos", () => {
  let amostras = 0;
  for (const [id, spec] of Object.entries(FIELDS)) {
    const lo = spec.stops[0][0];
    const hi = spec.stops[spec.stops.length - 1][0];
    const faixa = hi - lo;
    // Varre a faixa inteira e ainda transborda 20% de cada lado, porque é
    // fora das paradas que as duas poderiam divergir na saturação.
    for (let s = -0.2; s <= 1.2; s += 0.0013) {
      const v = lo + s * faixa;
      assert.deepEqual(corDaRampa(spec.stops, v), rampColor(spec.stops, v),
        `${id} em ${v}: rampa divergiu`);
      assert.deepEqual(corDaFaixa(spec.stops, v), stepColor(spec.stops, v),
        `${id} em ${v}: faixa divergiu`);
      amostras++;
    }
  }
  assert.ok(amostras > 5000, `amostragem rala: ${amostras}`);
});

ok("cada parada é atingida exatamente na sua cor", () => {
  for (const [id, spec] of Object.entries(FIELDS)) {
    for (const [v, cor] of spec.stops) {
      assert.deepEqual(corDaRampa(spec.stops, v), cor, `${id} na parada ${v}`);
      assert.deepEqual(corDaFaixa(spec.stops, v), cor, `${id} na faixa ${v}`);
    }
  }
});

ok("`corDoValor` escolhe o modo declarado pelo catálogo", () => {
  // O catálogo é o que o cliente recebe. Se `render` não viajasse, a malha
  // pintaria chuva com rampa suave e o PNG com faixas nítidas.
  for (const c of fieldCatalog()) {
    assert.ok(c.stops?.length, `${c.id} sem paradas no catálogo`);
    assert.ok(c.render === "rampa" || c.render === "faixas", `${c.id}: render "${c.render}"`);
    const meio = (c.stops[0][0] + c.stops[c.stops.length - 1][0]) / 2;
    const esperado = c.render === "faixas"
      ? stepColor(c.stops, meio)
      : rampColor(c.stops, meio);
    assert.deepEqual(corDoValor(c.stops, meio, c.render), esperado, `${c.id}`);
  }
});

ok("a precipitação e o WBGT viajam como FAIXAS, não como rampa", () => {
  // Os dois são lidos contra limiares de decisão. Se o catálogo os declarasse
  // como rampa, a malha suavizaria a fronteira dos 28 °C WBGT — que é a linha
  // entre "cautela" e "alerta".
  const cat = Object.fromEntries(fieldCatalog().map((c) => [c.id, c]));
  assert.equal(cat.precip.render, "faixas");
  assert.equal(cat.wbgt.render, "faixas");
  assert.equal(cat.temp2m.render, "rampa");
});

ok("faixa e rampa DISCORDAM no meio do intervalo — é para isso que servem", () => {
  // Se as duas dessem a mesma coisa, a distinção seria decorativa.
  const stops = FIELDS.wbgt.stops;
  const meio = 26.5;   // entre as paradas de 25 e 28
  assert.notDeepEqual(corDaRampa(stops, meio), corDaFaixa(stops, meio));
  // A faixa fica na cor dos 25, sem antecipar o laranja dos 28.
  assert.deepEqual(corDaFaixa(stops, meio), stops.find(([v]) => v === 25)[1]);
});

console.log("\nespaço de cor");

ok("sRGB → linear é monótona, fixa 0 e 1, e escurece o meio", () => {
  assert.equal(sRGBparaLinear(0), 0);
  assert.equal(+sRGBparaLinear(255).toFixed(12), 1);
  // 50% de sRGB é ~21% de luz. Entregar 0,5 ao three.js pintaria a malha bem
  // mais clara que o PNG do mesmo campo — que é exatamente a divergência que
  // este arquivo inteiro existe para impedir.
  const meio = sRGBparaLinear(128);
  assert.ok(meio > 0.2 && meio < 0.23, `128 virou ${meio}`);
  let anterior = -1;
  for (let c = 0; c <= 255; c++) {
    const x = sRGBparaLinear(c);
    assert.ok(x > anterior, `não é monótona em ${c}`);
    anterior = x;
  }
});

console.log(`\n  ${n} verificações da coerência de cor\n`);
