// test/orcamento.mjs
// -----------------------------------------------------------------------------
//   node test/orcamento.mjs
//
// A REGRA DO QUARTO, COMO TESTE E NÃO COMO PROMESSA.
//
// O projeto se permite usar no máximo **um quarto** do limite gratuito de
// qualquer provedor. A razão é simples: estes serviços são públicos e
// gratuitos, e um cliente que encosta no teto tira a folga de todo mundo que
// depende do mesmo endereço.
//
// Uma regra dessas, escrita só num documento, sobrevive até a primeira pressa.
// Escrita aqui, ela recusa: quem subir `share` para 0,5 numa madrugada vê o
// teste vermelho antes do commit.
//
// O que este arquivo NÃO faz: conferir se os números de `free` estão certos.
// Esses vêm da documentação de cada provedor, ou são tetos conservadores que
// nós mesmos escolhemos onde não há teto publicado — e cada um traz a origem
// escrita ao lado. Verificar isso exigiria rede, e um teste que depende de rede
// falha por motivo errado.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { PROVIDERS, capOf } from "../server/budget.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

const TETO = 0.25;

console.log("\na regra do quarto");

ok("há provedores registrados", () => {
  assert.ok(Object.keys(PROVIDERS).length >= 5);
});

for (const [id, p] of Object.entries(PROVIDERS)) {
  ok(`${id} não passa de ${TETO * 100}% do limite gratuito`, () => {
    assert.equal(typeof p.share, "number", `${id} não declara share`);
    assert.ok(p.share > 0, `${id} tem share não positivo`);
    assert.ok(
      p.share <= TETO + 1e-9,
      `${id} usa ${Math.round(p.share * 100)}% do limite gratuito; o teto do projeto é ${TETO * 100}%`,
    );
  });
}

console.log("\ncada provedor se explica");

for (const [id, p] of Object.entries(PROVIDERS)) {
  ok(`${id} declara rótulo, limite e a origem do número`, () => {
    assert.ok(p.label && typeof p.label === "string", `${id} sem label`);
    assert.ok(Number.isFinite(p.free) && p.free > 0, `${id} sem limite diário`);
    // A `note` e' onde mora a diferenca entre "a documentacao diz" e "nos
    // escolhemos um teto conservador". Sem ela, um numero inventado fica
    // indistinguivel de um numero apurado.
    assert.ok(p.note && p.note.length > 20, `${id} sem nota de origem`);
  });
}

console.log("\no teto efetivo é o declarado");

ok("capOf devolve free x share na janela do dia", () => {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const esperado = Math.floor(p.free * p.share);
    const obtido = capOf(id, "day");
    assert.ok(
      Math.abs(obtido - esperado) <= 1,
      `${id}: capOf deu ${obtido}, esperado ~${esperado}`,
    );
  }
});

ok("provedor desconhecido não tem teto — e por isso não pode existir em silêncio", () => {
  // `capOf` devolve Infinity para quem nao esta no registro. Isso e' deliberado
  // (uma rota nova nao deve quebrar por falta de cadastro), e e' justamente por
  // isso que o registro precisa ser conferido: uma fonte externa que nunca foi
  // cadastrada consome sem limite e sem ninguem ver.
  assert.equal(capOf("provedor-que-nao-existe", "day"), Infinity);
});

ok("as janelas curtas, quando existem, são menores que a do dia", () => {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.freeHour) {
      assert.ok(capOf(id, "hour") <= capOf(id, "day"),
                `${id}: o teto por hora não pode passar o do dia`);
    }
    if (p.freeMinute && p.freeHour) {
      assert.ok(capOf(id, "minute") <= capOf(id, "hour"),
                `${id}: o teto por minuto não pode passar o da hora`);
    }
  }
});

console.log(`\n  ${n} verificacoes\n`);
