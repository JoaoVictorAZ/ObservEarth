// test/captura.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/captura.mjs
//
// O defeito que este arquivo existe para impedir: o botão de captura salvava um
// PNG VAZIO, e salvava em silêncio. O download acontecia, o arquivo existia,
// tinha assinatura de PNG válida — e não tinha imagem. Só quem abrisse
// descobriria, possivelmente dias depois.
//
// Um canvas em branco produz um PNG legítimo e minúsculo: assinatura, cabeçalho
// e uma área transparente comprimem para algumas centenas de bytes. Nenhuma
// verificação de "isto é um PNG?" pega isso. A única coisa que separa uma
// captura real de uma vazia é o TAMANHO, e é por isso que `pareceVazio` mede
// bytes em vez de validar formato.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { pareceVazio, nomeDoArquivo } from "../src/captura.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nreconhecer a imagem vazia");

// Um PNG 1x1 transparente REAL, em base64. E' exatamente a forma do arquivo que
// o defeito antigo produzia: valido, abrivel, e sem nada dentro.
const PNG_VAZIO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

ok("um PNG 1x1 transparente é reconhecido como vazio", () => {
  assert.equal(pareceVazio(PNG_VAZIO), true);
});

ok("null é vazio", () => {
  assert.equal(pareceVazio(null), true);
});

ok("string sem vírgula não passa por data URL", () => {
  assert.equal(pareceVazio("nao-e-um-data-url"), true);
});

ok("data URL com corpo vazio é vazio", () => {
  assert.equal(pareceVazio("data:image/png;base64,"), true);
});

console.log("\nreconhecer a imagem de verdade");

// Nao precisa ser uma imagem valida para este teste: o que se afirma e' que o
// LIMIAR separa um payload de tamanho realista de um payload de canvas em
// branco. Uma vista do planeta comprime para dezenas de kB.
const grande = "data:image/png;base64," + "A".repeat(80_000);

ok("um payload do tamanho de uma vista real passa", () => {
  assert.equal(pareceVazio(grande), false);
});

ok("o limiar é ajustável, e o padrão fica entre os dois casos", () => {
  assert.equal(pareceVazio(grande, 1_000_000), true, "limiar alto recusa");
  assert.equal(pareceVazio(PNG_VAZIO, 10), false, "limiar baixo aceita");
});

// O calculo de bytes desconta o preenchimento do base64. Sem isso o tamanho sai
// ~33% maior, e um arquivo vazio poderia cruzar o limiar por arredondamento.
ok("o tamanho desconta o preenchimento `=` do base64", () => {
  const semPad = "data:image/png;base64," + "A".repeat(4000);
  const comPad = "data:image/png;base64," + "A".repeat(3998) + "==";
  assert.equal(pareceVazio(semPad, 2999), false);
  assert.equal(pareceVazio(comPad, 2999), false);
  // 4000 caracteres = 3000 bytes; com dois `=` sao 2998, abaixo do limiar.
  assert.equal(pareceVazio(comPad, 3000), true);
});

console.log("\no nome do arquivo");

ok("ordena por data e não tem caractere proibido no Windows", () => {
  const nome = nomeDoArquivo(new Date(2026, 8, 16, 7, 5));
  assert.equal(nome, "observearth-20260916-0705.png");
  // `:` e' o que o nome antigo deixava escapar do ISO, e Windows recusa.
  assert.ok(!/[:*?"<>|\\/]/.test(nome), nome);
});

ok("usa a hora LOCAL, que é a que a pessoa reconhece", () => {
  const d = new Date(2026, 0, 2, 3, 4);
  assert.ok(nomeDoArquivo(d).startsWith("observearth-20260102-0304"));
});

console.log(`\n  ${n} verificacoes\n`);
