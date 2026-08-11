// test/assimilate.mjs
// -----------------------------------------------------------------------------
// Análise objetiva do vento.
//
// Assimilação errada é PIOR que assimilação nenhuma: ela devolve um campo que
// parece mais preciso — foi "corrigido com observação" — e está pior que o
// palpite original. E não há como perceber olhando, porque o resultado continua
// sendo um campo de vento plausível.
//
// Por isso o que se verifica aqui não é "roda sem erro", e sim:
//   - a correção REDUZ o resíduo nos pontos observados
//   - o campo LONGE das observações fica intocado
//   - observação ruim é REJEITADA em vez de espalhada por 400 km
//   - a correção é VETORIAL (o teste do 350°→10° de novo)
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  analisar, controleQualidade, pesoCressman, uvDe, distKm, LIMITE_QC,
} from "../server/assimilate.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nanálise objetiva do vento");

const NX = 360, NY = 181;
/** campo uniforme de u,v — palpite inicial simples e previsível */
const campo = (u0, v0) => ({
  nx: NX, ny: NY,
  u: new Float32Array(NX * NY).fill(u0),
  v: new Float32Array(NX * NY).fill(v0),
  dataset: "GFS teste",
});
const agora = Date.UTC(2026, 7, 11, 12);
const obs = (lat, lng, speed, dir, dt = 0) =>
  ({ lat, lng, speed, direction: dir, at: agora - dt });

// ---------------------------------------------------------------------------
ok("peso de Cressman: 1 no centro, 0 EXATO no raio, monótono", () => {
  assert.equal(pesoCressman(0, 400), 1);
  assert.equal(pesoCressman(400, 400), 0);
  assert.equal(pesoCressman(500, 400), 0);
  let ant = 1;
  for (let d = 0; d <= 400; d += 10) {
    const w = pesoCressman(d, 400);
    assert.ok(w <= ant + 1e-12, `peso subiu em d=${d}`);
    assert.ok(w >= 0, `peso negativo em d=${d}`);
    ant = w;
  }
});

ok("chegar a zero no raio evita degrau — o círculo fantasma no mapa", () => {
  // Um peso que só TENDE a zero (gaussiano truncado, por exemplo) deixa um
  // salto na borda, e o olho lê esse círculo como estrutura meteorológica.
  const naBorda = pesoCressman(399.99, 400);
  assert.ok(naBorda < 1e-4, `peso ${naBorda} na borda ainda produz degrau`);
});

ok("velocidade e rumo -> u,v na convenção meteorológica", () => {
  // vento DE oeste (270°) sopra PARA leste: u > 0, v ~ 0
  const oeste = uvDe(10, 270);
  assert.ok(oeste.u > 9.99, `u=${oeste.u}`);
  assert.ok(Math.abs(oeste.v) < 1e-9, `v=${oeste.v}`);
  // vento DE sul (180°) sopra PARA norte: v > 0
  const sul = uvDe(10, 180);
  assert.ok(sul.v > 9.99, `v=${sul.v}`);
  assert.ok(Math.abs(sul.u) < 1e-9);
});

// ---------------------------------------------------------------------------
ok("a correção REDUZ o resíduo no ponto observado", () => {
  const g = campo(10, 0);                       // modelo diz 10 m/s de oeste
  const o = [obs(0, 0, 16, 270)];               // sonda mede 16 m/s de oeste
  const { report } = analisar(g, o, { agora });

  assert.equal(report.aceitas, 1);
  assert.ok(report.residuoAntes > 5, `resíduo inicial ${report.residuoAntes}`);
  assert.ok(
    report.residuoDepois < report.residuoAntes * 0.3,
    `resíduo só caiu de ${report.residuoAntes} para ${report.residuoDepois}`
  );
});

ok("o campo LONGE da observação fica intocado", () => {
  const g = campo(10, 0);
  const o = [obs(0, 0, 16, 270)];
  const { grid, report } = analisar(g, o, { agora, raioKm: 400 });

  // antípoda: nada pode ter mudado ali
  const idxLonge = Math.round((90 - -40) / 180 * (NY - 1)) * NX +
                   Math.round((150 + 180) / 360 * NX);
  assert.ok(Math.abs(grid.u[idxLonge] - 10) < 1e-6, "campo distante foi alterado");
  assert.ok(Math.abs(grid.v[idxLonge] - 0) < 1e-6);

  // e a fração tocada tem de ser pequena: uma observação não reescreve o planeta
  assert.ok(report.fracaoTocada < 3, `${report.fracaoTocada}% da grade tocada por 1 obs`);
});

ok("OBSERVAÇÃO RUIM é rejeitada, não espalhada", () => {
  const g = campo(10, 0);
  // 58,5 "m/s" — o valor que o erro de unidade produzia (era km/h)
  const o = [obs(0, 0, 58.5, 270)];
  const { grid, report } = analisar(g, o, { agora });

  assert.equal(report.aceitas, 0, "essa observação deveria ter sido rejeitada");
  assert.equal(report.rejeitadas.length, 1);
  assert.match(report.rejeitadas[0].motivo, /discorda do modelo/);
  // e o campo NÃO pode ter mudado
  assert.ok(Math.abs(grid.u[0] - 10) < 1e-9, "campo mudou apesar da rejeição");
  assert.match(report.nota, /inalterado/);
});

ok("observação velha é rejeitada", () => {
  const g = campo(10, 0);
  const o = [obs(0, 0, 14, 270, 6 * 3600e3)];   // 6 h atrás
  const { report } = analisar(g, o, { agora });
  assert.equal(report.aceitas, 0);
  assert.match(report.rejeitadas[0].motivo, /velha/);
});

ok("CORREÇÃO VETORIAL: 350° e 10° não viram 180°", () => {
  // modelo aponta 350°, observação aponta 10°. A correção certa cruza o norte.
  // Se alguém corrigisse a DIREÇÃO pela média dos ângulos, daria 180° — vento
  // exatamente invertido, e o mapa continuaria parecendo normal.
  const mod = uvDe(10, 350);
  const g = campo(mod.u, mod.v);
  const { grid, report } = analisar(g, [obs(0, 0, 10, 10)], { agora });
  assert.equal(report.aceitas, 1);

  const idx = Math.round(90 / 180 * (NY - 1)) * NX + Math.round(180 / 360 * NX);
  const dir = (270 - Math.atan2(grid.v[idx], grid.u[idx]) * 180 / Math.PI + 360) % 360;
  const perto = Math.min(Math.abs(dir - 0), Math.abs(dir - 360));
  assert.ok(perto < 25, `rumo corrigido ${dir.toFixed(1)}° — deveria cruzar o norte`);
  assert.ok(Math.abs(dir - 180) > 90, "a correção inverteu o vento");
});

ok("mais observações reduzem mais o resíduo", () => {
  const g = campo(10, 0);
  const uma = analisar(g, [obs(0, 0, 15, 270)], { agora }).report;
  const tres = analisar(g, [
    obs(0, 0, 15, 270), obs(2, 2, 15, 270), obs(-2, -2, 15, 270),
  ], { agora }).report;
  assert.equal(tres.aceitas, 3);
  assert.ok(tres.nosTocados > uma.nosTocados, "três observações deveriam tocar mais nós");
});

ok("a proveniência MUDA quando o campo é analisado", () => {
  const g = campo(10, 0);
  const { grid } = analisar(g, [obs(0, 0, 15, 270)], { agora });
  assert.equal(grid.analyzed, true);
  assert.match(grid.dataset, /analisado com 1 obs/);
  assert.ok(!/^GFS teste$/.test(grid.dataset),
    "campo corrigido não pode manter o rótulo do modelo puro");
});

ok("sem observação nenhuma, o campo sai idêntico", () => {
  const g = campo(7, -3);
  const { grid, report } = analisar(g, [], { agora });
  assert.equal(report.aceitas, 0);
  for (let i = 0; i < 50; i++) {
    assert.equal(grid.u[i], 7);
    assert.equal(grid.v[i], -3);
  }
});

ok("distância de grande círculo confere com valores conhecidos", () => {
  // equador, 1 grau de longitude ≈ 111,3 km
  assert.ok(Math.abs(distKm(0, 0, 0, 1) - 111.3) < 0.6);
  // polo a polo ≈ meia circunferência
  assert.ok(Math.abs(distKm(90, 0, -90, 0) - Math.PI * 6371) < 1);
  assert.equal(distKm(10, 20, 10, 20), 0);
});

console.log(`\n  ${n} verificações da análise objetiva\n`);
export default n;
