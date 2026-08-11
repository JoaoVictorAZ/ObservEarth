// test/wind-ramp.mjs
// -----------------------------------------------------------------------------
// A RAMPA DE VELOCIDADE DO VENTO.
//
// Este teste existe porque a rampa anterior tinha dois defeitos que ninguém
// encontraria lendo o código, e ambos só aparecem quando se MEDE:
//
//   1. `mix(c2, c3, s - 1.0)` onde devia ser `s - 2.0`. Como o `mix` do GLSL
//      não satura, entre s=2 e s=3 a cor extrapolava para R = 1,047 e
//      B = −0,187. O driver corta na escrita, então o sintoma era um estouro
//      branco que voltava de repente ao verde: uma emenda dura numa velocidade
//      específica, em todo o planeta.
//
//   2. Luminância NÃO monotônica. Subia até 0,93 em t ≈ 0,46 e caía para 0,213
//      em t = 1,0 — doze quedas no percurso. A corrente de jato recuava
//      visualmente enquanto o vento médio brilhava.
//
// O teste lê `RAMPA_VENTO`, a MESMA constante que é injetada no shader. Uma
// paleta transcrita à mão para dentro da string GLSL é uma paleta que vai
// divergir do que se acredita estar pintando — foi exatamente o que aconteceu
// com a legenda dos campos, e o teste equivalente pegou.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { RAMPA_VENTO } from "../src/windGPU.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nrampa de velocidade do vento");

/** reproduz EXATAMENTE a mistura sucessiva do shader */
function ramp(t) {
  const s = Math.min(1, Math.max(0, t)) * (RAMPA_VENTO.length - 1);
  let c = [...RAMPA_VENTO[0]];
  RAMPA_VENTO.slice(1).forEach((alvo, k) => {
    const f = Math.min(1, Math.max(0, s - k));
    c = c.map((x, i) => x + (alvo[i] - x) * f);
  });
  return c;
}

const srgb = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

const AMOSTRAS = 256;
const ts = Array.from({ length: AMOSTRAS + 1 }, (_, i) => i / AMOSTRAS);

// ---------------------------------------------------------------------------
ok("nenhuma cor sai do gamut — nem por extrapolação", () => {
  // O defeito anterior produzia R = 1,047 e B = −0,187. A mistura sucessiva
  // com clamp torna isso estruturalmente impossível, mas medir é o que prova.
  for (const t of ts) {
    const c = ramp(t);
    for (const [i, x] of c.entries()) {
      assert.ok(x >= -1e-9 && x <= 1 + 1e-9,
        `t=${t.toFixed(3)} canal ${i} = ${x.toFixed(4)}`);
    }
  }
});

ok("a luminância é ESTRITAMENTE crescente: velocidade lê como brilho", () => {
  let ant = -1, quedas = 0, pior = null;
  for (const t of ts) {
    const l = lum(ramp(t));
    if (l < ant - 1e-9) { quedas++; if (!pior) pior = t; }
    ant = l;
  }
  assert.equal(quedas, 0,
    `${quedas} quedas de luminância (a primeira em t=${pior}); a versão anterior tinha 12`);
});

ok("o vento mais forte é o mais claro da escala", () => {
  // Este é o teste que a rampa anterior reprovava: o máximo dela ficava no
  // meio, e o extremo direito era 4× mais escuro que o pico.
  const l0 = lum(ramp(0)), l1 = lum(ramp(1));
  const maxLum = Math.max(...ts.map((t) => lum(ramp(t))));
  assert.ok(Math.abs(l1 - maxLum) < 1e-9, `o pico de brilho não está no extremo rápido`);
  assert.ok(l1 > l0 * 10, `contraste insuficiente entre calmaria (${l0.toFixed(3)}) e jato (${l1.toFixed(3)})`);
});

ok("a escala é legível em preto e branco", () => {
  // Se a leitura sobrevive sem cor, a codificação é a grandeza — não enfeite.
  // Cinco faixas iguais precisam ser distinguíveis por luminância.
  const faixas = [0, 0.25, 0.5, 0.75, 1].map((t) => lum(ramp(t)));
  for (let i = 1; i < faixas.length; i++) {
    assert.ok(faixas[i] - faixas[i - 1] > 0.08,
      `faixas ${i - 1} e ${i} indistinguíveis em cinza: ${faixas[i - 1].toFixed(3)} vs ${faixas[i].toFixed(3)}`);
  }
});

ok("a calmaria é escura o bastante para não poluir o globo", () => {
  // Vento fraco cobre a maior parte da superfície. Se ele brilhar, o mapa vira
  // uma névoa uniforme e o que importa some no meio.
  assert.ok(lum(ramp(0)) < 0.05, `calmaria com luminância ${lum(ramp(0)).toFixed(3)}`);
});

ok("não há salto de cor: a rampa é contínua", () => {
  // O erro de índice produzia uma descontinuidade dura numa velocidade
  // específica. Nenhum passo de 1/256 pode dar um pulo perceptível.
  let maiorSalto = 0, onde = 0;
  for (let i = 1; i < ts.length; i++) {
    const a = ramp(ts[i - 1]), b = ramp(ts[i]);
    const d = Math.hypot(...a.map((x, k) => b[k] - x));
    if (d > maiorSalto) { maiorSalto = d; onde = ts[i]; }
  }
  assert.ok(maiorSalto < 0.05, `salto de ${maiorSalto.toFixed(4)} em t=${onde.toFixed(3)}`);
});

ok("os extremos são exatamente as pontas declaradas", () => {
  assert.deepEqual(ramp(0).map((x) => +x.toFixed(6)), RAMPA_VENTO[0].map((x) => +x.toFixed(6)));
  assert.deepEqual(ramp(1).map((x) => +x.toFixed(6)),
    RAMPA_VENTO[RAMPA_VENTO.length - 1].map((x) => +x.toFixed(6)));
});

ok("cada parada da rampa é atingida no seu ponto", () => {
  // Prova de que a mistura sucessiva É interpolação linear por partes, e não
  // uma aproximação que passa perto.
  RAMPA_VENTO.forEach((c, k) => {
    const t = k / (RAMPA_VENTO.length - 1);
    const got = ramp(t);
    for (const [i, x] of c.entries()) {
      assert.ok(Math.abs(got[i] - x) < 1e-6,
        `parada ${k} canal ${i}: esperava ${x}, veio ${got[i].toFixed(6)}`);
    }
  });
});

ok("valores fora de [0,1] não quebram nem extrapolam", () => {
  for (const t of [-5, -0.1, 1.1, 42, NaN]) {
    const c = ramp(Number.isNaN(t) ? 0 : t);
    assert.ok(c.every((x) => x >= -1e-9 && x <= 1 + 1e-9), `t=${t} saiu do gamut`);
  }
});

// ---------------------------------------------------------------------------
// Tabela impressa: dá para conferir a olho contra o que aparece na tela.
console.log("\n     t     hex       luminância");
for (let i = 0; i <= 10; i++) {
  const t = i / 10, c = ramp(t);
  const hex = "#" + c.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  const barra = "█".repeat(Math.round(lum(c) * 28));
  console.log(`  ${t.toFixed(1)}   ${hex}   ${lum(c).toFixed(3)}  ${barra}`);
}

console.log(`\n  ${n} verificações da rampa de vento\n`);
export default n;
