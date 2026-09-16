// test/bloco-agua.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/bloco-agua.mjs
//
// O corpo d'água do recorte é GEOMETRIA, e não tinta. A diferença aparece em
// três afirmações que este arquivo fixa:
//
//   1. não há água sobre terra seca;
//   2. a coluna que cada vértice carrega é a profundidade real ali;
//   3. um recorte inteiramente emerso não produz água nenhuma.
//
// A terceira é a que protege o princípio do projeto: um bloco num planalto a
// 800 m não pode ganhar mar. Desenhar a lâmina "por precaução" seria inventar
// geografia, que é a única coisa que o bloco não tem licença para fazer.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { aguaDoBloco, kmDeMetros } from "../src/bloco/geometria.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

const EXAG = 10;

/**
 * Uma malha 3x3 com as altitudes que se pedir.
 * As posições em x e z não importam para estes testes; o y sai da altitude.
 */
function malha(alts, nx = 3, ny = 3) {
  const altitude = Float32Array.from(alts);
  const posicao = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      posicao[k * 3] = i;
      posicao[k * 3 + 1] = kmDeMetros(altitude[k], EXAG);
      posicao[k * 3 + 2] = j;
    }
  }
  return { posicao, altitude, indice: new Uint32Array(0), vertices: nx * ny, triangulos: 0 };
}

const y0 = kmDeMetros(0, EXAG);

console.log("\nnão há água sobre terra seca");

ok("um recorte inteiramente emerso não gera geometria nenhuma", () => {
  const m = malha([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  assert.equal(a.triangulos, 0, "inventou água num bloco sem mar");
});

ok("a superfície só cobre células com os QUATRO cantos de mar", () => {
  // Metade oeste submersa e ligada à borda, metade leste emersa.
  const m = malha([
    -50, -50, 100,
    -50, -50, 100,
    -50, -50, 100,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  // Vertices de SUPERFICIE, todos no zero e todos do lado submerso.
  for (let v = 0; v < a.superficie.length; v++) {
    if (a.superficie[v] < 0.5) continue;
    const x = a.posicao[v * 3];
    assert.ok(Math.abs(a.posicao[v * 3 + 1] - y0) < 1e-9, "tampa fora do zero");
    assert.ok(x <= 1.0001, `tampa avançou sobre terra seca em x=${x}`);
  }
});

console.log("\na coluna é a profundidade de verdade");

ok("cada vértice carrega a própria profundidade, nunca negativa", () => {
  const m = malha([
    -10, -200, -3000,
    -10, -200, -3000,
    -10, -200, -3000,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  assert.ok(a.triangulos > 0);
  let mx = 0;
  for (const p of a.profundidade) {
    assert.ok(p >= 0, `profundidade negativa: ${p}`);
    if (p > mx) mx = p;
  }
  assert.ok(Math.abs(mx - 3000) < 1e-6, `a maior coluna deu ${mx}, esperado 3000`);
});

ok("vértice emerso na borda entra com coluna zero", () => {
  const m = malha([
    500, -20, -20,
    500, -20, -20,
    500, -20, -20,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  let temZero = false;
  for (const p of a.profundidade) if (p === 0) temZero = true;
  assert.ok(temZero, "a borda emersa devia entrar com coluna zero");
});

console.log("\ndepressão fechada não é mar");

// O criterio de conexao com a borda e' o que separa oceano de bacia. Um ponto
// abaixo do nivel do mar que nao se comunica com o oceano e' o Mar Morto, o
// Vale da Morte, o Qattara -- e encher essas bacias seria inventar geografia.
ok("uma bacia no meio do recorte, cercada de terra, fica seca", () => {
  const m = malha([
    100, 100, 100,
    100, -80, 100,
    100, 100, 100,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  assert.equal(a.triangulos, 0, "encheu uma depressão fechada de água");
});

ok("a mesma bacia, aberta na borda, vira mar", () => {
  const m = malha([
    100, 100, 100,
    -80, -80, 100,
    100, 100, 100,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  assert.ok(a.triangulos > 0, "não reconheceu água ligada à borda");
});

console.log("\no limiar é o ruído do instrumento");

// A acuracia vertical do SRTM e' de metros. Uma celula que le -1 m e'
// indistinguivel de uma que le +1 m -- e pinta-la de oceano afirma uma
// distincao que o dado nao faz. Sem limiar, toda restinga vira Veneza.
ok("uma costa rasa oscilando em torno de zero não vira mar com limiar", () => {
  const m = malha([
    -1, -2, -1,
    -2, -1, -2,
    -1, -2, -1,
  ]);
  assert.ok(aguaDoBloco(m, 3, 3, EXAG, 0).triangulos > 0,
            "com limiar zero devia alagar — é o comportamento cru");
  assert.equal(aguaDoBloco(m, 3, 3, EXAG, 3).triangulos, 0,
               "com limiar de 3 m o ruído devia ficar seco");
});

ok("água funda atravessa qualquer limiar razoável", () => {
  const m = malha(new Array(9).fill(-400));
  assert.ok(aguaDoBloco(m, 3, 3, EXAG, 20).triangulos > 0,
            "400 m de profundidade sumiram com limiar de 20");
});

console.log("\nburaco do DEM não vira oceano");

// Em `malhaDoTerreno`, celula sem dado recebe o MINIMO do bloco -- que num
// recorte costeiro e' negativo. Sem a mascara, todo buraco do DEM virava mar
// profundo.
ok("célula sem dado é ignorada, mesmo com altitude negativa", () => {
  const m = malha(new Array(9).fill(-500));
  const valido = new Uint8Array(9).fill(0);
  assert.equal(aguaDoBloco(m, 3, 3, EXAG, 0, valido).triangulos, 0,
               "desenhou água sobre buraco do DEM");
});

console.log("\na seção existe, e é o que dá volume");

ok("um bloco todo submerso tem superfície E seção", () => {
  const m = malha(new Array(9).fill(-100));
  const a = aguaDoBloco(m, 3, 3, EXAG);
  let sup = 0, sec = 0;
  for (const s of a.superficie) (s > 0.5 ? sup++ : sec++);
  assert.ok(sup > 0, "sem tampa");
  assert.ok(sec > 0, "sem seção nas paredes — o corpo d'água ficaria sem volume");
});

ok("nenhuma seção passa acima do nível do mar", () => {
  const m = malha([
    -30, -30, -30,
    -30, 250, -30,
    -30, -30, -30,
  ]);
  const a = aguaDoBloco(m, 3, 3, EXAG);
  for (let v = 0; v < a.superficie.length; v++) {
    assert.ok(a.posicao[v * 3 + 1] <= y0 + 1e-9,
              `água acima do zero em y=${a.posicao[v * 3 + 1]}`);
  }
});

ok("os três vetores têm o mesmo número de vértices", () => {
  const m = malha(new Array(9).fill(-40));
  const a = aguaDoBloco(m, 3, 3, EXAG);
  assert.equal(a.posicao.length / 3, a.profundidade.length);
  assert.equal(a.posicao.length / 3, a.superficie.length);
  assert.equal(a.posicao.length / 9, a.triangulos);
});

console.log(`\n  ${n} verificacoes\n`);
