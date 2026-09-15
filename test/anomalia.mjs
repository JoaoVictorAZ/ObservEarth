import assert from "node:assert/strict";
import {
  lerAnomalia, percentilDe, normalUtil, posicaoHistorica, corDaFaixa,
} from "../src/anomalia.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** 21 quantis igualmente espacados entre min e max — distribuicao uniforme. */
const uniforme = (min, max, unidade = "°C", anos = 30) => ({
  q: Array.from({ length: 21 }, (_, i) => min + (max - min) * (i / 20)),
  media: (min + max) / 2,
  anos, unidade,
});

/** Chuva de verdade: mediana zero, cauda longa. */
const chuva = {
  q: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.3, 0.8, 1.6, 3.1, 5.4, 9.2, 15.0, 26.0, 61.0],
  media: 3.4, anos: 30, unidade: "mm/h",
};

console.log("\npercentil");

ok("mediana cai no percentil 50", () => {
  const p = percentilDe(15, uniforme(0, 30));
  assert.ok(Math.abs(p - 50) < 0.001, "deu " + p);
});

ok("interpola entre quantis", () => {
  // entre q[10]=15 e q[11]=16.5, na metade -> 52,5
  const p = percentilDe(15.75, uniforme(0, 30));
  assert.ok(Math.abs(p - 52.5) < 0.001, "deu " + p);
});

ok("valor alem do extremo observado fica na ponta, nao passa de 100", () => {
  const nrm = uniforme(0, 30);
  assert.equal(percentilDe(999, nrm), 100);
  assert.equal(percentilDe(-999, nrm), 0);
});

console.log("\nchuva: a razao de usar percentil e nao desvio-padrao");

// Em muitos lugares a mediana da chuva diaria e ZERO e a media e puxada por
// poucos temporais. "2 desvios acima da media" ali descreve uma distribuicao
// que nao existe.
ok("chuva zero num lugar de mediana zero NAO e anomalia", () => {
  const l = lerAnomalia(0, chuva, "assimetrica", 1);
  assert.equal(l.faixa, "muito abaixo", "faixa " + l.faixa);
  assert.equal(l.percentil, 0);
});

ok("chuva assimetrica NAO reporta desvio em mm", () => {
  const l = lerAnomalia(9.2, chuva, "assimetrica", 1);
  assert.equal(l.desvio, null, "reportou desvio para variavel assimetrica");
  assert.ok(!/[+−]\d/.test(l.texto), "o texto trouxe desvio assinado: " + l.texto);
});

ok("chuva assimetrica ancora na MEDIANA, nao na media", () => {
  const l = lerAnomalia(9.2, chuva, "assimetrica", 1);
  assert.ok(/mediana/i.test(l.texto), "nao citou a mediana: " + l.texto);
  assert.ok(!/m[ée]dia\b/i.test(l.texto.replace(/mediana/gi, "")), "citou a media: " + l.texto);
});

ok("temperatura simetrica REPORTA o desvio, que e o que se quer ler", () => {
  const l = lerAnomalia(20, uniforme(0, 30), "simetrica", 1);
  assert.ok(l.desvio != null);
  assert.ok(Math.abs(l.desvio - 5) < 1e-9, "desvio " + l.desvio);
  assert.ok(/\+5\.0 °C/.test(l.texto), l.texto);
});

console.log("\nfaixas");

ok("as cinco faixas saem nos limites certos", () => {
  const nrm = uniforme(0, 100, "%");
  const f = (v) => lerAnomalia(v, nrm, "assimetrica").faixa;
  assert.equal(f(5), "muito abaixo");
  assert.equal(f(20), "abaixo");
  assert.equal(f(50), "normal");
  assert.equal(f(80), "acima");
  assert.equal(f(95), "muito acima");
});

ok("dentro do normal nao diz 'acima' nem 'abaixo'", () => {
  const t = lerAnomalia(50, uniforme(0, 100, "%"), "assimetrica").texto;
  assert.ok(/normal/i.test(t));
  assert.ok(!/(acima|abaixo)/i.test(t), t);
});

console.log("\nrecusas: sem referencia e melhor que referencia ruim");

ok("menos de 20 anos nao vira normal", () => {
  assert.equal(normalUtil(uniforme(0, 30, "°C", 19)), false);
  assert.equal(normalUtil(uniforme(0, 30, "°C", 20)), true);
  const l = lerAnomalia(15, uniforme(0, 30, "°C", 5));
  assert.equal(l.faixa, "sem referência");
  assert.equal(l.percentil, null);
});

ok("quantis furados demais nao viram normal", () => {
  const furada = { q: Array(21).fill(null).map((_, i) => (i < 5 ? i : null)), media: 2, anos: 30, unidade: "°C" };
  assert.equal(normalUtil(furada), false);
});

ok("valor ausente devolve 'sem referencia', nunca zero", () => {
  for (const v of [null, undefined, NaN, Infinity]) {
    const l = lerAnomalia(v, uniforme(0, 30));
    assert.equal(l.faixa, "sem referência", "valor " + v);
    assert.equal(l.percentil, null);
    assert.equal(l.desvio, null);
  }
});

ok("normal ausente devolve 'sem referencia'", () => {
  assert.equal(lerAnomalia(15, null).faixa, "sem referência");
  assert.equal(lerAnomalia(15, undefined).faixa, "sem referência");
  assert.equal(lerAnomalia(15, { q: [], media: 0, anos: 30, unidade: "" }).faixa, "sem referência");
});

console.log("\ndesenho");

// A barra mostrava posicao numa escala ABSOLUTA fixa (temperatura de -40 a 50),
// igual no Saara e na Groenlandia. Agora mostra a posicao na historia do ponto.
ok("a posicao do marcador e o percentil, nao a escala absoluta", () => {
  const l = lerAnomalia(20, uniforme(0, 30), "simetrica");
  const pos = posicaoHistorica(l);
  assert.ok(Math.abs(pos - 0.6667) < 0.01, "pos " + pos);
});

ok("sem referencia nao desenha marcador", () => {
  assert.equal(posicaoHistorica(lerAnomalia(null, null)), null);
});

ok("cada faixa tem cor, menos 'sem referencia'", () => {
  for (const f of ["muito abaixo", "abaixo", "normal", "acima", "muito acima"]) {
    assert.ok(corDaFaixa(f)?.startsWith("var(--"), "faixa sem cor: " + f);
  }
  assert.equal(corDaFaixa("sem referência"), null);
});

ok("plato de quantis iguais nao produz NaN", () => {
  const l = lerAnomalia(0, chuva, "assimetrica");
  assert.ok(Number.isFinite(l.percentil), "percentil " + l.percentil);
  assert.ok(!/NaN/.test(l.texto), l.texto);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
