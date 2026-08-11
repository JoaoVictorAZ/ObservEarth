// test/timeseries.mjs
// -----------------------------------------------------------------------------
// Série histórica diária.
//
// A rota que este módulo substitui não quebrava: ela RESPONDIA. Quando a
// Open-Meteo falhava, devolvia status 200 com dez anos de senóides
// (`25 − |lat|·0,35 + sen(i/4)·3`) e carimbos de tempo gerados a partir de
// `Date.now()`. A tela tem botão de exportar CSV.
//
// Então mais da metade destas verificações são sobre o que o módulo se RECUSA
// a fazer: inventar valor, inventar carimbo, engolir erro, esconder lacuna.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  JANELAS, DIARIAS, UNIDADES, ROTULOS, intervalo, resumo, buscarSerie,
} from "../server/timeseries.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const okA = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nsérie histórica diária");

// ---------------------------------------------------------------------------
// catálogo
// ---------------------------------------------------------------------------
ok("toda variável servida tem unidade E rótulo", () => {
  for (const v of DIARIAS) {
    assert.ok(UNIDADES[v], `${v} sem unidade`);
    assert.ok(ROTULOS[v], `${v} sem rótulo`);
  }
});

ok("nenhuma unidade ou rótulo sobra sem variável", () => {
  // Um rótulo órfão vira cabeçalho de coluna vazia no CSV: promete dado que
  // nunca vem. Foi assim que `surface_pressure_mean` entrou na versão anterior.
  for (const k of Object.keys(UNIDADES)) assert.ok(DIARIAS.includes(k), `unidade órfã: ${k}`);
  for (const k of Object.keys(ROTULOS)) assert.ok(DIARIAS.includes(k), `rótulo órfão: ${k}`);
});

ok("não se pede pressão média diária — ela não existe no arquivo", () => {
  assert.ok(!DIARIAS.includes("surface_pressure_mean"));
  assert.ok(!DIARIAS.some((v) => v.startsWith("surface_pressure")));
});

ok("vento é pedido em m/s, não em km/h", () => {
  assert.equal(UNIDADES.wind_speed_10m_max, "m/s");
});

// ---------------------------------------------------------------------------
// janela temporal
// ---------------------------------------------------------------------------
ok("cada janela produz o número de dias que anuncia", () => {
  const agora = new Date("2026-08-11T00:00:00Z");
  for (const [id, dias] of Object.entries(JANELAS)) {
    const iv = intervalo(id, agora);
    const passo = 86400e3;
    const contados =
      (Date.parse(`${iv.end}T00:00:00Z`) - Date.parse(`${iv.start}T00:00:00Z`)) / passo + 1;
    assert.equal(contados, dias, `${id}: ${contados} dias, esperava ${dias}`);
    assert.equal(iv.dias, dias);
  }
});

ok("a janela recua da consolidação e nunca pede o futuro", () => {
  // O arquivo da Open-Meteo tem ~5 dias de atraso. Pedir até ontem devolve uma
  // cauda de nulos, que na tela é indistinguível de falha de dado.
  const agora = new Date("2026-08-11T00:00:00Z");
  const { end } = intervalo("1m", agora);
  const atraso = (agora.getTime() - Date.parse(`${end}T00:00:00Z`)) / 86400e3;
  assert.ok(atraso >= 5, `atraso de ${atraso} dias, esperava ao menos 5`);
  assert.ok(Date.parse(`${end}T00:00:00Z`) < agora.getTime(), "fim no futuro");
});

ok("janela desconhecida cai em 1 ano em vez de quebrar", () => {
  assert.equal(intervalo("xx").dias, JANELAS["1y"]);
});

// ---------------------------------------------------------------------------
// estatística
// ---------------------------------------------------------------------------
ok("desvio padrão é AMOSTRAL (n−1), não populacional", () => {
  // [2,4,4,4,5,5,7,9]: populacional = 2, amostral = 2,138.
  // A série observada é uma amostra do clima; dividir por n subestima a
  // dispersão, e isso é o tipo de coisa que se cobra numa banca.
  const r = resumo([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.media, 5);
  assert.equal(r.desvio, 2.14, `desvio ${r.desvio}; populacional daria 2`);
});

ok("um único ponto não tem dispersão — e diz isso com null", () => {
  const r = resumo([7]);
  assert.equal(r.n, 1);
  assert.equal(r.desvio, null, "n=1 não pode produzir desvio");
  assert.equal(r.media, 7);
});

ok("nulos não entram na conta e são contados à parte", () => {
  const r = resumo([10, null, 20, undefined, NaN, 30]);
  assert.equal(r.n, 3);
  assert.equal(r.ausentes, 3);
  assert.equal(r.media, 20);
  assert.equal(r.soma, 60, "nulo somando como zero rebaixaria a média");
});

ok("série toda vazia devolve null em tudo, nunca zero", () => {
  const r = resumo([null, null, null]);
  assert.equal(r.n, 0);
  assert.equal(r.ausentes, 3);
  for (const k of ["min", "max", "media", "desvio", "soma"]) {
    assert.equal(r[k], null, `${k} virou ${r[k]} sem nenhum dado`);
  }
});

ok("n e ausentes acompanham todo resumo", () => {
  // Uma média de 12 dias e uma de 3.652 não significam a mesma coisa, e o
  // número sozinho não conta a diferença.
  const r = resumo([1, 2, null]);
  assert.equal(r.n + r.ausentes, 3);
});

// ---------------------------------------------------------------------------
// busca — o contrato com a rede
// ---------------------------------------------------------------------------
const diasDe = (start, dias) =>
  Array.from({ length: dias }, (_, i) =>
    new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400e3).toISOString().slice(0, 10));

/** servidor de mentira que devolve o que se mandar */
function falso({ status = 200, corpo }) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  };
  impl.chamadas = chamadas;
  return impl;
}

function corpoBom(start, dias, valor = (i) => 20 + i) {
  const time = diasDe(start, dias);
  const daily = { time };
  for (const v of DIARIAS) daily[v] = time.map((_, i) => valor(i));
  return { daily };
}

await okA("a URL pede m/s explicitamente e não supõe a unidade", async () => {
  // Supor foi o que fez a sonda mostrar 58,5 m/s onde havia 58,5 km/h —
  // um fator de 3,6 em todo o planeta.
  const f = falso({ corpo: corpoBom("2026-07-06", 30) });
  await buscarSerie(f, { lat: -23, lng: -46, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  const u = new URL(f.chamadas[0]);
  assert.equal(u.searchParams.get("wind_speed_unit"), "ms");
  assert.equal(u.searchParams.get("timezone"), "UTC");
  assert.ok(u.hostname.includes("archive-api"), `bateu em ${u.hostname}`);
});

await okA("a URL pede exatamente as variáveis do catálogo", async () => {
  const f = falso({ corpo: corpoBom("2026-07-06", 30) });
  await buscarSerie(f, { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  const pedidas = new URL(f.chamadas[0]).searchParams.get("daily").split(",");
  assert.deepEqual(pedidas, DIARIAS);
});

await okA("uma janela = uma requisição, dos 30 dias aos 10 anos", async () => {
  // Restrição do usuário: o consumo tem que caber em um quarto do limite
  // gratuito. Fatiar 10 anos em pedaços mensais seriam 120 chamadas.
  for (const range of ["1m", "10y"]) {
    const f = falso({ corpo: corpoBom("2016-01-01", JANELAS[range]) });
    await buscarSerie(f, { lat: 0, lng: 0, range, agora: new Date("2026-08-11T00:00:00Z") });
    assert.equal(f.chamadas.length, 1, `${range} gastou ${f.chamadas.length} chamadas`);
  }
});

await okA("HTTP ruim vira ERRO, nunca série inventada", async () => {
  const f = falso({ status: 503, corpo: {} });
  await assert.rejects(
    () => buscarSerie(f, { lat: 0, lng: 0, range: "1y" }),
    (e) => {
      assert.equal(e.code, "ARQUIVO_INDISPONIVEL");
      assert.equal(e.status, 502);
      assert.match(e.message, /503/);
      return true;
    }
  );
});

await okA("resposta 200 sem série também é erro", async () => {
  // A Open-Meteo responde 200 com `{}` para alguns pontos. A versão anterior
  // lia `h.time || <gerado a partir de Date.now()>` e seguia adiante.
  for (const corpo of [{}, { daily: {} }, { daily: { time: [] } }]) {
    await assert.rejects(
      () => buscarSerie(falso({ corpo }), { lat: 0, lng: 0, range: "1y" }),
      (e) => e.code === "SEM_SERIE" && e.status === 502
    );
  }
});

await okA("lacuna é null preservado, e é anunciada", async () => {
  const start = "2026-07-06";
  const corpo = corpoBom(start, 30);
  corpo.daily.temperature_2m_mean[3] = null;
  corpo.daily.temperature_2m_mean[9] = null;

  const out = await buscarSerie(falso({ corpo }),
    { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });

  assert.equal(out.serie.temperature_2m_mean[3], null, "buraco foi preenchido");
  assert.equal(out.resumos.temperature_2m_mean.ausentes, 2);
  assert.equal(out.resumos.temperature_2m_mean.n, 28);
  assert.equal(out.lacunas.length, 1);
  assert.match(out.lacunas[0], /2 de 30 dias/);
});

await okA("série sem lacuna não anuncia lacuna", () => {
  return buscarSerie(falso({ corpo: corpoBom("2026-07-06", 30) }),
    { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") })
    .then((out) => assert.deepEqual(out.lacunas, []));
});

await okA("variável ausente da resposta não vira coluna de zeros", async () => {
  const corpo = corpoBom("2026-07-06", 30);
  delete corpo.daily.shortwave_radiation_sum;
  const out = await buscarSerie(falso({ corpo }),
    { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  assert.deepEqual(out.serie.shortwave_radiation_sum, []);
  assert.equal(out.resumos.shortwave_radiation_sum.n, 0);
  assert.equal(out.resumos.shortwave_radiation_sum.media, null);
});

await okA("os carimbos de tempo vêm da fonte, não do relógio local", async () => {
  const corpo = corpoBom("2019-03-01", 10);
  const out = await buscarSerie(falso({ corpo }), { lat: 0, lng: 0, range: "1m" });
  assert.equal(out.serie.time[0], "2019-03-01");
  assert.equal(out.serie.time.length, 10);
});

await okA("todo resumo sai com unidade e rótulo colados", async () => {
  const out = await buscarSerie(falso({ corpo: corpoBom("2026-07-06", 30) }),
    { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  for (const v of DIARIAS) {
    assert.equal(out.resumos[v].unidade, UNIDADES[v], `${v} perdeu a unidade`);
    assert.equal(out.resumos[v].rotulo, ROTULOS[v]);
  }
});

await okA("a resposta declara fonte, intervalo e hora de obtenção", async () => {
  const out = await buscarSerie(falso({ corpo: corpoBom("2026-07-06", 30) }),
    { lat: -23, lng: -46, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  assert.match(out.fonte, /ERA5/);
  assert.equal(out.intervalo.dias, 30);
  assert.equal(out.range, "1m");
  assert.equal(out.lat, -23);
  assert.ok(!Number.isNaN(Date.parse(out.obtidoEm)));
  assert.match(out.nota, /nunca foi estimada/);
});

await okA("o comprimento da série bate com o das variáveis", async () => {
  const out = await buscarSerie(falso({ corpo: corpoBom("2026-07-06", 30) }),
    { lat: 0, lng: 0, range: "1m", agora: new Date("2026-08-11T00:00:00Z") });
  const nT = out.serie.time.length;
  for (const v of DIARIAS) {
    assert.equal(out.serie[v].length, nT, `${v} desalinhado do eixo do tempo`);
  }
});

console.log(`\n  ${n} verificações da série histórica\n`);
export default n;
