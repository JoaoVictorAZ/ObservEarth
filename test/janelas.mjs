// test/janelas.mjs
// -----------------------------------------------------------------------------
// UMA JANELA SALVA PRECISA SER ALCANÇÁVEL NA TELA DE HOJE.
// -----------------------------------------------------------------------------
// A posição de cada janela flutuante sobrevive à sessão, e isso é o certo — a
// pessoa arruma a tela do jeito dela uma vez. O risco vem da tela MUDAR entre
// as sessões: um monitor de 3440 px em casa e um notebook de 1366 na rua, ou
// simplesmente a janela do navegador diminuída.
//
// Uma caixa gravada em x = 2800 reabre inteiramente fora da vista num 1366. E
// não há como trazê-la de volta: a alça para arrastá-la é a barra de título, e
// ela está fora junto. A janela existe, responde a tudo, e é invisível.
//
// A validação anterior só perguntava se os quatro números eram finitos. Isso
// aceita x = 2800 sem piscar.
//
// O critério certo é o mesmo de `travar` em `src/arrasto.ts`: a janela não
// precisa CABER, precisa sobrar alça. É a diferença entre "grudar na borda" e
// "poder ser trazida de volta".
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { caixaUsavel } from "../src/arrasto.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

// Um notebook comum, que é onde o defeito aparece.
const W = 1366, H = 768;

console.log("\ncaixa de janela salva");

ok("uma caixa normal passa", () => {
  assert.equal(caixaUsavel({ x: 880, y: 80, w: 450, h: 410 }, W, H), true);
});

ok("caixa gravada num monitor grande é RECUSADA no notebook", () => {
  // O caso real: 3440x1440 em casa, 1366x768 na rua.
  assert.equal(caixaUsavel({ x: 2800, y: 120, w: 460, h: 380 }, W, H), false,
    "a janela nasceria fora da tela, sem alça para voltar");
  // E a mesma caixa continua válida na tela em que foi gravada.
  assert.equal(caixaUsavel({ x: 2800, y: 120, w: 460, h: 380 }, 3440, 1440), true);
});

ok("transbordar um pouco é PERMITIDO — não é preciso caber", () => {
  // Encostar a janela na borda direita é um gesto normal de organização, e
  // exigir que ela caiba inteira faria a caixa "pular" para dentro sozinha.
  assert.equal(caixaUsavel({ x: W - 120, y: 40, w: 460, h: 380 }, W, H), true,
    "uma janela encostada na borda foi recusada");
  assert.equal(caixaUsavel({ x: -300, y: 40, w: 460, h: 380 }, W, H), true,
    "uma janela meio para fora da esquerda ainda tem alça");
});

ok("sumir de vez à esquerda é recusado", () => {
  // Com x + w abaixo da margem não sobra pixel nenhum na tela.
  assert.equal(caixaUsavel({ x: -500, y: 40, w: 460, h: 380 }, W, H), false);
});

ok("cabeçalho acima do topo ou abaixo do fim é recusado", () => {
  // Y negativo é o defeito da conta de posição padrão do terminal: ela fazia
  // `Math.min(140, H - 450)`, que numa janela de navegador baixa devolve um
  // número NEGATIVO. A barra de título nascia acima da área visível.
  assert.equal(caixaUsavel({ x: 400, y: -50, w: 460, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: 400, y: H - 10, w: 460, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: 400, y: 0, w: 460, h: 380 }, W, H), true,
    "encostar no topo é posição legítima");
});

console.log("\nlixo e ausência");

ok("qualquer coisa que não seja uma caixa é recusada", () => {
  for (const lixo of [null, undefined, 42, "caixa", [], {}]) {
    assert.equal(caixaUsavel(lixo, W, H), false, `aceitou ${JSON.stringify(lixo)}`);
  }
});

ok("número não finito é recusado — inclusive o que o JSON deixa passar", () => {
  // `JSON.parse('{"x":null}')` devolve null, e `null` sobrevive a uma checagem
  // de `Number.isFinite` mal escrita porque `Number(null) === 0`.
  assert.equal(caixaUsavel({ x: NaN, y: 0, w: 460, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: Infinity, y: 0, w: 460, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: null, y: 0, w: 460, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: 100, y: 0, w: 460 }, W, H), false, "caixa sem altura");
});

ok("tamanho zero ou negativo é recusado", () => {
  assert.equal(caixaUsavel({ x: 100, y: 40, w: 0, h: 380 }, W, H), false);
  assert.equal(caixaUsavel({ x: 100, y: 40, w: 460, h: -10 }, W, H), false);
});

console.log(`\n  ${n} verificações das janelas flutuantes\n`);
