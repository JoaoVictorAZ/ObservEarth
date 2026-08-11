// server/keys.js
// -----------------------------------------------------------------------------
// INVENTARIO DE CHAVES.
//
// Existe por causa de uma confusao legitima: preencher o `.env` nao faz nada
// sozinho. A variavel so tem efeito se alguma rota a consumir. Sem este relatorio
// o usuario preenche o arquivo, reinicia, nada muda, e nao ha como saber se o
// problema foi o arquivo, o nome da variavel ou a integracao nao existir.
//
// No boot imprimimos exatamente tres estados por chave:
//   [ok]      definida E consumida por alguma rota
//   [--]      nao definida, e a integracao que depende dela fica desligada
//   [nao usada] definida no .env, mas NENHUM codigo le  -> nao adianta preencher
// -----------------------------------------------------------------------------

/** chaves que o codigo REALMENTE consome hoje */
const CONSUMED = {
  FIRMS_MAP_KEY: "focos de incêndio (NASA FIRMS) — /api/fires",
  PORT: "porta do servidor",
};

/** chaves declaradas no .env.example para fases futuras, ainda sem consumidor */
const RESERVED = {
  EARTHDATA_TOKEN: "download de granules DAAC — Fase 3",
  EARTHDATA_USER: "alternativa a token em bibliotecas antigas",
  EARTHDATA_PASS: "alternativa a token em bibliotecas antigas",
  CDS_API_KEY: "ERA5 para treino do modelo — Fase 3",
  CDS_API_URL: "endpoint do novo CDS",
  METEOSTAT_KEY: "séries de estação (opcional)",
};

export function has(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function get(name) {
  return has(name) ? process.env[name].trim() : null;
}

export function reportKeys() {
  const lines = [];
  lines.push("  chaves detectadas no ambiente:");

  for (const [k, what] of Object.entries(CONSUMED)) {
    if (k === "PORT") continue;
    lines.push(has(k) ? `    [ok] ${k} — ${what}` : `    [--] ${k} — ${what} (desligado)`);
  }

  const idle = Object.keys(RESERVED).filter(has);
  if (idle.length) {
    lines.push("  definidas mas ainda SEM consumidor no código (preencher não tem efeito):");
    for (const k of idle) lines.push(`    [não usada] ${k} — ${RESERVED[k]}`);
  }

  const anyConsumed = Object.keys(CONSUMED).some((k) => k !== "PORT" && has(k));
  if (!anyConsumed && !idle.length) {
    lines.push("    nenhuma. Tudo que a plataforma usa hoje é aberto e sem chave.");
  }
  return lines.join("\n");
}

export function keysStatus() {
  return {
    consumed: Object.fromEntries(
      Object.entries(CONSUMED)
        .filter(([k]) => k !== "PORT")
        .map(([k, what]) => [k, { present: has(k), purpose: what, wired: true }])
    ),
    reserved: Object.fromEntries(
      Object.entries(RESERVED).map(([k, what]) => [k, { present: has(k), purpose: what, wired: false }])
    ),
  };
}
