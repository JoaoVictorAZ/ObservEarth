import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(HERE, "..", "data");

/**
 * O CAMINHO DO BANCO É LIDO NA ABERTURA, NÃO NA IMPORTAÇÃO.
 *
 * Ele já foi uma constante de módulo, e isso era uma armadilha de ORDEM DE
 * IMPORTAÇÃO: em ESM os imports são avaliados antes de qualquer linha do
 * módulo que importa, então um teste que faz
 *
 *     import { closeStore } from "../server/store.js";
 *     process.env.DB_PATH = "/tmp/teste.db";        // tarde demais
 *
 * ficava com o caminho de PRODUÇÃO gravado na constante. O teste então lia o
 * `data/observatorio.db` de verdade, encontrava respostas em cache de uma
 * sessão anterior do servidor, e as rotas devolviam sem nunca tocar a rede —
 * fazendo cair justamente as verificações que conferem a URL requisitada.
 *
 * Isso aconteceu. O sintoma foi três falhas em `test/rotas-analise.mjs` logo
 * depois de acrescentar aquele import, e nada no erro apontava para banco.
 *
 * `test/rotas-analise.mjs` já documenta que um teste que depende do que ficou
 * da última execução não mede o código, mede a ordem em que se rodou. Ler o
 * ambiente na abertura é o que torna essa promessa cumprível.
 */
let db = null;
/** o caminho efetivamente aberto, para `/api/store` relatar a verdade */
let caminhoAberto = null;

export function openStore() {
  if (db) return db;
  const caminho = process.env.DB_PATH || join(DB_DIR, "observatorio.db");
  caminhoAberto = caminho;
  // Só cria o diretório do projeto quando é ele que vai ser usado: com
  // DB_PATH apontando para o temporário, criar `data/` seria efeito colateral.
  if (!process.env.DB_PATH) mkdirSync(DB_DIR, { recursive: true });
  db = new DatabaseSync(caminho);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = NORMAL;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      provider TEXT NOT NULL,
      day      TEXT NOT NULL,
      used     INTEGER NOT NULL DEFAULT 0,
      denied   INTEGER NOT NULL DEFAULT 0,
      last_at  TEXT,
      PRIMARY KEY (provider, day)
    );

    CREATE TABLE IF NOT EXISTS cache (
      key      TEXT PRIMARY KEY,
      payload  TEXT NOT NULL,
      at       INTEGER NOT NULL,
      ttl      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cache_at ON cache(at);

    -- arquivo cientifico: a resposta como veio, para reproduzir figura depois
    CREATE TABLE IF NOT EXISTS archive (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      key         TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      provider    TEXT,
      payload     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS archive_kind_time ON archive(kind, captured_at);
    CREATE UNIQUE INDEX IF NOT EXISTS archive_unique ON archive(kind, key, captured_at);
  `);
  return db;
}

// ------------------------------------------------------------------ orcamento
export function loadUsage(provider, day) {
  const row = openStore()
    .prepare(`SELECT used, denied, last_at FROM api_usage WHERE provider=? AND day=?`)
    .get(provider, day);
  return row ? { used: row.used, denied: row.denied, lastAt: row.last_at } : null;
}

export function saveUsage(provider, day, used, denied, lastAt) {
  openStore()
    .prepare(
      `INSERT INTO api_usage (provider, day, used, denied, last_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, day) DO UPDATE SET
         used = excluded.used, denied = excluded.denied, last_at = excluded.last_at`
    )
    .run(provider, day, used, denied, lastAt ?? null);
}

// ---------------------------------------------------------------------- cache
export function cacheGet(key) {
  const row = openStore().prepare(`SELECT payload, at, ttl FROM cache WHERE key=?`).get(key);
  if (!row) return null;
  if (Date.now() - row.at > row.ttl) {
    openStore().prepare(`DELETE FROM cache WHERE key=?`).run(key);
    return null;
  }
  try { return JSON.parse(row.payload); } catch { return null; }
}

const MAX_PAYLOAD = 4_000_000;
const MAX_ARCHIVE = 8_000_000;

/**
 * Estimativa BARATA do tamanho serializado, ANTES de serializar.
 *
 * `JSON.stringify` de uma fatia de vento produz uma string de ~18 MB que e
 * descartada em seguida por exceder o limite. Com o reprodutor pedindo a janela
 * inteira, viram dezenas de strings gigantes por minuto, alocadas so para
 * serem jogadas fora. Foi boa parte da pressao de coleta de lixo que derrubou
 * o processo — `Mark-Compact ... 1924 ms` no log, com 4 GB de heap.
 *
 * Um numero em JSON ocupa ~8 caracteres contando o separador. Somar o
 * comprimento dos vetores basta para saber, sem alocar NADA, que nao vai caber.
 */
function tooBig(v, limite) {
  if (!v || typeof v !== "object") return false;
  let n = 0;
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (Array.isArray(x) || ArrayBuffer.isView(x)) n += x.length;
  }
  return n * 8 > limite;
}

export function cacheSet(key, value, ttl) {
  if (value == null || Buffer.isBuffer(value)) return;
  if (tooBig(value, MAX_PAYLOAD)) return;         // recusa sem serializar
  let payload;
  try { payload = JSON.stringify(value); } catch { return; }
  if (payload.length > MAX_PAYLOAD) return;
  openStore()
    .prepare(
      `INSERT INTO cache (key, payload, at, ttl) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, at=excluded.at, ttl=excluded.ttl`
    )
    .run(key, payload, Date.now(), ttl);
}

export function cacheDropStale(prefix, keepPrefix) {
  const r = openStore()
    .prepare(`DELETE FROM cache WHERE key LIKE ? AND key NOT LIKE ?`)
    .run(`${prefix}%`, `${keepPrefix}%`);
  return r.changes ?? 0;
}

export function cachePrune() {
  const now = Date.now();
  const r = openStore().prepare(`DELETE FROM cache WHERE ? - at > ttl`).run(now);
  return r.changes ?? 0;
}

export function archive(kind, key, payload, provider = null) {
  // mesmo motivo do cacheSet: nao construir a string para depois recusá-la
  if (tooBig(payload, MAX_ARCHIVE)) return false;
  let text;
  try { text = JSON.stringify(payload); } catch { return false; }
  if (text.length > MAX_ARCHIVE) return false;
  try {
    openStore()
      .prepare(
        `INSERT OR IGNORE INTO archive (kind, key, captured_at, provider, payload)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(kind, key, new Date().toISOString(), provider, text);
    return true;
  } catch { return false; }
}

export function archiveStats() {
  const rows = openStore()
    .prepare(
      `SELECT kind, COUNT(*) AS n, MIN(captured_at) AS first, MAX(captured_at) AS last
       FROM archive GROUP BY kind ORDER BY n DESC`
    )
    .all();
  const size = openStore()
    .prepare(`SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()`)
    .get();
  const cacheRows = openStore().prepare(`SELECT COUNT(*) AS n FROM cache`).get();
  return {
    path: caminhoAberto,
    bytes: size?.bytes ?? 0,
    cacheEntries: cacheRows?.n ?? 0,
    kinds: rows,
  };
}

export function closeStore() {
  try { db?.close(); } catch {  }
  caminhoAberto = null;
  db = null;
}
