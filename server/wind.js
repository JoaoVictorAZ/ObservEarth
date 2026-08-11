import { metered } from "./budget.js";
import { fetchGfsWind } from "./gfs.js";
import { decodeGrib2 } from "./grib2.js";

export const WIND_STEP = 0.25;
export const WIND_SCHEMA = 7;

export function windKey(dateStr, hour) {
  return `wind:v${WIND_SCHEMA}:${dateStr}:${hour}`;
}

export const WIND_KEY_PREFIX = "wind:";
export const WIND_KEY_CURRENT = `wind:v${WIND_SCHEMA}:`;

// ─── circuit breaker ───
const gfsBreaker = { fails: 0, until: 0 };
const GFS_TRIP = 3;
const GFS_COOLDOWN = 20 * 60e3;

export async function buildWindGrid(fetchImpl, dateStr, hour) {
  validateDateHour(dateStr, hour);

  const now = Date.now();

  // Se GFS está em cooldown, pula direto pro Open-Meteo
  if (gfsBreaker.until > now) {
    console.log(`[wind] GFS em cooldown até ${new Date(gfsBreaker.until).toISOString()}`);
    return buildWindGridOpenMeteo(fetchImpl, dateStr, hour);
  }

  // ─── Tentativa 1: GFS GRIB2 nativo ───
  try {
    console.log(`[wind] tentando GFS GRIB2 para ${dateStr} ${hour}h...`);
    const grid = await buildWindGridGfs(fetchImpl, dateStr, hour);
    gfsBreaker.fails = 0;
    console.log(`[wind] GFS OK: ${grid.nx}×${grid.ny}, ${grid.provider}`);
    return grid;
  } catch (e) {
    gfsBreaker.fails++;
    console.warn(`[wind] GFS falhou (${gfsBreaker.fails}/${GFS_TRIP}): ${e.message}`);

    if (gfsBreaker.fails >= GFS_TRIP) {
      gfsBreaker.until = now + GFS_COOLDOWN;
      console.warn(`[wind] GFS desligado por ${GFS_COOLDOWN / 60e3} min`);
    }
  }

  // ─── Tentativa 2: Open-Meteo (fallback) ───
  try {
    console.log(`[wind] fallback Open-Meteo para ${dateStr} ${hour}h...`);
    const grid = await buildWindGridOpenMeteo(fetchImpl, dateStr, hour);
    console.log(`[wind] Open-Meteo OK: ${grid.nx}×${grid.ny}, ${grid.provider}`);
    return grid;
  } catch (e) {
    console.error(`[wind] Open-Meteo também falhou: ${e.message}`);
    // Propaga o erro com status apropriado
    throw e;
  }
}

export function gfsStatus() {
  return {
    fails: gfsBreaker.fails,
    disabledUntil: gfsBreaker.until ? new Date(gfsBreaker.until).toISOString() : null,
    note: "GFS 0.25° GRIB2 nativo via NOMADS/S3/DWD",
  };
}

function validateDateHour(dateStr, hour) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw Object.assign(new Error(`dateStr inválido: ${dateStr}`), { code: "INVALID_DATE", status: 400 });
  }
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || hour !== Math.floor(hour)) {
    throw Object.assign(new Error(`hour inválido: ${hour}`), { code: "INVALID_HOUR", status: 400 });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// GFS GRIB2 NATIVO
// ═════════════════════════════════════════════════════════════════════════════

const GFS_U_MATCH = { discipline: 0, category: 2, parameter: 2 };
const GFS_V_MATCH = { discipline: 0, category: 2, parameter: 3 };

async function buildWindGridGfs(fetchImpl, dateStr, hour) {
  let buf;
  try {
    buf = await fetchGfsWind(fetchImpl, dateStr, hour);
  } catch (e) {
    throw Object.assign(new Error(`download GFS falhou: ${e.message}`), { code: "GFS_DOWNLOAD_FAILED" });
  }

  if (!buf || buf.length < 16) {
    throw Object.assign(new Error("GRIB2 vazio ou muito curto"), { code: "GRIB2_EMPTY" });
  }

  let msgs;
  try {
    msgs = decodeGrib2(buf);
  } catch (e) {
    throw Object.assign(new Error(`decode GRIB2 falhou: ${e.message}`), { code: "GRIB2_DECODE_FAILED" });
  }

  if (!msgs || msgs.length === 0) {
    throw Object.assign(new Error("nenhuma mensagem GRIB2 decodificada"), { code: "GRIB2_NO_MESSAGES" });
  }

  const findMsg = (match) => msgs.find(
    (m) => m.discipline === match.discipline
        && m.category === match.category
        && m.parameter === match.parameter
  );

  const uMsg = findMsg(GFS_U_MATCH);
  const vMsg = findMsg(GFS_V_MATCH);

  if (!uMsg || !vMsg) {
    const params = msgs.map((m) => `d${m.discipline}.c${m.category}.p${m.parameter}`).join(", ");
    throw Object.assign(
      new Error(`GRIB2 sem U/V a 10m (params: ${params})`),
      { code: "GRIB2_NO_WIND_PARAMS" }
    );
  }

  const gU = uMsg.grid, gV = vMsg.grid;
  if (gU.ni !== gV.ni || gU.nj !== gV.nj) {
    throw Object.assign(
      new Error(`grade U/V mismatch: ${gU.ni}×${gU.nj} vs ${gV.ni}×${gV.nj}`),
      { code: "GRIB2_GRID_MISMATCH" }
    );
  }

  const nx = gU.ni;
  const ny = gU.nj;
  const nPoints = nx * ny;

  const u = Array.from(uMsg.values);
  const v = Array.from(vMsg.values);

  // -------------------------------------------------------------------------
  // PLAUSIBILIDADE FÍSICA, e não apenas "é um número".
  //
  // A checagem antiga só perguntava `Number.isFinite`. Um campo decodificado
  // errado, com 21 MILHÕES de m/s em cada nó, passava com "100% medido" — e
  // então o cliente aplicava `clamp(±40)` ao montar a textura, o que
  // transformava TODO nó em exatamente +40 ou -40.
  //
  // Campo constante = todas as partículas no mesmo rumo = listras diagonais
  // paralelas, uniformes, bonitas e completamente falsas. O clamp convertia
  // lixo absurdo em escoamento convincente, e por isso o defeito sobreviveu a
  // várias rodadas de "o vento está errado".
  //
  // O recorde de rajada registrado na Terra é ~113 m/s (Barrow Island, 1996).
  // Na alta troposfera um jato passa de 100 m/s, mas isto é vento de 10 m.
  // 150 m/s é folga generosa: nada real chega lá, e qualquer coisa acima é
  // defeito de desempacotamento, não meteorologia.
  const LIMITE_FISICO = 150;

  const valid = new Uint8Array(nPoints);
  let measured = 0;
  let absurdos = 0;
  let maxAbs = 0;

  for (let i = 0; i < nPoints; i++) {
    const a = u[i], b = v[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > maxAbs) maxAbs = m;
    if (m > LIMITE_FISICO) { absurdos++; continue; }   // não conta como medido

    valid[i] = 1;
    measured++;
  }

  if (absurdos > nPoints * 0.001) {
    throw Object.assign(
      new Error(
        `campo GFS fisicamente impossível: ${((absurdos / nPoints) * 100).toFixed(1)}% dos nós ` +
        `acima de ${LIMITE_FISICO} m/s (máximo observado ${maxAbs.toExponential(2)} m/s). ` +
        `Isto é erro de desempacotamento GRIB2, não vento. Ver /api/wind/grib-debug.`
      ),
      { code: "GFS_IMPLAUSIBLE", status: 502 }
    );
  }

  if (measured < nPoints * 0.90) {
    throw Object.assign(
      new Error(`dados GFS insuficientes: ${((measured / nPoints) * 100).toFixed(1)}% válidos`),
      { code: "GFS_INSUFFICIENT_DATA", status: 503 }
    );
  }

  return {
    nx, ny,
    u, v,
    valid: Array.from(valid),
    measuredPct: +((measured / nPoints) * 100).toFixed(1),
    validPct: 100.0,
    provider: "NOAA GFS 0.25°",
    dataset: "GFS Operacional · GRIB2 nativo",
    stepDeg: WIND_STEP,
    requests: 1,
    builtAt: new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// FALLBACK: Open-Meteo
// ═════════════════════════════════════════════════════════════════════════════

const WIND_BATCH = 200;

function diffuse(arr, mask, nx, ny, passes = 4) {
  const out = Float32Array.from(arr);
  const filledMask = Uint8Array.from(mask);

  for (let p = 0; p < passes; p++) {
    let filled = 0;
    const snap = Float32Array.from(out);
    const seen = Uint8Array.from(filledMask);

    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (seen[i]) continue;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const yy = y + dy;
            if (yy < 0 || yy >= ny) continue;
            const xx = ((x + dx) % nx + nx) % nx;
            const ni = yy * nx + xx;
            if (seen[ni]) { s += snap[ni]; n++; }
          }
        }
        if (n) { out[i] = s / n; filledMask[i] = 1; filled++; }
      }
    }
    if (!filled) break;
  }
  return { out, filledMask };
}

async function buildWindGridOpenMeteo(fetchImpl, dateStr, hour) {
  const target = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`).getTime();
  const daysAhead = (target - Date.now()) / 86400e3;

  if (daysAhead > 16) {
    const err = new Error(`${dateStr} ${hour}h está além do horizonte de previsão (~16 dias)`);
    err.status = 503;
    err.code = "BEYOND_HORIZON";
    throw err;
  }

  const lats = [], lngs = [];
  for (let la = 90 - 1.5; la > -90; la -= 3) lats.push(Math.round(la * 100) / 100);
  for (let ln = -180 + 1.5; ln < 180; ln += 3) lngs.push(Math.round(ln * 100) / 100);
  const nx = lngs.length;
  const ny = lats.length;

  const u = new Float32Array(nx * ny);
  const v = new Float32Array(nx * ny);
  const mask = new Uint8Array(nx * ny);

  const pts = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) pts.push([lats[y], lngs[x], y * nx + x]);
  }

  const isPast = target < Date.now() - 5 * 86400e3;
  const base = isPast
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";

  const batches = [];
  for (let i = 0; i < pts.length; i += WIND_BATCH) batches.push(pts.slice(i, i + WIND_BATCH));

  await Promise.all(
    batches.map(async (b) => {
      const qs = new URLSearchParams({
        latitude: b.map((p) => p[0]).join(","),
        longitude: b.map((p) => p[1]).join(","),
        hourly: "wind_speed_10m,wind_direction_10m",
        start_date: dateStr,
        end_date: dateStr,
        timezone: "UTC",
        wind_speed_unit: "ms",
      });

      try {
        const r = await metered("open-meteo", 1, () =>
          fetchImpl(`${base}?${qs}`, { signal: AbortSignal.timeout(15000) })
        );
        if (!r.ok) return;
        const body = await r.json();
        const list = Array.isArray(body) ? body : [body];
        list.forEach((loc, i) => {
          const idx = b[i]?.[2];
          if (idx === undefined) return;
          const h = loc?.hourly;
          if (!h) return;
          const hi = Math.min(hour, (h.time?.length ?? 1) - 1);
          const spd = h.wind_speed_10m?.[hi];
          const dir = h.wind_direction_10m?.[hi];
          if (!Number.isFinite(spd) || !Number.isFinite(dir)) return;
          const rad = ((dir + 180) * Math.PI) / 180;
          u[idx] = spd * Math.sin(rad);
          v[idx] = spd * Math.cos(rad);
          mask[idx] = 1;
        });
      } catch (err) {
        console.warn(`[wind] batch erro: ${err.message}`);
      }
    })
  );

  const measured = mask.reduce((a, b2) => a + b2, 0);
  console.log(`[wind] Open-Meteo: ${measured}/${nx * ny} pontos medidos (${((measured / (nx * ny)) * 100).toFixed(0)}%)`);

  if (measured < nx * ny * 0.30) {
    const err = new Error(
      `sem dados de vento suficientes para ${dateStr} ${hour}h ` +
      `(${((measured / (nx * ny)) * 100).toFixed(0)}% da grade; ` +
      `Open-Meteo pode não cobrir esta data)`
    );
    err.status = 503;
    err.code = "NO_WIND_DATA";
    throw err;
  }

  const du = diffuse(u, mask, nx, ny, 2);
  const dv = diffuse(v, mask, nx, ny, 2);
  const valid = du.filledMask;
  for (let i = 0; i < nx * ny; i++) {
    if (!valid[i]) { du.out[i] = 0; dv.out[i] = 0; }
  }

  return {
    nx, ny,
    u: Array.from(du.out),
    v: Array.from(dv.out),
    valid: Array.from(valid),
    measuredPct: +((measured / (nx * ny)) * 100).toFixed(1),
    validPct: +((valid.reduce((a, b2) => a + b2, 0) / (nx * ny)) * 100).toFixed(1),
    provider: "Open-Meteo",
    dataset: isPast ? "ERA5 (reanálise)" : "ECMWF/GFS (previsão)",
    stepDeg: 3,
    requests: batches.length,
    builtAt: new Date().toISOString(),
  };
}