// test/forecast.mjs
// -----------------------------------------------------------------------------
// A linha do tempo e o cursor da reproducao.
//
// O defeito que estes testes existem para impedir e o original: `(hora + 3) % 24`
// dava a volta no mesmo dia. Passava despercebido porque a tela MUDAVA — a hora
// subia — e so quem olhasse a data perceberia que ela nunca avancava. Um teste
// que so verificasse "o cursor se move" teria aprovado aquele codigo.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { forecastTimeline, alignToStep, FRAME_STEP } from "../server/forecast.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nlinha do tempo da previsão");

// Ancora fixa: 06/08/2026 as 14:07 UTC. O ciclo das 06z ja esta publicado
// (mais de 3,5 h antes); o das 12z ainda nao.
const NOW = new Date(Date.UTC(2026, 7, 6, 14, 7));

ok("alinha ao passo de 3 h", () => {
  const t = alignToStep(Date.UTC(2026, 7, 6, 14, 7));
  assert.equal(new Date(t).getUTCHours(), 12);
  assert.equal(new Date(t).getUTCMinutes(), 0);
});

ok("o tempo AVANÇA — não dá a volta no dia", () => {
  const { frames } = forecastTimeline({ now: NOW, spanH: 72 });
  assert.ok(frames.length > 8, `esperava mais de um dia de quadros, veio ${frames.length}`);

  // o defeito antigo: hora +3 com módulo 24 e data parada
  const dias = new Set(frames.map((f) => f.date));
  assert.ok(dias.size >= 3, `72 h devem cruzar ao menos 3 datas, cruzou ${dias.size}`);

  // instantes estritamente crescentes, sem repetição
  for (let i = 1; i < frames.length; i++) {
    assert.ok(
      frames[i].at > frames[i - 1].at,
      `quadro ${i} não avançou: ${frames[i - 1].date} ${frames[i - 1].hour}h ` +
      `-> ${frames[i].date} ${frames[i].hour}h`
    );
  }
});

ok("passo constante de 3 h entre quadros vizinhos", () => {
  const { frames } = forecastTimeline({ now: NOW, spanH: 48 });
  for (let i = 1; i < frames.length; i++) {
    const dh = (frames[i].at - frames[i - 1].at) / 3600e3;
    assert.equal(dh, FRAME_STEP, `salto de ${dh} h entre ${i - 1} e ${i}`);
  }
});

ok("horas caem na grade do modelo (0,3,6,…,21)", () => {
  const { frames } = forecastTimeline({ now: NOW, spanH: 72 });
  for (const f of frames) {
    assert.equal(f.hour % 3, 0, `hora fora da grade: ${f.hour}`);
  }
});

ok("o horizonte é pequeno — cada quadro vem de um ciclo próximo", () => {
  // MUDANÇA DE PROJETO, registrada aqui de propósito.
  //
  // Antes: a janela inteira saía de UM ciclo, então o lead crescia
  // monotonicamente (0, 3, 6, 9...). A vantagem era coerência física — uma
  // frente nascia num quadro e avançava nos seguintes, dentro da mesma rodada
  // do modelo.
  //
  // Agora `resolveCycle` escolhe sempre o ciclo mais próximo do alvo, então o
  // lead serrilha (0, 3, 0, 3...). Cada quadro fica individualmente MAIS
  // preciso, mas quadros vizinhos passam a vir de rodadas diferentes, e a
  // troca de rodada traz o incremento de assimilação: o campo pode SALTAR na
  // emenda. Numa animação isso aparece como um solavanco.
  //
  // O teste passa a garantir o que a nova regra promete: lead sempre pequeno.
  const { frames } = forecastTimeline({ now: NOW, spanH: 72 });
  const leads = frames.map((f) => f.leadH).filter((x) => x != null);
  assert.ok(leads.length > 8, `poucos quadros com lead: ${leads.length}`);
  for (const l of leads) {
    assert.ok(l >= 0 && l <= 6, `lead fora do esperado para ciclo mais próximo: ${l}h`);
  }
});

ok("todo quadro servido tem cobertura do GFS", () => {
  const { frames } = forecastTimeline({ now: NOW, spanH: 120 });
  for (const f of frames) {
    assert.ok(f.available, `quadro sem cobertura foi servido: ${f.date} ${f.hour}h`);
    assert.ok(f.cycle, "quadro sem ciclo identificado");
  }
});

ok("corta no primeiro buraco em vez de saltar por cima", () => {
  // 240 h é o limite do GFS; pedir mais deve truncar, não intercalar vazios
  const t = forecastTimeline({ now: NOW, spanH: 240 });
  assert.ok(t.frames.every((f) => f.available));
  const dh = (t.frames.at(-1).at - t.frames[0].at) / 3600e3;
  assert.equal(dh, (t.frames.length - 1) * FRAME_STEP, "há buraco no meio da série");
});

ok("marca de cache reflete o que o store respondeu", () => {
  const t = forecastTimeline({
    now: NOW, spanH: 12,
    isCached: (k) => k.endsWith(":12") || k.endsWith(":15"),
  });
  assert.equal(t.frames.filter((f) => f.cached).length, t.ready);
  assert.ok(t.ready >= 1, "nenhum quadro marcado como quente");
});

ok("respeita um início explícito", () => {
  const t = forecastTimeline({ now: NOW, from: "2026-08-07", hour: 6, spanH: 12 });
  assert.equal(t.frames[0].date, "2026-08-07");
  assert.equal(t.frames[0].hour, 6);
});

console.log(`\n  ${n} verificações da linha do tempo\n`);
export default n;
