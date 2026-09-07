// test/pilha-dialogos.mjs
// -----------------------------------------------------------------------------
// UMA TECLA `ESC`, UMA SUPERFÍCIE FECHADA.
// -----------------------------------------------------------------------------
// O defeito: o terminal do ponto, o modal de análise e a paleta de comandos
// registravam cada um o seu ouvinte de `Escape` em `document`, na fase de
// captura, e chamavam `stopPropagation`.
//
// `stopPropagation` impede o evento de SUBIR para outros nós. Não tem efeito
// nenhum sobre ouvintes irmãos no MESMO nó — e os três estavam em `document`.
// Resultado: um `Esc` com o modal por cima do terminal fechava os dois, mais a
// paleta se estivesse aberta. Uma tecla, três superfícies embora.
//
// A regra certa é a de qualquer sistema de janelas: `Esc` fecha a de CIMA. Este
// arquivo testa a ordem, que é a parte que se pode testar sem navegador — e é
// justamente a parte onde estava o erro.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { entrar, sair, noTopo, altura, _limpar } from "../src/pilhaDialogos.ts";

let n = 0;
const ok = (nome, fn) => { _limpar(); fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\npilha de diálogos");

ok("só a última a abrir responde", () => {
  const terminal = entrar();
  const modal = entrar();
  assert.equal(noTopo(modal), true, "o modal abriu por último e devia responder");
  assert.equal(noTopo(terminal), false, "o terminal atrás NÃO devia responder");
});

ok("fechar a de cima devolve a vez à de baixo", () => {
  const terminal = entrar();
  const modal = entrar();
  sair(modal);
  assert.equal(noTopo(terminal), true, "o terminal devia voltar a responder");
  assert.equal(altura(), 1);
});

ok("sair do MEIO não promove ninguém por engano", () => {
  // Acontece de verdade: fechar o terminal pelo X enquanto o modal está aberto
  // tira uma superfície do meio da pilha. Uma remoção cega do último faria o
  // modal herdar a saída do terminal, e aí `Esc` deixaria de fechar o modal —
  // a superfície que está na cara da pessoa pararia de responder.
  const terminal = entrar();
  const modal = entrar();
  sair(terminal);
  assert.equal(altura(), 1);
  assert.equal(noTopo(modal), true, "o modal continua sendo o topo");
  assert.equal(noTopo(terminal), false);
});

ok("três superfícies: `Esc` fecha uma por vez, de cima para baixo", () => {
  const terminal = entrar();
  const modal = entrar();
  const paleta = entrar();

  const quemResponde = () =>
    [["paleta", paleta], ["modal", modal], ["terminal", terminal]]
      .filter(([, f]) => noTopo(f)).map(([nome]) => nome);

  assert.deepEqual(quemResponde(), ["paleta"], "só a paleta devia responder");
  sair(paleta);
  assert.deepEqual(quemResponde(), ["modal"]);
  sair(modal);
  assert.deepEqual(quemResponde(), ["terminal"]);
  sair(terminal);
  assert.deepEqual(quemResponde(), [], "com a pilha vazia ninguém responde");
});

ok("NUNCA há duas respondendo ao mesmo tempo — é isso que estava quebrado", () => {
  const fichas = Array.from({ length: 6 }, () => entrar());
  for (let i = 0; i < 6; i++) {
    const respondem = fichas.filter((f) => noTopo(f)).length;
    assert.equal(respondem, 1, `${respondem} superfícies responderiam ao mesmo tempo`);
    sair(fichas[fichas.length - 1 - i]);
  }
});

console.log("\nrobustez");

ok("sair duas vezes não tira a de baixo junto", () => {
  // Desmontagem dupla acontece no modo estrito do React, que monta, desmonta e
  // monta de novo. Se a segunda saída removesse "o último", ela levaria embora
  // uma superfície que não é dela.
  const terminal = entrar();
  const modal = entrar();
  sair(modal);
  sair(modal);
  assert.equal(altura(), 1);
  assert.equal(noTopo(terminal), true, "o terminal foi removido por uma saída repetida");
});

ok("sair de quem nunca entrou não faz nada", () => {
  const terminal = entrar();
  sair({ id: 99999 });
  sair(null);
  sair(undefined);
  assert.equal(altura(), 1);
  assert.equal(noTopo(terminal), true);
});

ok("pilha vazia: `noTopo` é falso, e não estoura", () => {
  assert.equal(altura(), 0);
  assert.equal(noTopo(null), false);
  assert.equal(noTopo({ id: 1 }), false);
});

ok("reabrir põe no topo de novo, e não numa posição antiga", () => {
  const terminal = entrar();
  const modal = entrar();
  sair(terminal);
  const terminalDeNovo = entrar();
  assert.equal(noTopo(terminalDeNovo), true, "o terminal reaberto devia estar por cima");
  assert.equal(noTopo(modal), false);
});

console.log(`\n  ${n} verificações da pilha de diálogos\n`);
