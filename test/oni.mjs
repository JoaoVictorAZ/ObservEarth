import assert from "node:assert/strict";
import {
  lerONI, episodios, intensidade, em, frase, buscarONI,
  MES_DO_TRIMESTRE, LIMIAR, MINIMO_CONSECUTIVO,
} from "../server/oni.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const okAsync = async (nome, fn) => {
  try { await fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

// Formato do arquivo do CPC, com o cabecalho e o espacamento irregular que ele
// tem de verdade.
const ARQUIVO = `SEAS YR  TOTAL ANOM
DJF 1950 24.72 -1.53
JFM 1950 25.17 -1.34
FMA 1950 25.75 -1.16

`;

const TRIMESTRES = Object.keys(MES_DO_TRIMESTRE);

/** monta uma serie sintetica a partir de uma lista de anomalias */
function serieDe(valores, ano = 2020) {
  return valores.map((v, i) => ({
    trimestre: TRIMESTRES[i % 12],
    ano: ano + Math.floor(i / 12),
    mes: (i % 12) + 1,
    tsm: 27,
    anomalia: v,
  }));
}

console.log("\nleitura do arquivo");

ok("le as linhas de dado e pula cabecalho e linha em branco", () => {
  const s = lerONI(ARQUIVO);
  assert.equal(s.length, 3, "leu " + s.length);
  assert.equal(s[0].trimestre, "DJF");
  assert.equal(s[0].ano, 1950);
  assert.equal(s[0].anomalia, -1.53);
  assert.equal(s[0].tsm, 24.72);
});

// NDJ e o unico trimestre que atravessa a virada do ano; derivar o mes das
// iniciais quebraria exatamente nele.
ok("cada trimestre e ancorado no MES DO MEIO", () => {
  assert.equal(MES_DO_TRIMESTRE.DJF, 1, "DJF pertence a janeiro");
  assert.equal(MES_DO_TRIMESTRE.JJA, 7);
  assert.equal(MES_DO_TRIMESTRE.NDJ, 12, "NDJ pertence a dezembro");
  assert.equal(Object.keys(MES_DO_TRIMESTRE).length, 12);
});

ok("a serie sai ordenada no tempo", () => {
  const s = lerONI(`FMA 1951 25.0 0.1\nDJF 1950 24.7 -1.5\nJFM 1950 25.1 -1.3`);
  assert.deepEqual(s.map((x) => `${x.ano}-${x.mes}`), ["1950-1", "1950-2", "1951-3"]);
});

ok("lixo devolve lista vazia em vez de explodir", () => {
  for (const x of [null, undefined, "", "abacaxi", "XYZ 1950 a b"]) {
    assert.deepEqual(lerONI(x), []);
  }
});

console.log("\nepisodios: o erro classico deste dado");

// UM trimestre acima de 0,5 nao e um El Nino. O criterio oficial exige cinco
// consecutivos, e o numero isolado esta bem ali tentando ser lido errado.
ok("um pico isolado NAO vira El Nino", () => {
  const s = episodios(serieDe([0, 0.1, 0.9, 0.2, 0, 0]));
  assert.equal(s[2].fase, "neutro", "declarou episodio com um trimestre so");
});

ok("quatro consecutivos ainda nao bastam", () => {
  const s = episodios(serieDe([0, 0.8, 0.9, 1.0, 0.7, 0, 0]));
  assert.ok(s.slice(1, 5).every((x) => x.fase === "neutro"),
    "declarou episodio com " + (MINIMO_CONSECUTIVO - 1) + " trimestres");
});

ok("cinco consecutivos declaram o episodio, e so eles", () => {
  const s = episodios(serieDe([0.1, 0.8, 0.9, 1.0, 1.1, 0.7, 0.2]));
  assert.equal(s[0].fase, "neutro");
  assert.ok(s.slice(1, 6).every((x) => x.fase === "el nino"), s.map((x) => x.fase).join(","));
  assert.equal(s[6].fase, "neutro");
});

ok("La Nina e reconhecida do mesmo jeito, do outro lado", () => {
  const s = episodios(serieDe([0, -0.6, -0.9, -1.2, -1.0, -0.7, 0]));
  assert.ok(s.slice(1, 6).every((x) => x.fase === "la nina"));
});

// Uma corrida que troca de sinal no meio nao e uma corrida.
ok("a corrida quebra ao cruzar o zero", () => {
  const s = episodios(serieDe([0.8, 0.9, 1.0, -0.8, -0.9, -1.0, -0.7]));
  assert.equal(s[0].fase, "neutro", "contou dois lados como uma corrida so");
  assert.equal(s[3].fase, "neutro", "a corrida negativa tem 4, nao 5");
});

ok("exatamente no limiar conta como dentro", () => {
  const s = episodios(serieDe(Array(6).fill(LIMIAR)));
  assert.ok(s.every((x) => x.fase === "el nino"), "o limiar ficou de fora do proprio limiar");
});

ok("serie vazia devolve vazio", () => {
  assert.deepEqual(episodios([]), []);
});

console.log("\nintensidade");

ok("a escala do CPC sai nos degraus certos", () => {
  const f = (v) => intensidade({ fase: "el nino", anomalia: v });
  assert.equal(f(0.7), "fraco");
  assert.equal(f(1.2), "moderado");
  assert.equal(f(1.7), "forte");
  assert.equal(f(2.4), "muito forte");
});

// "La Nina fraca" e "neutro com -0,6" sao coisas diferentes, e a segunda nao
// tem nome.
ok("trimestre neutro NAO ganha intensidade", () => {
  assert.equal(intensidade({ fase: "neutro", anomalia: -0.6 }), null);
  assert.equal(intensidade(null), null);
});

ok("a intensidade nao depende do sinal", () => {
  assert.equal(intensidade({ fase: "la nina", anomalia: -1.7 }), "forte");
});

console.log("\nconsulta e frase");

ok("acha o trimestre de um ano e mes", () => {
  const s = episodios(serieDe([0.1, 0.2, 0.3]));
  assert.equal(em(s, 2020, 2).trimestre, "JFM");
  assert.equal(em(s, 1999, 1), null);
});

// A frase descreve o INDICE e nunca o efeito: El Nino traz chuva ao Sul e seca
// ao Nordeste, entao uma frase unica para o Brasil seria falsa.
ok("a frase traz o numero, o trimestre e nao afirma efeito local", () => {
  const s = episodios(serieDe([0.8, 0.9, 1.6, 1.7, 1.1, 0.9]));
  const t = frase(s[3]);
  assert.match(t, /El Niño/);
  assert.match(t, /forte/);
  assert.match(t, /MAM/);
  assert.ok(!/chuva|seca|Brasil|Nordeste|Sul/i.test(t), "a frase afirmou efeito local: " + t);
});

ok("neutro tambem produz frase, e ela diz neutro", () => {
  const s = episodios(serieDe([0.1]));
  assert.match(frase(s[0]), /neutro/i);
});

ok("sem registro, sem frase — e nao string vazia", () => {
  assert.equal(frase(null), null);
});

ok("o sinal negativo usa o menos tipografico, como no resto do app", () => {
  const s = episodios(serieDe([-0.3]));
  assert.match(frase(s[0]), /−0\.3/);
});

console.log("\nbusca");

await okAsync("busca, classifica e declara procedencia", async () => {
  const cache = async (_k, _t, prod) => prod();
  const r = await buscarONI(async () => ({ ok: true, text: async () => ARQUIVO }), cache);
  assert.equal(r.serie.length, 3);
  assert.equal(r.ultimo.trimestre, "FMA");
  assert.match(r.fonte, /NOAA/);
  assert.match(r.licenca, /p[úu]blico/i);
  assert.match(r.nota, new RegExp(String(MINIMO_CONSECUTIVO)));
  assert.match(r.nota, /Nordeste/, "a ressalva regional nao atravessou para a tela");
});

await okAsync("arquivo ilegivel vira 502, nao serie vazia silenciosa", async () => {
  const cache = async (_k, _t, prod) => prod();
  await assert.rejects(
    () => buscarONI(async () => ({ ok: true, text: async () => "manutenção" }), cache),
    (e) => e.status === 502,
  );
});

await okAsync("erro HTTP vira 502", async () => {
  const cache = async (_k, _t, prod) => prod();
  await assert.rejects(
    () => buscarONI(async () => ({ ok: false, status: 500 }), cache),
    (e) => e.status === 502,
  );
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
