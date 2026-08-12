// server/gribIndex.js
// -----------------------------------------------------------------------------
// Leitura de índices .idx GRIB2 e download parcial via HTTP Range requests.
// -----------------------------------------------------------------------------

/**
 * Interpreta o texto de um `.idx`.
 *
 * O fim de cada mensagem é o começo da seguinte. A última fica em aberto —
 * `fim: null` — porque o índice não diz o tamanho do arquivo, e inventar um
 * limite aqui truncaria a última mensagem.
 */
export function parseIdx(texto) {
  const regs = [];
  for (const linha of String(texto).split("\n")) {
    const l = linha.trim();
    if (!l) continue;
    // O nível pode conter ':'? Não no formato do wgrib2 — os separadores são
    // fixos —, mas o campo final costuma vir vazio, gerando um ':' terminal.
    const p = l.split(":");
    if (p.length < 6) continue;
    const n = Number(p[0]), inicio = Number(p[1]);
    if (!Number.isFinite(n) || !Number.isFinite(inicio)) continue;
    regs.push({
      n,
      inicio,
      fim: null,
      data: p[2],                    // d=YYYYMMDDHH
      campo: p[3],                   // UGRD, VGRD, PRMSL...
      nivel: p[4],                   // "10 m above ground"
      tipo: p[5],                    // "anl", "3 hour fcst"
    });
  }

  regs.sort((a, b) => a.inicio - b.inicio);
  for (let i = 0; i < regs.length - 1; i++) regs[i].fim = regs[i + 1].inicio - 1;
  return regs;
}

/**
 * Acha as mensagens pedidas.
 *
 * `alvos` é uma lista de `{ campo, nivel }`. A comparação de nível é EXATA:
 * "10 m above ground" não pode casar com "100 m above ground", e um casamento
 * por prefixo faria exatamente isso.
 */
export function acharRegistros(regs, alvos) {
  const achados = [];
  for (const a of alvos) {
    const r = regs.find((x) => x.campo === a.campo && x.nivel === a.nivel);
    if (r) achados.push(r);
  }
  return achados;
}

/**
 * Junta registros vizinhos numa faixa só.
 *
 * UGRD e VGRD a 10 m são quase sempre consecutivos no arquivo. Uma faixa
 * contígua os cobre com UMA requisição em vez de duas — o que importa porque o
 * orçamento do projeto é um quarto do limite gratuito.
 *
 * O `fim: null` (última mensagem do arquivo) propaga: uma faixa aberta continua
 * aberta ao ser fundida, senão o corte truncaria a mensagem final.
 */
export function fundirFaixas(regs) {
  if (!regs.length) return [];
  const ord = [...regs].sort((a, b) => a.inicio - b.inicio);
  const out = [{ inicio: ord[0].inicio, fim: ord[0].fim }];
  for (let i = 1; i < ord.length; i++) {
    const ult = out[out.length - 1];
    // Contíguo (ou já aberto): estende em vez de abrir outra faixa.
    if (ult.fim == null || ord[i].inicio <= ult.fim + 1) {
      ult.fim = ult.fim == null || ord[i].fim == null ? null : Math.max(ult.fim, ord[i].fim);
    } else {
      out.push({ inicio: ord[i].inicio, fim: ord[i].fim });
    }
  }
  return out;
}

export function cabecalhoRange({ inicio, fim }) {
  return fim == null ? `bytes=${inicio}-` : `bytes=${inicio}-${fim}`;
}

/**
 * Baixa só as mensagens pedidas de um GRIB remoto.
 *
 * Devolve a concatenação dos intervalos. Como cada registro do índice é uma
 * mensagem GRIB2 completa (começa em "GRIB", termina em "7777"), concatenar
 * intervalos produz um GRIB2 válido de várias mensagens, que o decodificador lê
 * direto.
 */
export async function baixarPorIndice(fetchImpl, urlGrib, alvos, { timeoutMs = 30000 } = {}) {
  const rIdx = await fetchImpl(`${urlGrib}.idx`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!rIdx.ok) {
    throw Object.assign(new Error(`índice indisponível (HTTP ${rIdx.status})`),
      { code: "SEM_INDICE", status: 502 });
  }
  const regs = parseIdx(await rIdx.text());
  if (!regs.length) {
    throw Object.assign(new Error("índice vazio ou ilegível"), { code: "INDICE_VAZIO", status: 502 });
  }

  const achados = acharRegistros(regs, alvos);
  if (achados.length !== alvos.length) {
    const faltam = alvos
      .filter((a) => !achados.some((r) => r.campo === a.campo && r.nivel === a.nivel))
      .map((a) => `${a.campo} em ${a.nivel}`);
    throw Object.assign(new Error(`o índice não tem: ${faltam.join(", ")}`),
      { code: "CAMPO_AUSENTE", status: 502 });
  }

  const faixas = fundirFaixas(achados);
  const partes = [];
  let bytes = 0;
  for (const f of faixas) {
    const r = await fetchImpl(urlGrib, {
      headers: { Range: cabecalhoRange(f) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 206 é o esperado. Um 200 significa que o servidor IGNOROU o Range e está
    // mandando o arquivo inteiro — meio gigabyte. Recusar é melhor que aceitar.
    if (r.status !== 206) {
      throw Object.assign(
        new Error(`servidor ignorou o Range (HTTP ${r.status}) — evitando baixar o arquivo inteiro`),
        { code: "SEM_RANGE", status: 502 }
      );
    }
    const b = Buffer.from(await r.arrayBuffer());
    bytes += b.length;
    partes.push(b);
  }

  const buf = Buffer.concat(partes);
  if (buf.length < 16 || buf.toString("latin1", 0, 4) !== "GRIB") {
    throw Object.assign(new Error("o intervalo baixado não começa em GRIB"),
      { code: "NAO_E_GRIB", status: 502 });
  }
  return { buf, bytes, requisicoes: faixas.length + 1, registros: achados };
}
