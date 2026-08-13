import assert from "node:assert/strict";
import { fecharResposta } from "../src/llm/resposta.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\nfechamento da resposta do modelo");

// A bolha vazia era o sintoma mais confuso do terminal: a pergunta aparecia, o
// modelo respondia nada, e ficava na tela um retangulo escuro sem uma palavra.
ok("NUNCA sobra bolha vazia", () => {
  for (const [acc, abort] of [["", false], ["", true], ["   ", false], ["\n\n", true]]) {
    const f = fecharResposta(acc, abort);
    assert.ok(f.texto.trim().length > 0, `vazio para (${JSON.stringify(acc)}, ${abort})`);
    assert.equal(f.aviso, true, "deveria estar marcado como aviso nosso");
  }
});

ok("resposta normal passa intacta", () => {
  const f = fecharResposta("O vento sopra de nordeste a 8 m/s.", false);
  assert.equal(f.texto, "O vento sopra de nordeste a 8 m/s.");
  assert.equal(f.aviso, false, "texto do modelo nao pode virar aviso");
});

ok("espaco e quebra de linha do modelo sao preservados", () => {
  const bruto = "  linha um\n\n  linha dois  ";
  assert.equal(fecharResposta(bruto, false).texto, bruto);
});

// Uma frase cortada no meio lida como conclusao do modelo e desinformacao.
ok("interrompido com texto marca o corte, sem apagar o que veio", () => {
  const f = fecharResposta("A temperatura sobe ate", true);
  assert.ok(f.texto.startsWith("A temperatura sobe ate"), "perdeu o texto");
  assert.ok(/interrompido/i.test(f.texto), "nao avisou que foi cortado");
  assert.equal(f.aviso, false, "o texto do modelo continua sendo dele");
});

ok("interrompido antes do primeiro token diz isso", () => {
  const f = fecharResposta("", true);
  assert.ok(/interrompido/i.test(f.texto));
  assert.equal(f.aviso, true);
});

ok("terminou sem escrever nada sugere o que fazer", () => {
  const f = fecharResposta("", false);
  assert.ok(!/interrompido/i.test(f.texto), "isto nao foi interrupcao");
  assert.ok(f.texto.length > 40, "aviso curto demais para ajudar");
});

// A primeira versao afirmava "contexto grande demais, tente um modelo maior".
// As duas metades estavam erradas: o usuario ja estava no maior modelo, e o
// dossie medido dava ~1.100 tokens numa janela de 4.096. Palpite vestido de
// diagnostico manda a pessoa perseguir a causa errada.
ok("o aviso NAO chuta causa nem manda trocar de modelo", () => {
  const f = fecharResposta("", false);
  assert.ok(!/modelo maior|contexto grande/i.test(f.texto), "voltou a chutar: " + f.texto);
});

ok("o aviso REPETE o que se mediu, quando ha medida", () => {
  const f = fecharResposta("", false, { tokensEnviados: 1081, motivo: "stop" });
  assert.ok(f.texto.includes("1081"), "nao disse quantos tokens foram");
  assert.ok(f.texto.includes("stop"), "nao disse o motivo relatado");
});

// A causa real, descoberta so depois de varias rodadas: "Device was lost".
// Do nosso lado ela chega como silencio, nao como erro — entao o aviso tem de
// apontar onde a mensagem existe e qual botao resolve.
ok("o aviso aponta o console e o botao de trocar modelo", () => {
  const f = fecharResposta("", false);
  assert.ok(/Device was lost/i.test(f.texto), "nao citou a mensagem do console");
  assert.ok(/trocar modelo/i.test(f.texto), "nao disse o que fazer");
});

ok("sem medida, nao inventa numero", () => {
  const f = fecharResposta("", false);
  assert.ok(!/~\d+ tokens/.test(f.texto), "inventou contagem: " + f.texto);
  assert.ok(!/Motivo relatado/.test(f.texto), "inventou motivo");
});

ok("os dois finais vazios nao dizem a mesma coisa", () => {
  assert.notEqual(fecharResposta("", true).texto, fecharResposta("", false).texto);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
