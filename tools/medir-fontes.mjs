import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

const AQUI = dirname(fileURLToPath(import.meta.url));
const LIMITE = 12000;

const CRW = "coastwatch.pfeg.noaa.gov";
const args = process.argv.slice(2);
const iAno = args.indexOf("--inmet");
if (iAno >= 0) {
  await baixarAno(args[iAno + 1] ?? "2024");
  process.exit(0);
}
const arquivo = args[0];
if (arquivo) {
  analisarCSV(arquivo);
  process.exit(0);
}

async function baixarAno(ano) {
  const { createWriteStream } = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const { execFileSync } = await import("node:child_process");
  const raiz = join(AQUI, "..");
  const dir = join(raiz, "data", "bronze");
  mkdirSync(dir, { recursive: true });

  const url = `https://portal.inmet.gov.br/uploads/dadoshistoricos/${ano}.zip`;
  const zip = join(dir, `${ano}.zip`);
  console.log(`\nbaixando ${url}`);
  const t0 = Date.now();
  const r = await fetch(url, { headers: { "User-Agent": "ObservEarth/medicao" } });
  if (!r.ok) { console.log(`  HTTP ${r.status} — o ano ${ano} não existe nesse padrão de URL`); return; }
  await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
  const { statSync } = await import("node:fs");
  const mb = statSync(zip).size / 1048576;
  console.log(`  ${mb.toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s  ->  ${zip}`);

  // ---- extrair UMA entrada ----------------------------------------------
  const alvo = join(dir, `amostra-${ano}.CSV`);
  try {
    if (process.platform === "win32") {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(zip)})
        $csv=$z.Entries | Where-Object { $_.FullName -match '\\.CSV$' }
        Write-Output ("ENTRADAS=" + $z.Entries.Count)
        Write-Output ("CSVS=" + $csv.Count)
        Write-Output ("PRIMEIRO=" + $csv[0].FullName)
        [IO.Compression.ZipFileExtensions]::ExtractToFile($csv[0], ${JSON.stringify(alvo)}, $true)
        $z.Dispose()`;
      const saida = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
      for (const l of saida.trim().split(/\r?\n/)) console.log("  " + l);
    } else {
      const lista = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
      const primeiro = lista.find((x) => /\.csv$/i.test(x));
      console.log(`  ENTRADAS=${lista.length}  PRIMEIRO=${primeiro}`);
      writeFileSync(alvo, execFileSync("unzip", ["-p", zip, primeiro], { maxBuffer: 1 << 28 }));
    }
  } catch (e) {
    console.log(`\n  não consegui extrair automaticamente (${e.message.split("\n")[0]}).`);
    console.log(`  Extraia um CSV à mão e rode:  node tools/medir-fontes.mjs caminho\\para\\um.CSV`);
    return;
  }
  analisarCSV(alvo);
}

function analisarCSV(caminho) {
  const bruto = readFileSync(caminho);
  console.log(`\nanalisando ${caminho}  (${(bruto.length / 1024).toFixed(0)} kB)\n`);

  // Latin-1 lido como UTF-8 produz U+FFFD.
  const comoUtf8 = bruto.toString("utf8");
  const comoLatin = bruto.toString("latin1");
  const lixoUtf8 = (comoUtf8.match(/�/g) ?? []).length;
  const bom = bruto[0] === 0xef && bruto[1] === 0xbb && bruto[2] === 0xbf;
  const texto = lixoUtf8 > 0 ? comoLatin : comoUtf8;
  console.log(`  codificacao: ${lixoUtf8 > 0 ? "LATIN-1 (utf8 produziu " + lixoUtf8 + " caracteres invalidos)" : "UTF-8"}${bom ? " com BOM" : ""}`);

  const linhas = texto.split(/\r?\n/);

  // ---- separador ---------------------------------------------------------
  const cabecalhoProvavel = linhas.find((l) => /;|,/.test(l) && l.length > 40) ?? "";
  const sep = (cabecalhoProvavel.match(/;/g)?.length ?? 0) >= (cabecalhoProvavel.match(/,/g)?.length ?? 0) ? ";" : ",";
  console.log(`  separador:   "${sep}"`);

  // ---- decimal -----------------------------------------------------------
  // Vírgula decimal com separador ponto-e-vírgula é o padrão brasileiro, e
  // `parseFloat("21,4")` devolve 21 sem erro nenhum. Silencioso e errado.
  const amostraNum = texto.match(/(?:^|;)(-?\d+,\d+)(?:;|$)/m);
  console.log(`  decimal:     ${amostraNum ? "VIRGULA (ex. " + amostraNum[1] + ") — parseFloat trunca sem avisar" : "ponto (ou nao achei numero fracionario)"}`);

  // ---- bloco de metadados no topo ----------------------------------------
  const ehLinhaDeDado = (l) => /^\s*\d{4}[-/]\d{2}[-/]\d{2}/.test(l) || /^\s*\d{2}[-/]\d{2}[-/]\d{4}/.test(l);
  const iPrimeiroDado = linhas.findIndex(ehLinhaDeDado);
  const iCab = iPrimeiroDado > 0 ? iPrimeiroDado - 1 : -1;
  if (iCab < 0) {
    console.log("  NÃO ACHEI linha de dado começando com data — o formato mudou, ou o arquivo não é do INMET.");
    console.log("  primeiras linhas, cruas:");
    for (const l of linhas.slice(0, 12)) console.log("    " + l.slice(0, 120));
    return;
  }
  console.log(`  cabecalho na linha ${iCab + 1}; ${iCab} linha(s) de metadados antes`);
  console.log(`  primeira linha de dado: ${iPrimeiroDado + 1}\n`);
  console.log("  --- metadados ---");
  for (const l of linhas.slice(0, Math.max(0, iCab))) if (l.trim()) console.log("    " + l.slice(0, 110));

  console.log("\n  --- colunas ---");
  const cols = (linhas[iCab] ?? "").split(sep);
  cols.forEach((c, i) => console.log(`    ${String(i).padStart(2)} ${c.trim().slice(0, 90)}`));

  console.log("\n  --- primeiras linhas de dado ---");
  for (const l of linhas.slice(iCab + 1, iCab + 4)) console.log("    " + l.slice(0, 130));

  // ---- sentinelas de ausência -------------------------------------------
  console.log("\n  --- como o arquivo diz 'sem medida' ---");
  const corpo = linhas.slice(iCab + 1).join("\n");
  for (const [rotulo, re] of [
    ["-9999", /(?:^|;)-9999(?:[,.]\d+)?(?:;|$)/gm],
    ["-999",  /(?:^|;)-999(?:[,.]\d+)?(?:;|$)/gm],
    ["campo vazio", /;;/g],
    ["null/NA", /(?:^|;)\s*(null|NA|N\/A)\s*(?:;|$)/gim],
  ]) {
    const q = (corpo.match(re) ?? []).length;
    console.log(`    ${rotulo.padEnd(12)} ${q ? q + " ocorrencia(s)" : "nao aparece"}`);
  }
  console.log(`\n    total de linhas de dado: ${linhas.length - iCab - 1}\n`);
}

// ---------------------------------------------------------------------------
// diagnóstico de alcance
// ---------------------------------------------------------------------------
function cadeia(e) {
  const fora = [];
  for (let c = e; c && fora.length < 6; c = c.cause) {
    fora.push({ nome: c.name, msg: c.message, code: c.code, errno: c.errno,
      syscall: c.syscall, address: c.address, port: c.port });
  }
  return fora;
}
const codigoDe = (e) => cadeia(e).map((c) => c.code).filter(Boolean).join(" < ") || "sem código";

async function camadaDNS(host) {
  const r = { host, v4: null, v6: null, erro: null };
  try { r.v4 = (await dns.resolve4(host)).slice(0, 3); } catch (e) { r.v4 = `erro ${e.code}`; }
  try { r.v6 = (await dns.resolve6(host)).slice(0, 2); } catch (e) { r.v6 = `erro ${e.code}`; }
  if (typeof r.v4 === "string" && typeof r.v6 === "string") r.erro = "o nome não resolve";
  return r;
}

const socket = (fabrica) => new Promise((ok) => {
  const t0 = Date.now();
  const s = fabrica();
  const fim = (res) => { s.destroy(); ok({ ...res, ms: Date.now() - t0 }); };
  s.setTimeout(LIMITE);
  s.on("timeout", () => fim({ ok: false, code: "TIMEOUT" }));
  s.on("error", (e) => fim({ ok: false, code: e.code ?? String(e) }));
  s.on("connect", () => { if (!(s instanceof tls.TLSSocket)) fim({ ok: true }); });
  s.on("secureConnect", () => fim({
    ok: true, autorizado: s.authorized,
    // Um proxy que intercepta TLS aparece aqui: o emissor não é o esperado.
    emissor: s.getPeerCertificate()?.issuer?.O ?? null,
    motivo: s.authorizationError ?? null,
  }));
});

async function alcance(host) {
  process.stdout.write(`  ${host.padEnd(32)}`);
  const d = await camadaDNS(host);
  const t = d.erro ? { ok: false, code: "sem DNS" } : await socket(() => net.connect({ host, port: 443 }));
  const l = t.ok ? await socket(() => tls.connect({ host, port: 443, servername: host })) : { ok: false, code: "sem TCP" };
  console.log(
    ` dns=${d.erro ? "NÃO" : "ok"}  tcp=${t.ok ? `ok ${t.ms}ms` : t.code}` +
    `  tls=${l.ok ? `ok ${l.ms}ms` : l.code}` + (l.ok && l.emissor ? `  emissor=${l.emissor}` : "")
  );

  // ---- DNS resolve, TCP não: separar rota de família de endereço ----------
  if (!d.erro && !t.ok && Array.isArray(d.v4) && d.v4.length) {
    const p4 = await socket(() => net.connect({ host, port: 443, family: 4 }));
    const p6 = Array.isArray(d.v6) && d.v6.length
      ? await socket(() => net.connect({ host, port: 443, family: 6 }))
      : { ok: false, code: "sem AAAA" };
    console.log(`  ${" ".repeat(30)} └ só IPv4: ${p4.ok ? `ok ${p4.ms}ms` : p4.code}` +
                `   só IPv6: ${p6.ok ? `ok ${p6.ms}ms` : p6.code}`);
    if (p4.ok) console.log(`  ${" ".repeat(30)}   → é IPv6 quebrado do lado de cá, não bloqueio do host`);
    else console.log(`  ${" ".repeat(30)}   → o host não responde por nenhuma família: filtrado ou fora do ar`);
    return { host, dns: d, tcp: t, tls: l, soV4: p4, soV6: p6 };
  }
  return { host, dns: d, tcp: t, tls: l };
}

// ---------------------------------------------------------------------------
async function medir(nome, url, { texto = false, metodo = "GET", inteiro = false } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: { "User-Agent": "ObservEarth/medicao" },
      signal: AbortSignal.timeout(LIMITE),
    });
    const corpo = metodo === "HEAD" ? "" : await r.text();
    const ms = Date.now() - t0;
    const tam = metodo === "HEAD" ? Number(r.headers.get("content-length") ?? 0) : corpo.length;
    let json = null;
    if (!texto && corpo) { try { json = JSON.parse(corpo); } catch { /* não era JSON */ } }
    console.log(
      `  ${r.ok ? "ok " : "ERR"} ${nome.padEnd(36)} http=${r.status} ` +
      `${(tam / 1048576).toFixed(2).padStart(8)} MB  ${String(ms).padStart(6)} ms`
    );
    return { nome, url, ok: r.ok, status: r.status, ms, bytes: tam,
      tipo: r.headers.get("content-type"), json,
      corpo: json ? null : (inteiro ? corpo : corpo.slice(0, 1200)) };
  } catch (e) {
    console.log(`  ERR ${nome.padEnd(36)} ${codigoDe(e)}`);
    return { nome, url, ok: false, causas: cadeia(e), ms: Date.now() - t0 };
  }
}

// ---------------------------------------------------------------------------
const rel = {
  medidoEm: new Date().toISOString(),
  node: process.version,
  plataforma: `${process.platform} ${process.arch}`,
  proxy: {
    HTTP_PROXY: process.env.HTTP_PROXY ?? process.env.http_proxy ?? null,
    HTTPS_PROXY: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null,
    NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? null,
  },
  alcance: [], provas: [],
};

console.log(`\nnode ${process.version} · ${process.platform}`);
if (rel.proxy.HTTPS_PROXY || rel.proxy.HTTP_PROXY) {
  console.log(`\n  ATENÇÃO: há proxy no ambiente (${rel.proxy.HTTPS_PROXY ?? rel.proxy.HTTP_PROXY}).`);
  console.log("  O fetch do Node NÃO usa proxy por padrão — isto sozinho explica a falha.");
}

console.log("\nalcance (dns / tcp / tls)\n");
for (const h of [CRW, "portal.inmet.gov.br"]) rel.alcance.push(await alcance(h));
console.log("  --- controles: hosts que o ObservEarth já usa ---");
for (const h of ["nomads.ncep.noaa.gov", "www.cpc.ncep.noaa.gov", "api.open-meteo.com"]) {
  rel.alcance.push(await alcance(h));
}

console.log("  --- espelhos do mesmo dado (candidatos, não verificados) ---");
for (const h of ["pae-paha.pacioos.hawaii.edu", "oceanwatch.pifsc.noaa.gov", "erddap.aoml.noaa.gov"]) {
  rel.alcance.push(await alcance(h));
}

const vivo = (h) => rel.alcance.find((a) => a.host === h)?.tls?.ok;

// ---------------------------------------------------------------------------
// INMET — o M1
// ---------------------------------------------------------------------------
if (!vivo("portal.inmet.gov.br")) {
  console.log("\n  INMET fora de alcance nesta máquina. Pulando.\n");
} else {
  console.log("\nINMET · dados históricos (M1)\n");
  console.log("  As URLs abaixo são CANDIDATAS: o padrão dos ZIPs anuais nunca foi");
  console.log("  verificado por este projeto. Um 404 aqui é medição, não falha.\n");
  for (const ano of [2024, 2020, 2010, 2000]) {
    rel.provas.push(await medir(
      `ZIP anual ${ano} (HEAD)`,
      `https://portal.inmet.gov.br/uploads/dadoshistoricos/${ano}.zip`,
      { metodo: "HEAD" }
    ));
  }
  const bons = rel.provas.filter((p) => p.ok && p.bytes > 0);
  if (bons.length) {
    const media = bons.reduce((a, p) => a + p.bytes, 0) / bons.length;
    console.log(`\n  média por ano: ${(media / 1048576).toFixed(0)} MB`);
    console.log(`  25 anos (2000-2024): ~${(media * 25 / 1073741824).toFixed(1)} GB`);
    console.log(`  10 anos (2015-2024): ~${(media * 10 / 1073741824).toFixed(1)} GB`);
    console.log("\n  Extraia UM ano e rode:  node tools/medir-fontes.mjs caminho/para/um.CSV");
  }
}

// ---------------------------------------------------------------------------
// OPEN-METEO ARCHIVE — a elevação da célula, para o M4
// ---------------------------------------------------------------------------

if (!vivo("api.open-meteo.com")) {
  console.log("\n  Open-Meteo fora de alcance. Pulando a sondagem de elevação.\n");
} else {
  console.log("\nOpen-Meteo Archive · a elevação da célula (M4)\n");

  const p = await medir("um dia em Brasília (forma da resposta)",
    "https://archive-api.open-meteo.com/v1/archive" +
    "?latitude=-15.789&longitude=-47.926&start_date=2024-01-01&end_date=2024-01-01" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=UTC");
  rel.provas.push(p);
  const j = p.json;
  if (j) {
    const campos = Object.keys(j).filter((k) => typeof j[k] !== "object");
    console.log(`      campos escalares: ${campos.join(", ")}`);
    console.log(`      elevation: ${j.elevation ?? "AUSENTE"}` +
      (j.elevation != null
        ? `  ·  estação A001 declara 1160,96 m  ->  delta = ${(1160.96 - j.elevation).toFixed(1)} m`
        : "  ->  sem isto o M4 não separa viés de relevo; achar outra fonte de orografia"));
    console.log(`      diárias devolvidas: ${Object.keys(j.daily ?? {}).join(", ")}`);
    rel.elevacaoModelo = j.elevation ?? null;
  }


  console.log("\n  a elevação é da célula ou do ponto? (relevo forte decide)\n");
  const dia = "&start_date=2024-01-01&end_date=2024-01-01&daily=temperature_2m_max&timezone=UTC";
  const pontos = [
    ["Cubatão (~10 m)", -23.89, -46.42],
    ["Paranapiacaba (~800 m)", -23.78, -46.30],
  ];
  const vistos = [];
  for (const [nome, la, lo] of pontos) {
    const q = await medir(`  ${nome}`,
      `https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}${dia}`);
    rel.provas.push(q);
    const t = q.json?.daily?.temperature_2m_max?.[0] ?? null;
    console.log(`        elevation=${q.json?.elevation ?? "?"}  tmax=${t}`);
    vistos.push({ nome, elevation: q.json?.elevation ?? null, tmax: t });
  }
  if (vistos.every((v) => v.elevation != null)) {
    const d = Math.abs(vistos[0].elevation - vistos[1].elevation);
    console.log(`\n        diferença entre os dois: ${d.toFixed(0)} m`);
    console.log(d > 200
      ? "        -> É A ALTITUDE DO PONTO (DEM fino). A Open-Meteo já rebaixa por\n" +
        "           altitude, e o M4 precisa da orografia do modelo por outro caminho."
      : "        -> é a média da célula: o M4 pode usar `elevation` como planejado.");
    rel.elevacaoEhDoPonto = d > 200;
  }


  const cru = await medir("  Cubatão com elevation=nan (valor bruto?)",
    `https://archive-api.open-meteo.com/v1/archive?latitude=-23.89&longitude=-46.42${dia}&elevation=nan`);
  rel.provas.push(cru);
  if (cru.json) {
    console.log(`        elevation=${cru.json.elevation ?? "?"}  ` +
      `tmax=${cru.json.daily?.temperature_2m_max?.[0] ?? "?"}`);
    console.log(cru.ok
      ? "        -> compare com o Cubatão de cima: se mudou, dá para pedir o bruto."
      : "        -> o parâmetro não é aceito nesta rota.");
  } else if (cru.corpo) {
    console.log(`        resposta: ${cru.corpo.slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// ERDDAP — a camada de TSM
// ---------------------------------------------------------------------------

const ERDDAPS = rel.alcance.filter((a) => /erddap|pacioos|oceanwatch|coastwatch/i.test(a.host));

async function procurarDataset(host) {
  const url = `https://${host}/erddap/search/index.json` +
    `?searchFor=CoralTemp&page=1&itemsPerPage=20`;
  const p = await medir(`busca em ${host}`, url);
  rel.provas.push(p);
  const t = p.json?.table;
  if (!t?.rows?.length) return [];
  const iId = t.columnNames.indexOf("Dataset ID");
  const iTit = t.columnNames.indexOf("Title");
  return t.rows.map((r) => ({ id: r[iId], titulo: String(r[iTit] ?? "").slice(0, 70) }))
               .filter((d) => d.id);
}

let alvoErddap = null;
/** o que cada dataset visto oferece — para o plano B, se nenhum tiver os dois */
const parciais = [];

console.log("\nERDDAP · procurando o CoralTemp num espelho que responda\n");
for (const a of ERDDAPS) {
  if (!a.tls?.ok) { console.log(`  --  ${a.host} fora de alcance`); continue; }
  const achados = await procurarDataset(a.host);
  for (const d of achados) console.log(`        ${d.id.padEnd(28)} ${d.titulo}`);

  const util = achados.filter((d) =>
    !/^ZZZ|DEPRECATED/i.test(d.titulo) &&
    !/-clim$|_monthly$|_8day$|lon360$/i.test(d.id));

  // O dataset que serve é o que tem as variáveis que a camada usa.
  for (const d of util) {
    const base = `https://${a.host}/erddap/griddap/${d.id}`;
    // `inteiro`: as variáveis moram no fim do .das. Ver o comentário em medir().
    const das = await medir(`  .das de ${d.id}`, `${base}.das`, { texto: true, inteiro: true });
    rel.provas.push({ ...das, corpo: das.corpo?.slice(0, 400) ?? null });
    const temAnom = /CRW_SSTANOMALY|sst_anomaly|SSTANOMALY/i.test(das.corpo ?? "");
    const temDhw = /CRW_DHW|degree.heating/i.test(das.corpo ?? "");
    console.log(`        anomalia=${temAnom ? "sim" : "não"}  DHW=${temDhw ? "sim" : "não"}`);
    if (das.ok && (temAnom || temDhw)) parciais.push({ host: a.host, id: d.id, temAnom, temDhw });
    if (das.ok && temAnom && temDhw) {
      const fim = /time_coverage_end "([^"]+)"/.exec(das.corpo ?? "")?.[1] ?? null;
      alvoErddap = { host: a.host, id: d.id, base, fim };
      console.log(`\n  ESCOLHIDO: ${d.id} em ${a.host}`);
      if (fim) {
        const h = Math.round(((Date.now() - Date.parse(fim)) / 3600e3) * 10) / 10;
        console.log(`  dia mais recente: ${fim}  (${h} h atrás)`);
      }
      break;
    }
  }
  if (alvoErddap) break;
}

if (!alvoErddap) {
  console.log("\n  Nenhum espelho alcançável tem anomalia de TSM E DHW no MESMO dataset.");
  
  // PLANO B: separados no mesmo host servem.
  const porHost = new Map();
  for (const p of parciais) {
    const h = porHost.get(p.host) ?? { anom: null, dhw: null };
    if (p.temAnom && !h.anom) h.anom = p.id;
    if (p.temDhw && !h.dhw) h.dhw = p.id;
    porHost.set(p.host, h);
  }
  const par = [...porHost].find(([, h]) => h.anom && h.dhw);
  if (par) {
    console.log(`\n  Mas em ${par[0]} elas existem SEPARADAS:`);
    console.log(`    anomalia: ${par[1].anom}`);
    console.log(`    DHW:      ${par[1].dhw}`);
    console.log("  Serve — custa uma requisição a mais por ponto, e é a mesma grade.");
    rel.erddapSeparados = { host: par[0], ...par[1] };
  } else {
    console.log("  Nada foi escrito com base em palpite — a camada segue parada.");
  }
  console.log("");
} else {
  rel.erddapEscolhido = alvoErddap;
  const B = alvoErddap.base;
  console.log("");
  // Abrolhos: o banco de corais mais importante do Atlântico Sul.
  const mar = "[(-18.1):(-17.9)][(-38.8):(-38.6)]";
  rel.provas.push(await medir("[last] sobre Abrolhos (oceano)", `${B}.json?CRW_DHW[last]${mar}`));
  rel.provas.push(await medir("tres variaveis numa requisicao",
    `${B}.json?CRW_SSTANOMALY[last]${mar},CRW_DHW[last]${mar},CRW_BAA[last]${mar}`));

  rel.provas.push(await medir("sobre terra (valor de preenchimento)",
    `${B}.json?CRW_SSTANOMALY[last][(-15.1):(-15.0)][(-50.1):(-50.0)]`));

  for (const s of [20, 10]) {
    rel.provas.push(await medir(`grade global stride ${s}`,
      `${B}.json?CRW_SSTANOMALY[last][(-89):${s}:(89)][(-179):${s}:(179)]`));
  }
  rel.provas.push(await medir("data inexistente (forma do erro)",
    `${B}.json?CRW_DHW[(2030-01-01T12:00:00Z)]${mar}`));

  console.log("\n  resumo\n");
  for (const [rotulo, p] of [
    ["oceano", rel.provas.find((x) => x.nome.includes("Abrolhos"))],
    ["terra ", rel.provas.find((x) => x.nome.includes("terra"))],
  ]) {
    const linhas = p?.json?.table?.rows;
    if (!linhas?.length) { console.log(`    ${rotulo}: sem linhas`); continue; }
    const valores = linhas.map((l) => l[l.length - 1]);
    console.log(`    ${rotulo}: colunas ${JSON.stringify(p.json.table.columnNames)}`);
    console.log(`            ${linhas.length} linhas, valores ${JSON.stringify(valores.slice(0, 6))}`);
    console.log(
      `            -327.68 presente: ${valores.some((v) => typeof v === "number" && Math.abs(v + 327.68) < 1e-6)}` +
      `   null presente: ${valores.some((v) => v === null)}`
    );
  }
}

mkdirSync(AQUI, { recursive: true });
const saida = join(AQUI, "medicao-fontes.json");
writeFileSync(saida, JSON.stringify(rel, null, 2));
console.log(`\n  relatorio em ${saida}\n`);
