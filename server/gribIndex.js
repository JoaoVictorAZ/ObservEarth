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


export function acharRegistros(regs, alvos) {
  const achados = [];
  for (const a of alvos) {
    const r = regs.find((x) => x.campo === a.campo && x.nivel === a.nivel);
    if (r) achados.push(r);
  }
  return achados;
}

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
