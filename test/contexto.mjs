import assert from "node:assert/strict";
import { dossieParaTexto, tokensAprox } from "../src/llm/contexto.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const dossie = {
  ponto: { lat: -22.589, lng: -42.651, lugar: "Rio de Janeiro, Brazil" },
  referencia: { data: "2026-08-12", horaUTC: 12, janelaH: 24, passoH: 3 },
  esquema: { temperatura: { unidade: "°C", fonte: "Open-Meteo", campo: "temperature_2m", desc: "temperatura do ar a 2 m" } },
  campoNoPonto: { ventoVel: 7.4, ventoDir: 118, fonte: "GFS 0,25°" },
  serie: [
    { at: "2026-08-12T09:00", ref: false, valores: { temperatura: 21.5, ventoVel: null } },
    { at: "2026-08-12T12:00", ref: true,  valores: { temperatura: 24.1, ventoVel: 7.4 } },
  ],
  resumo: {
    temperatura: { n: 2, ausentes: 0, min: 21.5, max: 24.1, media: 22.8, delta: 2.6, tendencia: "subindo", unidade: "°C" },
    ventoVel: { n: 1, ausentes: 1, min: 7.4, max: 7.4, media: 7.4, delta: null, tendencia: null, unidade: "m/s" },
  },
  lacunas: ["ventoVel: 1 de 2 instantes sem dado"],
};

console.log("\ndossie em texto para o modelo");

ok("nenhum numero se perde na traducao", () => {
  const t = dossieParaTexto(dossie);
  for (const v of ["-22.589", "-42.651", "21.5", "24.1", "22.8", "2.6", "7.4", "118"]) {
    assert.ok(t.includes(v), "sumiu: " + v);
  }
});

// A regra do projeto inteiro: ausencia nunca vira zero.
ok("null vira 'sem dado', nunca zero", () => {
  const t = dossieParaTexto(dossie);
  assert.ok(t.includes("sem dado"), "nao marcou a ausencia");
  assert.ok(!/vento: .*\b0\b/.test(t), "transformou ausencia em zero");
});

ok("as unidades acompanham os numeros", () => {
  const t = dossieParaTexto(dossie);
  assert.ok(t.includes("°C") && t.includes("m/s"), "perdeu unidade");
});

ok("o instante de referencia e marcado", () => {
  assert.ok(/«referência»/.test(dossieParaTexto(dossie)), "nao marcou a referencia");
});

ok("o vento da grade do mapa aparece, para poder ser confrontado", () => {
  assert.ok(/GRADE DO MAPA/.test(dossieParaTexto(dossie)));
});

ok("as lacunas sao declaradas", () => {
  assert.ok(/LACUNAS/.test(dossieParaTexto(dossie)));
});

// A razao de existir do arquivo: o JSON cru afogava um modelo de 8B.
ok("o texto e bem menor que o JSON cru", () => {
  const cru = JSON.stringify(dossie);
  const txt = dossieParaTexto(dossie);
  assert.ok(txt.length < cru.length, `texto ${txt.length} nao e menor que JSON ${cru.length}`);
});

ok("nao carrega metadado que nao ajuda a responder", () => {
  const t = dossieParaTexto(dossie);
  assert.ok(!t.includes("temperature_2m"), "levou o nome do campo da API");
  assert.ok(!t.includes("\"unidade\""), "levou chave de JSON");
});

console.log("\nentradas degeneradas");

ok("dossie nulo nao quebra", () => {
  assert.equal(typeof dossieParaTexto(null), "string");
  assert.ok(dossieParaTexto(null).length > 0);
});

ok("dossie vazio nao quebra nem inventa", () => {
  const t = dossieParaTexto({});
  assert.equal(typeof t, "string");
  assert.ok(!/NaN|undefined/.test(t), "vazou lixo: " + t);
});

ok("serie sem valores nao vira NaN", () => {
  const t = dossieParaTexto({ serie: [{ at: "x", valores: {} }] });
  assert.ok(!/NaN|undefined/.test(t), t);
});

ok("estimativa de tokens e proporcional e nunca zero", () => {
  assert.ok(tokensAprox("") >= 0);
  assert.ok(tokensAprox("a".repeat(350)) === 100);
  assert.ok(tokensAprox("a".repeat(700)) > tokensAprox("a".repeat(350)));
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
