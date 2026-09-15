// test/terra.mjs
// -----------------------------------------------------------------------------
// O QUE DA SUPERFICIE DA TERRA DA PARA TESTAR SEM UMA GPU
// -----------------------------------------------------------------------------
// O shader em si nao roda aqui. O que roda e a REGRA que ele aplica -- onde
// acaba o dia, onde comeca a noite, quanto dura o crepusculo -- e essa regra
// existe duas vezes: em GLSL, dentro do fragmento, e em JavaScript, para a tela
// poder rotular um ponto. Duas copias da mesma conta com numeros diferentes e
// como um rotulo passa a discordar do pixel.
//
// Este arquivo verifica a copia em JavaScript e, no fim, LE O GLSL para
// confirmar que os dois usam o mesmo uniforme e a mesma funcao.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fracaoDiurna, momentoDe, CREPUSCULO } from "../src/globo/terra.ts";
import { vetorSolar } from "../src/globo/sol.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\na banda do crepusculo");

ok("meio-dia e meia-noite sao os extremos exatos", () => {
  assert.equal(fracaoDiurna(1), 1);
  assert.equal(fracaoDiurna(-1), 0);
});

ok("o horizonte geometrico e exatamente meio termo", () => {
  assert.ok(Math.abs(fracaoDiurna(0) - 0.5) < 1e-12, "deu " + fracaoDiurna(0));
});

ok("a transicao e suave, nao um degrau", () => {
  // um degrau daria 0 ou 1 nos dois lados; a borda dura e o defeito que este
  // material existe para eliminar
  const a = fracaoDiurna(CREPUSCULO * 0.5);
  const b = fracaoDiurna(-CREPUSCULO * 0.5);
  assert.ok(a > 0.5 && a < 1, "lado claro deu " + a);
  assert.ok(b > 0 && b < 0.5, "lado escuro deu " + b);
});

ok("a funcao e monotona: mais Sol nunca escurece", () => {
  let ant = -1;
  for (let c = -1; c <= 1.0001; c += 0.01) {
    const v = fracaoDiurna(c);
    assert.ok(v >= ant - 1e-12, "caiu em cos=" + c.toFixed(2));
    ant = v;
  }
});

ok("nunca sai de 0..1", () => {
  for (const c of [-99, -1, 0, 1, 99]) {
    const v = fracaoDiurna(c);
    assert.ok(v >= 0 && v <= 1, `cos ${c} deu ${v}`);
  }
});

console.log("\nrotulos");

ok("os tres momentos caem nos limites declarados", () => {
  assert.equal(momentoDe(0.9), "dia");
  assert.equal(momentoDe(-0.9), "noite");
  assert.equal(momentoDe(0), "crepúsculo");
  assert.equal(momentoDe(CREPUSCULO * 0.99), "crepúsculo");
  assert.equal(momentoDe(CREPUSCULO * 1.01), "dia");
});

// 9 graus abaixo do horizonte fica entre o crepusculo civil (6) e o nautico
// (12), que e onde o ceu de fato passa de claro a escuro.
ok("a largura declarada corresponde a ~9 graus de altura solar", () => {
  const graus = (Math.asin(CREPUSCULO) * 180) / Math.PI;
  assert.ok(graus > 8 && graus < 10, "deu " + graus.toFixed(2) + " grau");
});

console.log("\nligacao com a posicao do Sol");

ok("ao meio-dia UTC no equador e dia; do lado oposto e noite", () => {
  const [sx, sy, sz] = vetorSolar(new Date(Date.UTC(2026, 2, 20, 12)));
  // ponto na superficie: lat 0, lng 0 -> normal (0,0,1)
  assert.equal(momentoDe(0 * sx + 0 * sy + 1 * sz), "dia");
  assert.equal(momentoDe(0 * sx + 0 * sy + -1 * sz), "noite");
});

ok("no equinocio o polo esta no crepusculo, nao no dia nem na noite", () => {
  const [, sy] = vetorSolar(new Date(Date.UTC(2026, 2, 20, 12)));
  // normal do polo norte = (0,1,0)
  assert.equal(momentoDe(sy), "crepúsculo", "cos no polo = " + sy.toFixed(4));
});

console.log("\no GLSL e a copia em JavaScript falam do mesmo numero");

const glsl = readFileSync(fileURLToPath(new URL("../src/globo/terra.ts", import.meta.url)), "utf8");

ok("o shader usa o uniforme do crepusculo, e nao um valor cravado", () => {
  assert.match(glsl, /smoothstep\(-uCrepusculo,\s*uCrepusculo,/,
    "o GLSL deixou de usar uCrepusculo: as duas copias da regra divergiram");
  assert.match(glsl, /uCrepusculo:\s*\{\s*value:\s*CREPUSCULO\s*\}/,
    "o uniforme nao esta mais amarrado a constante exportada");
});

// O terminador tem que vir da normal GEOMETRICA. Usando a do relevo, ele
// serrilha em cima de cada cordilheira -- e a linha e astronomica, nao
// topografica.
ok("a mistura dia/noite usa a normal geometrica, nao a do relevo", () => {
  assert.match(glsl, /dia01\s*=\s*smoothstep\(-uCrepusculo,\s*uCrepusculo,\s*dot\(N,\s*L\)\)/,
    "a mistura passou a usar Nr (relevo) e o terminador vai serrilhar");
});

ok("as luzes de cidade so aparecem no lado noturno", () => {
  assert.match(glsl, /luzes\s*\*\s*\(1\.0\s*-\s*dia01\)/,
    "as luzes deixaram de ser multiplicadas pela fracao NOTURNA");
});

ok("o glint e so na agua e so de dia", () => {
  assert.match(glsl, /pow\(max\(dot\(Nr,\s*H\),\s*0\.0\),\s*[\d.]+\)\s*\*\s*agua\s*\*\s*dia01/,
    "o reflexo especular escapou da mascara de agua ou do lado diurno");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
