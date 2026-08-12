// test/grib-index.mjs
// -----------------------------------------------------------------------------
// Índice .idx e download por faixa de bytes.
//
// Isto existe por causa de um relato: "no dia 29/07 no Rio tivemos ventos de
// 90 km/h e a visualização mostra 8", e "semana passada tinha um furacão perto
// do Japão e agora não aparece mais".
//
// A causa não era a renderização. Quando o NOMADS não tem mais a data — ele
// guarda ~10 dias de ciclos — o código tentava o S3 baixando o arquivo COMPLETO
// (`pgrb2.0p25`, ~500 MB, todas as variáveis e níveis) com 30 s de prazo, para
// extrair dois campos de vento de superfície. Nunca terminava. Então toda data
// antiga caía no recuo de 3°, onde a célula tem 333 km: um ciclone tropical
// cabe numa célula e some, e a rajada de uma baía vira a média do oceano.
//
// O `.idx` resolve: lê-se o índice, acham-se as duas mensagens, e pede-se só
// aquele intervalo. ~3 MB em vez de 500 MB.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  parseIdx, acharRegistros, fundirFaixas, cabecalhoRange, baixarPorIndice,
} from "../server/gribIndex.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\níndice .idx e faixa de bytes");

/** um .idx no formato real do wgrib2, com as armadilhas que importam */
const IDX = [
  "1:0:d=2026072912:PRMSL:mean sea level:anl:",
  "2:1000:d=2026072912:CLMR:1 hybrid level:anl:",
  "3:2500:d=2026072912:UGRD:100 m above ground:anl:",
  "4:4000:d=2026072912:UGRD:10 m above ground:anl:",
  "5:5500:d=2026072912:VGRD:10 m above ground:anl:",
  "6:7000:d=2026072912:TMP:2 m above ground:anl:",
  "7:9000:d=2026072912:UGRD:250 mb:anl:",
].join("\n") + "\n";

const ALVO = [
  { campo: "UGRD", nivel: "10 m above ground" },
  { campo: "VGRD", nivel: "10 m above ground" },
];

// ---------------------------------------------------------------------------
ok("lê número, deslocamento, campo e nível de cada linha", () => {
  const regs = parseIdx(IDX);
  assert.equal(regs.length, 7);
  assert.equal(regs[3].campo, "UGRD");
  assert.equal(regs[3].nivel, "10 m above ground");
  assert.equal(regs[3].inicio, 4000);
  assert.equal(regs[3].tipo, "anl");
});

ok("o fim de cada mensagem é o começo da seguinte, menos um", () => {
  const regs = parseIdx(IDX);
  for (let i = 0; i < regs.length - 1; i++) {
    assert.equal(regs[i].fim, regs[i + 1].inicio - 1,
      `mensagem ${i} termina em ${regs[i].fim} e a próxima começa em ${regs[i + 1].inicio}`);
  }
});

ok("a última mensagem fica ABERTA, não com um fim inventado", () => {
  // O índice não diz o tamanho do arquivo. Chutar um limite truncaria a última
  // mensagem, e um GRIB truncado não lança erro: ele decodifica menos pontos.
  const regs = parseIdx(IDX);
  assert.equal(regs[regs.length - 1].fim, null);
  assert.equal(cabecalhoRange({ inicio: 9000, fim: null }), "bytes=9000-");
});

ok("linhas vazias e lixo não viram registro", () => {
  const regs = parseIdx("\n\n" + IDX + "\nlixo sem dois pontos\n:::\n\n");
  assert.equal(regs.length, 7);
});

ok("índice fora de ordem é ordenado antes de calcular os fins", () => {
  // Se não ordenar, os `fim` saem negativos e as faixas ficam inválidas.
  const embaralhado = IDX.split("\n").filter(Boolean).reverse().join("\n");
  const regs = parseIdx(embaralhado);
  for (let i = 0; i < regs.length - 1; i++) {
    assert.ok(regs[i].inicio < regs[i + 1].inicio, "não ordenou");
    assert.ok(regs[i].fim > regs[i].inicio, `fim ${regs[i].fim} antes do início`);
  }
});

// ---------------------------------------------------------------------------
// a busca — onde um casamento frouxo pegaria o campo errado
// ---------------------------------------------------------------------------
ok("o nível casa por igualdade EXATA", () => {
  // "10 m above ground" não pode casar com "100 m above ground". Um casamento
  // por prefixo pegaria o vento a 100 m e ninguém notaria: também é vento,
  // também é plausível, e é sistematicamente mais forte.
  const regs = parseIdx(IDX);
  const achados = acharRegistros(regs, ALVO);
  assert.equal(achados.length, 2);
  assert.equal(achados[0].inicio, 4000, "pegou o UGRD de 100 m");
  assert.equal(achados[0].nivel, "10 m above ground");
});

ok("o campo casa por igualdade, sem confundir UGRD de outro nível", () => {
  const regs = parseIdx(IDX);
  const achados = acharRegistros(regs, [{ campo: "UGRD", nivel: "250 mb" }]);
  assert.equal(achados[0].inicio, 9000);
});

ok("alvo inexistente não é silenciosamente omitido", () => {
  const regs = parseIdx(IDX);
  const achados = acharRegistros(regs, [{ campo: "GUST", nivel: "surface" }]);
  assert.equal(achados.length, 0);
});

// ---------------------------------------------------------------------------
// as faixas — onde se ganha ou se perde requisição
// ---------------------------------------------------------------------------
ok("mensagens vizinhas viram UMA faixa só", () => {
  // UGRD e VGRD a 10 m são consecutivos no arquivo. Uma faixa contígua cobre as
  // duas com uma requisição — e o orçamento do projeto é um quarto do gratuito.
  const regs = parseIdx(IDX);
  const faixas = fundirFaixas(acharRegistros(regs, ALVO));
  assert.equal(faixas.length, 1, `saíram ${faixas.length} faixas`);
  assert.equal(faixas[0].inicio, 4000);
  assert.equal(faixas[0].fim, 6999);
});

ok("mensagens distantes continuam em faixas separadas", () => {
  const regs = parseIdx(IDX);
  const faixas = fundirFaixas(acharRegistros(regs, [
    { campo: "PRMSL", nivel: "mean sea level" },
    { campo: "UGRD", nivel: "250 mb" },
  ]));
  assert.equal(faixas.length, 2, "fundiu o que está a 9 kB de distância");
});

ok("uma faixa aberta continua aberta ao ser fundida", () => {
  // Fundir uma faixa aberta com uma fechada e fechar o resultado truncaria a
  // última mensagem do arquivo.
  const faixas = fundirFaixas([
    { inicio: 100, fim: 199 },
    { inicio: 200, fim: null },
  ]);
  assert.equal(faixas.length, 1);
  assert.equal(faixas[0].fim, null);
});

ok("lista vazia não quebra", () => {
  assert.deepEqual(fundirFaixas([]), []);
});

// ---------------------------------------------------------------------------
// o download
// ---------------------------------------------------------------------------
const GRIB_FALSO = Buffer.concat([
  Buffer.from("GRIB"), Buffer.alloc(4000 - 4, 0x41),          // 0..3999 outras msgs
  Buffer.from("GRIB"), Buffer.alloc(1500 - 4, 0x55),          // 4000..5499 UGRD
  Buffer.from("GRIB"), Buffer.alloc(1500 - 4, 0x56),          // 5500..6999 VGRD
  Buffer.alloc(3000, 0x54),                                    // 7000..9999 resto
]);

function servidor({ statusIdx = 200, statusRange = 206, corpoIdx = IDX } = {}) {
  const chamadas = [];
  const impl = async (url, opts = {}) => {
    chamadas.push({ url: String(url), range: opts.headers?.Range ?? null });
    if (String(url).endsWith(".idx")) {
      return { ok: statusIdx >= 200 && statusIdx < 300, status: statusIdx, text: async () => corpoIdx };
    }
    const m = /bytes=(\d+)-(\d*)/.exec(opts.headers?.Range ?? "");
    const ini = m ? Number(m[1]) : 0;
    const fim = m && m[2] ? Number(m[2]) : GRIB_FALSO.length - 1;
    const fatia = GRIB_FALSO.subarray(ini, fim + 1);
    return {
      ok: true, status: statusRange,
      arrayBuffer: async () => fatia.buffer.slice(fatia.byteOffset, fatia.byteOffset + fatia.byteLength),
    };
  };
  impl.chamadas = chamadas;
  return impl;
}

await okA("baixa SÓ o intervalo das mensagens pedidas", async () => {
  const f = servidor();
  const r = await baixarPorIndice(f, "https://exemplo/gfs.f000", ALVO);
  assert.equal(r.bytes, 3000, `baixou ${r.bytes} bytes`);
  assert.ok(r.bytes < GRIB_FALSO.length / 3, "baixou perto do arquivo inteiro");
  assert.equal(r.buf.toString("latin1", 0, 4), "GRIB");
});

await okA("gasta UMA requisição de índice e UMA de dados", async () => {
  const f = servidor();
  const r = await baixarPorIndice(f, "https://exemplo/gfs.f000", ALVO);
  assert.equal(f.chamadas.length, 2, `gastou ${f.chamadas.length} requisições`);
  assert.equal(r.requisicoes, 2);
  assert.ok(f.chamadas[0].url.endsWith(".idx"));
  assert.equal(f.chamadas[1].range, "bytes=4000-6999");
});

await okA("um servidor que IGNORA o Range é recusado", async () => {
  // HTTP 200 numa requisição com Range significa "vou te mandar o arquivo
  // inteiro" — meio gigabyte. Aceitar isso é voltar exatamente ao defeito.
  await assert.rejects(
    () => baixarPorIndice(servidor({ statusRange: 200 }), "https://exemplo/gfs.f000", ALVO),
    (e) => e.code === "SEM_RANGE"
  );
});

await okA("índice indisponível é erro com código, não recuo silencioso", async () => {
  await assert.rejects(
    () => baixarPorIndice(servidor({ statusIdx: 404 }), "https://exemplo/gfs.f000", ALVO),
    (e) => e.code === "SEM_INDICE"
  );
  await assert.rejects(
    () => baixarPorIndice(servidor({ corpoIdx: "" }), "https://exemplo/gfs.f000", ALVO),
    (e) => e.code === "INDICE_VAZIO"
  );
});

await okA("campo ausente no índice é dito por nome", async () => {
  await assert.rejects(
    () => baixarPorIndice(servidor(), "https://exemplo/gfs.f000",
      [{ campo: "GUST", nivel: "surface" }]),
    (e) => e.code === "CAMPO_AUSENTE" && /GUST em surface/.test(e.message)
  );
});

await okA("o índice é pedido no endereço do GRIB mais .idx", async () => {
  const f = servidor();
  await baixarPorIndice(f, "https://exemplo/gfs.t12z.pgrb2.0p25.f000", ALVO);
  assert.equal(f.chamadas[0].url, "https://exemplo/gfs.t12z.pgrb2.0p25.f000.idx");
});

console.log(`\n  ${n} verificações do índice .idx\n`);
export default n;
