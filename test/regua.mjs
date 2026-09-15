import assert from "node:assert/strict";
import {
  dominio, posicaoDe, gradienteCSS, marcasDe, formatar, abaixoDoPiso,
} from "../src/legenda/regua.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

// Recorte real do catalogo do servidor (server/fields.js), com RGB em 0-255.
const TEMP = [
  [-30, [ 40,   0,  80]],
  [-15, [ 20,  60, 160]],
  [  0, [ 40, 150, 200]],
  [ 15, [120, 200, 120]],
  [ 30, [240, 180,  60]],
  [ 45, [200,  40,  40]],
];

// Chuva e classificada em degraus, nao interpolada.
const CHUVA = [
  [0.2, [ 80, 140, 200]],
  [2.0, [ 60, 180, 140]],
  [10.0, [220, 200,  80]],
  [30.0, [220,  90,  60]],
];

console.log("\ndominio");

ok("min e max saem das paradas", () => {
  assert.deepEqual(dominio(TEMP), { min: -30, max: 45 });
});

// Uma escala de largura zero produziria marcador em NaN%, que o navegador
// ignora -- e o ponto fica grudado na esquerda como se todo valor fosse o
// minimo.
ok("escala degenerada devolve null em vez de dividir por zero", () => {
  assert.equal(dominio([[5, [0, 0, 0]], [5, [1, 1, 1]]]), null);
  assert.equal(dominio([[5, [0, 0, 0]]]), null, "uma parada so nao e escala");
  assert.equal(dominio(null), null);
  assert.equal(dominio([]), null);
});

console.log("\nposicao do valor");

ok("as pontas e o meio caem onde devem", () => {
  assert.equal(posicaoDe(-30, TEMP), 0);
  assert.equal(posicaoDe(45, TEMP), 1);
  assert.ok(Math.abs(posicaoDe(7.5, TEMP) - 0.5) < 1e-12, "meio deu " + posicaoDe(7.5, TEMP));
});

ok("valor fora da escala gruda na ponta, nao sai da regua", () => {
  assert.equal(posicaoDe(-99, TEMP), 0);
  assert.equal(posicaoDe(999, TEMP), 1);
});

ok("ausencia devolve null, nunca zero", () => {
  for (const v of [null, undefined, NaN, Infinity]) {
    assert.equal(posicaoDe(v, TEMP), null, "valor " + v);
  }
});

console.log("\ngradiente: rampa contra faixas");

// A DISTINCAO QUE JUSTIFICA O ARQUIVO. Desenhar escala em degraus como
// gradiente suave sugere leitura continua onde ha CLASSIFICACAO.
ok("os dois modos NAO produzem o mesmo CSS", () => {
  const r = gradienteCSS(CHUVA, "rampa");
  const f = gradienteCSS(CHUVA, "faixas");
  assert.notEqual(r, f, "a escala em degraus sairia igual a uma rampa suave");
});

ok("faixas repete cada cor ate a parada seguinte", () => {
  const f = gradienteCSS(CHUVA, "faixas");
  // a primeira cor tem que aparecer DUAS vezes: inicio e fim da propria faixa
  const primeira = (f.match(/#508cc8/g) ?? []).length;
  assert.equal(primeira, 2, "a cor da primeira faixa apareceu " + primeira + " vez(es)");
});

ok("rampa cita cada cor uma vez so", () => {
  const r = gradienteCSS(TEMP, "rampa");
  for (const c of ["#280050", "#c82828"]) {
    assert.equal((r.match(new RegExp(c, "g")) ?? []).length, 1, "cor repetida numa rampa: " + c);
  }
});

ok("comeca em 0% e termina em 100%", () => {
  for (const modo of ["rampa", "faixas"]) {
    const g = gradienteCSS(TEMP, modo);
    assert.match(g, /0\.00%/, modo);
    assert.match(g, /100\.00%/, modo);
  }
});

ok("paradas fora de ordem sao ordenadas, e nao invertem a regua", () => {
  const bagunca = [TEMP[3], TEMP[0], TEMP[5], TEMP[1]];
  const g = gradienteCSS(bagunca, "rampa");
  const pcts = [...g.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
  for (let i = 1; i < pcts.length; i++) {
    assert.ok(pcts[i] >= pcts[i - 1], "porcentagem andou para tras: " + pcts.join(","));
  }
});

ok("escala degenerada nao produz gradiente", () => {
  assert.equal(gradienteCSS([[1, [0, 0, 0]]], "rampa"), null);
});

console.log("\nmarcas do eixo");

ok("as marcas saem das paradas, nao de uma divisao regular", () => {
  const m = marcasDe(TEMP, 0);
  assert.deepEqual(m.map((x) => x.valor), [-30, -15, 0, 15, 30, 45]);
  assert.equal(m[0].pos, 0);
  assert.equal(m[m.length - 1].pos, 1);
});

// Doze paradas viram doze rotulos empilhados em 300 px.
ok("escala longa e reduzida ao limite, guardando as pontas", () => {
  const longa = Array.from({ length: 14 }, (_, i) => [i * 10, [i, i, i]]);
  const m = marcasDe(longa, 0, 5);
  assert.equal(m.length, 5, "saiu " + m.length);
  assert.equal(m[0].valor, 0, "perdeu o minimo");
  assert.equal(m[m.length - 1].valor, 130, "perdeu o maximo");
});

ok("as posicoes ficam em 0..1 e nao andam para tras", () => {
  const m = marcasDe(TEMP, 0);
  let ant = -1;
  for (const x of m) {
    assert.ok(x.pos >= 0 && x.pos <= 1, "pos " + x.pos);
    assert.ok(x.pos >= ant, "marca fora de ordem");
    ant = x.pos;
  }
});

ok("escala degenerada nao produz marca nenhuma", () => {
  assert.deepEqual(marcasDe([[3, [0, 0, 0]]], 0), []);
});

// MEDIDO NA TELA: a escala do WBGT termina em 31, 34 e 35. Os dois ultimos
// caiam a 6% de distancia um do outro, colados na ponta direita da barra.
ok("rotulos colados sao descartados, e as PONTAS sobrevivem", () => {
  const wbgt = [
    [18, [ 60, 160, 100]], [22, [120, 200,  90]], [25, [230, 220,  70]],
    [31, [240, 130,  60]], [34, [220,  60,  60]], [35, [180,  30,  70]],
  ];
  const m = marcasDe(wbgt, 0);
  assert.equal(m[0].valor, 18, "perdeu o minimo");
  assert.equal(m[m.length - 1].valor, 35, "perdeu o maximo");
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i].pos - m[i - 1].pos >= 0.089,
      `rotulos a ${((m[i].pos - m[i - 1].pos) * 100).toFixed(1)}% um do outro: ${m.map((x) => x.valor)}`);
  }
});

ok("escala bem espacada nao perde marca nenhuma", () => {
  const m = marcasDe(TEMP, 0);
  assert.equal(m.length, 6, "cortou marca que cabia: " + m.map((x) => x.valor));
});

console.log("\nformatacao e piso");

// Uma string de espaco reservado vinda daqui viraria numero falso no primeiro
// lugar que a concatenasse.
ok("ausencia devolve null, e nao um traco", () => {
  assert.equal(formatar(null, "°C"), null);
  assert.equal(formatar(NaN, "°C"), null);
  assert.equal(formatar(undefined, "°C"), null);
});

ok("o valor sai com unidade e casas pedidas", () => {
  assert.equal(formatar(21.456, "°C", 1), "21.5 °C");
  assert.equal(formatar(1013, "hPa", 0), "1013 hPa");
  assert.equal(formatar(0.5, "", 1), "0.5", "unidade vazia nao deixa espaco solto");
});

// Marcar 0,05 mm na ponta esquerda da escala de chuva sugeriria a menor classe
// de chuva onde nao ha chuva nenhuma.
ok("abaixo do piso e detectado, e ausencia de piso nao inventa piso", () => {
  assert.equal(abaixoDoPiso(0.05, 0.2), true);
  assert.equal(abaixoDoPiso(0.5, 0.2), false);
  assert.equal(abaixoDoPiso(0.05, null), false);
  assert.equal(abaixoDoPiso(null, 0.2), false);
  assert.equal(abaixoDoPiso(0.2, 0.2), false, "exatamente no piso ja e a primeira classe");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
