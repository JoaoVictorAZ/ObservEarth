// test/dossier.mjs
// -----------------------------------------------------------------------------
// Dossiê do ponto — o contrato que o chat consome.
//
// Um dossiê errado é perigoso de um jeito específico: ele não quebra nada. Ele
// alimenta um modelo de linguagem, que transforma o erro em prosa fluente e
// confiante. Ninguém confere um parágrafo bem escrito.
//
// Por isso o que se verifica aqui é sobretudo o que o dossiê NÃO pode fazer:
// não preencher ausência, não errar delta angular, não confundir amplitude com
// variação, não deixar número sem unidade nem sem fonte.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { montarDossie, ESQUEMA, promptSistema } from "../server/dossier.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ndossiê do ponto");

/** série horária no formato da Open-Meteo */
function horario(nHoras, f) {
  const time = [], campos = {};
  for (const k of Object.keys(ESQUEMA)) campos[ESQUEMA[k].campo] = [];
  for (let i = 0; i < nHoras; i++) {
    const hh = String(i % 24).padStart(2, "0");
    time.push(`2026-08-11T${hh}:00`);
    const v = f(i);
    for (const k of Object.keys(ESQUEMA)) campos[ESQUEMA[k].campo].push(v[k] ?? null);
  }
  return { time, ...campos };
}

const base = (i) => ({
  temperatura: 20 + i * 0.5,
  orvalho: 12,
  umidade: 60,
  pressao: 1013,
  precipitacao: 0,
  nuvens: 40,
  ventoVel: 5 + i * 0.2,
  ventoDir: 270,
});

// ---------------------------------------------------------------------------
ok("todo valor carrega unidade e fonte", () => {
  const d = montarDossie({ lat: -20, lng: -45, date: "2026-08-11", hour: 12, hourly: horario(24, base) });
  for (const [k, meta] of Object.entries(d.esquema)) {
    assert.ok(meta.unidade, `${k} sem unidade`);
    assert.ok(meta.fonte, `${k} sem fonte`);
    assert.ok(meta.desc, `${k} sem descrição`);
    assert.ok(d.resumo[k].unidade, `resumo de ${k} sem unidade`);
  }
});

ok("AUSÊNCIA continua null — nunca vira zero nem estimativa", () => {
  const h = horario(24, (i) => ({ ...base(i), nuvens: i % 2 ? null : 40 }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: h });
  const nulos = d.serie.filter((p) => p.valores.nuvens === null).length;
  assert.ok(nulos > 0, "deveria haver instantes sem nuvem");
  for (const p of d.serie) {
    if (p.valores.nuvens === null) continue;
    assert.notEqual(p.valores.nuvens, 0, "ausência virou zero");
  }
  assert.ok(d.resumo.nuvens.ausentes > 0, "resumo não contabilizou as ausências");
});

ok("as lacunas são DECLARADAS, não escondidas", () => {
  const h = horario(24, (i) => ({ ...base(i), precipitacao: null }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: h });
  assert.ok(d.lacunas.length > 0, "nenhuma lacuna declarada");
  assert.ok(d.lacunas.some((l) => l.startsWith("precipitacao")), d.lacunas.join(" | "));
});

ok("série totalmente ausente não inventa média", () => {
  const h = horario(24, (i) => ({ ...base(i), umidade: null }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: h });
  assert.equal(d.resumo.umidade.media, null);
  assert.equal(d.resumo.umidade.min, null);
  assert.equal(d.resumo.umidade.n, 0);
  assert.equal(d.resumo.umidade.tendencia, null);
});

// ---------------------------------------------------------------------------
ok("DELTA é primeiro→último, não amplitude", () => {
  // sobe e volta: amplitude grande, variação líquida zero. Confundir os dois
  // produz "a temperatura subiu 10°" num dia que terminou como começou.
  const h = horario(24, (i) => ({ ...base(i), temperatura: 20 + 10 * Math.sin((i / 23) * Math.PI) }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, spanH: 24, stepH: 3, hourly: h });
  const s = d.resumo.temperatura;
  assert.ok(Math.abs(s.delta) < 4, `delta ${s.delta} — parece amplitude, não variação`);
  assert.ok(s.max - s.min > 5, `amplitude ${s.max - s.min} deveria ser grande`);
});

ok("DELTA ANGULAR pelo caminho curto: 350°→10° são 20°", () => {
  const h = horario(24, (i) => ({ ...base(i), ventoDir: i < 12 ? 350 : 10 }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, spanH: 24, stepH: 3, hourly: h });
  const dl = d.resumo.ventoDir.delta;
  assert.ok(Math.abs(dl) <= 30, `delta angular ${dl} — deveria cruzar o norte, não dar a volta`);
  assert.ok(Math.abs(dl) !== 340, "deu a volta pelo caminho longo");
});

ok("tendência de direção é rotação, não subida", () => {
  const h = horario(24, (i) => ({ ...base(i), ventoDir: (200 + i * 4) % 360 }));
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: h });
  assert.match(d.resumo.ventoDir.tendencia, /rodando|constante/);
  assert.ok(d.resumo.ventoDir.nota.includes("350"));
});

// ---------------------------------------------------------------------------
ok("o campo que ANIMA as partículas vem junto, para poder ser confrontado", () => {
  const d = montarDossie({
    lat: -20, lng: -45, date: "2026-08-11", hour: 12,
    hourly: horario(24, base),
    fieldWind: { speed: 16.3, direction: 268 },
    fieldSrc: "GFS 0,25° · 2026081100z +012h",
  });
  assert.equal(d.campoNoPonto.ventoVel, 16.3);
  assert.equal(d.campoNoPonto.unidade, "m/s");
  assert.match(d.campoNoPonto.fonte, /GFS/);
  // e a sonda continua separada — as duas fontes não se misturam
  assert.equal(d.esquema.ventoVel.fonte, "Open-Meteo");
});

ok("o instante de referência é marcado", () => {
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: horario(24, base) });
  const refs = d.serie.filter((p) => p.ref);
  assert.equal(refs.length, 1, `${refs.length} instantes marcados como referência`);
  assert.match(refs[0].at, /T12:00/);
  assert.equal(d.instanteReferencia.at, refs[0].at);
});

ok("a janela respeita o que a série cobre — sem índice fora do array", () => {
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 1, spanH: 48, stepH: 3, hourly: horario(12, base) });
  assert.ok(d.serie.length > 0);
  for (const p of d.serie) assert.ok(p.at, "instante sem carimbo de tempo");
});

// ---------------------------------------------------------------------------
ok("o prompt PROÍBE o modelo de fazer conta", () => {
  const p = promptSistema();
  assert.match(p, /SOMENTE números presentes/i);
  assert.match(p, /não os recalcule/i);
  assert.match(p, /sem dado/i);
  assert.match(p, /Não explique causas/i);
});

// ---------------------------------------------------------------------------
// Perguntado sobre "insights de clima", o modelo devolvia ZERO tokens. As
// regras 5 e 6 proíbem interpretar, deduzir, explicar causa e prever — que é
// exatamente o que "insights" pede. Sem uma saída permitida, ele emite fim de
// texto na primeira posição e a tela mostra uma bolha vazia.
// ---------------------------------------------------------------------------
ok("o prompt diz o que fazer quando NADA é permitido", () => {
  const p = promptSistema();
  assert.match(p, /NUNCA responda vazio/i, "sem esta regra, 'insights' vira silêncio");
  assert.match(p, /interpreta[çc][ãa]o|causa|previs[ãa]o/i, "não nomeia o tipo de pergunta que cai aqui");
  assert.match(p, /PODE fazer/i, "proíbe sem oferecer alternativa");
});

// O dossiê deixou de ir como JSON quando o contexto foi compactado; um prompt
// mandando ler `esquema` mandaria o modelo procurar algo que não é enviado.
ok("o prompt não manda ler campo que não existe mais", () => {
  const p = promptSistema();
  assert.doesNotMatch(p, /`esquema`/, "ainda cita o esquema, que não vai no contexto");
  assert.doesNotMatch(p, /JSON/, "ainda chama o dossiê de JSON");
  assert.doesNotMatch(p, /`resumo`/, "cita a chave em vez da seção RESUMO");
});

ok("o dossiê avisa que a aritmética já foi feita", () => {
  const d = montarDossie({ lat: 0, lng: 0, date: "2026-08-11", hour: 12, hourly: horario(24, base) });
  assert.match(d.aviso, /nenhuma aritmética/i);
  assert.match(d.aviso, /nunca foi estimada/i);
});

console.log(`\n  ${n} verificações do dossiê\n`);
export default n;
