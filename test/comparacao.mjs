import assert from "node:assert/strict";
import { montarPainel, manchete, frasePainel, LINHAS } from "../src/probe/comparacao.ts";
import { reguaDe, posicaoNaRegua } from "../src/anomalia.ts";
import { VARIAVEIS } from "../server/climatologia.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** normal uniforme entre min e max, com os 21 quantis */
const nrm = (min, max, unidade, feitio, rotulo) => ({
  q: Array.from({ length: 21 }, (_, i) => min + (max - min) * (i / 20)),
  media: (min + max) / 2, anos: 30, amostras: 450, unidade, feitio, rotulo,
});

/** chuva de verdade: mediana zero, cauda longa */
const chuva = {
  q: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.9, 2.4, 5.1, 9.0, 15.2, 24.0, 38.0, 61.0, 122.0],
  media: 8.1, anos: 30, amostras: 450, unidade: "mm", feitio: "assimetrica", rotulo: "precipitação diária",
};

const clima = (valores, extra = {}) => ({
  referencia: "1991–2020", diaDoAno: 250, janelaDias: 7, anos: 30,
  fonte: "ERA5 via Open-Meteo Archive",
  nota: "…",
  normais: {
    temperature_2m_max: nrm(18, 34, "°C", "simetrica", "temperatura máxima"),
    temperature_2m_min: nrm(8, 20, "°C", "simetrica", "temperatura mínima"),
    temperature_2m_mean: nrm(13, 27, "°C", "simetrica", "temperatura média"),
    precipitation_sum: chuva,
    wind_speed_10m_max: nrm(1, 14, "m/s", "assimetrica", "vento máximo"),
  },
  hoje: valores === null ? null : { data: "2026-09-07", valores, fonte: "Open-Meteo", nota: "…" },
  ...extra,
});

const normalDia = { temperature_2m_max: 26, temperature_2m_min: 14, temperature_2m_mean: 20, precipitation_sum: 0.2, wind_speed_10m_max: 7.5 };

console.log("\nregua em unidade, nao em percentil");

// A barra antiga marcava a posicao numa escala ABSOLUTA fixa: temperatura de
// -40 a 50, igual no Saara e na Groenlandia.
ok("a regua e a historia DAQUELE ponto, nao uma escala global", () => {
  const quente = reguaDe(nrm(30, 48, "°C", "simetrica", ""));
  const frio = reguaDe(nrm(-25, 2, "°C", "simetrica", ""));
  assert.equal(posicaoNaRegua(39, quente), 0.5);
  assert.equal(posicaoNaRegua(-11.5, frio), 0.5);
  // o MESMO valor cai em pontas opostas nos dois lugares
  assert.equal(posicaoNaRegua(2, quente), 0);
  assert.equal(posicaoNaRegua(2, frio), 1);
});

ok("valor alem do observado gruda na ponta, nao sai da barra", () => {
  const r = reguaDe(nrm(18, 34, "°C", "simetrica", ""));
  assert.equal(posicaoNaRegua(999, r), 1);
  assert.equal(posicaoNaRegua(-999, r), 0);
});

ok("distribuicao degenerada nao vira regua de largura zero", () => {
  const plano = { q: Array(21).fill(7), media: 7, anos: 30, unidade: "°C" };
  assert.equal(reguaDe(plano), null, "regua com min == max produziria divisao por zero");
});

console.log("\nlinhas do painel");

ok("as linhas existem todas na climatologia do servidor", () => {
  for (const l of LINHAS) {
    assert.ok(VARIAVEIS[l.id], `${l.id} nao existe em VARIAVEIS: a linha ficaria vazia para sempre`);
  }
});

ok("a ordem e a de leitura: maxima primeiro, media por ultimo", () => {
  const p = montarPainel(clima(normalDia));
  assert.equal(p.linhas[0].id, "temperature_2m_max");
  assert.equal(p.linhas[p.linhas.length - 1].id, "temperature_2m_mean");
});

ok("a banda p10-p90 e desenhada em unidade e nao ocupa sempre 10%-90%", () => {
  const p = montarPainel(clima(normalDia));
  const t = p.linhas.find((l) => l.id === "temperature_2m_max");
  const c = p.linhas.find((l) => l.id === "precipitation_sum");
  // uniforme: p10 e p90 caem em 10% e 90% da regua
  assert.ok(Math.abs(t.banda.de - 0.1) < 1e-9, "uniforme deu " + t.banda.de);
  // chuva assimetrica: p10 = 0 = minimo, e p90 fica bem antes do maximo
  assert.equal(c.banda.de, 0, "p10 de chuva com mediana zero tem que colar na esquerda");
  assert.ok(c.banda.ate < 0.4, "a cauda longa da chuva sumiu: p90 em " + c.banda.ate);
});

console.log("\nmanchete");

ok("dia comum NAO produz manchete", () => {
  const p = montarPainel(clima(normalDia));
  assert.equal(p.manchete, null, "destacou " + p.manchete?.rotulo);
  assert.match(frasePainel(p), /dentro da normal/i);
});

ok("a manchete e a linha MAIS distante da mediana", () => {
  const p = montarPainel(clima({ ...normalDia, temperature_2m_max: 33.8, wind_speed_10m_max: 9 }));
  assert.equal(p.manchete.id, "temperature_2m_max", "escolheu " + p.manchete?.id);
  assert.match(frasePainel(p), /Máxima do dia/);
});

ok("frio extremo ganha manchete tanto quanto calor extremo", () => {
  const p = montarPainel(clima({ ...normalDia, temperature_2m_min: 8.2 }));
  assert.equal(p.manchete.id, "temperature_2m_min");
  assert.match(p.manchete.leitura.faixa, /muito abaixo/);
});

console.log("\no que a tela pode afirmar");

// Temperatura autoriza "+3,4 °C acima"; chuva nao, porque a media de chuva e
// puxada por poucos dias e descreveria uma distribuicao que nao existe.
ok("temperatura traz desvio em grau; chuva traz mediana", () => {
  const p = montarPainel(clima({ ...normalDia, temperature_2m_max: 32, precipitation_sum: 40 }));
  const t = p.linhas.find((l) => l.id === "temperature_2m_max");
  const c = p.linhas.find((l) => l.id === "precipitation_sum");
  assert.ok(t.leitura.desvio != null && /°C/.test(t.leitura.texto), t.leitura.texto);
  assert.equal(c.leitura.desvio, null, "reportou desvio em mm: " + c.leitura.texto);
  assert.match(c.leitura.texto, /mediana/i);
});

ok("cada linha comparavel tem cor; sem referencia nao tem", () => {
  const p = montarPainel(clima({ ...normalDia, temperature_2m_max: 32 }));
  const t = p.linhas.find((l) => l.id === "temperature_2m_max");
  assert.ok(t.cor?.startsWith("var(--"), "cor " + t.cor);
  const sem = montarPainel(clima({ ...normalDia, temperature_2m_max: null }));
  assert.equal(sem.linhas.find((l) => l.id === "temperature_2m_max").cor, null);
});

console.log("\nausencias: melhor sem resposta que resposta inventada");

ok("sem agregado de hoje, as linhas ficam sem valor mas a regua permanece", () => {
  const p = montarPainel(clima(null));
  assert.equal(p.comparaveis, 0);
  assert.equal(p.linhas[0].valor, null);
  assert.equal(p.linhas[0].pos, null, "desenhou marcador sem valor");
  assert.ok(p.linhas[0].regua, "perdeu a distribuicao historica, que nao dependia de hoje");
  assert.match(frasePainel(p), /sem agregado/i);
});

ok("variavel ausente de hoje nao contamina as outras", () => {
  const p = montarPainel(clima({ ...normalDia, precipitation_sum: null }));
  assert.equal(p.linhas.find((l) => l.id === "precipitation_sum").pos, null);
  assert.ok(p.linhas.find((l) => l.id === "temperature_2m_max").pos != null);
});

ok("normal fraca nao vira percentil", () => {
  const c = clima(normalDia);
  c.normais.temperature_2m_max = { ...c.normais.temperature_2m_max, anos: 6 };
  const l = montarPainel(c).linhas.find((x) => x.id === "temperature_2m_max");
  assert.equal(l.leitura.faixa, "sem referência");
  assert.equal(l.leitura.percentil, null);
  assert.equal(l.regua, null, "desenhou regua a partir de normal que ele mesmo recusou");
});

ok("resposta vazia ou quebrada devolve null, nao painel meio montado", () => {
  assert.equal(montarPainel(null), null);
  assert.equal(montarPainel({}), null);
  assert.equal(montarPainel({ normais: {} }), null);
  assert.equal(frasePainel(null), null);
});

ok("a procedencia atravessa para a tela", () => {
  const p = montarPainel(clima(normalDia));
  assert.match(p.referencia, /1991/);
  assert.equal(p.anos, 30);
  assert.equal(p.janelaDias, 7);
  assert.match(p.fonteNormal, /ERA5/);
  assert.equal(p.dataHoje, "2026-09-07");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
