import assert from "node:assert/strict";
import { arrastar, travar, MOVER } from "../src/arrasto.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const LIM = { minW: 340, minH: 220, telaW: 1920, telaH: 1080 };
const C = { x: 1440, y: 80, w: 450, h: 410 };
const dir = (c) => c.x + c.w;

console.log("\narraste de janela");

// -------------------------------------------------------------------------
// A REGRESSÃO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
//
// Os modos de redimensionamento são combinações de d/e/b/c testadas com
// `includes`, e a palavra "mover" contém um "e". O arraste do cabeçalho caía
// nos dois ramos e o segundo sobrescrevia o x: a janela esticava para a
// esquerda com a borda direita congelada em vez de andar.
// -------------------------------------------------------------------------
ok("MOVER nao altera o tamanho (o bug do 'e' em 'mover')", () => {
  for (const dx of [-600, -300, -1, 0, 1, 300, 600]) {
    const r = arrastar(MOVER, dx, 0, C, LIM);
    assert.equal(r.w, C.w, `largura mudou com dx=${dx}: ${r.w}`);
    assert.equal(r.h, C.h, `altura mudou com dx=${dx}: ${r.h}`);
  }
});

ok("MOVER para a esquerda anda, nao estica", () => {
  const r = arrastar(MOVER, -300, 0, C, LIM);
  assert.equal(r.x, 1140, "x " + r.x);
  assert.equal(r.w, 450, "largura " + r.w);
  assert.notEqual(dir(r), dir(C), "a borda direita ficou congelada");
});

ok("MOVER para a direita anda de verdade", () => {
  const r = arrastar(MOVER, 300, 0, C, LIM);
  assert.equal(r.x, 1740, "x " + r.x);
  assert.equal(r.w, 450);
});

ok("MOVER carrega o eixo vertical junto", () => {
  const r = arrastar(MOVER, 40, 120, C, LIM);
  assert.equal(r.x, 1480);
  assert.equal(r.y, 200);
});

ok("MOVER e reversivel: ida e volta voltam ao mesmo lugar", () => {
  const ida = arrastar(MOVER, -400, -30, C, LIM);
  const volta = arrastar(MOVER, 400, 30, ida, LIM);
  assert.deepEqual(volta, C);
});

console.log("\nredimensionamento por borda");

ok("borda esquerda ('e') prende a direita — e SO ela faz isso", () => {
  const r = arrastar("e", -200, 0, C, LIM);
  assert.equal(dir(r), dir(C), "a direita deveria ficar parada");
  assert.equal(r.w, 650, "largura " + r.w);
});

ok("borda direita ('d') prende a esquerda", () => {
  const r = arrastar("d", 200, 0, C, LIM);
  assert.equal(r.x, C.x);
  assert.equal(r.w, 650);
});

ok("cantos combinam duas bordas", () => {
  const r = arrastar("eb", -100, 90, C, LIM);
  assert.equal(r.w, 550, "largura " + r.w);
  assert.equal(r.h, 500, "altura " + r.h);
  assert.equal(r.x, 1340, "x " + r.x);
});

ok("largura minima e respeitada e a janela nao foge", () => {
  const r = arrastar("e", 5000, 0, C, LIM);
  assert.equal(r.w, LIM.minW);
});

console.log("\nlimites: solta, mas alcancavel");

ok("pode passar da borda direita, deixando 80px na tela", () => {
  const r = travar({ ...C, x: 5000 }, LIM);
  assert.equal(r.x, LIM.telaW - 80, "x " + r.x);
  assert.ok(dir(r) > LIM.telaW, "nao deixou transbordar");
});

ok("pode sair pela esquerda, deixando 80px na tela", () => {
  const r = travar({ ...C, x: -5000 }, LIM);
  assert.equal(r.x, 80 - C.w, "x " + r.x);
  assert.equal(dir(r), 80);
});

ok("janela mais larga que a tela ainda se move", () => {
  const larga = { x: 0, y: 0, w: 3000, h: 400 };
  const a = travar(larga, LIM);
  const b = arrastar(MOVER, -500, 0, a, LIM);
  assert.notEqual(a.x, b.x, "travou uma janela maior que a tela");
});

ok("o topo nunca some: y nao fica negativo", () => {
  assert.equal(travar({ ...C, y: -400 }, LIM).y, 0);
  assert.equal(travar({ ...C, y: 9999 }, LIM).y, LIM.telaH - 40);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
