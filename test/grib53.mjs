// test/grib53.mjs
// -----------------------------------------------------------------------------
// GABARITO 5.3 — empacotamento complexo com diferenciação espacial.
//
// O TESTE QUE FALTAVA, e cuja ausência custou semanas.
//
// Os testes cobriam apenas o gabarito 5.0 (empacotamento simples). NENHUMA
// mensagem do GFS usa 5.0 — todas usam 5.3. Ou seja: `unpackComplex`, com
// grupos, larguras variáveis e recorrência de segunda ordem, rodava em
// produção sem uma única verificação.
//
// O sintoma disso não era um erro: era um mapa. Blocos retangulares, listras
// diagonais, regiões vazias — coisas que só se diagnosticam olhando pixel, dias
// depois, por adivinhação. Um defeito de decodificação binária não deveria ser
// investigado por inspeção visual de um globo 3D.
//
// Aqui o dado conhecido entra, é codificado conforme a norma, decodificado, e
// comparado. Se não voltar idêntico, o teste diz em qual etapa quebrou.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { buildGrib53 } from "./_grib53-fixture.mjs";
import { decodeGrib2 } from "../server/grib2.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nGRIB2 gabarito 5.3 (o que o GFS realmente usa)");

/** desfaz a rotação de meia volta que `reorient` aplica quando lo1 = 0 */
function comparar(valores, ints, ni, nj) {
  const half = ni / 2;
  let iguais = 0;
  const difs = [];
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const esperado = ints[j * ni + i];
      const obtido = valores[j * ni + ((i + half) % ni)];
      if (Math.abs(obtido - esperado) < 1e-6) iguais++;
      else if (difs.length < 4) difs.push({ i, j, esperado, obtido });
    }
  }
  return { iguais, total: ni * nj, difs };
}

const campo = (ni, nj, f) => {
  const a = new Int32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) a[j * ni + i] = f(i, j);
  return a;
};

ok("ida e volta EXATA num campo suave com sinal", () => {
  const ni = 32, nj = 16;
  const ints = campo(ni, nj, (i, j) => Math.round(30 * Math.sin(i / 5) * Math.cos(j / 4)));
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 2, groupLen: 16 }));
  assert.equal(msgs[0].packing, "5.3");
  const r = comparar(msgs[0].values, ints, ni, nj);
  assert.equal(r.iguais, r.total,
    `${r.total - r.iguais} valores divergiram; primeiros: ${JSON.stringify(r.difs)}`);
});

ok("a SEMENTE é sinal-magnitude — complemento de dois estoura o Int32", () => {
  // Este é o defeito concreto. Um `minsd` de −3 gravado em sinal-magnitude é
  // 2.147.483.651. Lido como complemento de dois vira −2.147.483.645, e a
  // recorrência `x[i] += 2·x[i−1] − x[i−2]` leva tudo a −2.147.483.648, que é
  // exatamente o mínimo do Int32Array.
  const bits = 32, signBit = Math.pow(2, bits - 1);
  const gravado = 3 + signBit;
  const doisComp = gravado >= signBit ? gravado - 2 * signBit : gravado;
  const sinalMag = gravado >= signBit ? -(gravado - signBit) : gravado;

  assert.equal(sinalMag, -3, "sinal-magnitude deve recuperar −3");
  assert.equal(doisComp, -2147483645, "referência do erro que estamos evitando");
  assert.ok(Math.abs(doisComp) > 2e9, "a leitura errada produz magnitude absurda");
  assert.equal(-Math.pow(2, 31), -2147483648, "valor de saturação observado no campo");
});

ok("diferenciação de PRIMEIRA ordem também volta exata", () => {
  const ni = 16, nj = 8;
  const ints = campo(ni, nj, (i, j) => Math.round(15 * Math.sin((i + j) / 4)));
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 1, groupLen: 8 }));
  const r = comparar(msgs[0].values, ints, ni, nj);
  assert.equal(r.iguais, r.total, `divergiram ${r.total - r.iguais}`);
});

ok("campo constante: grupos de largura ZERO", () => {
  // Todo grupo fica com largura 0 porque não há variação. É o caminho
  // `if (w === 0)` do desempacotador, que de outro modo nunca seria exercitado.
  const ni = 16, nj = 8;
  const ints = campo(ni, nj, () => 7);
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 2, groupLen: 8 }));
  for (const v of msgs[0].values) assert.equal(v, 7);
});

ok("campo com amplitude grande e sinal alternado", () => {
  const ni = 24, nj = 12;
  const ints = campo(ni, nj, (i, j) => ((i + j) % 2 ? 1 : -1) * (40 + ((i * j) % 30)));
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 2, groupLen: 12 }));
  const r = comparar(msgs[0].values, ints, ni, nj);
  assert.equal(r.iguais, r.total, `divergiram ${r.total - r.iguais}`);
});

ok("grupos de tamanhos diferentes (o último é mais curto)", () => {
  // 100 valores em grupos de 16 -> o último grupo tem 4. `lastGroupLength`
  // precisa ser respeitado, senão o desempacotador lê 12 valores a mais e
  // desalinha tudo o que vem depois.
  const ni = 10, nj = 10;
  const ints = campo(ni, nj, (i, j) => Math.round(20 * Math.cos((i - j) / 3)));
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 2, groupLen: 16 }));
  const r = comparar(msgs[0].values, ints, ni, nj);
  assert.equal(r.iguais, r.total, `divergiram ${r.total - r.iguais}`);
});

ok("valores permanecem em faixa física — nada de estouro", () => {
  const ni = 40, nj = 20;
  const ints = campo(ni, nj, (i, j) => Math.round(35 * Math.sin(i / 6) + 10 * Math.cos(j / 3)));
  const msgs = decodeGrib2(buildGrib53(ni, nj, ints, { spatialOrder: 2, groupLen: 32 }));
  let min = Infinity, max = -Infinity;
  for (const v of msgs[0].values) { if (v < min) min = v; if (v > max) max = v; }
  assert.ok(Math.abs(min) < 200 && Math.abs(max) < 200,
    `faixa ${min}..${max} — sinal de estouro na recorrência`);
});

console.log(`\n  ${n} verificações do gabarito 5.3\n`);
export default n;
