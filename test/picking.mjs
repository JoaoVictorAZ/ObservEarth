// test/picking.mjs
// -----------------------------------------------------------------------------
// O DEFEITO: com a malha 3D levantada, o clique atravessava o pico que a pessoa
// mirava e batia na ESFERA la atras -- que naquela direcao e' outro lugar.
// Mirando uma alta sobre a Argentina em vista obliqua, a sonda abria no
// Atlantico.
//
// O teste central e o da VISTA OBLIQUA: em vista frontal o erro nao aparece,
// porque o raio passa pelo centro e a esfera concorda com o relevo. E' de lado
// que as duas respostas divergem, e e' de lado que a pessoa clica.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { intersectarRelevo, raizesEsfera, geoDe } from "../src/malha/picking.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const R = 100;
const norm = (v) => { const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; };
const raioPara = (origem, alvo) => ({
  o: origem,
  d: norm([alvo[0] - origem[0], alvo[1] - origem[1], alvo[2] - origem[2]]),
});
/** ponto da esfera de raio r na convencao do globe.gl */
const naEsfera = (lat, lng, r = R) => {
  const la = (lat * Math.PI) / 180, lo = (lng * Math.PI) / 180, c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
};

console.log("\ngeometria basica");

ok("geoDe desfaz a conversao da esfera", () => {
  for (const [lat, lng] of [[0, 0], [45, 90], [-30, -140], [80, 179]]) {
    const g = geoDe(naEsfera(lat, lng));
    assert.ok(Math.abs(g.lat - lat) < 1e-9, `lat ${lat} -> ${g.lat}`);
    assert.ok(Math.abs(((g.lng - lng + 540) % 360) - 180) < 1e-9, `lng ${lng} -> ${g.lng}`);
    assert.ok(Math.abs(g.r - R) < 1e-9);
  }
});

ok("as raizes da esfera saem em ordem e o raio que passa longe nao acerta", () => {
  const r = raizesEsfera({ o: [0, 0, 500], d: [0, 0, -1] }, R);
  assert.ok(r.perto < r.longe);
  assert.ok(Math.abs(r.perto - 400) < 1e-9, "perto " + r.perto);
  assert.equal(raizesEsfera({ o: [0, 300, 500], d: [0, 0, -1] }, R), null);
});

console.log("\nacerto no relevo");

// Campo com UM domo em (0, 0): altura 1 no centro, caindo com a distancia.
const domo = (largura = 25) => (lat, lng) => {
  const d = Math.hypot(lat, ((lng + 540) % 360) - 180);
  return Math.max(0, 1 - d / largura);
};

const OPC = { raio: R, exagero: 0.25, alturaEm: domo() };

ok("de frente, o acerto cai no topo do domo", () => {
  const r = raioPara([0, 0, 500], [0, 0, 0]);
  const a = intersectarRelevo(r, OPC);
  assert.ok(a, "nao acertou nada");
  assert.ok(Math.abs(a.lat) < 0.5 && Math.abs(a.lng) < 0.5, `${a.lat}, ${a.lng}`);
  // o topo esta em R*(1+exagero) = 125
  assert.ok(Math.abs(500 - a.t - 125) < 1.0, "acertou em r=" + (500 - a.t));
});

// ESTE E O TESTE QUE IMPORTA. De lado, o raio que tangencia o domo bate no
// relevo MUITO ANTES de bater na esfera, e as duas respostas sao lugares
// diferentes do planeta.
ok("em vista obliqua, o relevo e a esfera dao respostas DIFERENTES", () => {
  // A camera esta a LESTE e o raio aponta para um ponto da esfera a OESTE do
  // domo. Sem considerar o relevo, ele atravessaria o domo e pousaria naquele
  // ponto de tras — que e' exatamente a reclamacao: clicar numa alta e a sonda
  // abrir noutro lugar.
  const olho = naEsfera(0, 80, 600);
  const atrasDoDomo = naEsfera(0, -12, R);
  const r = raioPara(olho, atrasDoDomo);

  const noRelevo = intersectarRelevo(r, OPC);
  assert.ok(noRelevo, "o raio nao achou o relevo");

  const naLisa = raizesEsfera(r, R);
  assert.ok(naLisa && naLisa.perto > 0, "o raio nem toca a esfera");
  const gLisa = geoDe([
    r.o[0] + r.d[0] * naLisa.perto,
    r.o[1] + r.d[1] * naLisa.perto,
    r.o[2] + r.d[2] * naLisa.perto,
  ]);

  const erro = Math.hypot(noRelevo.lat - gLisa.lat, noRelevo.lng - gLisa.lng);
  assert.ok(erro > 3,
    `relevo (${noRelevo.lat.toFixed(1)}, ${noRelevo.lng.toFixed(1)}) e esfera ` +
    `(${gLisa.lat.toFixed(1)}, ${gLisa.lng.toFixed(1)}) coincidiram: o teste nao prova nada`);

  // e o acerto do relevo tem que estar PERTO DO DOMO, que e o que a pessoa mira
  assert.ok(Math.hypot(noRelevo.lat, noRelevo.lng) < 25,
    `o acerto caiu fora do domo: ${noRelevo.lat.toFixed(1)}, ${noRelevo.lng.toFixed(1)}`);
});

ok("o acerto sempre fica na casca, entre a esfera e o teto do relevo", () => {
  for (const lng of [0, 20, 45, 70]) {
    const r = raioPara(naEsfera(10, lng, 600), naEsfera(0, 0, R * 1.1));
    const a = intersectarRelevo(r, OPC);
    if (!a) continue;
    const p = [r.o[0] + r.d[0] * a.t, r.o[1] + r.d[1] * a.t, r.o[2] + r.d[2] * a.t];
    const rr = Math.hypot(...p);
    assert.ok(rr >= R - 1e-6 && rr <= R * 1.25 + 1e-6, `raio do acerto ${rr}`);
  }
});

console.log("\nquando NAO ha acerto");

// Os tres casos abaixo tem que devolver null para quem chama poder cair no
// plano B (a esfera lisa) em vez de receber uma coordenada inventada.
ok("raio que passa longe do planeta nao acerta", () => {
  assert.equal(intersectarRelevo({ o: [0, 400, 500], d: [0, 0, -1] }, OPC), null);
});

ok("raio que passa por cima de todo o relevo nao acerta", () => {
  // rasante bem acima do domo, mas ainda dentro da casca externa
  const r = { o: [-500, 0, 124], d: [1, 0, 0] };
  const a = intersectarRelevo(r, { ...OPC, alturaEm: () => 0.02 });
  assert.equal(a, null, "inventou acerto onde o relevo e' raso");
});

// Onde a fonte nao mediu NAO existe superficie. Tratar ausencia como zero
// criaria um chao invisivel no nivel da esfera, e o clique pousaria num lugar
// onde nao ha malha desenhada.
ok("buraco no dado nao vira chao no nivel da esfera", () => {
  const r = raioPara([0, 0, 500], [0, 0, 0]);
  assert.equal(intersectarRelevo(r, { ...OPC, alturaEm: () => null }), null);
});

ok("exagero zero nao tem casca, e nao ha o que acertar", () => {
  const r = raioPara([0, 0, 500], [0, 0, 0]);
  assert.equal(intersectarRelevo(r, { ...OPC, exagero: 0 }), null);
});

console.log("\ncamera dentro da casca");

// Ignorar isto faria o clique voltar a cair na esfera justamente no zoom em que
// o relevo ocupa mais tela.
ok("com a camera ja dentro do relevo, o acerto sai mesmo assim", () => {
  const r = { o: naEsfera(0, 0, R * 1.05), d: norm([0, 0, -1]) };
  const a = intersectarRelevo(r, OPC);
  assert.ok(a, "perdeu o acerto com a camera dentro da casca");
});

console.log("\nprecisao e custo");

ok("a bisseccao converge para a travessia", () => {
  const r = raioPara([0, 0, 500], [0, 0, 0]);
  const grosso = intersectarRelevo(r, { ...OPC, passos: 16, refinos: 2 });
  const fino = intersectarRelevo(r, { ...OPC, passos: 256, refinos: 24 });
  assert.ok(Math.abs(grosso.t - fino.t) < 1.5, `${grosso.t} vs ${fino.t}`);
});

// O ponto do arquivo inteiro: o custo NAO depende da resolucao da grade.
ok("o numero de consultas ao campo e limitado e previsivel", () => {
  let chamadas = 0;
  const r = raioPara([0, 0, 500], [0, 0, 0]);
  intersectarRelevo(r, {
    ...OPC,
    passos: 64, refinos: 12,
    alturaEm: (lat, lng) => { chamadas++; return domo()(lat, lng); },
  });
  assert.ok(chamadas <= 90, "gastou " + chamadas + " consultas");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
