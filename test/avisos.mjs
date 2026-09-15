// test/avisos.mjs
// -----------------------------------------------------------------------------
// A AMOSTRA ABAIXO E RECORTE DO FEED DE VERDADE, buscado em 07/09/2026. Nao e
// sintetica: e o HTML dentro do CDATA como o INMET publica, com as entidades,
// os acentos e a tabela. Testar contra invencao minha nao provaria nada sobre
// a fonte.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  lerAvisos, lerTabela, lerAreas, lerInstante, grauDe, vigente, buscarAvisos, SEVERIDADES,
} from "../server/avisos.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const okAsync = async (nome, fn) => {
  try { await fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

const ITEM_REAL = `<item>
<title>Aviso de Ventos Costeiros. Severidade Grau: Perigo Potencial</title>
<link>https://apiprevmet3.inmet.gov.br/avisos/rss/55632</link>
<description><![CDATA[<table border="0" cellspacing="0" cellpadding="3"><tr><th align="left">Status</th><td>Alert</td></tr><tr><th align="left">Evento</th><td>Ventos Costeiros</td></tr><tr><th align="left">Severidade</th><td>Perigo Potencial</td></tr><tr><th align="left">Início</th><td>2026-09-06 11:20:00.0</td></tr><tr><th align="left">Fim</th><td>2026-09-07 11:00:00.0</td></tr><tr><th align="left">Descrição</th><td>INMET publica aviso iniciando em: 06/09/2026 11:20. Intensificação dos ventos nas regiões litorâneas, movimentando dunas de areia sobre construções na orla.</td></tr><tr><th align="left">Área</th><td>Aviso para as Áreas: Sul Baiano, Central Espírito-santense, Sul Fluminense, Baixadas</td></tr><tr><th align="left">Link Gráfico</th><td><a href='https://avisos.inmet.gov.br/55632'>https://avisos.inmet.gov.br/55632</a></td></tr></table>]]></description>
<pubDate>Sun, 06 Sep 2026 11:20:00 +0000</pubDate>
<guid>https://apiprevmet3.inmet.gov.br/avisos/rss/55632</guid>
</item>`;

const ITEM_GRAVE = ITEM_REAL
  .replace(/Perigo Potencial/g, "Perigo")
  // /g, e o motivo importa: "Ventos Costeiros" aparece DUAS vezes no item --
  // no <title> e na celula Evento da tabela. Sem o /g so o titulo mudava, e o
  // teste comparava contra o campo que ele nao tinha trocado.
  .replace(/Ventos Costeiros/g, "Tempestade")
  .replace(/55632/g, "55999");

const FEED = (...its) =>
  `<?xml version="1.0" encoding="UTF-8" ?><rss version="2.0"><channel>` +
  `<title>Avisos</title><copyright>public domain</copyright>` + its.join("") +
  `</channel></rss>`;

console.log("\nleitura do item real");

ok("extrai os campos da tabela dentro do CDATA", () => {
  const { avisos } = lerAvisos(FEED(ITEM_REAL));
  assert.equal(avisos.length, 1);
  const a = avisos[0];
  assert.equal(a.id, "55632");
  assert.equal(a.evento, "Ventos Costeiros");
  assert.equal(a.severidade, "Perigo potencial");
  assert.equal(a.status, "Alert");
  assert.match(a.descricao, /dunas de areia/);
});

// O feed NAO publica geometria: as areas sao nomes de mesorregiao do IBGE.
// Esta lista e o que torna possivel casar com a malha do IBGE depois, sem
// ninguem precisar reprocessar HTML.
ok("as areas viram lista, sem o prefixo e sem vazios", () => {
  const { avisos } = lerAvisos(FEED(ITEM_REAL));
  assert.deepEqual(avisos[0].areas,
    ["Sul Baiano", "Central Espírito-santense", "Sul Fluminense", "Baixadas"]);
});

ok("area ausente vira lista vazia, nao ['']", () => {
  assert.deepEqual(lerAreas(undefined), []);
  assert.deepEqual(lerAreas(""), []);
  assert.deepEqual(lerAreas("Aviso para as Áreas: "), []);
});

ok("o texto original das datas e preservado ao lado do instante", () => {
  const a = lerAvisos(FEED(ITEM_REAL)).avisos[0];
  assert.equal(a.inicioTexto, "2026-09-06 11:20:00.0");
  assert.equal(a.inicio, Date.UTC(2026, 8, 6, 11, 20));
  assert.equal(a.fim, Date.UTC(2026, 8, 7, 11, 0));
});

console.log("\nseveridade");

ok("os tres graus da escala oficial estao previstos", () => {
  assert.equal(Object.keys(SEVERIDADES).length, 3);
  assert.equal(grauDe("Perigo Potencial").grau, 1);
  assert.equal(grauDe("Perigo").grau, 2);
  assert.equal(grauDe("Grande Perigo").grau, 3);
});

// Uma severidade desconhecida chegando na tela sem cor e pior que uma prevista.
ok("severidade desconhecida nao quebra e nao vira a mais grave", () => {
  const g = grauDe("Alerta Roxo Cosmico");
  assert.equal(g.grau, 0);
  assert.ok(g.rotulo.length > 0);
  assert.notEqual(g.cor, undefined);
});

ok("acento e caixa nao mudam o grau", () => {
  assert.equal(grauDe("PERIGO POTENCIAL").grau, 1);
  assert.equal(grauDe("perigo").grau, 2);
});

ok("mais grave vem primeiro na lista", () => {
  const { avisos } = lerAvisos(FEED(ITEM_REAL, ITEM_GRAVE));
  assert.equal(avisos[0].grau, 2, "abriu pelo aviso menos grave");
  assert.equal(avisos[0].evento, "Tempestade");
});

console.log("\ndescarte declarado");

// Um aviso sem evento ou sem janela viraria um retangulo colorido sem
// significado. Ele sai da lista E aparece na contagem.
ok("item sem campos obrigatorios e descartado, e a contagem sai", () => {
  const quebrado = ITEM_REAL.replace(/<th align="left">Evento<\/th><td>[^<]*<\/td>/, "");
  const r = lerAvisos(FEED(ITEM_REAL, quebrado));
  assert.equal(r.avisos.length, 1);
  assert.equal(r.descartados.length, 1);
  assert.match(r.descartados[0].motivo, /obrigat/i);
});

ok("data ilegivel derruba o aviso com motivo, nao vira NaN na tela", () => {
  const torto = ITEM_REAL.replace("2026-09-06 11:20:00.0", "ontem de manhã");
  const r = lerAvisos(FEED(torto));
  assert.equal(r.avisos.length, 0);
  assert.match(r.descartados[0].motivo, /ileg[íi]veis/i);
});

ok("feed vazio devolve listas vazias, nunca null", () => {
  const r = lerAvisos(FEED());
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(r.descartados, []);
});

ok("lixo total nao explode", () => {
  for (const x of [null, undefined, "", "<html>oi</html>", 42]) {
    const r = lerAvisos(x);
    assert.equal(r.avisos.length, 0);
  }
});

console.log("\nvigencia");

ok("vigente so dentro da janela, inclusive nas bordas", () => {
  const a = lerAvisos(FEED(ITEM_REAL)).avisos[0];
  assert.equal(vigente(a, a.inicio - 1), false);
  assert.equal(vigente(a, a.inicio), true);
  assert.equal(vigente(a, a.fim), true);
  assert.equal(vigente(a, a.fim + 1), false, "aviso expirado continuaria desenhado");
});

console.log("\nbusca");

await okAsync("conta vigentes e descartados, e declara a fonte", async () => {
  const cache = async (_k, _t, prod) => prod();
  const f = async () => ({ ok: true, text: async () => FEED(ITEM_REAL, ITEM_GRAVE) });
  const r = await buscarAvisos(f, cache, Date.UTC(2026, 8, 6, 12, 0));
  assert.equal(r.avisos.length, 2);
  assert.equal(r.vigentes, 2);
  assert.match(r.fonte, /INMET/);
  assert.match(r.licenca, /cita/i, "a licenca declarada pelo feed nao atravessou");
  assert.match(r.nota, /mesorregi/i, "a tela precisa saber que nao ha geometria");
});

await okAsync("erro HTTP vira 502 em vez de lista vazia silenciosa", async () => {
  const cache = async (_k, _t, prod) => prod();
  await assert.rejects(
    () => buscarAvisos(async () => ({ ok: false, status: 503 }), cache),
    (e) => e.status === 502,
  );
});

// "Nao ha aviso hoje" e "nao sei mais ler o feed" sao coisas MUITO diferentes.
await okAsync("resposta sem nenhum <item> e tratada como falha, nao como dia calmo", async () => {
  const cache = async (_k, _t, prod) => prod();
  await assert.rejects(
    () => buscarAvisos(async () => ({ ok: true, text: async () => "<html>manutenção</html>" }), cache),
    (e) => e.status === 502 && /nenhum item/i.test(e.message),
  );
});

await okAsync("canal com zero item mas RSS valido NAO e falha: e dia calmo", async () => {
  const cache = async (_k, _t, prod) => prod();
  const vazio = `<rss><channel><title>Avisos</title><item></item></channel></rss>`;
  const r = await buscarAvisos(async () => ({ ok: true, text: async () => vazio }), cache);
  assert.equal(r.avisos.length, 0);
  assert.equal(r.vigentes, 0);
});

console.log("\ntabela crua");

ok("lerTabela normaliza chave sem acento e limpa a marcacao interna", () => {
  const t = lerTabela(`<tr><th align="left">Descrição</th><td>a <b>b</b> c</td></tr>`);
  assert.equal(t["descricao"], "a b c");
});

ok("instante aceita T e espaco, e recusa o resto", () => {
  assert.equal(lerInstante("2026-01-02T03:04"), Date.UTC(2026, 0, 2, 3, 4));
  assert.equal(lerInstante("2026-01-02 03:04:05.0"), Date.UTC(2026, 0, 2, 3, 4));
  assert.equal(lerInstante("02/01/2026"), null);
  assert.equal(lerInstante(null), null);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
