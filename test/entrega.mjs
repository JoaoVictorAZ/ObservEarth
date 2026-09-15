// test/entrega.mjs
// -----------------------------------------------------------------------------
// O DOCUMENTO AVALIADO
// -----------------------------------------------------------------------------
// `docs/MVP.md` e' a entrega do MVP academico, e ele tem duas maneiras de dar
// errado em silencio:
//
//   1. UM TITULO RENOMEADO. O enunciado exige sete topicos com os titulos
//      exatos. Trocar "Carga dos Dados" por "Ingestao" nao quebra nada, nao
//      aparece em nenhum lugar, e custa ponto na correcao.
//
//   2. UM NUMERO QUE DIVERGE DO CODIGO. O documento afirma escala de 150 km,
//      recorte 2010-2024, `percentile` em vez de `percentile_approx`. Se
//      alguem mudar o contrato e nao o texto, o documento passa a descrever um
//      pipeline que nao existe — e e' justamente o documento que a correcao le.
//
// A segunda checagem e' a que importa. Documentacao concorda com o codigo no
// dia em que e' escrita; um teste concorda todo dia.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const DOC = "docs/MVP.md";
let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\no documento da entrega");

ok("docs/MVP.md existe", () => {
  assert.ok(existsSync(DOC), "o documento avaliado nao esta no repositorio");
});

const md = existsSync(DOC) ? readFileSync(DOC, "utf8") : "";
const C = JSON.parse(readFileSync("pipeline/contrato/esquema.json", "utf8"));

// Os sete titulos do item 5 do enunciado, na ordem.
const TITULOS = [
  "Contexto de Negócios e Perguntas",
  "Carga dos Dados",
  "Modelagem e Catálogo de Dados",
  "Pipeline de Dados",
  "Qualidade de Dados",
  "Análise de Dados",
  "Autoavaliação",
];

ok("os sete topicos exigidos estao presentes", () => {
  const faltando = TITULOS.filter((t) => !md.includes(t));
  assert.deepEqual(faltando, [], "titulos ausentes: " + faltando.join(" · "));
});

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** posição do CABEÇALHO do tópico, e não da primeira menção em qualquer lugar */
const posDoTitulo = (t) =>
  md.search(new RegExp(`^## \\d+\\. ${escapar(t)}`, "m"));

ok("cada topico e' um cabecalho de nivel 2 numerado, e nao so uma mencao no texto", () => {
  for (const t of TITULOS) {
    assert.ok(posDoTitulo(t) >= 0, `"${t}" nao e' um cabecalho ## numerado`);
  }
});

// A primeira versao deste teste procurava a primeira MENÇÃO de cada título e
// reprovava "Pipeline de Dados" — que aparece no título do documento, muito
// antes da seção 4. O teste estava errado, não o documento: ele verificava
// "a palavra aparece nesta ordem", que não é a propriedade que interessa.
ok("os sete topicos estao NA ORDEM do enunciado", () => {
  const pos = TITULOS.map((t) => [t, posDoTitulo(t)]);
  for (let i = 1; i < pos.length; i++) {
    assert.ok(pos[i][1] > pos[i - 1][1],
      `"${pos[i][0]}" vem antes de "${pos[i - 1][0]}"`);
  }
});

console.log("\no texto concorda com o codigo");

// A escala da confianca esta no contrato E no texto. Duas fontes para o mesmo
// numero e' como elas passam a discordar.
ok("a escala de proximidade do texto e' a do contrato", () => {
  const conta = C.algoritmos.confianca.fatores.proximidade.conta;
  const km = /(\d+)/.exec(conta)?.[1];
  assert.ok(km, "nao achei a escala no contrato");
  assert.ok(md.includes(`${km} km`), `o contrato usa ${km} km e o documento nao cita esse numero`);
});

ok("o recorte de anos do texto e' o do contrato", () => {
  const rec = C.algoritmos.referenciaClimatologica.inmet.escolhida;
  assert.ok(md.includes(rec), `o contrato escolheu ${rec} e o documento nao diz isso`);
});

ok("o documento proibe percentile_approx, como o contrato", () => {
  assert.match(md, /percentile_approx/, "a armadilha do percentil sumiu do documento");
  assert.match(md, /0 de 15|0 de 15 casos/, "sumiu o resultado medido do percentil exato");
  assert.match(md, /8 de 15/, "sumiu o resultado medido do aproximado");
});

ok("o documento cita as cinco variaveis do contrato", () => {
  // Nao pelo nome tecnico: pelo que elas governam. `feitio` e `referencia` sao
  // os dois campos que decidem o que a tela pode AFIRMAR, e sao o coracao da
  // secao de modelagem.
  for (const c of ["feitio", "referencia", "assimetrica", "simetrica"]) {
    assert.ok(md.includes(c), `o documento nao menciona "${c}"`);
  }
});

console.log("\nhonestidade do documento");

// A convencao declarada no proprio documento: todo numero e' medido ou marcado
// como pendente. Se os marcadores sumirem sem os numeros chegarem, o documento
// passou a afirmar coisas que ninguem mediu.
ok("os marcadores de pendencia existem e estao listados no fim", () => {
  const marcas = (md.match(/⟨PENDENTE/g) ?? []).length;
  assert.ok(marcas > 0, "nenhuma pendencia marcada — ou tudo foi executado, ou os marcadores sumiram");
  assert.match(md, /pendências para fechar a entrega/i, "sumiu a lista de pendencias do fim");
});

ok("a autoavaliacao diz o que NAO foi atingido", () => {
  const i = md.indexOf("Autoavaliação");
  const fim = md.slice(i);
  assert.match(fim, /não foi (atingido|construído|feita|respondida)/i,
    "a autoavaliacao nao declara nenhuma falta — o enunciado pede exatamente isso");
});

// As perguntas originais ficam INTACTAS, mesmo as nao respondidas. Apagar uma
// pergunta sem resposta seria esconder o que a autoavaliacao existe para expor.
ok("as quatro perguntas originais continuam no documento", () => {
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
    assert.ok(md.includes(q), `a pergunta ${q} sumiu`);
  }
});

console.log("\nseguranca: o repositorio e' publico");

ok("nenhuma chave de API vazou para o documento", () => {
  // Padroes de chave comuns nas fontes que o projeto usa. Uma chave num
  // repositorio publico esta comprometida no instante em que sobe.
  const suspeitos = [
    /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}/,   // token com ponto
    /api[_-]?key\s*[=:]\s*["']?[A-Za-z0-9]{16,}/i,
    /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  ];
  for (const re of suspeitos) {
    const m = re.exec(md);
    assert.equal(m, null, "possivel segredo no documento: " + m?.[0]?.slice(0, 24));
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
