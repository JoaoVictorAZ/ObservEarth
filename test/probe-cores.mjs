// test/probe-cores.mjs
// -----------------------------------------------------------------------------
// COR POR VALOR NA SONDA.
//
// Eu errei DUAS vezes no mesmo lugar: primeiro dez matizes decorativos do
// Tailwind, depois nenhuma cor — removi a leitura junto com o enfeite.
//
// Agora a cor sai do VALOR. O que este arquivo trava é que ela continue sendo
// dado: monotônica dentro de cada escala, legível contra o fundo, e ausente
// quando o dado é ausente.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import * as E from "../src/probe/escalas.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
console.log("\ncores da sonda");

const lin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** o painel é --scrim sobre o vácuo: ~#0a0d14 no pior caso */
const FUNDO = L(hx("#0a0d14"));
const razao = (cor) => (L(hx(cor)) + 0.05) / (FUNDO + 0.05);

const ESCALAS = Object.entries(E).filter(([, v]) => Array.isArray(v));

ok("toda parada de toda escala passa em 4,5:1", () => {
  // É TEXTO, não decoração. Um valor colorido que não se lê é pior que cinza.
  for (const [nome, esc] of ESCALAS) {
    for (const [v, cor] of esc) {
      assert.ok(razao(cor) >= 4.5,
        `${nome} em ${v}: ${cor} dá ${razao(cor).toFixed(2)}:1`);
    }
  }
});

ok("as paradas estão em ordem crescente de valor", () => {
  // Fora de ordem, a interpolação anda para trás e a cor deixa de ser função
  // monotônica do valor.
  for (const [nome, esc] of ESCALAS) {
    for (let i = 1; i < esc.length; i++) {
      assert.ok(esc[i][0] > esc[i - 1][0], `${nome}: parada ${i} não é maior`);
    }
  }
});

ok("ausência não recebe cor", () => {
  // Um nulo colorido pareceria medição.
  for (const [, esc] of ESCALAS) {
    assert.equal(E.corDe(esc, null), null);
    assert.equal(E.corDe(esc, undefined), null);
    assert.equal(E.corDe(esc, NaN), null);
    assert.equal(E.posicaoNaFaixa(esc, null), null);
  }
});

ok("fora da faixa satura nas pontas, sem extrapolar", () => {
  for (const [nome, esc] of ESCALAS) {
    assert.equal(E.corDe(esc, esc[0][0] - 1e6), esc[0][1], `${nome} abaixo`);
    assert.equal(E.corDe(esc, esc[esc.length - 1][0] + 1e6), esc[esc.length - 1][1], `${nome} acima`);
    assert.equal(E.posicaoNaFaixa(esc, -1e9), 0);
    assert.equal(E.posicaoNaFaixa(esc, 1e9), 1);
  }
});

ok("cada parada é atingida exatamente no seu valor", () => {
  for (const [nome, esc] of ESCALAS) {
    for (const [v, cor] of esc) {
      assert.equal(E.corDe(esc, v), cor, `${nome} em ${v}`);
    }
  }
});

ok("a interpolação é contínua — nenhum salto de cor", () => {
  // Amostrar POR TRECHO, não uniformemente na faixa toda. A escala de chuva vai
  // de 0 a 60 mm/h com paradas em 0,5 e 2,5: uma amostragem uniforme daria dois
  // pontos no primeiro trecho e reportaria "salto de 0,139" numa função que é
  // perfeitamente contínua. O defeito estaria no teste, não na escala.
  for (const [nome, esc] of ESCALAS) {
    let maior = 0;
    for (let s = 1; s < esc.length; s++) {
      const a = esc[s - 1][0], b = esc[s][0];
      let ant = hx(E.corDe(esc, a));
      for (let i = 1; i <= 60; i++) {
        const c = hx(E.corDe(esc, a + ((b - a) * i) / 60));
        maior = Math.max(maior, Math.hypot(...c.map((x, k) => x - ant[k])));
        ant = c;
      }
    }
    assert.ok(maior < 0.05, `${nome}: salto de ${maior.toFixed(3)}`);
  }
});

ok("o vento da sonda usa a MESMA escala da rajada", () => {
  // São a mesma grandeza física. Escalas diferentes fariam 15 m/s de vento e
  // 15 m/s de rajada aparecerem em cores diferentes na mesma tela.
  assert.equal(E.VENTO, E.RAJADA);
  assert.equal(E.TEMPERATURA, E.ORVALHO);
});

ok("a escala de vento fecha perto da referência de cor do mapa", () => {
  // REF_COR no windGPU é 26 m/s. Se a sonda fechasse em outro valor, painel e
  // globo diriam coisas diferentes sobre a mesma medida.
  assert.equal(E.VENTO[E.VENTO.length - 1][0], 26);
});

ok("a posição na faixa é linear e cobre 0 a 1", () => {
  const e = E.TEMPERATURA;
  const lo = e[0][0], hi = e[e.length - 1][0];
  assert.equal(E.posicaoNaFaixa(e, lo), 0);
  assert.equal(E.posicaoNaFaixa(e, hi), 1);
  assert.ok(Math.abs(E.posicaoNaFaixa(e, (lo + hi) / 2) - 0.5) < 1e-9);
});

console.log(`\n  ${n} verificações das cores da sonda\n`);
export default n;
