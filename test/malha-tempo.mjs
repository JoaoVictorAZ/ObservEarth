// test/malha-tempo.mjs
// -----------------------------------------------------------------------------
// A QUARTA DIMENSÃO, E A DIFERENÇA ENTRE OS DOIS TIPOS DE EXTREMO.
// -----------------------------------------------------------------------------
// O teste que descreve melhor o módulo é o do "mapa que nunca aconteceu": uma
// pilha em que a célula A atinge o pico na primeira hora e a célula B na
// última. O mapa de máximas junta os dois num só quadro, e esse quadro NÃO
// corresponde a nenhum instante real. Ele é um envelope, e o único jeito de
// alguém saber disso é o `quandoMaximo` vir junto.
//
// O resto é aritmética exata: uma rampa linear no tempo tem que devolver a
// inclinação da rampa, com R² = 1 e resíduo zero — se a solução da equação
// normal estiver certa. Não há tolerância de discretização a acomodar aqui,
// porque o modelo ajustado é EXATAMENTE o modelo que gerou o dado.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { agregarTempo, tendencia, anomalia, extremos4D } from "../src/malha/tempo.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

const HORA = 3600e3;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

/** grade pequena, porque aqui o que se testa é o eixo do tempo */
const NX = 8, NY = 5;

function fatia(f, hora) {
  const v = new Float32Array(NX * NY);
  for (let k = 0; k < NX * NY; k++) v[k] = f(k, hora);
  return {
    campo: { nx: NX, ny: NY, valores: v, unidade: "°C", titulo: "temperatura", dataset: "teste" },
    instante: T0 + hora * HORA,
  };
}

console.log("\nagregação temporal");

ok("média, mínimo e máximo por célula, com a HORA de cada extremo", () => {
  // Célula 0 sobe; célula 1 desce. Os dois picos acontecem em pontas opostas
  // da janela, e é exatamente por isso que o mapa de máximas é um envelope.
  const pilha = [0, 3, 6, 9].map((h) =>
    fatia((k) => (k === 0 ? 10 + h : k === 1 ? 30 - h : 20), h));
  const a = agregarTempo(pilha);

  perto(a.maximo.valores[0], 19, 1e-5, "máximo da célula que sobe");
  assert.equal(a.quandoMaximo[0], T0 + 9 * HORA, "a célula que sobe picou no fim");
  perto(a.maximo.valores[1], 30, 1e-5, "máximo da célula que desce");
  assert.equal(a.quandoMaximo[1], T0 + 0 * HORA, "a célula que desce picou no começo");

  // O mapa de máximas mostra 19 e 30 lado a lado. Não houve instante nenhum em
  // que os dois valores existissem ao mesmo tempo.
  assert.notEqual(a.quandoMaximo[0], a.quandoMaximo[1], "o envelope não é uma fotografia");

  perto(a.media.valores[0], 14.5, 1e-5, "média da célula que sobe");
  perto(a.amplitude.valores[0], 9, 1e-5, "amplitude");
  assert.equal(a.fatias, 4);
  assert.equal(a.intervalo.de, T0);
  assert.equal(a.intervalo.ate, T0 + 9 * HORA);
});

ok("o desvio temporal é AMOSTRAL (n−1), ao contrário do espacial", () => {
  // valores 1, 2, 3, 4 → média 2,5; desvio amostral = √(5/3) ≈ 1,29099
  // (o populacional daria √1,25 ≈ 1,11803, e a diferença é visível)
  const pilha = [0, 1, 2, 3].map((h) => fatia(() => h + 1, h));
  const a = agregarTempo(pilha);
  perto(a.media.valores[0], 2.5, 1e-6, "média");
  perto(a.desvio.valores[0], Math.sqrt(5 / 3), 1e-5, "desvio amostral");
  assert.notEqual(+a.desvio.valores[0].toFixed(4), +Math.sqrt(1.25).toFixed(4));
});

ok("uma fatia só: média existe, desvio NÃO — e a diferença fica na máscara", () => {
  const a = agregarTempo([fatia(() => 7, 0)]);
  perto(a.media.valores[0], 7, 1e-6, "média");
  assert.equal(a.media.valido[0], 1, "a média devia valer");
  assert.equal(a.desvio.valido[0], 0, "com uma fatia não há dispersão para declarar");
});

ok("célula ausente em algumas fatias entra só nas que tinha dado", () => {
  const pilha = [0, 1, 2].map((h) => {
    const f = fatia(() => 10 * (h + 1), h);
    if (h === 1) {
      f.campo.valido = new Uint8Array(NX * NY).fill(1);
      f.campo.valido[0] = 0;      // a célula 0 falta na fatia do meio
    }
    return f;
  });
  const a = agregarTempo(pilha);
  assert.equal(a.contagem[0], 2, "contagem da célula com buraco");
  assert.equal(a.contagem[1], 3, "contagem da célula sem buraco");
  perto(a.media.valores[0], 20, 1e-5, "média de 10 e 30");
  perto(a.media.valores[1], 20, 1e-5, "média de 10, 20 e 30");
});

ok("pilha com grades diferentes é RECUSADA", () => {
  const a = fatia(() => 1, 0);
  const b = { campo: { nx: 4, ny: 3, valores: new Float32Array(12) }, instante: T0 + HORA };
  assert.throws(() => agregarTempo([a, b]), /grades diferentes/);
  assert.throws(() => agregarTempo([]), /pilha vazia/);
});

console.log("\ntendência linear");

ok("uma rampa de 0,5 °C por hora devolve 0,5, com R² = 1 e resíduo zero", () => {
  const pilha = [0, 2, 4, 6, 8].map((h) => fatia(() => 20 + 0.5 * h, h));
  const t = tendencia(pilha);
  perto(t.porHora.valores[0], 0.5, 1e-5, "β");
  perto(t.r2.valores[0], 1, 1e-5, "R²");
  perto(t.erroPadrao.valores[0], 0, 1e-5, "erro padrão de um ajuste exato");
  assert.equal(t.porHora.unidade, "°C/h");
});

ok("as horas NÃO precisam ser igualmente espaçadas", () => {
  // O GFS não entrega passo constante: análise, +1h, +3h, +6h… Uma implementação
  // que usasse o ÍNDICE da fatia como tempo daria a inclinação errada aqui e
  // certa no teste anterior — e o teste anterior sozinho não pegaria.
  const pilha = [0, 1, 3, 6, 12].map((h) => fatia(() => 20 + 0.5 * h, h));
  const t = tendencia(pilha);
  perto(t.porHora.valores[0], 0.5, 1e-5, "β com passo irregular");
});

ok("uma tendência de sinal negativo sai negativa", () => {
  const pilha = [0, 3, 6].map((h) => fatia(() => 20 - 2 * h, h));
  const t = tendencia(pilha);
  perto(t.porHora.valores[0], -2, 1e-5, "β");
});

ok("com ruído, o erro padrão deixa de ser zero — é ele que qualifica a subida", () => {
  const desvios = [0.4, -0.3, 0.5, -0.6, 0.2, -0.2];
  const pilha = desvios.map((d, s) => fatia(() => 20 + 0.5 * s + d, s));
  const t = tendencia(pilha);
  assert.ok(t.erroPadrao.valido[0] === 1, "erro padrão devia existir com 6 fatias");
  assert.ok(t.erroPadrao.valores[0] > 0, "erro padrão devia ser positivo com resíduo");
  assert.ok(t.r2.valores[0] < 1, "R² devia ser menor que 1 com resíduo");
  // A pergunta que importa: a inclinação é distinguível de zero? Aqui sim.
  assert.ok(t.porHora.valores[0] / t.erroPadrao.valores[0] > 3, "razão sinal/ruído baixa demais");
});

ok("com DUAS fatias a reta é exata e a incerteza é declarada ausente", () => {
  // n−2 = 0. A reta passa pelos dois pontos e o resíduo é zero — mas isso não
  // é um ajuste bom, é um ajuste sem graus de liberdade. Publicar erro padrão
  // zero aqui afirmaria certeza absoluta a partir de dois pontos.
  const pilha = [0, 6].map((h) => fatia(() => 20 + 0.5 * h, h));
  const t = tendencia(pilha);
  perto(t.porHora.valores[0], 0.5, 1e-5, "β");
  assert.equal(t.porHora.valido[0], 1, "a inclinação existe");
  assert.equal(t.erroPadrao.valido[0], 0, "a incerteza NÃO existe com duas fatias");
});

ok("todas as fatias no MESMO instante: sem tendência, e sem zero mentiroso", () => {
  const pilha = [0, 0, 0].map(() => fatia(() => 20, 0));
  const t = tendencia(pilha);
  assert.equal(t.porHora.valido[0], 0, "zero aqui afirmaria 'estável', que é uma medida");
});

console.log("\nanomalia e extremos 4D");

ok("a anomalia é o campo menos a referência, e declara qual referência é", () => {
  const pilha = [0, 6, 12].map((h) => fatia((k) => (k === 0 ? 20 + h : 15), h));
  const a = agregarTempo(pilha);
  const an = anomalia(pilha[2].campo, a.media);
  // célula 0: 32 contra média 26 → +6
  perto(an.valores[0], 6, 1e-5, "anomalia positiva");
  perto(an.valores[1], 0, 1e-5, "célula que não variou");
  assert.match(an.titulo, /referência/, "a anomalia não disse contra o que foi medida");
  assert.equal(an.unidade, "°C");
});

ok("anomalia com grade diferente é recusada", () => {
  const a = fatia(() => 1, 0).campo;
  const b = { nx: 4, ny: 3, valores: new Float32Array(12) };
  assert.throws(() => anomalia(a, b), /mesma grade/);
});

ok("o extremo 4D aconteceu de verdade: tem lugar E hora", () => {
  const pilha = [0, 3, 6].map((h) =>
    fatia((k) => (k === 3 && h === 3 ? 45 : k === 5 && h === 6 ? -12 : 20), h));
  const e = extremos4D(pilha);
  perto(e.maximo.valor, 45, 1e-5, "valor máximo");
  assert.equal(e.maximo.instante, T0 + 3 * HORA, "hora do máximo");
  assert.equal(e.maximo.fatia, 1, "índice da fatia do máximo");
  perto(e.minimo.valor, -12, 1e-5, "valor mínimo");
  assert.equal(e.minimo.instante, T0 + 6 * HORA, "hora do mínimo");
  // Lugar e hora diferentes: é o que distingue este resultado do envelope.
  assert.notEqual(e.maximo.instante, e.minimo.instante);
});

ok("o extremo 4D respeita a janela", () => {
  // pico no hemisfério norte, janela só do sul
  const pilha = [fatia((k) => (k < NX ? 99 : 20), 0)];
  const e = extremos4D(pilha, { latSul: -90, latNorte: -45, lngOeste: -180, lngLeste: 180 });
  assert.ok(e.maximo.valor < 99, `a janela não recortou: ${e.maximo.valor}`);
});

console.log(`\n  ${n} verificações da quarta dimensão\n`);
