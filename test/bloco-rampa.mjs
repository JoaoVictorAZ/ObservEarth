// test/bloco-rampa.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/bloco-rampa.mjs
//
// A rampa do bloco passou a se esticar para a faixa do recorte. É uma troca:
// ganha-se contraste onde o dado está e perde-se comparabilidade entre blocos.
//
// A parte que NÃO pode ser negociada nessa troca é a linha d'água. Esticar as
// duas metades juntas moveria o zero para o meio da faixa, e um bloco sem
// nenhuma terra exposta ganharia verde de planície no ponto mais raso —
// inventando uma costa que não existe. Estes testes existem para isso.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { rampaDoRecorte } from "../src/bloco/cena.ts";
import { corDaRampa } from "../src/malha/rampa.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

/** Quanto de azul contra verde: separa "isto é água" de "isto é terra". */
const azulejo = ([r, g, b]) => b - g;

console.log("\na rampa cobre a faixa do recorte");

ok("as paradas começam no mínimo e terminam no máximo", () => {
  const p = rampaDoRecorte(-4695, 165);
  assert.ok(Math.abs(p[0][0] - (-4695)) < 1e-6, `começa em ${p[0][0]}`);
  assert.ok(Math.abs(p[p.length - 1][0] - 165) < 1e-6, `termina em ${p[p.length - 1][0]}`);
});

ok("as paradas ficam em ordem crescente", () => {
  for (const [lo, hi] of [[-4695, 165], [-80, 1200], [-11000, -3000], [5, 2995]]) {
    const p = rampaDoRecorte(lo, hi);
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i][0] >= p[i - 1][0], `${lo}..${hi}: parada ${i} fora de ordem`);
    }
  }
});

console.log("\nas cores ficam ESPALHADAS, não concentradas perto do zero");

// A PRIMEIRA TENTATIVA ESTICOU AS POSICOES PROPORCIONALMENTE E NAO RESOLVEU.
//
// As paradas de MAR sao -8000, -3000, -600, -60, -1: concentradas perto do
// zero, que e' a distribuicao certa para um atlas. Reescalar mantem a
// concentracao -- num bloco de -4695 a 0 a parada de -3000 cai em -1761, e os
// dois azuis mais escuros continuam cobrindo 63% da faixa.
//
// Este teste mede o ESPACAMENTO: nenhum intervalo entre paradas consecutivas
// pode engolir a faixa.
ok("nenhum intervalo entre paradas passa de 40% da faixa", () => {
  for (const [lo, hi] of [[-4695, 165], [-5200, -4000], [-80, 1200], [0, 2995]]) {
    const p = rampaDoRecorte(lo, hi);
    const faixa = p[p.length - 1][0] - p[0][0];
    for (let i = 1; i < p.length; i++) {
      const passo = (p[i][0] - p[i - 1][0]) / faixa;
      assert.ok(passo <= 0.40 + 1e-9,
                `${lo}..${hi}: o intervalo ${i} ocupa ${(passo * 100).toFixed(0)}% da faixa`);
    }
  }
});

console.log("\no contraste volta — que é o motivo de tudo isto");

// MEDIDO EM 16/09/2026: bloco de 500 km em 13,6°S / 175,7°L, altitudes de
// -4.695 a 165 m. Com a rampa absoluta, o fundo inteiro caia entre duas
// paradas quase identicas e aparecia como mancha azul uniforme.
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

ok("num bloco oceânico, fundo e meia-água ficam distinguíveis", () => {
  const p = rampaDoRecorte(-4695, 165);
  const fundo = corDaRampa(p, -4600);
  const meio = corDaRampa(p, -2300);
  const raso = corDaRampa(p, -100);

  assert.ok(dist(fundo, meio) > 40, `fundo e meio quase iguais: ${dist(fundo, meio)}`);
  assert.ok(dist(meio, raso) > 40, `meio e raso quase iguais: ${dist(meio, raso)}`);
});

// O caso que motivou tudo: um bloco INTEIRAMENTE em planicie abissal. Com a
// rampa absoluta ele cai entre duas paradas quase identicas e sai preto.
ok("um bloco todo em planície abissal usa a paleta inteira", () => {
  const p = rampaDoRecorte(-5200, -4000);
  const baixo = corDaRampa(p, -5150);
  const alto = corDaRampa(p, -4050);
  assert.ok(dist(baixo, alto) > 150,
            `de -5150 a -4050 mudou só ${dist(baixo, alto)} — continua uma mancha só`);
});

console.log("\na linha d'água não se move");

ok("num bloco todo submerso, NENHUMA profundidade fica verde", () => {
  const p = rampaDoRecorte(-4695, -120);
  for (const z of [-4695, -4000, -2000, -500, -121]) {
    const c = corDaRampa(p, z);
    assert.ok(azulejo(c) > 0, `${z} m saiu com cara de terra: ${c}`);
  }
});

ok("num bloco todo emerso, NENHUMA altitude fica azul de profundidade", () => {
  const p = rampaDoRecorte(120, 2995);
  for (const z of [120, 800, 1600, 2995]) {
    const c = corDaRampa(p, z);
    assert.ok(azulejo(c) <= 0, `${z} m saiu com cara de água: ${c}`);
  }
});

ok("num bloco costeiro, o zero continua sendo a virada", () => {
  const p = rampaDoRecorte(-60, 900);
  assert.ok(azulejo(corDaRampa(p, -1)) > 0, "−1 m devia ser água");
  assert.ok(azulejo(corDaRampa(p, 1)) <= 0, "+1 m devia ser terra");
});

console.log("\na costa: acima e abaixo do zero, medíveis");

// O caso que o recorte costeiro existe para responder: onde esta' o mar, e
// quanto sobe ou desce em relacao a ele. Os dois lados precisam de contraste
// PROPRIO -- esticar a faixa inteira de uma vez daria a metade submersa duas
// cores e a emersa dez, ou o contrario, conforme a proporcao do recorte.
ok("num bloco costeiro, os dois lados ganham contraste próprio", () => {
  const p = rampaDoRecorte(-60, 900);

  // submerso: -60 a -1 precisa variar
  const fundo = corDaRampa(p, -55);
  const beira = corDaRampa(p, -5);
  assert.ok(dist(fundo, beira) > 60,
            `a faixa submersa de 60 m variou só ${dist(fundo, beira)}`);

  // emerso: 0 a 900 precisa variar
  const praia = corDaRampa(p, 20);
  const alto = corDaRampa(p, 860);
  assert.ok(dist(praia, alto) > 100,
            `a faixa emersa de 900 m variou só ${dist(praia, alto)}`);
});

ok("a proporção do recorte não rouba cor de um dos lados", () => {
  // Bloco com 5 m de mar e 2000 m de serra: a faixa submersa e' 0,25% da
  // amplitude e mesmo assim tem que ser legivel como agua.
  const p = rampaDoRecorte(-5, 2000);
  assert.ok(azulejo(corDaRampa(p, -4)) > 0, "os 5 m de mar sumiram");
  assert.ok(azulejo(corDaRampa(p, 4)) <= 0, "a terra logo acima virou água");
});

console.log("\ncasos degenerados não derrubam nada");

ok("faixa invertida ou nula cai para a rampa absoluta", () => {
  for (const [lo, hi] of [[100, 100], [500, -500], [NaN, 10], [0, NaN]]) {
    const p = rampaDoRecorte(lo, hi);
    assert.ok(Array.isArray(p) && p.length >= 2, `${lo}..${hi} devolveu ${p?.length}`);
  }
});

ok("mesmo na faixa degenerada a virada no zero sobrevive", () => {
  const p = rampaDoRecorte(NaN, NaN);
  assert.ok(azulejo(corDaRampa(p, -1)) > 0);
  assert.ok(azulejo(corDaRampa(p, 1)) <= 0);
});

console.log(`\n  ${n} verificacoes\n`);
