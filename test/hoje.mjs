import assert from "node:assert/strict";
import { urlDia, chaveDia, lerDia, buscarDia, CAMPOS } from "../server/hoje.js";
import { VARIAVEIS } from "../server/climatologia.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const okAsync = async (nome, fn) => {
  try { await fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\nagregado do dia");

// ESTE E O TESTE QUE IMPORTA. A comparacao inteira e feita casando as chaves
// do agregado de hoje com as chaves da normal. Se uma das duas listas mudar
// sozinha, a variavel some da tela sem erro nenhum -- ou pior, uma grandeza
// e confrontada com a distribuicao de outra.
ok("as chaves de hoje sao AS MESMAS da normal", () => {
  assert.deepEqual(CAMPOS.slice().sort(), Object.keys(VARIAVEIS).sort());
});

ok("a URL pede exatamente o dia pedido, nao a semana", () => {
  const u = urlDia(-22.9, -43.2, "2026-09-07");
  assert.ok(u.includes("start_date=2026-09-07"), u);
  assert.ok(u.includes("end_date=2026-09-07"), u);
  assert.ok(u.includes("wind_speed_unit=ms"), "sem isso o vento volta em km/h e o percentil sai errado");
  for (const k of CAMPOS) assert.ok(u.includes(k), "faltou " + k);
});

ok("a chave leva a DATA: a normal nao muda, o agregado de hoje muda", () => {
  assert.notEqual(chaveDia(0, 0, "2026-09-07"), chaveDia(0, 0, "2026-09-08"));
  assert.equal(chaveDia(-22.91, -43.18, "2026-09-07"), chaveDia(-22.95, -43.22, "2026-09-07"));
});

const diario = (extra = {}) => ({
  time: ["2026-09-06", "2026-09-07"],
  temperature_2m_mean: [18.0, 21.5],
  temperature_2m_max: [24.0, 29.5],
  temperature_2m_min: [12.0, 14.5],
  precipitation_sum: [0, 0],
  wind_speed_10m_max: [4.1, 9.8],
  ...extra,
});

ok("pega a linha do dia pedido, nao a primeira da lista", () => {
  const v = lerDia(diario(), "2026-09-07");
  assert.equal(v.temperature_2m_max, 29.5);
  assert.equal(v.temperature_2m_min, 14.5);
});

ok("dia fora da serie devolve null, nao a linha vizinha", () => {
  assert.equal(lerDia(diario(), "2026-01-01"), null);
  assert.equal(lerDia({ time: [] }, "2026-09-07"), null);
  assert.equal(lerDia(undefined, "2026-09-07"), null);
});

// Zero de chuva e uma medicao. Ausencia de chuva nao e.
ok("ausencia vira null e nunca zero", () => {
  const v = lerDia(diario({ precipitation_sum: [0, null] }), "2026-09-07");
  assert.equal(v.precipitation_sum, null, "transformou ausencia em seca");
  const z = lerDia(diario(), "2026-09-07");
  assert.equal(z.precipitation_sum, 0, "transformou seca em ausencia");
});

ok("variavel que a API nao devolveu vira null, nao quebra", () => {
  const d = diario();
  delete d.wind_speed_10m_max;
  const v = lerDia(d, "2026-09-07");
  assert.equal(v.wind_speed_10m_max, null);
  assert.equal(v.temperature_2m_max, 29.5);
});

console.log("\nbusca e cache");

await okAsync("cacheia por ponto e dia", async () => {
  let chamadas = 0;
  const memo = new Map();
  const cache = async (k, _t, prod) => {
    if (memo.has(k)) return memo.get(k);
    const v = await prod(); memo.set(k, v); return v;
  };
  const f = async () => { chamadas++; return { ok: true, json: async () => ({ daily: diario() }) }; };

  await buscarDia(f, -22.9, -43.2, "2026-09-07", cache);
  await buscarDia(f, -22.92, -43.21, "2026-09-07", cache);
  assert.equal(chamadas, 1, `bateu ${chamadas} vezes na API para o mesmo ponto e dia`);

  await buscarDia(f, -22.9, -43.2, "2026-09-06", cache);
  assert.equal(chamadas, 2, "outro dia tem que ser outra requisicao");
});

await okAsync("dia sem cobertura falha em vez de inventar", async () => {
  const cache = async (_k, _t, prod) => prod();
  const f = async () => ({ ok: true, json: async () => ({ daily: diario() }) });
  await assert.rejects(
    () => buscarDia(f, 0, 0, "1970-01-01", cache),
    (e) => e.status === 502 && /agregado/i.test(e.message),
  );
});

await okAsync("erro HTTP vira 502", async () => {
  const cache = async (_k, _t, prod) => prod();
  await assert.rejects(
    () => buscarDia(async () => ({ ok: false, status: 429 }), 0, 0, "2026-09-07", cache),
    (e) => e.status === 502,
  );
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
