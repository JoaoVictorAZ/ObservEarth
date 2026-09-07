// test/malha-estatistica.mjs
// -----------------------------------------------------------------------------
// ESTATÍSTICA ESPACIAL, CONFERIDA CONTRA INTEGRAIS QUE SE RESOLVEM À MÃO.
// -----------------------------------------------------------------------------
// O TESTE QUE JUSTIFICA O MÓDULO INTEIRO é o do sen²φ. A média dele sobre a
// esfera vale
//
//     ∫ sen²φ cos φ dφ / ∫ cos φ dφ  =  (2/3) / 2  =  1/3
//
// exatamente. A média SEM ponderação, sobre uma grade regular em grau, vale
// 1/2 — porque a grade dá aos polos, onde sen²φ = 1, um voto que a Terra não
// dá. São 50% de erro num campo de brinquedo; num campo de temperatura são
// vários graus, e ninguém olhando para o número saberia dizer.
//
// O TESTE MAIS BONITO é o dos quantis. Sob a medida de área da esfera,
// dA ∝ cos φ dφ = d(sen φ) — então sen φ é UNIFORME em [−1, 1]. A mediana
// ponderada por área de sen φ tem que dar 0, o primeiro quartil −0,5 e o
// terceiro +0,5, e esses números não vêm de rodar o código: vêm da mudança de
// variável. Um quantil ponderado por ÍNDICE em vez de por área não passa nem
// perto.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { latDaLinha, lngDaColuna } from "../src/malha/campo.ts";
import { momentos, quantis, comparar } from "../src/malha/estatistica.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const rad = Math.PI / 180;
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

function campoDe(nx, ny, f, extra = {}) {
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = f(latDaLinha(j, ny) * rad, lngDaColuna(i, nx) * rad);
  }
  return { nx, ny, valores: v, unidade: "u", titulo: "teste", ...extra };
}

const NX = 360, NY = 181;

console.log("\nmomentos ponderados por área");

ok("a média de sen²φ é 1/3 — e SEM ponderação seria 1/2", () => {
  const c = campoDe(NX, NY, (phi) => Math.sin(phi) ** 2);
  const m = momentos(c);
  perto(m.media, 1 / 3, 1e-4, "média ponderada");

  // A média crua da mesma grade, para o teste mostrar a diferença em vez de
  // afirmá-la. Se um dia alguém "simplificar" a ponderação, este número é o
  // que a substituição produziria.
  let soma = 0;
  for (let k = 0; k < NX * NY; k++) soma += c.valores[k];
  perto(soma / (NX * NY), 0.5, 5e-3, "média crua");
});

ok("a média de sen φ é zero por simetria hemisférica", () => {
  const c = campoDe(NX, NY, (phi) => Math.sin(phi));
  const m = momentos(c);
  perto(m.media, 0, 1e-12, "média");
  // Var(sen φ) = E[sen²] − E[sen]² = 1/3 − 0
  perto(m.variancia, 1 / 3, 1e-4, "variância");
  perto(m.desvio, Math.sqrt(1 / 3), 1e-4, "desvio");
});

ok("num campo constante a variância NUNCA fica negativa, e o desvio nunca é NaN", () => {
  // A fórmula de um passo, E[x²] − E[x]², subtrai dois números quase iguais e
  // muito grandes: com 288,15 K a diferença sai da ordem de −1e−9, NEGATIVA, e
  // a raiz quadrada disso é NaN. A tela mostraria "desvio: NaN" para um campo
  // perfeitamente bem comportado.
  //
  // A soma de quadrados de duas passagens não tem como ser negativa: cada
  // termo é d², e d² ≥ 0. A garantia é estrutural, não de tolerância.
  const c = campoDe(NX, NY, () => 288.15);
  const m = momentos(c);
  perto(m.media, 288.15, 1e-9, "média");
  assert.ok(m.variancia >= 0, `variância negativa: ${m.variancia}`);
  assert.ok(Number.isFinite(m.desvio), "desvio virou NaN");
  assert.ok(m.desvio < 1e-9, `desvio ${m.desvio} grande demais para um campo constante`);
});

ok("o extremo vem com o LUGAR onde ocorre", () => {
  // Máximo em (0°, 0°) e mínimo em (0°, 180°) — ver test/malha-derivadas.
  const c = campoDe(NX, NY, (phi, lam) => Math.cos(phi) * Math.cos(lam));
  const m = momentos(c);
  perto(m.maximo.valor, 1, 1e-6, "valor máximo");
  perto(m.maximo.lat, 0, 1e-9, "lat do máximo");
  perto(m.maximo.lng, 0, 1e-9, "lng do máximo");
  perto(m.minimo.valor, -1, 1e-6, "valor mínimo");
  perto(Math.abs(m.minimo.lng), 180, 1e-9, "lng do mínimo");
  perto(m.amplitude, 2, 1e-6, "amplitude");
});

ok("a área coberta pelo mundo inteiro é a da Terra, em km²", () => {
  const c = campoDe(72, 37, () => 1);
  const m = momentos(c);
  perto(m.areaKm2 / 510.1e6, 1, 1e-3, "área da Terra");
  assert.equal(m.cobertura, 1);
  assert.equal(m.ausentes, 0);
});

ok("célula ausente não entra na conta e aparece na cobertura", () => {
  const c = campoDe(NX, NY, () => 10);
  c.valido = new Uint8Array(NX * NY).fill(1);
  // apaga o hemisfério norte inteiro
  for (let j = 0; j < (NY - 1) / 2; j++) for (let i = 0; i < NX; i++) c.valido[j * NX + i] = 0;
  const m = momentos(c);
  perto(m.media, 10, 1e-9, "média do que sobrou");
  perto(m.cobertura, 0.5, 0.01, "cobertura");
  assert.ok(m.ausentes > 0, "ausentes não foram contados");
});

ok("sem NENHUMA célula medida devolve null, e não um resumo de zeros", () => {
  const c = campoDe(36, 19, () => 5);
  c.valido = new Uint8Array(36 * 19);   // tudo zero
  assert.equal(momentos(c), null);
  assert.equal(quantis(c, [0.5]), null);
});

ok("a janela recorta de verdade — e a borda é uma CÉLULA, não um corte fino", () => {
  const c = campoDe(NX, NY, (phi) => Math.sin(phi));
  // Hemisfério norte: ∫₀^{π/2} sen φ cos φ dφ / ∫₀^{π/2} cos φ dφ = 1/2.
  //
  // O que sai é 0,4957, e a diferença NÃO é erro: a janela seleciona células
  // inteiras, e a célula do equador está metade ao norte e metade ao sul. Ela
  // entra com peso cheio e valor zero, o que dilui a média por 1/(1 + w/2).
  // Com ny = 181 isso é 0,87% — exatamente o que se vê.
  //
  // Vale registrar porque quem pedir "média do hemisfério norte" e comparar
  // com um livro vai encontrar esta diferença e precisa saber de onde vem.
  const m = momentos(c, { latSul: 0, latNorte: 90, lngOeste: -180, lngLeste: 180 });
  perto(m.media, 0.5, 0.01, "média do hemisfério norte");
  assert.ok(m.media < 0.5, "a diluição da célula de borda tem sinal conhecido");
  assert.ok(m.minimo.valor >= -1e-9, "entrou latitude sul de verdade na janela");
});

console.log("\nquantis ponderados por área");

ok("sen φ é UNIFORME sob a medida de área: mediana 0, quartis ∓0,5", () => {
  const c = campoDe(NX, NY, (phi) => Math.sin(phi));
  const q = quantis(c, [0.25, 0.5, 0.75]);
  perto(q["0.5"], 0, 0.01, "mediana");
  perto(q["0.25"], -0.5, 0.01, "primeiro quartil");
  perto(q["0.75"], 0.5, 0.01, "terceiro quartil");
});

ok("num campo assimétrico a mediana foge da média — e é ela que descreve", () => {
  // Precipitação de brinquedo: quase tudo zero, uma faixa estreita em 80.
  const c = campoDe(NX, NY, (phi) => (Math.abs(phi) < 0.05 ? 80 : 0));
  const m = momentos(c);
  const q = quantis(c, [0.5, 0.99]);
  assert.equal(q["0.5"], 0, "metade da ÁREA está seca");
  assert.ok(m.media > 0 && m.media < 5, `média ${m.media} devia ser pequena e não zero`);
  assert.ok(q["0.99"] > 0, "o percentil alto devia enxergar a faixa");
});

ok("os quantis extremos batem com mínimo e máximo", () => {
  const c = campoDe(180, 91, (phi, lam) => Math.cos(phi) * Math.sin(lam));
  const m = momentos(c);
  const q = quantis(c, [0, 1]);
  perto(q["0"], m.minimo.valor, 1e-6, "q=0");
  perto(q["1"], m.maximo.valor, 1e-6, "q=1");
});

console.log("\ncomparação entre campos");

ok("a = 2b + 3 é recuperado exatamente pelos mínimos quadrados", () => {
  const b = campoDe(NX, NY, (phi, lam) => Math.cos(phi) * Math.cos(lam));
  const a = campoDe(NX, NY, (phi, lam) => 2 * Math.cos(phi) * Math.cos(lam) + 3);
  const r = comparar(a, b);
  perto(r.inclinacao, 2, 1e-6, "β");
  perto(r.intercepto, 3, 1e-6, "α");
  perto(r.correlacao, 1, 1e-9, "correlação");
  perto(r.r2, 1, 1e-9, "R²");
  perto(r.vies, 3, 1e-6, "viés: a − b tem média 3 porque b tem média 0");
});

ok("dois campos idênticos: viés, EQM e EAM zerados, correlação 1", () => {
  const a = campoDe(180, 91, (phi, lam) => Math.sin(phi) + Math.cos(lam));
  const b = campoDe(180, 91, (phi, lam) => Math.sin(phi) + Math.cos(lam));
  const r = comparar(a, b);
  assert.equal(r.vies, 0);
  assert.equal(r.eqm, 0);
  assert.equal(r.eam, 0);
  perto(r.correlacao, 1, 1e-12, "correlação");
});

ok("campos anticorrelacionados dão −1, e o eixo principal denuncia", () => {
  const a = campoDe(180, 91, (phi) => Math.sin(phi));
  const b = campoDe(180, 91, (phi) => -Math.sin(phi));
  const r = comparar(a, b);
  perto(r.correlacao, -1, 1e-9, "correlação");
  perto(r.inclinacao, -1, 1e-9, "β");
  // Nuvem colapsada numa reta: um autovalor carrega tudo, o outro é ~0.
  assert.ok(r.eixoPrincipal.autovalorMenor < 1e-12 * r.eixoPrincipal.autovalorMaior,
    "a nuvem não colapsou numa reta");
});

ok("contra um campo CONSTANTE a correlação é NaN, não zero", () => {
  // Zero diria "não se parecem". A verdade é que não há do que falar: um dos
  // dois não varia, e a correlação não está definida.
  const a = campoDe(180, 91, (phi) => Math.sin(phi));
  const b = campoDe(180, 91, () => 7);
  const r = comparar(a, b);
  assert.ok(Number.isNaN(r.correlacao), `veio ${r.correlacao}`);
  assert.ok(Number.isNaN(r.inclinacao), "β de um regressor constante não existe");
  perto(r.vies, -7, 1e-6, "o viés continua existindo e valendo");
});

ok("grades diferentes são RECUSADAS, não reamostradas", () => {
  const a = campoDe(360, 181, (phi) => Math.sin(phi));
  const b = campoDe(180, 91, (phi) => Math.sin(phi));
  assert.throws(() => comparar(a, b), /grades diferentes/);
});

ok("a maior diferença vem com o lugar e o sinal", () => {
  const base = (phi, lam) => Math.cos(phi) * Math.cos(lam);
  const a = campoDe(NX, NY, base);
  const b = campoDe(NX, NY, base);
  // crava uma discordância de −5 num ponto conhecido
  const j = (NY - 1) / 2, i = NX / 4;      // equador, lng −90
  b.valores[j * NX + i] += 5;
  const r = comparar(a, b);
  perto(r.maiorDiferenca.valor, -5, 1e-6, "diferença assinada");
  perto(r.maiorDiferenca.lat, 0, 1e-9, "lat");
  perto(r.maiorDiferenca.lng, -90, 1e-9, "lng");
});

ok("célula ausente em QUALQUER um dos dois é descartada nos dois", () => {
  const a = campoDe(72, 37, () => 10);
  const b = campoDe(72, 37, () => 4);
  b.valido = new Uint8Array(72 * 37).fill(1);
  b.valido[10] = 0;
  const r = comparar(a, b);
  assert.equal(r.n, 72 * 37 - 1, `n = ${r.n}`);
  perto(r.vies, 6, 1e-9, "viés");
});

console.log(`\n  ${n} verificações da estatística espacial\n`);
