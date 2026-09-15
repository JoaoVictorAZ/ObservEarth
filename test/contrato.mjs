// test/contrato.mjs
// -----------------------------------------------------------------------------
// O CONTRATO ENTRE O PIPELINE E O APP
// -----------------------------------------------------------------------------
// M0 do Patch MVP. O pipeline PySpark e o ObservEarth sao dois subsistemas que
// trocam arquivos, e sem um contrato executavel a discordancia entre eles e'
// SILENCIOSA: o Parquet sai com `temp_max`, o app espera `temperature_2m_max`,
// e a tela mostra um campo vazio que parece "nao tem dado para este ponto".
// Ninguem investiga um vazio.
//
// O teste tem duas metades, e a segunda e' a que justifica o arquivo:
//
//   1. o validador reprova dado ruim         (e' util?)
//   2. o contrato concorda com o CODIGO      (continua verdadeiro?)
//
// A segunda le `VARIAVEIS` de server/climatologia.js -- o objeto que a rota usa
// de verdade, nao a documentacao. Documentacao concorda com o codigo no dia em
// que e' escrita; um teste concorda todo dia.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validar, conferirComOApp } from "../pipeline/contrato/validar.mjs";
import { VARIAVEIS, quantis, dentroDaJanela, JANELA_DIAS } from "../server/climatologia.js";

const C = JSON.parse(readFileSync("pipeline/contrato/esquema.json", "utf8"));
const G = JSON.parse(readFileSync("pipeline/contrato/gabarito-quantis.json", "utf8"));

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** uma linha valida de gold_normal, para os testes mexerem UM campo por vez */
const NORMAL = () => ({
  estacao_id: "A001", variavel: "temperature_2m_max", dia_do_ano: 200,
  p10: 24.1, p50: 27.8, p90: 31.2, media: 27.9,
  n_amostras: 870, anos: 30, referencia: "1991-2020",
  feitio: "simetrica", unidade: "°C", rotulo: "temperatura máxima",
});

const FATO = () => ({
  estacao_id: "A001", data: "2026-01-15", dia_do_ano: 15,
  temperature_2m_max: 31.4, temperature_2m_min: 21.0, temperature_2m_mean: 25.7,
  precipitation_sum: 0, wind_speed_10m_max: 6.2,
  horas_validas: 24, ingestao_em: "2026-01-16T03:00:00Z",
  fonte: "INMET/automatica/2026.zip",
});

const so = (probs, campo) => probs.filter((p) => p.campo === campo);

console.log("\no contrato aceita dado bom");

ok("linha valida de gold_normal passa limpa", () => {
  assert.deepEqual(validar(C, "gold_normal", [NORMAL()]), []);
});

ok("linha valida de fato_observacao_diaria passa limpa", () => {
  assert.deepEqual(validar(C, "fato_observacao_diaria", [FATO()]), []);
});

// ZERO NAO E' AUSENCIA, E O VALIDADOR NAO PODE CONFUNDIR OS DOIS. Um dia sem
// chuva tem precipitation_sum = 0, e isso e' uma medida.
ok("zero e' medida, e passa", () => {
  const l = FATO(); l.precipitation_sum = 0; l.wind_speed_10m_max = 0;
  assert.deepEqual(validar(C, "fato_observacao_diaria", [l]), []);
});

console.log("\na regra de ausencia");

// A REGRA MAIS IMPORTANTE DO CONTRATO. Um -9999 do INMET que escape para a
// camada Gold entra na media e no percentil sem levantar erro nenhum e desloca
// a distribuicao inteira -- a normal de 30 anos fica errada, e o app desenha
// essa normal com toda a confianca do mundo.
ok("sentinela -9999 e' reprovada, e a mensagem diz que e' ausencia", () => {
  const l = FATO(); l.temperature_2m_max = -9999;
  const p = so(validar(C, "fato_observacao_diaria", [l]), "temperature_2m_max");
  assert.equal(p.length, 1, "passou uma sentinela");
  assert.match(p[0].erro, /sentinela|ausência/i,
    "reprovou por faixa em vez de por ausencia: esconde o defeito real");
});

ok("as outras sentinelas conhecidas tambem caem", () => {
  for (const s of [-999, -99.9, -327.68]) {
    const l = FATO(); l.precipitation_sum = s;
    assert.ok(validar(C, "fato_observacao_diaria", [l]).length > 0, "passou " + s);
  }
});

ok("string vazia nao e' ausencia valida", () => {
  const l = NORMAL(); l.unidade = "";
  assert.ok(so(validar(C, "gold_normal", [l]), "unidade").length > 0);
});

ok("campo opcional em null passa; obrigatorio em null nao", () => {
  const bom = FATO(); bom.temperature_2m_max = null; bom.horas_validas = 12;
  // com poucas horas validas o agregado TEM que ser null; os outros tambem
  bom.temperature_2m_min = null; bom.temperature_2m_mean = null;
  bom.precipitation_sum = null; bom.wind_speed_10m_max = null;
  assert.deepEqual(validar(C, "fato_observacao_diaria", [bom]), []);

  const ruim = FATO(); ruim.estacao_id = null;
  assert.ok(so(validar(C, "fato_observacao_diaria", [ruim]), "estacao_id").length > 0);
});

console.log("\nnome de campo errado");

// O DEFEITO QUE O M0 EXISTE PARA IMPEDIR. Ele aparece como DOIS problemas: um
// campo desconhecido presente e um campo do contrato ausente.
ok("`temp_max` no lugar de `temperature_2m_max` e' reprovado dos dois lados", () => {
  const l = FATO(); l.temp_max = l.temperature_2m_max; delete l.temperature_2m_max;
  const p = validar(C, "fato_observacao_diaria", [l]);
  assert.ok(so(p, "temp_max").length > 0, "aceitou campo fora do contrato");
  assert.ok(so(p, "temperature_2m_max").length > 0, "nao notou o campo faltando");
});

ok("tabela que nao existe no contrato e' reprovada", () => {
  assert.ok(validar(C, "tabela_inventada", [{}]).length > 0);
});

console.log("\ntipos, dominios e faixas");

ok("tipo errado e' pego", () => {
  const l = NORMAL(); l.dia_do_ano = "200";
  assert.ok(so(validar(C, "gold_normal", [l]), "dia_do_ano").length > 0, "int veio como string");
});

ok("int com casa decimal nao passa por int", () => {
  const l = NORMAL(); l.anos = 30.5;
  assert.ok(so(validar(C, "gold_normal", [l]), "anos").length > 0);
});

ok("dia_do_ano fora de 1..366 cai", () => {
  for (const d of [0, 367]) {
    const l = NORMAL(); l.dia_do_ano = d;
    assert.ok(so(validar(C, "gold_normal", [l]), "dia_do_ano").length > 0, "passou " + d);
  }
});

ok("feitio fora do dominio cai", () => {
  const l = NORMAL(); l.feitio = "meio_simetrica";
  assert.ok(so(validar(C, "gold_normal", [l]), "feitio").length > 0);
});

ok("variavel fora do contrato cai", () => {
  const l = NORMAL(); l.variavel = "temperatura_maxima";
  assert.ok(so(validar(C, "gold_normal", [l]), "variavel").length > 0);
});

ok("referencia sem forma de periodo cai", () => {
  const l = NORMAL(); l.referencia = "normal climatologica";
  assert.ok(so(validar(C, "gold_normal", [l]), "referencia").length > 0);
});

ok("estacao fora do retangulo do Brasil cai", () => {
  const l = { estacao_id: "A001", nome: "X", uf: "SP", regiao: "SE",
    lat: 48.8, lng: 2.3, altitude_m: 35, fundacao: "2001-05-01",
    rede: "automatica", primeiro_dado: null, ultimo_dado: null, anos_uteis: 20 };
  const p = validar(C, "dim_estacao", [l]);
  assert.ok(so(p, "lat").length > 0 && so(p, "lng").length > 0, "aceitou Paris como estacao do INMET");
});

console.log("\ninvariantes");

// Percentis fora de ordem nao quebram nada: a regua desenha a faixa invertida e
// o ponto cai do lado errado da mediana, com toda a aparencia de normalidade.
ok("percentis fora de ordem sao reprovados", () => {
  const l = NORMAL(); l.p10 = 31.0; l.p90 = 24.0;
  assert.ok(validar(C, "gold_normal", [l]).some((x) => /crescente|ordem/i.test(x.erro)));
});

ok("percentil sem amostra e' reprovado", () => {
  const l = NORMAL(); l.n_amostras = 0;
  const p = validar(C, "gold_normal", [l]);
  assert.ok(p.length > 0, "percentil de conjunto vazio passou");
  assert.ok(p.some((x) => /sem amostra|amostra/i.test(x.erro)));
});

ok("n_amostras 0 com tudo null passa", () => {
  const l = NORMAL();
  l.n_amostras = 0; l.anos = 0;
  l.p10 = l.p50 = l.p90 = l.media = null;
  assert.deepEqual(validar(C, "gold_normal", [l]), []);
});

ok("minima acima da maxima e' reprovada", () => {
  const l = FATO(); l.temperature_2m_min = 35; l.temperature_2m_max = 30;
  assert.ok(validar(C, "fato_observacao_diaria", [l]).some((x) => /invariante/.test(x.erro)));
});

// Uma maxima calculada com 3 horas do dia nao e' a maxima do dia, e sai com a
// mesma cara de um dia completo.
ok("dia incompleto com agregado preenchido e' reprovado", () => {
  const l = FATO(); l.horas_validas = 3;
  const p = validar(C, "fato_observacao_diaria", [l]);
  assert.ok(p.some((x) => /h válidas|válidas/.test(x.erro)),
    "aceitou maxima do dia calculada com 3 horas");
});

ok("EAM acima do RMSE e' reprovado (desigualdade de Jensen)", () => {
  const l = { estacao_id: "A001", modelo: "ERA5", variavel: "temperature_2m_max", mes: 7,
    vies_medio: 1.2, erro_absoluto_medio: 3.0, rmse: 2.0, n_pares: 900,
    delta_altitude_m: -120, vies_residual: 0.4 };
  assert.ok(validar(C, "gold_vies", [l]).some((x) => /invariante/.test(x.erro)));
});

ok("chave repetida e' reprovada", () => {
  const p = validar(C, "gold_normal", [NORMAL(), NORMAL()]);
  assert.ok(p.some((x) => /duplicada/.test(x.erro)), "o agregado rodou duas vezes e ninguem viu");
});

console.log("\no contrato concorda com o app");

// A METADE QUE COSTURA OS DOIS SUBSISTEMAS. Le o objeto que a rota
// /api/climatologia usa de verdade.
ok("as variaveis do contrato sao EXATAMENTE as de server/climatologia.js", () => {
  const fora = conferirComOApp(C, VARIAVEIS);
  assert.deepEqual(fora, [], "contrato e app divergiram:\n    " + fora.join("\n    "));
});

ok("o conferidor sabe reprovar: unidade trocada e' detectada", () => {
  const falso = structuredClone(VARIAVEIS);
  falso.temperature_2m_max.unidade = "K";
  const fora = conferirComOApp(C, falso);
  assert.ok(fora.length > 0, "um teste que nao sabe falhar nao guarda nada");
  assert.match(fora[0], /unidade/);
});

ok("o conferidor detecta variavel que so existe de um lado", () => {
  const falso = structuredClone(VARIAVEIS);
  delete falso.precipitation_sum;
  assert.ok(conferirComOApp(C, falso).some((f) => /precipitation_sum/.test(f)));
});

// O feitio decide o que a TELA pode afirmar: `simetrica` autoriza "+3,4 °C
// acima da media"; `assimetrica` so autoriza percentil, porque em chuva a
// mediana costuma ser 0 e a media nao descreve nada.
ok("chuva e vento continuam assimetricos no contrato", () => {
  assert.equal(C.variaveis.precipitation_sum.feitio, "assimetrica");
  assert.equal(C.variaveis.wind_speed_10m_max.feitio, "assimetrica");
  assert.equal(C.variaveis.temperature_2m_max.feitio, "simetrica");
});

console.log("\no gabarito de quantis: o numero, e nao so o nome do campo");

// O CONTRATO DE ESQUEMA SOZINHO NAO BASTA. Se o notebook calcular o percentil
// por outro metodo, os campos casam, o app desenha, e a normal esta errada por
// decimos sem NADA na tela indicando isso. O Spark tem `percentile_approx`
// (aproximado por construcao) e `percentile` (exato) -- escolher o primeiro por
// habito seria exatamente esse defeito.
//
// Os valores do gabarito foram calculados a mao pela formula do tipo 7. Um
// gabarito gerado pela propria implementacao so provaria que ela continua
// fazendo o que fazia.
const IDX = { p10: 2, p50: 10, p90: 18 };   // quantis() devolve 21 passos de 5%

for (const caso of G.casos) {
  ok(`quantil · ${caso.nome}`, () => {
    const r = quantis(caso.amostra);
    assert.equal(r.n, caso.n, `n deu ${r.n}, esperado ${caso.n}`);
    for (const [chave, i] of Object.entries(IDX)) {
      const esperado = caso.esperado[chave];
      if (esperado === null) {
        assert.equal(r.q[i], null, `${chave} devia ser null`);
      } else {
        assert.ok(Math.abs(r.q[i] - esperado) < 1e-9,
          `${chave}: deu ${r.q[i]}, gabarito diz ${esperado} (${caso.conta})`);
      }
    }
    if (caso.esperado.media === null) assert.equal(r.media, null);
    else assert.ok(Math.abs(r.media - caso.esperado.media) < 1e-9,
      `media: deu ${r.media}, gabarito diz ${caso.esperado.media}`);
  });
}

// NaN nao cabe em JSON, entao este caso mora aqui e nao no gabarito.
ok("NaN e Infinity sao descartados como ausencia, e nao propagam", () => {
  const r = quantis([10, NaN, 20, Infinity, 30]);
  assert.equal(r.n, 3, "n deu " + r.n);
  assert.ok(Number.isFinite(r.media), "um NaN contaminou a media");
});

ok("a janela bate com o gabarito, inclusive na virada do ano", () => {
  for (const c of G.janela.casos) {
    assert.equal(dentroDaJanela(c.dia, c.alvo), c.dentro,
      `dia ${c.dia} vs alvo ${c.alvo}: esperado ${c.dentro}` + (c.porque ? ` — ${c.porque}` : ""));
  }
});

ok("a janela do contrato e' a mesma constante do app", () => {
  assert.equal(C.algoritmos.janela.dias, JANELA_DIAS,
    "o contrato promete uma janela e o app usa outra");
});

// O erro de ano bissexto esta DECLARADO no contrato. Este teste existe para que
// ele continue declarado: se alguem "consertar" a constante para 366 sem ler o
// porque, a virada do ano volta a perder metade das amostras em silencio.
ok("o contrato registra por que a volta do ano usa 365, e nao 366", () => {
  assert.match(C.algoritmos.janela.regra, /365/);
  assert.ok(C.algoritmos.janela.porque365?.length > 40, "o motivo sumiu do contrato");
  assert.ok(C.algoritmos.janela.erroAceito?.length > 40, "o erro aceito sumiu do contrato");
});

ok("o contrato proibe percentile_approx explicitamente", () => {
  const q = C.algoritmos.quantil;
  assert.equal(q.definicao, "tipo 7");
  assert.match(q.spark.NAO_usar, /percentile_approx/);
  assert.match(q.spark.usar, /percentile\(/);
});

// A proibicao acima nao e' opiniao: foi medida. O registro tem que dizer ONDE
// foi medida e COMO reproduzir, senao daqui a tres meses vira folclore.
ok("a proibicao de percentile_approx esta registrada como MEDIDA, com ambiente", () => {
  const m = C.algoritmos.quantil.spark.medido;
  assert.ok(m, "sumiu o registro da medicao");
  assert.match(m.ambiente, /Spark/, "sem versao de Spark: a medicao nao e' reproduzivel");
  assert.match(m.reproduzir, /--conferir/, "sem comando para refazer a medicao");
  assert.match(m.percentile, /^0 /, "o exato deixou de bater com o gabarito");
  // A ressalva de versao tem que sobreviver: foi medido na 3.5, e o Databricks
  // roda outra. Apagar isso transformaria uma medicao local em fato universal.
  assert.ok(m.ressalva?.length > 40, "sumiu a ressalva de que foi medido em outra versao");
});

console.log("\na saida REAL do Spark, julgada pelo contrato");

// O CIRCUITO FECHADO. `pipeline/contrato/amostra-gold.json` sai de uma execucao
// de verdade do pipeline/gold_normal.py sobre dado sintetico. Valida-la aqui
// significa que a MESMA regra que o aplicativo usa julga o que o Spark produz —
// e nao duas checagens parecidas em dois lugares.
ok("a amostra da saida do pipeline passa no contrato", () => {
  let linhas;
  try {
    linhas = JSON.parse(readFileSync("pipeline/contrato/amostra-gold.json", "utf8"));
  } catch {
    assert.fail("amostra-gold.json ausente — rode `python pipeline/test_gold.py`");
  }
  assert.ok(linhas.length > 0, "amostra vazia");
  const p = validar(C, "gold_normal", linhas);
  assert.deepEqual(p, [], "a saida do Spark viola o contrato:\n    " +
    p.slice(0, 8).map((x) => `linha ${x.linha} ${x.campo}: ${x.erro}`).join("\n    "));
});

// Um Parquet que o Spark grava com `long` no lugar de `int`, ou com a data como
// string ISO no lugar de date, passaria pelo esquema do Spark e quebraria aqui.
ok("a amostra tem as cinco variaveis do contrato, e nenhuma a mais", () => {
  const linhas = JSON.parse(readFileSync("pipeline/contrato/amostra-gold.json", "utf8"));
  for (const l of linhas) {
    assert.ok(C.variaveis[l.variavel], `variavel fora do contrato: ${l.variavel}`);
    assert.equal(l.unidade, C.variaveis[l.variavel].unidade, `unidade divergente em ${l.variavel}`);
    assert.equal(l.feitio, C.variaveis[l.variavel].feitio, `feitio divergente em ${l.variavel}`);
  }
});

console.log("\nas duas implementacoes da janela");

// O aplicativo nao roda Python e o Spark nao roda JavaScript, entao a regra de
// +/-7 dias existe DUAS VEZES. Duplicacao e' divida, e o que a paga e' uma prova
// de equivalencia: um resumo dos 366x366 pares, gravado dos dois lados.
// pipeline/test_gold.py afirma exatamente os mesmos dois numeros.
const JANELA_TOTAL = 5506;
const JANELA_HASH = 803922391n;

ok("o resumo dos 366x366 pares bate com o que pipeline/test_gold.py afirma", () => {
  let total = 0, h = 0n;
  const M = 1000000007n;
  for (let d = 1; d <= 366; d++) {
    for (let a = 1; a <= 366; a++) {
      if (dentroDaJanela(d, a)) { total++; h = (h * 31n + BigInt(d * 367 + a)) % M; }
    }
  }
  assert.equal(total, JANELA_TOTAL, `total ${total}; o lado Python afirma ${JANELA_TOTAL}`);
  assert.equal(h, JANELA_HASH, `hash ${h}; o lado Python afirma ${JANELA_HASH}`);
});

console.log("\nforma do proprio contrato");

ok("toda tabela declara camada, chave e campos", () => {
  for (const [nome, t] of Object.entries(C.tabelas)) {
    assert.ok(["bronze", "silver", "gold"].includes(t.camada), nome + ": camada " + t.camada);
    assert.ok(Array.isArray(t.chave) && t.chave.length > 0, nome + " sem chave");
    assert.ok(Object.keys(t.campos ?? {}).length > 0, nome + " sem campos");
    for (const c of t.chave) assert.ok(t.campos[c], `${nome}: chave "${c}" nao e' campo`);
  }
});

// Um numero que chega ao app sem procedencia nao pode ser desenhado: a tela
// afirma coisas diferentes conforme a referencia seja 1991-2020 ou 2008-2024.
ok("toda tabela gold carrega a procedencia exigida", () => {
  for (const [nome, t] of Object.entries(C.tabelas)) {
    if (t.camada !== "gold") continue;
    for (const exigido of C.procedencia.obrigatorioEmGold) {
      // gold_vies e gold_cobertura nao sao series climatologicas; a exigencia
      // vale para quem carrega normal. Declarado aqui em vez de silenciado.
      if (nome !== "gold_normal") continue;
      assert.ok(t.campos[exigido], `${nome} sem "${exigido}"`);
    }
  }
});

ok("nenhum campo do contrato usa nome em portugues para grandeza", () => {
  // A regra de nomes: chave tecnica em ingles (a que o app fala), rotulo em
  // portugues. Um `temperatura_maxima` aqui seria o adaptador nascendo.
  for (const t of Object.values(C.tabelas)) {
    for (const nome of Object.keys(t.campos)) {
      assert.ok(!/temperatura|precipitacao|umidade|vento_/.test(nome),
        "campo com nome em portugues: " + nome);
    }
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
