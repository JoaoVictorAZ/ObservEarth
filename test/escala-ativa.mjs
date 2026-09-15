// test/escala-ativa.mjs
// -----------------------------------------------------------------------------
// QUAL CAMADA MANDA NA REGUA
// -----------------------------------------------------------------------------
// A RECLAMACAO: "a regua nao aparece para todos os efeitos". Ela conhecia duas
// camadas -- campo pintado e vento -- e o app tem mais. Correntes oceanicas e
// malha 3D pintavam o planeta sem nenhuma escala na tela.
//
// O teste que importa aqui nao e' o de precedencia: e' o de que a CHAVE e a
// ESCALA saem da mesma chamada. A regua desenha a escala; o amostrador do
// cursor le a grade indicada pela chave. Se as duas decisoes vierem de lugares
// diferentes, o sintoma e' a regua dizer "Corrente oceanica" com o numero do
// vento embaixo -- plausivel, e errado. Um valor errado que parece certo e' pior
// que um erro em vermelho.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { escalaAtiva, casasDe } from "../src/legenda/ativa.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const RAMPA = [[0, [0, 0, 0]], [10, [255, 255, 255]]];

const base = {
  modo: "globo",
  malha: null,
  campo: null,
  correntes: false,
  vento: false,
  stopsVento: [[0, [1, 2, 3]], [26, [4, 5, 6]]],
  stopsCorrente: [[0, [7, 8, 9]], [2, [10, 11, 12]]],
};

const CAMPO = {
  id: "temp2m", title: "Temperatura do Ar (2m)", unit: "°C",
  stops: RAMPA, render: "rampa", floor: -50, group: "Modelo GFS",
};

const MALHA_PRONTA = {
  ativa: true, titulo: "Pressao ao Nivel do Mar", unidade: "hPa",
  stops: RAMPA, modo: "rampa", temValores: true,
};

console.log("\nquando NAO ha escala");

ok("sem camada de grandeza a regua some inteira", () => {
  assert.equal(escalaAtiva(base), null);
});

// Sismo, foco de calor, hospital e aviso nao entram: sao ocorrencias. Uma rampa
// de magnitude sob um mapa de pontos sugeriria que a COR DO PLANETA significa
// magnitude. Aqui isso se traduz em: nada disso aparece na entrada, entao nada
// disso pode produzir escala.
ok("camada de imagem de satelite nao produz escala", () => {
  // kind "sat" nunca vira `campo` -- o chamador so passa campo para kind
  // "field". Sem campo e sem vetor, nao ha eixo.
  assert.equal(escalaAtiva({ ...base, campo: null }), null);
});

console.log("\nprecedencia");

ok("so o vento ligado: a regua e' do vento", () => {
  const e = escalaAtiva({ ...base, vento: true, ventoNoCliente: true });
  assert.equal(e.chave, "vento");
  assert.equal(e.unidade, "m/s");
  assert.equal(e.amostravel, true);
});

// ESTE E' O DEFEITO RELATADO. Antes disto, ligar correntes deixava o planeta
// coberto de linhas em movimento e a regua muda -- ou, pior, mostrando a escala
// do vento, que vai a 26 m/s.
ok("correntes ligadas produzem escala PROPRIA, e nao a do vento", () => {
  const e = escalaAtiva({ ...base, correntes: true, correntesNoCliente: true });
  assert.equal(e.chave, "corrente");
  assert.match(e.titulo, /[Cc]orrente/);
  assert.deepEqual(e.stops, base.stopsCorrente, "usou as paradas do vento");
});

ok("corrente tem precedencia sobre o vento", () => {
  const e = escalaAtiva({ ...base, correntes: true, vento: true });
  assert.equal(e.chave, "corrente");
});

ok("o campo pintado tem precedencia sobre os dois campos vetoriais", () => {
  const e = escalaAtiva({ ...base, campo: CAMPO, correntes: true, vento: true });
  assert.equal(e.chave, "campo");
  assert.equal(e.titulo, CAMPO.title);
  assert.equal(e.piso, -50, "perdeu o piso do campo");
  assert.equal(e.fonteId, "campo:temp2m");
});

ok("a malha 3D tem precedencia sobre tudo", () => {
  const e = escalaAtiva({
    ...base, malha: MALHA_PRONTA, campo: CAMPO, correntes: true, vento: true,
  });
  assert.equal(e.chave, "malha");
  assert.equal(e.unidade, "hPa");
});

console.log("\nligada nao e' o mesmo que pronta");

// Entre o interruptor e a chegada dos 326 kB do campo ha uma janela de segundos
// em que a malha esta ativa e VAZIA. Desenhar a escala dela ali prometeria uma
// leitura que ainda nao existe.
ok("malha ligada mas sem valores nao rouba a regua", () => {
  const e = escalaAtiva({
    ...base, campo: CAMPO,
    malha: { ...MALHA_PRONTA, temValores: false },
  });
  assert.equal(e.chave, "campo", "a malha vazia tomou a regua do campo pintado");
});

ok("malha sem paradas nao rouba a regua", () => {
  const e = escalaAtiva({ ...base, vento: true, malha: { ...MALHA_PRONTA, stops: null } });
  assert.equal(e.chave, "vento");
});

// A malha 3D nao existe no mapa plano. Sem isto, trocar para o mapa deixaria a
// regua presa numa camada que nao esta desenhada em lugar nenhum.
ok("no mapa plano a malha nao conta", () => {
  const e = escalaAtiva({ ...base, modo: "mapa", malha: MALHA_PRONTA, vento: true });
  assert.equal(e.chave, "vento");
});

console.log("\nleitura continua: quem tem numero no cliente");

// A distincao que a regua usa para escolher entre "sem medida neste ponto" e
// "esta camada nao tem leitura continua".
ok("o campo pintado NAO e' amostravel, e os vetoriais sao", () => {
  assert.equal(escalaAtiva({ ...base, campo: CAMPO }).amostravel, false,
    "textura de imagem virou leitura continua: seria numero reconstruido de 8 bits");
  assert.equal(escalaAtiva({ ...base, vento: true, ventoNoCliente: true }).amostravel, true);
  assert.equal(escalaAtiva({ ...base, correntes: true, correntesNoCliente: true }).amostravel, true);
});

ok("a malha 3D e' amostravel: o campo que virou relevo responde o valor", () => {
  assert.equal(escalaAtiva({ ...base, malha: MALHA_PRONTA }).amostravel, true);
});

ok("grade que ainda nao chegou nao se declara amostravel", () => {
  assert.equal(escalaAtiva({ ...base, vento: true, ventoNoCliente: false }).amostravel, false);
  assert.equal(escalaAtiva({ ...base, correntes: true, correntesNoCliente: false }).amostravel, false);
});

console.log("\ncasas decimais");

// Pressao em decimos de hPa e' ruido: a diferenca entre 1013,4 e 1013,5 nao
// significa nada num campo de modelo, e um digito que oscila sozinho treina o
// olho a ignorar o numero inteiro.
ok("hPa e % saem inteiros; o resto vai a uma casa", () => {
  assert.equal(casasDe("hPa"), 0);
  assert.equal(casasDe("%"), 0);
  assert.equal(casasDe("°C"), 1);
  assert.equal(casasDe("m/s"), 1);
});

// A corrente quase toda cabe abaixo de 0,5 m/s. Com uma casa, metade do oceano
// leria "0,0 m/s" e "0,1 m/s" e a camada pareceria ter dois valores.
ok("a corrente tem DUAS casas, porque 0,05 m/s importa nela", () => {
  const e = escalaAtiva({ ...base, correntes: true });
  assert.equal(e.casas, 2, "com uma casa metade do oceano lê 0,0");
});

console.log("\na chave e a escala saem juntas");

// O PONTO DO ARQUIVO. Se a chave e a escala pudessem discordar, a regua diria
// uma coisa e o ponteiro leria outra.
ok("toda escala devolvida traz chave, titulo, unidade e paradas", () => {
  const casos = [
    { ...base, vento: true },
    { ...base, correntes: true },
    { ...base, campo: CAMPO },
    { ...base, malha: MALHA_PRONTA },
  ];
  for (const c of casos) {
    const e = escalaAtiva(c);
    assert.ok(e, "caso sem escala");
    assert.ok(["malha", "campo", "corrente", "vento"].includes(e.chave), "chave " + e.chave);
    assert.ok(e.titulo && e.titulo.length > 0, "sem titulo: " + e.chave);
    assert.equal(typeof e.unidade, "string", "sem unidade: " + e.chave);
    assert.ok(Array.isArray(e.stops) && e.stops.length >= 2, "sem paradas: " + e.chave);
    assert.ok(e.modo === "rampa" || e.modo === "faixas", "modo " + e.modo);
  }
});

// A regua e o amostrador leem a MESMA funcao. Este teste guarda o contrato
// lendo o texto do viewport: se alguem voltar a decidir a grade la dentro com
// um `if` proprio, as duas respostas voltam a poder divergir.
ok("o viewport decide a grade pela mesma funcao, e nao por conta propria", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/globe/GlobeViewport.tsx", "utf8");
  assert.match(src, /escalaAtiva\(/,
    "o viewport parou de usar escalaAtiva: a regua e o ponteiro podem divergir");
  assert.match(src, /correnteRef/,
    "a grade das correntes deixou de ser retida: a regua fica sem numero");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
