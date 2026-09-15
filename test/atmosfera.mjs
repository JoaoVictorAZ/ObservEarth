// test/atmosfera.mjs
// -----------------------------------------------------------------------------
// O DEFEITO QUE ESTE ARQUIVO PASSOU A GUARDAR
// -----------------------------------------------------------------------------
// A versao anterior deste shader usava Fresnel sobre a normal da casca. A
// intuicao estava certa e o resultado nao: `1 - dot(N, V)` vale 1 na SILHUETA
// DA CASCA, ou seja o brilho era maximo exatamente onde a geometria acaba. Na
// tela isso vira um ANEL com borda externa dura -- o aro de uma tigela, nao o
// ar em volta de um planeta.
//
// Nenhum teste pegou isso, porque todos verificavam que a curva CRESCIA para a
// borda. Ela crescia. O problema era o que acontecia DEPOIS da borda: nada,
// porque nao havia depois.
//
// Agora o brilho e' funcao do parametro de impacto e o teste central e outro:
// ele TEM que chegar a zero na borda da casca.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  perfilLimbo, posicaoNoLimbo, aceso, rasancia, ALTURA, QUEDA,
} from "../src/globo/atmosfera.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\nperfil do limbo");

// ESTE E O TESTE QUE FALTAVA. Sem o zero na ponta, a geometria corta o brilho a
// pique e o anel ganha borda dura.
ok("o brilho chega a ZERO na borda da casca", () => {
  assert.equal(perfilLimbo(1), 0, "a casca acaba com brilho sobrando: volta a borda dura");
  assert.ok(perfilLimbo(0.999) < 0.001, "chegou em " + perfilLimbo(0.999));
});

ok("o maximo e no limbo do planeta, nao na borda da casca", () => {
  assert.equal(perfilLimbo(0), 1);
  for (const t of [0.1, 0.3, 0.6, 0.9]) {
    assert.ok(perfilLimbo(t) < perfilLimbo(0), "t=" + t + " passou do limbo");
  }
});

ok("cai sem voltar atras", () => {
  let ant = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const v = perfilLimbo(t);
    assert.ok(v <= ant + 1e-12, "subiu em t=" + t.toFixed(2));
    ant = v;
  }
});

// Um decaimento lento pinta a casca inteira com intensidade quase uniforme e o
// anel volta a parecer aro; um rapido demais desenha um fio de meio pixel.
ok("o decaimento gasta a maior parte do brilho na primeira metade", () => {
  assert.ok(perfilLimbo(0.5) < 0.15, "meio caminho ainda tem " + perfilLimbo(0.5).toFixed(3));
  assert.ok(perfilLimbo(0.15) > 0.35, "some rapido demais: " + perfilLimbo(0.15).toFixed(3));
  assert.ok(QUEDA > 2 && QUEDA < 12, "queda " + QUEDA);
});

ok("nunca sai de 0..1, nem com entrada absurda", () => {
  for (const t of [-9, -1, 0, 0.5, 1, 7]) {
    const v = perfilLimbo(t);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `t=${t} deu ${v}`);
  }
});

console.log("\nparametro de impacto");

ok("a visada que raspa a superficie e o limbo", () => {
  assert.equal(posicaoNoLimbo(100, 100, 108), 0);
  assert.equal(posicaoNoLimbo(108, 100, 108), 1);
  assert.ok(Math.abs(posicaoNoLimbo(104, 100, 108) - 0.5) < 1e-12);
});

ok("visada que atravessa o planeta gruda no limbo, e nao vira negativa", () => {
  assert.equal(posicaoNoLimbo(0, 100, 108), 0);
  assert.equal(posicaoNoLimbo(-5, 100, 108), 0);
});

ok("casca degenerada nao divide por zero", () => {
  const v = posicaoNoLimbo(100, 100, 100);
  assert.ok(Number.isFinite(v), "deu " + v);
});

console.log("\nonde a atmosfera esta acesa");

ok("apaga do lado noturno e acende do lado do Sol", () => {
  assert.equal(aceso(-1), 0, "anel azul contornando o hemisferio escuro e enfeite");
  assert.equal(aceso(1), 1);
});

// A alta atmosfera continua iluminada depois que o solo escureceu -- e a linha
// azul fina sobre o hemisferio escuro nas fotos da estacao espacial.
ok("o brilho vaza um pouco para ALEM do terminador", () => {
  const v = aceso(-0.15);
  assert.ok(v > 0.02 && v < 0.5, "logo depois do terminador deu " + v.toFixed(3));
});

console.log("\no vermelho do crepusculo");

ok("e maximo em cima do terminador e nao vaza para os dois lados", () => {
  assert.ok(rasancia(0) > rasancia(0.6), "o vermelho vazou para o meio-dia");
  assert.ok(rasancia(0) > rasancia(-0.6), "o vermelho vazou para a meia-noite");
  assert.ok(rasancia(-1) < 1e-9, "meia-noite com crepusculo");
  assert.ok(rasancia(1) < 1e-9, "meio-dia alaranjado");
});

console.log("\ngeometria da casca");

// A ALTURA DEIXOU DE MANDAR NA ESPESSURA APARENTE. Com o brilho zerando antes
// da borda, ela e' so o limite da geometria: quem decide a grossura do anel e'
// a QUEDA. Por isso este teste afrouxou, e nao aperta mais um numero que nao
// governa mais nada.
ok("a casca cabe ao redor do planeta sem virar um segundo planeta", () => {
  assert.ok(ALTURA > 0.02 && ALTURA < 0.25, "altura " + ALTURA);
});

console.log("\no GLSL e a copia em JavaScript falam do mesmo numero");

const glsl = readFileSync(fileURLToPath(new URL("../src/globo/atmosfera.ts", import.meta.url)), "utf8");

// A V2 usava a NORMAL. Se ela voltar, o anel volta a ter borda dura.
ok("o brilho vem do parametro de impacto, e NAO da normal", () => {
  assert.match(glsl, /float b = length\(cross\(vPosW, V\)\)/,
    "o shader deixou de calcular o parametro de impacto");
  assert.ok(!/pow\(1\.0 - clamp\(dot\(N, V\)/.test(glsl),
    "o Fresnel sobre a normal voltou: o anel vai ganhar borda dura de novo");
});

ok("o fator que forca o zero na borda continua no shader", () => {
  assert.match(glsl, /exp\(-t \* uQueda\) \* \(1\.0 - t\)/,
    "sem o (1 - t) a exponencial ainda vale algo na borda da casca");
});

// Sem ciclo dia/noite nao existe terminador, e pintar de laranja o pe de um
// planeta uniformemente iluminado e enfeite. Apareceu na tela.
ok("o crepusculo depende de haver ciclo dia/noite", () => {
  assert.match(glsl, /rasante = [^;]*\* uCiclo;/,
    "o alaranjado sobrevive ao ciclo desligado");
});

// Gravar profundidade faria o halo recortar tudo que vier depois: particulas de
// vento, marcadores, a malha.
ok("o halo nao escreve profundidade e e aditivo por tras do planeta", () => {
  assert.match(glsl, /depthWrite:\s*false/);
  assert.match(glsl, /blending:\s*THREE\.AdditiveBlending/);
  assert.match(glsl, /side:\s*THREE\.BackSide/, "sem BackSide a casca tapa o planeta");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
