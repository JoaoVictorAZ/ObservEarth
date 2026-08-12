// server/currents.js
// -----------------------------------------------------------------------------
// Processamento e conversão de vetores de correntes oceânicas.
// -----------------------------------------------------------------------------

const BASE = "https://marine-api.open-meteo.com/v1/marine";

/**
 * Passo da grade, em graus.
 *
 * A fonte é de 8 km; isto aqui é subamostragem dela, não invenção. 1,5° dá
 * 240x120 = 28.800 pontos, que em lotes de 200 são 144 requisições — cabe no
 * teto de um quarto do limite gratuito com folga, e o resultado fica cacheado
 * por 6 h.
 *
 * Corrente aguenta grade mais grossa que vento: os campos são muito mais
 * suaves (0,1 a 2 m/s contra 0 a 70) e as feições que importam — Golfo,
 * Kuroshio, Circumpolar — têm centenas de quilômetros de largura.
 */
export const PASSO = 1.5;
export const LOTE = 200;

/**
 * (velocidade, direção oceanográfica) -> (u, v).
 *
 * u é positivo para LESTE, v positivo para NORTE — a mesma convenção do campo
 * de vento, para que o mesmo shader de advecção sirva aos dois.
 *
 * Como a direção já aponta PARA ONDE a água vai, não há inversão de 180°:
 *   u = vel · sen(θ)      θ = 0° -> (0, +vel), indo para o norte
 *   v = vel · cos(θ)      θ = 90° -> (+vel, 0), indo para o leste
 */
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

export async function buscarCorrentes(fetchImpl, {
  passo = PASSO, lote = LOTE, hora = null, medir = (_n, f) => f(),
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

  let ok = 0, falhas = 0, foraDeFaixa = 0;

  await Promise.all(lotes.map(async (b) => {
    const qs = new URLSearchParams({
      latitude: b.map((p) => p[0]).join(","),
      longitude: b.map((p) => p[1]).join(","),
      hourly: "ocean_current_velocity,ocean_current_direction",
      // Pedir a unidade em vez de supor. O padrão desta API é km/h — supor foi
      // o que já fez a sonda deste projeto mostrar 58,5 m/s onde havia
      // 58,5 km/h, um fator de 3,6 no planeta inteiro.
      velocity_unit: "ms",
      // Célula de MAR. O padrão da API é procurar célula em terra com elevação
      // parecida; para corrente isso devolveria nulo em quase toda costa.
      cell_selection: "sea",
      forecast_days: "1",
      timezone: "UTC",
    });

    try {
      const r = await medir(1, () => fetchImpl(`${BASE}?${qs}`, { signal: AbortSignal.timeout(20000) }));
      if (!r.ok) { falhas++; return; }
      const corpo = await r.json();
      const lista = Array.isArray(corpo) ? corpo : [corpo];
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
        // Terra volta como null — é ausência declarada, e a máscara `valid`
        // é o que impede a partícula de nascer em cima do continente.
        if (!uv) return;
        if (Math.abs(uv.u) > TETO_MS || Math.abs(uv.v) > TETO_MS) { foraDeFaixa++; return; }
        u[idx] = uv.u; v[idx] = uv.v; valid[idx] = 1; ok++;
      });
    } catch { falhas++; }
  }));

  if (ok === 0) {
    throw Object.assign(
      new Error("nenhum ponto de corrente foi medido — fonte indisponível"),
      { code: "SEM_CORRENTES", status: 502 }
    );
  }

  const nPontos = nx * ny;
  return {
    nx, ny,
    u: Array.from(u), v: Array.from(v), valid: Array.from(valid),
    stepDeg: passo,
    // Bem abaixo de 100% por construção: 71% do planeta é oceano, então ~29%
    // dos pontos são terra e voltam nulos. Isso É o resultado certo, e por isso
    // o número vem acompanhado da fração de mar esperada.
    measuredPct: +((ok / nPontos) * 100).toFixed(1),
    marEsperadoPct: 71,
    lotesComFalha: falhas,
    foraDeFaixa,
    provider: "Copernicus Marine · SMOC (Météo-France) via Open-Meteo",
    dataset: "GLOBAL_ANALYSISFORECAST_PHY_001_024 · 0,08° na origem",
    convencao: "direção oceanográfica: para onde a água VAI (oposta à do vento)",
    requests: lotes.length,
    builtAt: new Date().toISOString(),
  };
}
