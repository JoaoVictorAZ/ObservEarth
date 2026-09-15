// test/estado-fontes.mjs
// -----------------------------------------------------------------------------
// O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
// -----------------------------------------------------------------------------
// Um mapa de vento de seis horas atras, desenhado como se fosse agora, nao
// parece defeito nenhum: parece um mapa de vento. E o unico jeito de garantir
// que a tela avisa e' testar a REGRA que decide quando avisar.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  criarFonte, marcarBuscando, marcarSucesso, marcarFalha,
  idade, vencido, situacaoEfetiva, deveTentar, idadeEmTexto, frase, resumir,
  explicarFalha, ESPERA_INICIAL_MS, ESPERA_MAXIMA_MS,
} from "../src/dados/estado.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const nova = (validade = 30 * MIN) => criarFonte("vento", "Vento à superfície", validade);

console.log("\nciclo de vida");

ok("nasce ociosa, sem dado e sem motivo", () => {
  const f = nova();
  assert.equal(f.situacao, "ocioso");
  assert.equal(f.atualizadoEm, null);
  assert.equal(f.motivo, null);
  assert.equal(f.falhas, 0);
});

ok("sucesso zera falhas e limpa o motivo", () => {
  let f = nova();
  f = marcarFalha(f, { status: 500 }, T0);
  f = marcarSucesso(f, T0 + MIN);
  assert.equal(f.situacao, "pronto");
  assert.equal(f.falhas, 0);
  assert.equal(f.motivo, null);
  assert.equal(f.proximaTentativa, null);
});

console.log("\na distincao que justifica o arquivo");

// SEM dado anterior, nao se desenha nada -- meio mapa e pior que nenhum mapa.
ok("falha SEM dado anterior e INDISPONIVEL", () => {
  const f = marcarFalha(nova(), { status: 503 }, T0);
  assert.equal(f.situacao, "indisponivel");
  assert.match(f.motivo, /fora do ar/i);
});

// COM dado anterior, a camada continua desenhada E a tela diz que e velha.
ok("falha COM dado anterior e DEGRADADO, nao indisponivel", () => {
  let f = marcarSucesso(nova(), T0);
  f = marcarFalha(f, { status: 503 }, T0 + MIN);
  assert.equal(f.situacao, "degradado", "apagou uma camada que ainda tinha dado");
  assert.equal(f.atualizadoEm, T0, "perdeu o instante do dado que ainda esta na tela");
});

// Trocar o mapa por um spinner a cada atualizacao faria a camada piscar de
// minuto em minuto.
ok("buscar com dado na tela NAO volta para 'carregando'", () => {
  let f = marcarSucesso(nova(), T0);
  f = marcarBuscando(f);
  assert.equal(f.situacao, "pronto");
});

ok("buscar sem dado nenhum vira 'carregando'", () => {
  assert.equal(marcarBuscando(nova()).situacao, "carregando");
});

console.log("\nenvelhecimento");

// O GFS roda de 6 em 6 horas: as 05:59 o campo mais novo tem quase 6 horas.
// Isso e legitimo, e a tela tem que poder dizer.
ok("dado dentro da validade e 'pronto'; passou, e 'degradado'", () => {
  const f = marcarSucesso(nova(30 * MIN), T0);
  assert.equal(situacaoEfetiva(f, T0 + 29 * MIN), "pronto");
  assert.equal(situacaoEfetiva(f, T0 + 31 * MIN), "degradado");
});

ok("vencer NAO e o mesmo que falhar: o motivo continua nulo", () => {
  const f = marcarSucesso(nova(MIN), T0);
  assert.equal(situacaoEfetiva(f, T0 + 10 * MIN), "degradado");
  assert.equal(f.motivo, null, "inventou motivo de falha para dado apenas vencido");
});

ok("idade nunca e negativa, mesmo com relogio andando para tras", () => {
  const f = marcarSucesso(nova(), T0);
  assert.equal(idade(f, T0 - 5 * MIN), 0);
});

ok("sem dado, idade e vencimento sao nulos e falsos, nunca zero", () => {
  const f = nova();
  assert.equal(idade(f, T0), null);
  assert.equal(vencido(f, T0), false);
});

console.log("\nbackoff");

ok("a espera dobra a cada falha", () => {
  let f = nova();
  f = marcarFalha(f, { status: 500 }, T0);
  assert.equal(f.proximaTentativa - T0, ESPERA_INICIAL_MS);
  f = marcarFalha(f, { status: 500 }, T0);
  assert.equal(f.proximaTentativa - T0, ESPERA_INICIAL_MS * 2);
  f = marcarFalha(f, { status: 500 }, T0);
  assert.equal(f.proximaTentativa - T0, ESPERA_INICIAL_MS * 4);
});

// Sem teto, vinte falhas seguidas empurrariam a proxima tentativa para daqui a
// meses e a camada nunca mais voltaria sozinha.
ok("a espera tem TETO", () => {
  let f = nova();
  for (let i = 0; i < 40; i++) f = marcarFalha(f, { status: 500 }, T0);
  assert.equal(f.proximaTentativa - T0, ESPERA_MAXIMA_MS);
});

ok("nao tenta antes da hora, e tenta depois", () => {
  const f = marcarFalha(nova(), { status: 500 }, T0);
  assert.equal(deveTentar(f, T0 + ESPERA_INICIAL_MS - 1), false);
  assert.equal(deveTentar(f, T0 + ESPERA_INICIAL_MS + 1), true);
});

ok("nao dispara uma segunda busca com uma em voo", () => {
  assert.equal(deveTentar(marcarBuscando(nova()), T0), false);
});

ok("fonte ociosa e sempre buscada; fonte fresca nao", () => {
  assert.equal(deveTentar(nova(), T0), true);
  const f = marcarSucesso(nova(30 * MIN), T0);
  assert.equal(deveTentar(f, T0 + 10 * MIN), false);
  assert.equal(deveTentar(f, T0 + 31 * MIN), true, "dado vencido tem que ser rebuscado");
});

console.log("\nmotivos legiveis");

// "HTTP 503" nao diz se vale tentar de novo nem de quem e o problema.
ok("cada faixa de status vira uma frase diferente", () => {
  assert.match(explicarFalha({ status: 404 }), /n[ãa]o tem dado/i);
  assert.match(explicarFalha({ status: 429 }), /limite/i);
  assert.match(explicarFalha({ status: 500 }), /fora do ar/i);
  assert.match(explicarFalha({ status: 403 }), /recusou/i);
  assert.match(explicarFalha({ name: "TypeError" }), /sem conex/i);
  assert.match(explicarFalha({ name: "AbortError" }), /cancelada/i);
});

ok("nunca devolve vazio, nem para erro sem forma nenhuma", () => {
  for (const e of [null, undefined, 42, "oi", {}, new Error("")]) {
    const m = explicarFalha(e);
    assert.ok(typeof m === "string" && m.length > 0, "vazio para " + JSON.stringify(e));
  }
});

console.log("\na frase da tela");

ok("nunca devolve string vazia", () => {
  const casos = [
    nova(),
    marcarBuscando(nova()),
    marcarSucesso(nova(), T0),
    marcarFalha(marcarSucesso(nova(), T0), { status: 500 }, T0),
    marcarFalha(nova(), { status: 500 }, T0),
  ];
  for (const f of casos) {
    const s = frase(f, T0 + MIN);
    assert.ok(s && s.length > 0, "frase vazia para " + f.situacao);
  }
});

// Uma linha de procedencia em branco e indistinguivel de uma que nao carregou.
ok("degradado DIZ a idade do que esta na tela", () => {
  let f = marcarSucesso(nova(MIN), T0);
  f = marcarFalha(f, { status: 500 }, T0 + 90 * MIN);
  const s = frase(f, T0 + 90 * MIN);
  assert.match(s, /h[áa] 1 h/, s);
  assert.match(s, /fora do ar/i, s);
});

ok("a idade sai em linguagem, nao em timestamp", () => {
  const f = marcarSucesso(nova(), T0);
  assert.equal(idadeEmTexto(f, T0 + 10_000), "agora há pouco");
  assert.equal(idadeEmTexto(f, T0 + 5 * MIN), "há 5 min");
  assert.equal(idadeEmTexto(f, T0 + 3 * 60 * MIN), "há 3 h");
  assert.equal(idadeEmTexto(f, T0 + 5 * 24 * 60 * MIN), "há 5 dias");
});

console.log("\nresumo global");

// Contar camada desligada como falha encheria o painel de alerta sobre coisas
// que ninguem pediu -- o jeito mais rapido de treinar alguem a ignorar alertas.
ok("camada OCIOSA nao entra na conta nem vira aviso", () => {
  const r = resumir([nova(), marcarSucesso(nova(), T0)], T0);
  assert.equal(r.total, 1);
  assert.equal(r.prontas, 1);
  assert.equal(r.avisos.length, 0);
});

ok("indisponivel vem ANTES de degradado na lista", () => {
  const a = { ...marcarFalha(marcarSucesso(criarFonte("a", "Alfa", MIN), T0), { status: 500 }, T0), id: "a" };
  const b = marcarFalha(criarFonte("b", "Beta", MIN), { status: 500 }, T0);
  const r = resumir([a, b], T0);
  assert.equal(r.avisos[0].id, "b", "abriu pela noticia menos ruim");
  assert.equal(r.avisos[0].situacao, "indisponivel");
  assert.equal(r.degradadas, 1);
  assert.equal(r.indisponiveis, 1);
});

ok("dado vencido entra no resumo como degradado, sem ter falhado", () => {
  const f = marcarSucesso(criarFonte("c", "Gama", MIN), T0);
  const r = resumir([f], T0 + 10 * MIN);
  assert.equal(r.degradadas, 1);
  assert.equal(r.prontas, 0);
  assert.equal(r.avisos.length, 1);
});

ok("lista vazia devolve zeros, nao NaN", () => {
  const r = resumir([], T0);
  assert.equal(r.total, 0);
  assert.equal(r.avisos.length, 0);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
