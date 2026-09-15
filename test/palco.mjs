// test/palco.mjs
// -----------------------------------------------------------------------------
// QUEM MANDA NO DOM DE CADA CAIXA DO PALCO
// -----------------------------------------------------------------------------
// O DEFEITO: o cartao ancorado era filho da MESMA caixa que o motor monta. O
// cleanup do motor chama `replaceChildren()` — para nao empilhar telas mortas
// ao trocar de globo para mapa plano — e `replaceChildren` nao distingue a tela
// do WebGL do <div> que o React desenhou ali. Apagava os dois. Quando o React
// ia remover o proprio no, o no ja nao era filho de ninguem:
//
//   NotFoundError: Failed to execute 'removeChild' on 'Node'
//
// e a arvore inteira caia. Em desenvolvimento aparecia a cada recarga a quente;
// no uso real, alternar globo <-> mapa com a sonda aberta derrubava o app.
//
// Sao dois invariantes, e os dois falham CALADOS se alguem os quebrar:
//
//   1. a caixa do motor nao tem filho do React      -> derruba o app
//   2. a caixa do motor cobre o palco inteiro       -> cartao no lugar errado
//
// O segundo merece explicacao. `projetar` devolve pixels relativos a tela do
// motor; o cartao se posiciona dentro de `.stage`. Se as duas caixas deixarem
// de coincidir, nada quebra e nada avisa — o cartao so passa a apontar alguns
// pixels ao lado do lugar de que ele fala.
//
// Sim, isto le TEXTO de fonte em vez de executar. E' de proposito: o defeito
// mora no acoplamento entre um arquivo TSX e um arquivo CSS, e montar React
// com WebGL sob jsdom custaria muito mais do que a propriedade vale.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = readFileSync(join(raiz, "src/components/globe/GlobeViewport.tsx"), "utf8");
const css = readFileSync(join(raiz, "src/index.css"), "utf8");

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** o texto da tag JSX que contem `marca`, do "<" ate o ">" que a fecha */
function tagQueContem(fonte, marca) {
  const i = fonte.indexOf(marca);
  if (i < 0) return null;
  const abre = fonte.lastIndexOf("<", i);
  const fecha = fonte.indexOf(">", i);
  if (abre < 0 || fecha < 0) return null;
  return fonte.slice(abre, fecha + 1);
}

console.log("\ndonos do DOM no palco");

ok("existe uma caixa so do motor, separada do palco", () => {
  assert.match(tsx, /className="stage-tela"/,
    "a caixa do motor sumiu: o motor voltou a dividir o palco com o React");
});

// ESTE E O TESTE DO DEFEITO. Um filho JSX aqui e' um no que o React vai querer
// remover depois de `replaceChildren()` ja ter apagado.
ok("a caixa do motor NAO tem filho do React", () => {
  const tag = tagQueContem(tsx, "ref={boxRef}");
  assert.ok(tag, "nao achei o elemento que recebe boxRef");
  assert.ok(
    tag.trimEnd().endsWith("/>"),
    "o elemento que o motor monta tem filhos JSX. O cleanup chama " +
    "replaceChildren() nele, e o React cai ao remover um no ja apagado. " +
    "Tag: " + tag
  );
});

ok("o motor monta na caixa do boxRef, e e' ela que o cleanup limpa", () => {
  assert.match(tsx, /const caixa = boxRef\.current/, "o motor mudou de caixa");
  assert.match(tsx, /caixa\.replaceChildren\(\)/,
    "sem a limpeza, trocar de motor empilha telas mortas por baixo da viva");
});

// O cartao PRECISA morar aqui dentro. Movido para o AppShell, ele passaria a
// se posicionar contra outro elemento e sairia deslocado pela altura da barra
// superior — de novo sem erro nenhum, so no lugar errado.
//
// (Que ele e' IRMAO da tela, e nao filho dela, quem prova e' o teste acima:
// se a tag do motor fecha em `/>`, nada pode estar dentro dela.)
ok("o cartao ancorado mora no palco", () => {
  assert.ok(tsx.includes("<Ancora"),
    "o cartao saiu do palco: fora de .stage ele se posiciona contra outro " +
    "elemento e aparece deslocado pela altura da barra superior");
  assert.ok(tsx.indexOf("<Ancora") > tsx.indexOf('className="stage"'),
    "o cartao esta antes da abertura do palco");
});

console.log("\ngeometria: as duas caixas tem que coincidir");

// Se `.stage-tela` deixar de cobrir `.stage`, o cartao nao quebra: ele so
// aponta para o lugar errado, calado.
ok("as duas caixas cobrem exatamente a mesma area", () => {
  for (const classe of ["stage", "stage-tela"]) {
    const re = new RegExp("\\.[\\w-]*\\b" + classe + "\\b\\s*\\{([^}]*)\\}");
    const m = css.match(re);
    assert.ok(m, "regra .{0} nao encontrada".replace("{0}", classe));
    const corpo = m[1];
    assert.match(corpo, /position:\s*absolute/, classe + " sem position: absolute");
    assert.match(corpo, /inset:\s*0/,
      classe + " sem inset: 0 — as caixas deixam de coincidir e o cartao " +
      "passa a apontar ao lado do ponto");
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
