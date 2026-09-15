import assert from "node:assert/strict";
import { pontoSubsolar, declinacao, vetorSolar, diaDoAno, OBLIQUIDADE } from "../src/globo/sol.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const U = (a, m, d, h = 12) => new Date(Date.UTC(a, m - 1, d, h, 0, 0));

console.log("\ndeclinacao contra o calendario");

// Estes quatro pontos sao a unica verificacao possivel sem uma efemeride: se a
// curva estiver defasada ou invertida, um deles denuncia.
ok("solsticios batem em +-23,44 grau", () => {
  const jun = declinacao(U(2026, 6, 21));
  const dez = declinacao(U(2026, 12, 21));
  assert.ok(Math.abs(jun - OBLIQUIDADE) < 1.0, "junho deu " + jun.toFixed(2));
  assert.ok(Math.abs(dez + OBLIQUIDADE) < 1.0, "dezembro deu " + dez.toFixed(2));
});

ok("equinocios passam perto de zero", () => {
  const mar = declinacao(U(2026, 3, 20));
  const set = declinacao(U(2026, 9, 22));
  assert.ok(Math.abs(mar) < 2.0, "marco deu " + mar.toFixed(2));
  assert.ok(Math.abs(set) < 2.0, "setembro deu " + set.toFixed(2));
});

// Sem o deslocamento de 10 dias a curva ancora em 1/jan e nao no solsticio.
ok("o minimo cai em dezembro, nao em 1 de janeiro", () => {
  let pior = 1, menor = Infinity;
  for (let d = 1; d <= 365; d++) {
    const v = declinacao(new Date(Date.UTC(2026, 0, d)));
    if (v < menor) { menor = v; pior = d; }
  }
  // dia 355 = 21/dez
  assert.ok(Math.abs(pior - 355) <= 3, "o minimo caiu no dia " + pior);
});

ok("a declinacao nunca sai do intervalo fisico", () => {
  for (let d = 1; d <= 366; d++) {
    const v = declinacao(new Date(Date.UTC(2024, 0, d)));
    assert.ok(Math.abs(v) <= OBLIQUIDADE + 1e-9, "dia " + d + " deu " + v);
  }
});

console.log("\nlongitude subsolar");

ok("meio-dia UTC poe o Sol sobre Greenwich", () => {
  assert.ok(Math.abs(pontoSubsolar(U(2026, 6, 21, 12)).lng) < 1e-9);
});

ok("cada hora desloca 15 graus para OESTE", () => {
  assert.ok(Math.abs(pontoSubsolar(U(2026, 6, 21, 13)).lng + 15) < 1e-9);
  assert.ok(Math.abs(pontoSubsolar(U(2026, 6, 21, 6)).lng - 90) < 1e-9);
});

// A meia-noite UTC o resultado bruto e -180 ou +180 conforme o arredondamento,
// e uma comparacao de intervalo com o sinal errado da a volta no mundo.
ok("a longitude fica em (-180, 180]", () => {
  for (let h = 0; h < 24; h++) {
    const l = pontoSubsolar(U(2026, 6, 21, h)).lng;
    assert.ok(l > -180 && l <= 180, `${h}h deu ${l}`);
  }
  assert.equal(pontoSubsolar(U(2026, 6, 21, 0)).lng, 180);
});

ok("os minutos entram na conta", () => {
  const a = pontoSubsolar(new Date(Date.UTC(2026, 5, 21, 12, 30)));
  assert.ok(Math.abs(a.lng + 7.5) < 1e-9, "meia hora deveria valer 7,5 grau: " + a.lng);
});

console.log("\nvetor solar");

ok("o vetor e unitario", () => {
  for (const h of [0, 6, 12, 18]) {
    const [x, y, z] = vetorSolar(U(2026, 3, 20, h));
    const m = Math.hypot(x, y, z);
    assert.ok(Math.abs(m - 1) < 1e-9, "modulo " + m);
  }
});

// Se o eixo estiver trocado, o terminador sai espelhado -- e um globo com o dia
// no lado errado e o tipo de erro que passa despercebido numa captura de tela.
ok("a convencao dos eixos: Y e o norte, +Z e a longitude zero", () => {
  const [x, y, z] = vetorSolar(U(2026, 6, 21, 12));
  assert.ok(y > 0, "no solsticio de junho o Sol esta no hemisferio NORTE: y=" + y);
  assert.ok(z > 0.9, "ao meio-dia UTC o Sol deveria apontar para +Z: z=" + z);
  assert.ok(Math.abs(x) < 1e-9, "x deveria ser zero sobre Greenwich: " + x);
});

ok("as 6h UTC o Sol esta a leste, em +X", () => {
  const [x] = vetorSolar(U(2026, 3, 20, 6));
  assert.ok(x > 0.9, "x=" + x);
});

console.log("\ndia do ano");

ok("bissexto tem 366", () => {
  assert.equal(diaDoAno(new Date(Date.UTC(2024, 11, 31))), 366);
  assert.equal(diaDoAno(new Date(Date.UTC(2026, 11, 31))), 365);
  assert.equal(diaDoAno(new Date(Date.UTC(2026, 0, 1))), 1);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
