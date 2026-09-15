import assert from "node:assert/strict";
import { diaDoAno, alinhar, contar, frase } from "../src/analysis/normalSerie.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** envelope sintetico: p10 = 10, p50 = 15, p90 = 20, todo dia do ano */
const env = (p10 = 10, p50 = 15, p90 = 20) => ({
  p10: Array(366).fill(p10), p50: Array(366).fill(p50), p90: Array(366).fill(p90),
  n: Array(366).fill(450), unidade: "°C", rotulo: "temperatura média",
});

console.log("\ndia do ano");

ok("primeiro e ultimo dia, em UTC", () => {
  assert.equal(diaDoAno("2026-01-01"), 1);
  assert.equal(diaDoAno("2026-12-31"), 365);
  assert.equal(diaDoAno("2024-12-31"), 366, "2024 e bissexto");
});

ok("data invalida devolve null, nao NaN nem 0", () => {
  assert.equal(diaDoAno("nao-e-data"), null);
  assert.equal(diaDoAno(""), null);
});

console.log("\nalinhamento");

ok("cada data observada recebe a normal DO SEU dia do ano", () => {
  const e = env();
  // p50 diferente em cada dia, para dar pra ver se pegou o indice certo
  e.p50 = Array.from({ length: 366 }, (_, i) => i + 1);
  const f = alinhar(["2026-01-01", "2026-03-01", "2026-12-31"], e);
  assert.equal(f[0].p50, 1);
  assert.equal(f[1].p50, 60, "1/mar de ano comum e o dia 60");
  assert.equal(f[2].p50, 365);
});

ok("data ilegivel nao cola a normal de 1/jan num dia qualquer", () => {
  const f = alinhar(["lixo"], env());
  assert.equal(f[0].p50, null, "usou o indice 0 como se fosse 1/jan");
});

ok("sem envelope, alinhamento vazio em vez de faixa achatada", () => {
  assert.deepEqual(alinhar(["2026-01-01"], null), []);
  assert.deepEqual(alinhar(["2026-01-01"], undefined), []);
});

ok("buraco no envelope atravessa como ausencia", () => {
  const e = env();
  e.p10[0] = null; e.p90[0] = null;
  const f = alinhar(["2026-01-01"], e);
  assert.equal(f[0].p10, null);
});

console.log("\ncontagem de dias fora da faixa");

const faixa = (datas) => alinhar(datas, env());

ok("acima do p90 e abaixo do p10 sao contados separados", () => {
  const datas = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
  const c = contar([25, 5, 15, 20], faixa(datas));
  assert.equal(c.acima, 1);
  assert.equal(c.abaixo, 1);
  assert.equal(c.dentro, 2, "o valor igual ao p90 tem que contar como dentro");
  assert.equal(c.comparados, 4);
});

// Em precipitacao o p10 e zero em boa parte do planeta. Tratar `valor <= p10`
// como "abaixo" faria todo dia seco virar anomalia seca -- exatamente a leitura
// que o percentil existe para evitar.
ok("valor IGUAL ao limite fica dentro, nao fora", () => {
  const c = contar([0, 0], alinhar(["2026-05-01", "2026-05-02"], env(0, 0, 3)));
  assert.equal(c.abaixo, 0, "marcou dia seco como anomalia seca");
  assert.equal(c.dentro, 2);
});

ok("dia sem valor observado nao entra na conta", () => {
  const c = contar([null, 25, NaN], faixa(["2026-01-01", "2026-01-02", "2026-01-03"]));
  assert.equal(c.comparados, 1);
  assert.equal(c.acima, 1);
});

ok("dia sem normal nao entra na conta, mesmo com valor observado", () => {
  const e = env();
  e.p10[0] = null; e.p90[0] = null;
  const c = contar([99], alinhar(["2026-01-01"], e));
  assert.equal(c.comparados, 0, "comparou contra normal ausente");
  assert.equal(c.acima, 0);
});

ok("o recorde e a MAIOR margem, nao o ultimo nem o maior valor bruto", () => {
  const datas = ["2026-01-01", "2026-01-02", "2026-01-03"];
  // 22 passa 2 do p90; -20 fica 30 abaixo do p10 -- a margem maior e a de baixo
  const c = contar([22, -20, 21], faixa(datas));
  assert.equal(c.recorde.lado, "abaixo");
  assert.equal(c.recorde.margem, 30);
  assert.equal(c.recorde.valor, -20);
});

ok("periodo sem nenhum dia comparavel devolve zeros, nao recorde falso", () => {
  const c = contar([], []);
  assert.equal(c.comparados, 0);
  assert.equal(c.recorde, null);
  assert.equal(frase(c, "Temperatura"), null, "escreveu frase sobre zero dias");
});

console.log("\nleitura");

// "23 dias acima do p90" sozinho nao diz nada: em 365 dias esperam-se ~37.
// Nesse exemplo a leitura correta e que o periodo foi mais FRIO que o normal.
ok("a frase traz o ESPERADO ao lado do observado", () => {
  const datas = Array.from({ length: 100 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const vals = datas.map((_, i) => (i < 30 ? 25 : 15));
  const f = frase(contar(vals, faixa(datas)), "Temperatura");
  assert.match(f, /30 dias acima/);
  assert.match(f, /~10 de cada lado/, f);
});

ok("periodo todo dentro da faixa e dito, nao omitido", () => {
  const datas = ["2026-01-01", "2026-01-02"];
  const f = frase(contar([15, 16], faixa(datas)), "Temperatura");
  assert.match(f, /nenhum/i);
  assert.match(f, /2 dias/);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
