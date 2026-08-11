// test/series-chart.mjs
// -----------------------------------------------------------------------------
// A matemática do gráfico e do CSV.
//
// O gráfico anterior filtrava os nulos e depois posicionava o que sobrou por
// ÍNDICE. O eixo rotulado "tempo" era, na verdade, "n-ésimo ponto que tinha
// dado". Uma série com 200 dias faltando no meio saía como linha contínua e
// uniforme: a lacuna desaparecia e o resto se esticava para tapar o buraco.
//
// E a legenda imprimia o mínimo da série ao lado da data do PRIMEIRO ponto.
// Duas informações verdadeiras coladas numa afirmação falsa.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  pontos, envelope, extremos, trechos, escala, marcas,
} from "../src/analysis/series.ts";
import { paraCSV, celula } from "../src/analysis/csv.ts";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ngráfico e exportação");

const DIA = 86400e3;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// eixo do tempo
// ---------------------------------------------------------------------------
ok("data sem hora é lida como meia-noite UTC, não como hora local", () => {
  // Sem o Z explícito, "2026-08-11" em alguns runtimes é local: a série inteira
  // desliza algumas horas e, perto da virada do dia, muda de data.
  const p = pontos(["2026-08-11"], [1]);
  assert.equal(p[0].t, Date.parse("2026-08-11T00:00:00Z"));
});

ok("null atravessa a conversão sem virar número", () => {
  const p = pontos(["2026-08-11", "2026-08-12"], [null, 3]);
  assert.equal(p[0].v, null);
  assert.equal(p[1].v, 3);
});

ok("o eixo é o TEMPO: uma lacuna ocupa espaço proporcional", () => {
  // Um ponto no dia 0, outro no dia 1, outro no dia 100. O terceiro tem que
  // cair perto do fim do eixo — não a dois terços, como daria o índice.
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const ps = [
    { t: t0, v: 10 },
    { t: t0 + DIA, v: 11 },
    { t: t0 + 100 * DIA, v: 12 },
  ];
  const cols = envelope(ps, 100);
  const span = ps[2].t - ps[0].t;
  const frac = cols.map((c) => (c.t - ps[0].t) / span);
  assert.ok(frac[1] < 0.02, `segundo ponto a ${(frac[1] * 100).toFixed(1)}% do eixo`);
  assert.ok(frac[2] > 0.98);
});

// ---------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------
ok("séries curtas passam inteiras, sem redução", () => {
  const ps = Array.from({ length: 30 }, (_, i) => ({ t: i * DIA, v: i }));
  assert.equal(envelope(ps, 100).length, 30);
});

ok("séries longas cabem no número de colunas pedido", () => {
  const ps = Array.from({ length: 3652 }, (_, i) => ({ t: i * DIA, v: Math.sin(i / 30) }));
  const c = envelope(ps, 240);
  assert.ok(c.length <= 240, `saíram ${c.length} colunas`);
  assert.ok(c.length > 200, `redução exagerada: ${c.length}`);
});

ok("a redução PRESERVA os extremos — nenhum pico se perde", () => {
  // Reduzir pegando um a cada N descartaria justamente o dia de pico. Ele
  // sumiria do gráfico e continuaria no CSV.
  const ps = Array.from({ length: 3652 }, (_, i) => ({ t: i * DIA, v: 20 }));
  ps[1777] = { t: 1777 * DIA, v: 148.6 };   // um dia de chuva extrema
  ps[2003] = { t: 2003 * DIA, v: -31.2 };
  const c = envelope(ps, 200);
  assert.equal(Math.max(...c.map((x) => x.max)), 148.6, "o pico sumiu na redução");
  assert.equal(Math.min(...c.map((x) => x.min)), -31.2, "o vale sumiu na redução");
});

ok("cada coluna contém min ≤ média ≤ max", () => {
  const ps = Array.from({ length: 1000 }, (_, i) => ({ t: i * DIA, v: Math.sin(i / 17) * 30 }));
  for (const c of envelope(ps, 120)) {
    assert.ok(c.min <= c.media + 1e-9 && c.media <= c.max + 1e-9, `coluna incoerente ${JSON.stringify(c)}`);
    assert.ok(c.n >= 1);
  }
});

ok("todas as observações são contadas exatamente uma vez", () => {
  // Um erro de borda no cálculo do balde perderia o último ponto em silêncio,
  // ou o contaria duas vezes.
  const ps = Array.from({ length: 777 }, (_, i) => ({ t: i * DIA, v: i }));
  const total = envelope(ps, 100).reduce((s, c) => s + c.n, 0);
  assert.equal(total, 777);
});

ok("nulos não entram no envelope nem criam coluna", () => {
  const ps = [
    { t: 0, v: 5 },
    { t: DIA, v: null },
    { t: 2 * DIA, v: 7 },
  ];
  const c = envelope(ps, 100);
  assert.equal(c.length, 2);
  assert.equal(c.reduce((s, x) => s + x.n, 0), 2);
});

ok("série sem nenhum dado devolve nada, e não uma coluna de zeros", () => {
  assert.deepEqual(envelope([{ t: 0, v: null }], 100), []);
  assert.deepEqual(envelope([], 100), []);
});

ok("todos os pontos no mesmo instante não quebram a divisão", () => {
  const ps = [{ t: 0, v: 1 }, { t: 0, v: 5 }, { t: 0, v: 3 }];
  const c = envelope(ps, 50);
  assert.ok(c.length >= 1);
  assert.ok(c.every((x) => Number.isFinite(x.min) && Number.isFinite(x.max)));
});

// ---------------------------------------------------------------------------
// extremos — a legenda mentirosa
// ---------------------------------------------------------------------------
ok("o mínimo vem com a data em que ele ocorreu", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const ps = [
    { t: t0, v: 20 },
    { t: t0 + DIA, v: 3.2 },     // o mínimo, no segundo dia
    { t: t0 + 2 * DIA, v: 25 },
  ];
  const e = extremos(ps);
  assert.equal(e.min.valor, 3.2);
  assert.equal(iso(e.min.t), "2026-01-02", "a data do mínimo veio do início da série");
  assert.equal(e.max.valor, 25);
  assert.equal(iso(e.max.t), "2026-01-03");
});

ok("empate fica com a primeira ocorrência, de forma estável", () => {
  const ps = [{ t: 10, v: 5 }, { t: 20, v: 5 }, { t: 30, v: 9 }];
  assert.equal(extremos(ps).min.t, 10);
});

ok("sem dado não há extremo — devolve null, não zero", () => {
  assert.equal(extremos([{ t: 0, v: null }]), null);
  assert.equal(extremos([]), null);
});

// ---------------------------------------------------------------------------
// trechos — a lacuna como lacuna
// ---------------------------------------------------------------------------
ok("a linha QUEBRA no buraco em vez de atravessá-lo", () => {
  // Um segmento reto ligando junho a setembro seria um dado que ninguém mediu.
  const cols = [
    { t: 0 }, { t: DIA }, { t: 2 * DIA },
    { t: 100 * DIA }, { t: 101 * DIA },
  ];
  const t = trechos(cols, 2 * DIA);
  assert.equal(t.length, 2, "a linha atravessou a lacuna");
  assert.equal(t[0].length, 3);
  assert.equal(t[1].length, 2);
});

ok("série contínua é um trecho só", () => {
  const cols = Array.from({ length: 50 }, (_, i) => ({ t: i * DIA }));
  assert.equal(trechos(cols, 2 * DIA).length, 1);
});

ok("nenhum ponto se perde na quebra", () => {
  const cols = Array.from({ length: 50 }, (_, i) => ({ t: i * DIA * (i > 25 ? 9 : 1) }));
  assert.equal(trechos(cols, 2 * DIA).flat().length, 50);
});

// ---------------------------------------------------------------------------
// escala
// ---------------------------------------------------------------------------
ok("a escala contém os dados e usa passo legível", () => {
  const casos = [[3.2, 27.8], [-15, 40], [1008, 1024], [0, 0.35]];
  for (const [mn, mx] of casos) {
    const e = escala(mn, mx);
    assert.ok(e.lo <= mn && e.hi >= mx, `[${mn},${mx}] virou [${e.lo},${e.hi}]`);
    const m = e.passo / Math.pow(10, Math.floor(Math.log10(e.passo)));
    assert.ok([1, 2, 5, 10].some((x) => Math.abs(m - x) < 1e-9), `passo feio: ${e.passo}`);
  }
});

ok("série achatada ainda produz faixa — sem divisão por zero", () => {
  const e = escala(1013, 1013);
  assert.ok(e.hi > e.lo, "faixa nula mandaria a linha para fora da tela");
  assert.ok(e.lo <= 1013 && e.hi >= 1013);
});

ok("as marcas cobrem a faixa e nunca entram em laço infinito", () => {
  const e = escala(3.2, 27.8);
  const m = marcas(e.lo, e.hi, e.passo);
  assert.ok(m.length >= 2 && m.length <= 64);
  assert.equal(m[0], e.lo);
  assert.ok(m[m.length - 1] >= 27.8);
  assert.deepEqual(marcas(0, 10, 0), [0], "passo zero devia ser recusado");
  assert.deepEqual(marcas(0, 10, -1), [0]);
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const serieExemplo = {
  intervalo: { start: "2026-07-06", end: "2026-08-04", dias: 30 },
  variaveis: ["temperature_2m_mean", "precipitation_sum"],
  unidades: { temperature_2m_mean: "°C", precipitation_sum: "mm" },
  rotulos: { temperature_2m_mean: "Temperatura média", precipitation_sum: "Precipitação acumulada" },
  serie: {
    time: ["2026-07-06", "2026-07-07", "2026-07-08"],
    temperature_2m_mean: [18.4, null, 21],
    precipitation_sum: [0, 12.5, null],
  },
  fonte: "Open-Meteo · reanálise ERA5 (arquivo histórico)",
  obtidoEm: "2026-08-11T09:00:00.000Z",
  lacunas: ["Temperatura média: 1 de 3 dias sem dado"],
};
const ctx = { place: "São Paulo, Brasil", lat: -23.5505, lng: -46.6333 };

ok("toda coluna do CSV declara a unidade", () => {
  const linhas = paraCSV(serieExemplo, ctx).split("\n");
  const cab = linhas.find((l) => l.startsWith("Data"));
  assert.match(cab, /Temperatura média \(°C\)/);
  assert.match(cab, /Precipitação acumulada \(mm\)/);
  assert.ok(!/\(C\)/.test(cab), "unidade sem o grau");
});

ok("o CSV não tem coluna de pressão — ela não existe no arquivo diário", () => {
  // O cabeçalho anterior prometia "Pressão(hPa)" e entregava célula vazia em
  // toda linha, os 3.652 dias.
  const txt = paraCSV(serieExemplo, ctx);
  assert.ok(!/Pressão/.test(txt), "voltou a prometer pressão");
});

ok("ausência é célula VAZIA, jamais zero", () => {
  // "0 mm" significa que não choveu. É diferente de "não sabemos se choveu", e
  // a média da coluna muda conforme a escolha.
  const linhas = paraCSV(serieExemplo, ctx).split("\n").filter((l) => /^2026-/.test(l));
  assert.equal(linhas[0], "2026-07-06,18.4,0", "o zero real de precipitação se perdeu");
  assert.equal(linhas[1], "2026-07-07,,12.5", "o nulo virou número");
  assert.equal(linhas[2], "2026-07-08,21,");
});

ok("o preâmbulo carrega origem, intervalo e coordenada com hemisfério", () => {
  const txt = paraCSV(serieExemplo, ctx);
  assert.match(txt, /# Fonte: Open-Meteo/);
  assert.match(txt, /# Intervalo: 2026-07-06 a 2026-08-04 \(30 dias\)/);
  assert.match(txt, /23\.5505S/);
  assert.match(txt, /46\.6333O/);
  assert.match(txt, /# Obtido em: 2026-08-11/);
  assert.match(txt, /Nunca estimado/);
  assert.match(txt, /# Lacuna: Temperatura média/);
});

ok("o número de colunas é o mesmo em toda linha", () => {
  const linhas = paraCSV(serieExemplo, ctx).split("\n").filter((l) => l && !l.startsWith("#"));
  const cols = linhas.map((l) => l.split(",").length);
  assert.equal(new Set(cols).size, 1, `larguras diferentes: ${[...new Set(cols)]}`);
});

ok("vírgula e aspas no nome do lugar não quebram o arquivo (RFC 4180)", () => {
  assert.equal(celula("São Paulo, Brasil"), '"São Paulo, Brasil"');
  assert.equal(celula('Ilha "do" Mel'), '"Ilha ""do"" Mel"');
  assert.equal(celula("simples"), "simples");
  const txt = paraCSV(serieExemplo, ctx);
  const cab = txt.split("\n").find((l) => l.startsWith("Data"));
  assert.equal(cab.split(",").length, 3, "a vírgula do rótulo virou separador");
});

ok("decimal é ponto, porque o separador é vírgula", () => {
  const txt = paraCSV(serieExemplo, ctx);
  assert.match(txt, /18\.4/);
  assert.ok(!/18,4/.test(txt), "vírgula decimal num arquivo separado por vírgula");
});

console.log(`\n  ${n} verificações do gráfico e da exportação\n`);
export default n;
