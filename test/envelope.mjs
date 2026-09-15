import assert from "node:assert/strict";
import { montarEnvelope, envelopeDe, baldes, vizinhos, DIAS } from "../server/envelope.js";
import { VARIAVEIS, JANELA_DIAS } from "../server/climatologia.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** 30 anos de serie diaria, com maximo em janeiro (hemisferio sul). */
function arquivo(anos = 30) {
  const time = [], temp = [], chuva = [];
  for (let a = 0; a < anos; a++) {
    const ano = 1991 + a;
    for (let d = 1; d <= 365; d++) {
      time.push(new Date(Date.UTC(ano, 0, d)).toISOString().slice(0, 10));
      temp.push(20 + 10 * Math.cos((2 * Math.PI * d) / 365) + (a % 5) - 2);
      chuva.push(d % 3 === 0 ? (a % 7) * 1.5 : 0);
    }
  }
  return {
    time,
    temperature_2m_mean: temp,
    temperature_2m_max: temp.map((t) => t + 5),
    temperature_2m_min: temp.map((t) => t - 5),
    precipitation_sum: chuva,
    wind_speed_10m_max: temp.map((t) => Math.abs(t) / 3),
  };
}

console.log("\nbaldes e janela");

ok("cada dia do ano tem seus 30 indices", () => {
  const b = baldes(arquivo().time);
  assert.equal(b[1].length, 30, "1/jan apareceu " + b[1].length + " vezes");
  assert.equal(b[200].length, 30);
  // a serie sintetica nao tem 29/fev, entao o dia 366 fica vazio -- e isso
  // tem que virar ausencia, nao zero
  assert.equal(b[DIAS].length, 0);
});

ok("a janela tem 15 dias e da a volta no ano", () => {
  assert.equal(vizinhos(200).length, 2 * JANELA_DIAS + 1);
  const v = vizinhos(2);
  assert.ok(v.includes(360), "2/jan perdeu 26/dez: " + v.join(","));
  assert.ok(v.includes(9));
});

console.log("\nenvelope de uma variavel");

const arq = arquivo();
const bal = baldes(arq.time);

ok("os tres percentis nunca se cruzam", () => {
  const e = envelopeDe(arq.temperature_2m_mean, bal);
  for (let i = 0; i < DIAS; i++) {
    if (e.p10[i] == null) continue;
    assert.ok(e.p10[i] <= e.p50[i], "p10 > p50 no dia " + (i + 1));
    assert.ok(e.p50[i] <= e.p90[i], "p50 > p90 no dia " + (i + 1));
  }
});

// Se a faixa fosse igual o ano inteiro, o dia do ano nao estaria sendo usado --
// e o grafico mostraria uma fita reta atras de uma linha sazonal.
ok("a faixa ACOMPANHA a estacao do ano", () => {
  const e = envelopeDe(arq.temperature_2m_mean, bal);
  const jan = e.p50[14], jul = e.p50[195];
  assert.ok(jan - jul > 15, `jan ${jan?.toFixed(1)} vs jul ${jul?.toFixed(1)}: a faixa esta reta`);
});

ok("cada dia usa as 450 amostras da janela, nao as 30 do proprio dia", () => {
  const e = envelopeDe(arq.temperature_2m_mean, bal);
  assert.equal(e.n[99], 450, "dia 100 teve " + e.n[99] + " amostras");
});

// MEDIDO, e o resultado contraria o que eu ia escrever aqui. Eu esperava que o
// dia 366 ficasse vazio nesta serie sintetica, que nao tem 29/fev. Ele nao
// fica: o enrolamento do ano puxa 31/dez e 1/jan, que e exatamente o que se
// quer. O que a serie nao tem e um dia SEM NENHUM vizinho -- num calendario
// circular esse dia nao existe.
ok("o enrolamento alimenta ate o dia 366, que a serie nao tem", () => {
  const e = envelopeDe(arq.temperature_2m_mean, bal, 0);
  assert.notEqual(e.p50[DIAS - 1], null, "o dia 366 ficou sem normal");
  // e o valor vem da virada do ano, nao de um dia qualquer
  const jan1 = e.p50[0];
  assert.ok(Math.abs(e.p50[DIAS - 1] - jan1) < 0.5,
    `dia 366 deu ${e.p50[DIAS - 1]?.toFixed(1)} e 1/jan deu ${jan1?.toFixed(1)}`);
});

// A ausencia que existe de verdade e a variavel que a fonte nunca publicou
// naquele ponto. Uma faixa desabando para zero seria lida como um evento
// climatico; ela tem que simplesmente nao ser desenhada.
ok("variavel toda ausente vira envelope de nulos, nunca de zeros", () => {
  const vazia = arq.temperature_2m_mean.map(() => null);
  const e = envelopeDe(vazia, bal);
  assert.ok(e.p50.every((x) => x === null), "inventou normal para variavel sem dado");
  assert.ok(e.n.every((x) => x === 0));
});

ok("chuva com mediana zero mantem p50 = 0 sem virar ausencia", () => {
  const e = envelopeDe(arq.precipitation_sum, bal);
  assert.equal(e.p50[99], 0, "p50 da chuva deu " + e.p50[99]);
  assert.notEqual(e.p50[99], null, "confundiu seca com falta de dado");
  assert.ok(e.p90[99] > 0, "a cauda da chuva sumiu");
});

console.log("\nmontagem completa");

ok("todas as variaveis declaradas ganham envelope de 366 dias", () => {
  const r = montarEnvelope(arq);
  for (const nome of Object.keys(VARIAVEIS)) {
    assert.ok(r.variaveis[nome], "faltou " + nome);
    assert.equal(r.variaveis[nome].p50.length, DIAS);
    assert.equal(r.variaveis[nome].p10.length, DIAS);
  }
});

ok("o feitio e a unidade atravessam para o cliente", () => {
  const r = montarEnvelope(arq);
  assert.equal(r.variaveis.precipitation_sum.feitio, "assimetrica");
  assert.equal(r.variaveis.temperature_2m_mean.unidade, "°C");
});

ok("a procedencia diz o periodo, a janela e o que a faixa significa", () => {
  const r = montarEnvelope(arq);
  assert.match(r.referencia, /1991.2020/);
  assert.equal(r.anos, 30);
  assert.match(r.nota, /percentil 10/);
  assert.match(r.nota, /percentil|90/);
  assert.match(r.fonte, /ERA5/);
});

ok("arquivo vazio falha em vez de devolver faixa reta", () => {
  assert.throws(() => montarEnvelope({ time: [] }), /sem s[ée]rie/i);
});

// A rota inteira existe porque este numero e zero: o envelope e aritmetica
// sobre um download que a sonda ja pagou.
ok("montar o envelope nao toca em rede", () => {
  const antes = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("o envelope tentou baixar alguma coisa"); };
  try { montarEnvelope(arq); } finally { globalThis.fetch = antes; }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
