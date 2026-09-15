import assert from "node:assert/strict";
import {
  diaDoAno, dentroDaJanela, quantis, montarNormais, urlArquivo, chaveCache,
  buscarClimatologia, VARIAVEIS, REF_INICIO, REF_FIM, JANELA_DIAS,
} from "../server/climatologia.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const okAsync = async (nome, fn) => {
  try { await fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\ndia do ano");

ok("primeiro e ultimo dia", () => {
  assert.equal(diaDoAno("2020-01-01"), 1);
  assert.equal(diaDoAno("2020-12-31"), 366, "2020 e bissexto");
  assert.equal(diaDoAno("2021-12-31"), 365);
});

ok("data invalida devolve null, nao NaN", () => {
  assert.equal(diaDoAno("nao-e-data"), null);
  assert.equal(diaDoAno(""), null);
});

console.log("\njanela em torno do dia");

// A normal de 2 de janeiro precisa dos dias 26 a 31 de dezembro. Sem o
// enrolamento, as duas semanas em torno do Ano-Novo teriam metade das amostras
// das demais — e ninguem notaria, porque o numero continuaria parecendo normal.
ok("a janela DA A VOLTA no ano", () => {
  assert.equal(dentroDaJanela(360, 2), true, "26/dez deveria entrar na janela de 2/jan");
  assert.equal(dentroDaJanela(2, 360), true, "e o inverso tambem");
  assert.equal(dentroDaJanela(1, 366), true);
});

ok("fora da janela fica fora", () => {
  assert.equal(dentroDaJanela(100, 200), false);
  assert.equal(dentroDaJanela(180, 200), false);
});

ok("a janela tem o tamanho declarado", () => {
  assert.equal(dentroDaJanela(100, 100 + JANELA_DIAS), true);
  assert.equal(dentroDaJanela(100, 100 + JANELA_DIAS + 1), false);
});

console.log("\nquantis");

ok("21 valores, do minimo ao maximo", () => {
  const { q, n: cont } = quantis([1, 2, 3, 4, 5]);
  assert.equal(q.length, 21);
  assert.equal(q[0], 1, "p0 deveria ser o minimo");
  assert.equal(q[20], 5, "p100 deveria ser o maximo");
  assert.equal(q[10], 3, "p50 deveria ser a mediana");
  assert.equal(cont, 5);
});

ok("os quantis nunca decrescem", () => {
  const { q } = quantis([5, 1, 9, 3, 7, 2, 8]);
  for (let i = 1; i <= 20; i++) assert.ok(q[i] >= q[i - 1], "caiu no indice " + i);
});

ok("ausencias sao descartadas, nao viram zero", () => {
  const { q, media, n: cont } = quantis([10, null, 20, undefined, NaN, 30]);
  assert.equal(cont, 3, "contou ausencia como amostra");
  assert.equal(media, 20);
  assert.equal(q[0], 10);
});

ok("serie toda vazia devolve nulos, nao zeros", () => {
  const { q, media, n: cont } = quantis([null, null]);
  assert.equal(cont, 0);
  assert.equal(media, null);
  assert.ok(q.every((x) => x === null), "inventou quantis para serie vazia");
});

console.log("\nmontagem das normais");

/** 30 anos de serie diaria sintetica, com sazonalidade. */
function arquivo(anos = 30) {
  const time = [], temp = [], chuva = [];
  for (let a = 0; a < anos; a++) {
    const ano = 1991 + a;
    for (let d = 1; d <= 365; d++) {
      const dt = new Date(Date.UTC(ano, 0, d));
      time.push(dt.toISOString().slice(0, 10));
      // COSSENO, nao seno: o maximo cai em JANEIRO e o minimo em julho, que e
      // o hemisferio sul. Com seno os extremos caiam em abril e outubro, e o
      // teste de sazonalidade comparava dois pontos a meio caminho da amplitude.
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

ok("usa os 30 anos e a janela inteira", () => {
  const r = montarNormais(arquivo(), "2026-03-15");
  assert.equal(r.anos, 30, "anos " + r.anos);
  // 30 anos x (2*7+1) dias = 450 amostras
  assert.equal(r.normais.temperature_2m_mean.amostras, 450, "amostras " + r.normais.temperature_2m_mean.amostras);
});

ok("todas as variaveis declaradas ganham normal", () => {
  const r = montarNormais(arquivo(), "2026-06-01");
  for (const nome of Object.keys(VARIAVEIS)) {
    assert.ok(r.normais[nome], "faltou " + nome);
    assert.equal(r.normais[nome].q.length, 21);
  }
});

ok("o feitio de cada variavel atravessa para o cliente", () => {
  const r = montarNormais(arquivo(), "2026-06-01");
  assert.equal(r.normais.temperature_2m_mean.feitio, "simetrica");
  assert.equal(r.normais.precipitation_sum.feitio, "assimetrica",
    "chuva marcada como simetrica autorizaria a tela a dizer '+12 mm acima da media'");
});

// A sazonalidade tem que aparecer: se a normal de janeiro e de julho for igual,
// a janela ou o dia-do-ano estao errados em algum lugar.
ok("a normal MUDA com a epoca do ano", () => {
  const jan = montarNormais(arquivo(), "2026-01-15").normais.temperature_2m_mean.media;
  const jul = montarNormais(arquivo(), "2026-07-15").normais.temperature_2m_mean.media;
  assert.ok(Math.abs(jan - jul) > 5, `jan ${jan?.toFixed(1)} vs jul ${jul?.toFixed(1)}`);
});

ok("virada de ano tem tantas amostras quanto o meio do ano", () => {
  const a = montarNormais(arquivo(), "2026-01-02").normais.temperature_2m_mean.amostras;
  const b = montarNormais(arquivo(), "2026-07-02").normais.temperature_2m_mean.amostras;
  assert.ok(a >= b * 0.9, `2/jan teve ${a} amostras contra ${b} de 2/jul`);
});

ok("a nota diz o periodo e a janela, para a tela nao inventar", () => {
  const r = montarNormais(arquivo(), "2026-03-15");
  assert.match(r.referencia, /1991.2020/);
  assert.match(r.nota, /1991/);
  assert.match(r.nota, new RegExp(String(JANELA_DIAS)));
  assert.match(r.fonte, /ERA5/);
});

ok("arquivo vazio falha em vez de devolver normal falsa", () => {
  assert.throws(() => montarNormais({ time: [] }, "2026-03-15"), /sem s[ée]rie/i);
  assert.throws(() => montarNormais(arquivo(), "abacaxi"), /inv[áa]lida/i);
});

console.log("\nrequisicao e cache");

ok("a URL pede o periodo fechado da OMM", () => {
  const u = urlArquivo(-22.9, -43.2);
  assert.ok(u.includes(`start_date=${REF_INICIO}`), u);
  assert.ok(u.includes(`end_date=${REF_FIM}`), u);
  assert.ok(u.includes("wind_speed_unit=ms"), "sem isso o vento volta em km/h");
  for (const nome of Object.keys(VARIAVEIS)) assert.ok(u.includes(nome), "faltou " + nome);
});

// Dois cliques no mesmo bairro nao podem custar dois downloads de 30 anos.
ok("a chave arredonda para a grade de 0,25 grau", () => {
  assert.equal(chaveCache(-22.91, -43.18), chaveCache(-22.95, -43.22));
  assert.notEqual(chaveCache(-22.9, -43.2), chaveCache(-23.4, -43.2));
});

ok("a chave leva o periodo: mudar a referencia invalida o cache", () => {
  assert.ok(chaveCache(0, 0).includes(REF_INICIO));
});

await okAsync("baixa uma vez e reaproveita para outros dias", async () => {
  let chamadas = 0;
  const memo = new Map();
  const cache = async (k, _ttl, prod) => {
    if (memo.has(k)) return memo.get(k);
    const v = await prod();
    memo.set(k, v);
    return v;
  };
  const fetchFalso = async () => { chamadas++; return { ok: true, json: async () => ({ daily: arquivo() }) }; };

  await buscarClimatologia(fetchFalso, -22.9, -43.2, "2026-03-15", cache);
  await buscarClimatologia(fetchFalso, -22.9, -43.2, "2026-08-01", cache);
  await buscarClimatologia(fetchFalso, -22.92, -43.21, "2026-12-25", cache);
  assert.equal(chamadas, 1, `baixou ${chamadas} vezes 30 anos de dados`);
});

await okAsync("erro do arquivo vira 502, nao normal inventada", async () => {
  const cache = async (_k, _t, prod) => prod();
  const ruim = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    () => buscarClimatologia(ruim, 0, 0, "2026-03-15", cache),
    (e) => e.status === 502,
  );
});

await okAsync("coordenada invalida e recusada antes de gastar requisicao", async () => {
  let chamadas = 0;
  const cache = async (_k, _t, prod) => prod();
  const f = async () => { chamadas++; return { ok: true, json: async () => ({ daily: arquivo() }) }; };
  await assert.rejects(() => buscarClimatologia(f, NaN, 0, "2026-03-15", cache), (e) => e.status === 400);
  assert.equal(chamadas, 0, "gastou requisicao com coordenada invalida");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
