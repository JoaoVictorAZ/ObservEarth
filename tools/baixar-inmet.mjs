import { createWriteStream, createReadStream, existsSync, mkdirSync,
         readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { execFileSync } from "node:child_process";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const BRONZE = join(RAIZ, "data", "bronze");

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const tem = (nome) => process.argv.includes(nome);

const DE = Number(arg("--de", 2010));
const ATE = Number(arg("--ate", 2024));
const GZ = tem("--gz");
const SO_BAIXAR = tem("--so-baixar");

const mb = (b) => (b / 1048576).toFixed(1);
const gb = (b) => (b / 1073741824).toFixed(2);

/** Baixa o ZIP do ano. Devolve o caminho, ou null se falhou. */
async function baixarAno(ano) {
  const alvo = join(BRONZE, `${ano}.zip`);
  if (existsSync(alvo)) {
    console.log(`  ${ano}  ZIP já existe (${mb(statSync(alvo).size)} MB)`);
    return alvo;
  }
  const url = `https://portal.inmet.gov.br/uploads/dadoshistoricos/${ano}.zip`;
  // Arquivo temporário: só vira o definitivo quando o download fecha. Ver a
  // nota sobre retomada no cabeçalho.
  const parcial = alvo + ".parcial";
  const t0 = Date.now();
  process.stdout.write(`  ${ano}  baixando…`);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "ObservEarth/carga" } });
    if (!r.ok) { console.log(` HTTP ${r.status} — pulando`); return null; }
    await pipeline(Readable.fromWeb(r.body), createWriteStream(parcial));
    renameSync(parcial, alvo);
    const s = statSync(alvo).size;
    console.log(` ${mb(s)} MB em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return alvo;
  } catch (e) {
    console.log(` falhou: ${e.message}`);
    try { rmSync(parcial, { force: true }); } catch { /* já não existe */ }
    return null;
  }
}

/** Extrai todos os CSVs do ZIP para data/bronze/{ano}/. */
function extrairAno(ano, zip) {
  const dir = join(BRONZE, String(ano));
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    console.log(`  ${ano}  já extraído (${readdirSync(dir).length} arquivos)`);
    return dir;
  }
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  process.stdout.write(`  ${ano}  extraindo…`);
  try {
    if (process.platform === "win32") {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(zip)})
        $n=0
        foreach($e in $z.Entries){
          if($e.Name -match '\\.CSV$'){
            $d=Join-Path ${JSON.stringify(dir)} $e.Name
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$d,$true)
            $n++
          }
        }
        $z.Dispose()
        Write-Output $n`;
      const n = execFileSync("powershell", ["-NoProfile", "-Command", ps],
                             { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
      console.log(` ${n} CSVs em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } else {
      execFileSync("unzip", ["-o", "-j", "-q", zip, "*.CSV", "-d", dir],
                   { maxBuffer: 1 << 26 });
      console.log(` ${readdirSync(dir).length} CSVs em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    return dir;
  } catch (e) {
    console.log(` falhou: ${e.message.split("\n")[0]}`);
    return null;
  }
}

/** Comprime cada CSV em .csv.gz e apaga o original. */
async function comprimir(dir) {
  const arquivos = readdirSync(dir).filter((f) => /\.CSV$/i.test(f));
  if (!arquivos.length) return;
  const t0 = Date.now();
  process.stdout.write(`        comprimindo ${arquivos.length}…`);
  let antes = 0, depois = 0;
  for (const f of arquivos) {
    const src = join(dir, f);
    antes += statSync(src).size;
    await pipeline(createReadStream(src), createGzip({ level: 6 }),
                   createWriteStream(src + ".gz"));
    depois += statSync(src + ".gz").size;
    rmSync(src);
  }
  console.log(` ${mb(antes)} → ${mb(depois)} MB em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ---------------------------------------------------------------------------
const anos = [];
for (let a = DE; a <= ATE; a++) anos.push(a);

console.log(`\ncarga do INMET · ${DE} a ${ATE} (${anos.length} anos)`);
console.log(`destino: ${BRONZE}`);
// A estimativa vem da medição de 08/09/2026: 98 MB por ZIP, ~448 MB abertos.
console.log(`\nestimativa: ~${gb(anos.length * 98 * 1048576)} GB em ZIP` +
  (SO_BAIXAR ? "" : GZ ? ` + ~${gb(anos.length * 100 * 1048576)} GB comprimido`
                      : ` + ~${gb(anos.length * 448 * 1048576)} GB extraído`));
if (!GZ && !SO_BAIXAR && anos.length > 3) {
  console.log("\n  Dica: `--gz` guarda ~4,5× menos disco, e o Silver lê os dois formatos.");
}
console.log("");

mkdirSync(BRONZE, { recursive: true });
let ok = 0;
for (const ano of anos) {
  const zip = await baixarAno(ano);
  if (!zip || SO_BAIXAR) { if (zip) ok++; continue; }
  const dir = extrairAno(ano, zip);
  if (!dir) continue;
  if (GZ) await comprimir(dir);
  ok++;
}

console.log(`\n  ${ok} de ${anos.length} anos prontos em ${BRONZE}\n`);
if (ok) {
  console.log("  próximo passo:");
  console.log(`    python pipeline/silver_inmet.py --entrada 'data/bronze/*/*.CSV${GZ ? ".gz" : ""}' --saida data/silver\n`);
}
