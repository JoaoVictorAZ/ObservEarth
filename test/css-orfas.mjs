// test/css-orfas.mjs
// -----------------------------------------------------------------------------
// TODA CLASSE USADA NO TSX TEM QUE TER REGRA.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// Eu venho editando `src/index.css` com substituições em BLOCO — localizo um
// marcador de início e um de fim e troco tudo que está no meio. Cada uma dessas
// operações apagou, sem eu notar, as seções que estavam entre os marcadores.
//
// O estrago acumulado foi medido: 77 de 143 classes sem NENHUMA regra.
//
// O sintoma nunca aparece como erro. O componente renderiza, o `tsc` passa, o
// build passa, os 402 testes passam — e a tela mostra texto solto, centralizado
// por herança, sem controle nenhum. Foi assim que o painel de camadas, o modal
// de análise e o console de LLM "quebraram" um depois do outro, e em cada caso
// eu procurei o defeito no componente.
//
// Este teste é a única coisa que fecha esse buraco: ele lê o que os TSX usam e
// o que o CSS define, e reprova a diferença.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
console.log("\nclasses CSS órfãs");

function arquivos(dir, ext, saida = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, ext, saida);
    else if (nome.endsWith(ext)) saida.push(p);
  }
  return saida;
}

const raiz = new URL("../src", import.meta.url).pathname;

/** todo seletor de classe declarado em qualquer folha do projeto */
function definidas() {
  const set = new Set();
  for (const f of arquivos(raiz, ".css")) {
    const css = readFileSync(f, "utf8");
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) set.add(m[1]);
  }
  return set;
}

/**
 * Toda classe que aparece num `className`.
 *
 * Pega tanto `className="a b"` quanto template com expressão —
 * `className={`cam ${on ? "cam-on" : ""}`}` — porque as classes condicionais
 * são justamente as de ESTADO, e um estado sem estilo é um controle que não
 * mostra que está ligado.
 */
function usadas() {
  const set = new Set();
  for (const f of arquivos(raiz, ".tsx")) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/className=[{"`]([^"`}]*)/g)) {
      for (const c of m[1].split(/[\s${}?:]+/)) {
        const nome = c.replace(/["'`]/g, "").trim();
        if (/^[a-z][\w-]*$/.test(nome)) set.add(nome);
      }
    }
  }
  return set;
}

const def = definidas();
const uso = usadas();
const orfas = [...uso].filter((c) => !def.has(c)).sort();

ok("nenhuma classe usada no TSX está sem regra", () => {
  assert.deepEqual(orfas, [],
    `${orfas.length} de ${uso.size} classes sem CSS:\n    ${orfas.join(", ")}`);
});

ok("as folhas do projeto foram encontradas", () => {
  // Um teste que não acha nenhum arquivo passaria vazio e daria falsa
  // segurança — que é exatamente o modo de falha que ele existe para evitar.
  assert.ok(arquivos(raiz, ".css").length >= 1, "nenhuma folha de estilo achada");
  assert.ok(uso.size > 50, `só ${uso.size} classes lidas dos TSX; o leitor quebrou`);
});

console.log(`\n  ${uso.size} classes usadas, ${def.size} definidas, ${orfas.length} órfãs`);
console.log(`  ${n} verificações de classes órfãs\n`);
export default n;
