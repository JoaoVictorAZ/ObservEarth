const BASE = "https://marine-api.open-meteo.com/v1/marine";
export const PASSO = 1.5;
export const CORRENTES_SCHEMA = 2;
export const LOTE = 380;
export const CONCORRENCIA = 2;
export const TENTATIVAS = 4;
export const COBERTURA_MINIMA = 0.55;


export function uvDaCorrente(velocidade, direcaoGraus) {
  if (velocidade == null || direcaoGraus == null) return null;
  if (!Number.isFinite(velocidade) || !Number.isFinite(direcaoGraus)) return null;
  const rad = (direcaoGraus * Math.PI) / 180;
  return { u: velocidade * Math.sin(rad), v: velocidade * Math.cos(rad) };
}

/** teto de plausibilidade: a Corrente do Golfo passa de 2,5 m/s em raros pontos */
export const TETO_MS = 5;

export function montarPontos(passo = PASSO) {
  const lats = [], lngs = [];
  for (let la = 90 - passo / 2; la > -90; la -= passo) lats.push(+la.toFixed(3));
  for (let ln = -180 + passo / 2; ln < 180; ln += passo) lngs.push(+ln.toFixed(3));
  return { lats, lngs, nx: lngs.length, ny: lats.length };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function emFila(itens, n, trabalho) {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.max(1, n) }, async () => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      await trabalho(itens[i], i);
    }
  });
  await Promise.all(trabalhadores);
}

async function lotePedido(fetchImpl, url, medir, custo) {
  let ultimoMotivo = "sem tentativa";
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    if (tentativa > 0) {
      await dormir(800 * 2 ** (tentativa - 1));
    }
    try {
      const r = await medir(custo, () => fetchImpl(url, { signal: AbortSignal.timeout(25000) }));
      if (r.ok) return { ok: true, corpo: await r.json() };

      if (r.status === 429) {
        const espera = Number(r.headers.get("retry-after"));
        if (Number.isFinite(espera) && espera > 0) await dormir(Math.min(15000, espera * 1000));
        ultimoMotivo = "429 (limite de rajada)";
        continue;
      }
      if (r.status >= 500) { ultimoMotivo = `HTTP ${r.status}`; continue; }
      // 4xx que não é 429: a requisição é que está errada. Insistir não conserta.
      return { ok: false, motivo: `HTTP ${r.status}`, fatal: true };
    } catch (e) {
      if (e?.code === "BUDGET_EXCEEDED") {
        return { ok: false, motivo: `orçamento por ${e.window} esgotado`, fatal: true, orcamento: true };
      }
      ultimoMotivo = e?.name === "TimeoutError" ? "tempo esgotado" : (e?.message ?? "erro de rede");
    }
  }
  return { ok: false, motivo: ultimoMotivo };
}

export async function buscarCorrentes(fetchImpl, {
  passo = PASSO, lote = LOTE, hora = null, medir = (_n, f) => f(),
  concorrencia = CONCORRENCIA, coberturaMinima = COBERTURA_MINIMA,
} = {}) {
  const { lats, lngs, nx, ny } = montarPontos(passo);
  const u = new Float32Array(nx * ny);
  const v = new Float32Array(nx * ny);
  const valid = new Uint8Array(nx * ny);

  const pts = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) pts.push([lats[y], lngs[x], y * nx + x]);
  }
  const lotes = [];
  for (let i = 0; i < pts.length; i += lote) lotes.push(pts.slice(i, i + lote));

  let ok = 0, falhas = 0, foraDeFaixa = 0, repetidos = 0;
  let semOrcamento = false;
  const motivos = new Map();

  await emFila(lotes, concorrencia, async (b) => {
    if (semOrcamento) { falhas++; return; }

    const qs = new URLSearchParams({
      latitude: b.map((p) => p[0]).join(","),
      longitude: b.map((p) => p[1]).join(","),
      hourly: "ocean_current_velocity,ocean_current_direction",
      velocity_unit: "ms",
      cell_selection: "sea",
      forecast_days: "1",
      timezone: "UTC",
    });

    const url = `${BASE}?${qs}`;
    if (url.length > 7800) {
      falhas++;
      motivos.set("URL longa demais", (motivos.get("URL longa demais") ?? 0) + 1);
      return;
    }

    const r = await lotePedido(fetchImpl, url, medir, b.length);
    if (!r.ok) {
      falhas++;
      if (r.orcamento) semOrcamento = true;
      motivos.set(r.motivo, (motivos.get(r.motivo) ?? 0) + 1);
      return;
    }

    const lista = Array.isArray(r.corpo) ? r.corpo : [r.corpo];
    lista.forEach((loc, i) => {
      const idx = b[i]?.[2];
      if (idx === undefined) return;
      const h = loc?.hourly;
      if (!h?.time?.length) return;
      const hi = hora == null
        ? Math.min(12, h.time.length - 1)
        : Math.min(hora, h.time.length - 1);
      const vel = h.ocean_current_velocity?.[hi];
      const dir = h.ocean_current_direction?.[hi];
      const uv = uvDaCorrente(vel, dir);
      if (!uv) return;
      if (Math.abs(uv.u) > TETO_MS || Math.abs(uv.v) > TETO_MS) { foraDeFaixa++; return; }
      u[idx] = uv.u; v[idx] = uv.v; valid[idx] = 1; ok++;
    });
  });

  const nPontos = nx * ny;
  const medidoPct = +((ok / nPontos) * 100).toFixed(1);
  const MAR_ESPERADO = 71;
  const fracao = medidoPct / MAR_ESPERADO;

  const porqueLotes = () => [...motivos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n}x ${m}`)
    .join(", ") || "sem motivo registrado";

  if (ok === 0) {
    throw Object.assign(
      new Error(
        `nenhum ponto de corrente foi medido — ${falhas} de ${lotes.length} lotes falharam ` +
        `(${porqueLotes()})`,
      ),
      { code: "SEM_CORRENTES", status: 502, medidoPct: 0, lotesComFalha: falhas },
    );
  }

  if (fracao < coberturaMinima) {
    throw Object.assign(
      new Error(
        `campo de correntes incompleto: ${medidoPct}% dos pontos medidos, ` +
        `~${MAR_ESPERADO}% esperados (${falhas} de ${lotes.length} lotes falharam — ${porqueLotes()}). ` +
        "Um campo com este tamanho de buraco desenharia faixas vazias no lugar de corrente.",
      ),
      { code: "CORRENTES_INCOMPLETAS", status: 502, medidoPct, lotesComFalha: falhas },
    );
  }

  return {
    nx, ny,
    u: Array.from(u), v: Array.from(v), valid: Array.from(valid),
    stepDeg: passo,
    esquema: CORRENTES_SCHEMA,
    measuredPct: medidoPct,
    marEsperadoPct: MAR_ESPERADO,
    coberturaDoMar: +fracao.toFixed(3),
    lotesComFalha: falhas,
    lotesRepetidos: repetidos,
    foraDeFaixa,
    provider: "Copernicus Marine · SMOC (Météo-France) via Open-Meteo",
    dataset: "GLOBAL_ANALYSISFORECAST_PHY_001_024 · 0,08° na origem",
    convencao: "direção oceanográfica: para onde a água VAI (oposta à do vento)",
    requests: lotes.length,
    builtAt: new Date().toISOString(),
  };
}
