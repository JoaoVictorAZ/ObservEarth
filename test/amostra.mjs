import assert from "node:assert/strict";
import { amostrarVento, direcaoVento, gradeUtil } from "../src/legenda/amostra.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** grade com u e v definidos por funcao de (lat, lng) */
function grade(nx, ny, fu, fv, valido = null) {
  const u = new Float32Array(nx * ny), v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = 90 - (j / (ny - 1)) * 180;
    for (let i = 0; i < nx; i++) {
      const lng = -180 + (i / nx) * 360;
      u[j * nx + i] = fu(lat, lng);
      v[j * nx + i] = fv(lat, lng);
    }
  }
  const g = { nx, ny, u, v };
  if (valido) g.valid = valido(nx, ny);
  return g;
}

const constante = (k) => grade(8, 5, () => k, () => 0);

console.log("\nforma da grade");

ok("grade sem forma nao vira amostra", () => {
  assert.equal(gradeUtil(null), false);
  assert.equal(gradeUtil({ nx: 1, ny: 1, u: [1], v: [1] }), false);
  assert.equal(gradeUtil({ nx: 4, ny: 4, u: new Float32Array(4), v: new Float32Array(16) }), false,
    "aceitou grade com plano curto");
  assert.equal(amostrarVento(null, 0, 0), null);
});

console.log("\namostragem");

ok("campo constante devolve o mesmo valor em qualquer ponto", () => {
  const g = constante(7);
  for (const [lat, lng] of [[0, 0], [45, -60], [-33, 170], [89, 179]]) {
    const s = amostrarVento(g, lat, lng);
    assert.ok(Math.abs(s - 7) < 1e-5, `${lat},${lng} deu ${s}`);
  }
});

ok("a velocidade e o modulo de u e v, nao a soma", () => {
  const g = grade(8, 5, () => 3, () => 4);
  assert.ok(Math.abs(amostrarVento(g, 0, 0) - 5) < 1e-5, "deu " + amostrarVento(g, 0, 0));
});

// Coluna 0 e -180 porque o servidor desloca a grade do GFS, que nasce em 0.
// O test/wind-longitude.mjs ja defende essa convencao do lado do shader.
ok("a coluna 0 e a longitude -180, e nao 0", () => {
  const g = grade(360, 3, (_lat, lng) => lng, () => 0);
  // em -180 o valor da grade e -180; em 0 e 0
  assert.ok(Math.abs(amostrarVento(g, 0, -180) - 180) < 1e-3, amostrarVento(g, 0, -180));
  assert.ok(Math.abs(amostrarVento(g, 0, 0) - 0) < 1e-3, amostrarVento(g, 0, 0));
});

// Longitude e ciclica; latitude nao. Enrolar a latitude faria o ponto sobre o
// Artico ler o vento da Antartida.
ok("a longitude ENROLA e a latitude e GRAMPEADA", () => {
  const g = grade(8, 5, () => 6, () => 0);
  assert.ok(Math.abs(amostrarVento(g, 0, 181) - amostrarVento(g, 0, -179)) < 1e-5,
    "181 e -179 sao a mesma longitude");
  assert.ok(Math.abs(amostrarVento(g, 0, 540) - amostrarVento(g, 0, 180)) < 1e-5);
  // fora do intervalo de latitude nao devolve null: gruda no polo
  assert.ok(amostrarVento(g, 120, 0) != null, "grampeou para null em vez de para o polo");
});

ok("interpola entre celulas em vez de saltar", () => {
  const g = grade(360, 181, (_lat, lng) => lng, () => 0);
  const a = amostrarVento(g, 0, 10.0);
  const b = amostrarVento(g, 0, 10.5);
  const c = amostrarVento(g, 0, 11.0);
  assert.ok(b > a && b < c, `${a} / ${b} / ${c} nao interpolou`);
});

console.log("\nausencia nao e zero");

// Zero em u e v e CALMARIA -- informacao real e comum na zona de convergencia.
// Tratar ausencia como zero pintaria calmaria em cima de buraco de dado.
ok("canto sem medida derruba a amostra inteira para null", () => {
  const g = grade(8, 5, () => 9, () => 0, (nx, ny) => {
    const val = new Uint8Array(nx * ny).fill(1);
    val[0] = 0;                       // canto noroeste sem dado
    return val;
  });
  assert.equal(amostrarVento(g, 90, -180), null, "interpolou por cima de buraco");
  assert.ok(amostrarVento(g, -45, 90) != null, "derrubou um ponto que tinha dado");
});

ok("calmaria de verdade devolve 0, e nao null", () => {
  const g = constante(0);
  assert.equal(amostrarVento(g, 0, 0), 0, "confundiu calmaria com ausencia");
});

ok("NaN na grade tambem derruba, mesmo sem plano de validade", () => {
  const g = constante(5);
  g.u[0] = NaN;
  assert.equal(amostrarVento(g, 90, -180), null);
});

ok("coordenada invalida devolve null", () => {
  const g = constante(5);
  for (const [lat, lng] of [[NaN, 0], [0, NaN], [Infinity, 0]]) {
    assert.equal(amostrarVento(g, lat, lng), null, `${lat},${lng}`);
  }
});

console.log("\ndirecao meteorologica");

// A convencao e a de ORIGEM: vento norte SOPRA do norte. Inverter nao aparece
// no numero -- aparece numa seta apontando exatamente ao contrario.
ok("vento vindo do norte da 0 grau", () => {
  // do norte para o sul: v negativo
  const g = grade(8, 5, () => 0, () => -1);
  const d = direcaoVento(g, 0, 0);
  assert.ok(Math.abs(d - 0) < 1e-6 || Math.abs(d - 360) < 1e-6, "deu " + d);
});

ok("vento vindo do oeste da 270 graus", () => {
  const g = grade(8, 5, () => 1, () => 0);   // sopra para leste
  assert.ok(Math.abs(direcaoVento(g, 0, 0) - 270) < 1e-6, "deu " + direcaoVento(g, 0, 0));
});

ok("vento vindo do sul da 180 graus", () => {
  const g = grade(8, 5, () => 0, () => 1);
  assert.ok(Math.abs(direcaoVento(g, 0, 0) - 180) < 1e-6, "deu " + direcaoVento(g, 0, 0));
});

ok("a direcao fica sempre em 0..360", () => {
  for (const [u, v] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [0, 0]]) {
    const d = direcaoVento(grade(8, 5, () => u, () => v), 0, 0);
    assert.ok(d >= 0 && d < 360.0001, `u=${u} v=${v} deu ${d}`);
  }
});

ok("ponto sem medida nao tem direcao", () => {
  const g = grade(8, 5, () => 1, () => 0, (nx, ny) => new Uint8Array(nx * ny));
  assert.equal(direcaoVento(g, 0, 0), null);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
