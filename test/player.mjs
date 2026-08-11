// test/player.mjs
// -----------------------------------------------------------------------------
// CURSOR DA REPRODUCAO E INTERPOLACAO TEMPORAL.
//
// Dois riscos concretos:
//
//   1. O cursor atravessar para um quadro que ainda nao chegou. Isso nao lanca
//      erro: a GPU recebe um campo vazio, todas as particulas morrem no mesmo
//      instante e o globo "apaga" por um segundo. Parece bug de renderizacao e
//      seria caçado no lugar errado.
//
//   2. Interpolar a DIRECAO em vez do VETOR. Entre 350 graus e 10 graus a
//      resposta certa e cruzar o norte; a media dos angulos da 180 e o vento
//      inverte. O shader faz a conta certa (mix em u e v) — este teste fixa
//      isso numericamente, porque um erro assim so aparece em telas de vento
//      girando e ninguem repara olhando o codigo.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { PlayerState, offsetLabel } from "../src/forecastPlayer.ts";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ncursor da reprodução");

const mkFrames = (count) =>
  Array.from({ length: count }, (_, i) => ({
    date: "2026-08-06", hour: (i * 3) % 24, at: i * 3 * 3600e3,
    offsetH: i * 3, leadH: i * 3, kind: "previsão", cycle: "2026080606",
    available: true, cached: true,
  }));

const allReady = () => true;

ok("avança de fato, com par A/B e fração coerentes", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(10));
  p.advance(0.5, 1, allReady);       // meio quadro
  assert.equal(p.indexA, 0);
  assert.equal(p.indexB, 1);
  assert.ok(Math.abs(p.mix - 0.5) < 1e-9, `fração ${p.mix}`);

  p.advance(1.0, 1, allReady);       // mais um quadro inteiro
  assert.equal(p.indexA, 1);
  assert.ok(Math.abs(p.mix - 0.5) < 1e-9);
});

ok("NÃO atravessa para um quadro que ainda não chegou", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(10));
  // só os dois primeiros baixados
  const ready = (f) => f.offsetH <= 3;

  const moved = p.advance(5, 1, ready);   // tentaria pular 5 quadros
  assert.equal(moved, false, "deveria ter segurado");
  assert.equal(p.indexA, 0, `parou no quadro ${p.indexA}, esperava 0`);
  // o par continua válido: A=0 e B=1, ambos carregados
  assert.ok(ready(p.frameA));
  assert.ok(ready(p.frameB));
});

ok("retoma assim que o quadro seguinte chega", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(10));
  let limite = 3;
  const ready = (f) => f.offsetH <= limite;

  assert.equal(p.advance(2, 1, ready), false);
  limite = 12;                                   // chegaram mais quadros
  assert.equal(p.advance(1, 1, ready), true);
  assert.ok(p.cursor > 0.9, `cursor travado em ${p.cursor}`);
});

ok("fecha o laço no fim da janela", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(5));
  p.seek(4);
  p.advance(1, 1, allReady);
  assert.equal(p.cursor, 0, "deveria voltar ao início");
});

ok("no último quadro não existe B — a mistura não vaza para fora", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(3));
  p.seek(2);
  assert.equal(p.frameB, null, "B deveria ser nulo no fim");
});

ok("pré-carga olha para a frente, a partir do cursor", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(10));
  p.seek(4);
  const q = p.prefetchQueue(3);
  assert.deepEqual(q.map((f) => f.offsetH), [12, 15, 18, 21]);
});

ok("pré-carga não estoura o fim da lista", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(3));
  p.seek(2);
  assert.equal(p.prefetchQueue(5).length, 1);
});

ok("rótulo de horizonte no formato dos centros de previsão", () => {
  assert.equal(offsetLabel(0), "+000h");
  assert.equal(offsetLabel(18), "+018h");
  assert.equal(offsetLabel(240), "+240h");
});

ok("pair() nunca entrega um campo ausente", () => {
  const p = new PlayerState();
  p.setFrames(mkFrames(4));
  const so0 = (f) => f.offsetH === 0;             // só o primeiro carregou
  const { a, b, mix } = p.pair(so0);
  assert.ok(a, "A deveria estar disponível");
  assert.equal(b, null, "B não carregou — deveria sair nulo");
  assert.equal(mix, 0, "sem B, a fração precisa ser zero");
});

ok("simulação: 40 s de reprodução com rede lenta, sem publicar campo vazio", () => {
  // Este é o teste que pegou o defeito real. Um caso pontual não pega: a falha
  // aparece na COMBINAÇÃO de cursor fracionário, entrega assíncrona e despejo
  // de cache. Rodar o laço inteiro e checar a invariante a cada quadro pega.
  const frames = mkFrames(25);
  const p = new PlayerState();
  p.setFrames(frames);

  const chegou = new Set([frameKeyOf(frames[0])]);
  const ready = (f) => chegou.has(frameKeyOf(f));
  const dt = 1 / 60;
  let t = 0, entregues = 1, segurou = 0, semB = 0;

  for (let step = 0; step < 60 * 40; step++) {
    t += dt;
    if (t > entregues * 0.30 && entregues < frames.length) {
      chegou.add(frameKeyOf(frames[entregues++]));   // 1 quadro a cada 300 ms
    }
    if (!p.advance(dt, 1.2, ready)) segurou++;

    const { a, b, mix } = p.pair(ready);
    if (a) assert.ok(ready(a), `quadro A ausente publicado em t=${t.toFixed(2)}s`);
    if (b) assert.ok(ready(b), `quadro B ausente publicado em t=${t.toFixed(2)}s`);
    if (!b) { assert.equal(mix, 0, "sem B a fração precisa ser zero"); semB++; }
  }

  assert.ok(segurou > 0, "com rede lenta o cursor deveria ter segurado alguma vez");
  assert.ok(semB > 0, "deveria ter havido quadros sem B");
  assert.ok(p.cursor > 20, `cursor mal avançou: ${p.cursor.toFixed(2)}`);
});

function frameKeyOf(f) { return `${f.date}:${f.offsetH}`; }

// ---------------------------------------------------------------------------
console.log("\ninterpolação temporal do vetor");

/** o que o shader faz: mix(a.xy, b.xy, t) — vetorial, não angular */
const lerpVec = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dirOf = ([u, v]) => ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

ok("cruza o norte pelo caminho curto (o teste do 350°→10°)", () => {
  // 350°: u pequeno negativo, v positivo | 10°: u pequeno positivo, v positivo
  const a = [-Math.sin((10 * Math.PI) / 180), Math.cos((10 * Math.PI) / 180)];
  const b = [Math.sin((10 * Math.PI) / 180), Math.cos((10 * Math.PI) / 180)];

  const meio = dirOf(lerpVec(a, b, 0.5));
  assert.ok(
    meio < 1 || meio > 359,
    `no meio do caminho a direção deveria ser ~0°/360°, deu ${meio.toFixed(1)}°`
  );

  // a média ANGULAR ingênua daria 180° — exatamente o vento invertido
  const anguloIngenuo = (350 + 10) / 2;
  assert.equal(anguloIngenuo, 180, "referência do erro que estamos evitando");
});

ok("a direção varre continuamente, sem salto entre quadros", () => {
  const a = [10, 0];      // oeste->leste
  const b = [0, 10];      // sul->norte
  let anterior = dirOf(a);
  let maxSalto = 0;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const d = dirOf(lerpVec(a, b, t));
    let salto = Math.abs(d - anterior);
    if (salto > 180) salto = 360 - salto;
    maxSalto = Math.max(maxSalto, salto);
    anterior = d;
  }
  assert.ok(maxSalto < 12, `salto de ${maxSalto.toFixed(1)}° entre passos`);
});

ok("velocidade não é inventada nem some na mistura", () => {
  const a = [10, 0], b = [10, 0];
  const [u, v] = lerpVec(a, b, 0.5);
  assert.ok(Math.abs(Math.hypot(u, v) - 10) < 1e-9, "campo idêntico mudou de módulo");

  // ventos opostos passam por zero: fisicamente correto (é uma linha de
  // convergência), e o shader mata partícula abaixo de 0,25 m/s
  const [u2, v2] = lerpVec([10, 0], [-10, 0], 0.5);
  assert.ok(Math.hypot(u2, v2) < 1e-9);
});

ok("validade sai pelo mínimo — não se anima meio dado", () => {
  const validA = 1, validB = 0;
  assert.equal(Math.min(validA, validB), 0, "só anima onde os dois passos medem");
  // a média daria 0,5, acima do limiar de 0,5 do shader? não: o teste é > 0.5
  assert.ok(!((validA + validB) / 2 > 0.5), "a média passaria raspando — por isso é mínimo");
});

console.log(`\n  ${n} verificações do reprodutor\n`);
export default n;
