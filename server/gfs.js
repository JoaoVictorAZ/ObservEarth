// server/gfs.js
// -----------------------------------------------------------------------------
// Download de GRIB2 do NOMADS (NOAA) para vento a 10m.
//
// O GFS 0.25° tem ciclos a cada 6h (00, 06, 12, 18 UTC). Para uma data/hora
// pedida, encontramos o ciclo mais recente e o passo de previsão (fhr).
//
// URL do NOMADS GRIB filter:
//   https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
// -----------------------------------------------------------------------------

import { decodeGrib2 } from "./grib2.js";

/** Alcance máximo de previsão do GFS em horas (16 dias) */
export const GFS_MAX_LEAD = 384;

/**
 * Encontra o ciclo GFS mais recente disponível para uma data.
 *
 * O GFS publica com ~4h de atraso. Para "agora", usamos o ciclo anterior.
 * Para datas no passado, usamos o último ciclo do dia (18z).
 */
function resolveCycle(dateStr, hour) {
  const askedMs = Date.UTC(
    +dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10), Number(hour) || 0
  );
  const nowMs = Date.now();
  const maxAvailableMs = nowMs - 4.5 * 3600e3;

  const runBaseMs = Math.min(askedMs, maxAvailableMs);
  const runDate = new Date(runBaseMs);

  const runHour = runDate.getUTCHours();
  const cycles = [0, 6, 12, 18];
  let cycle = 0;
  for (const c of cycles) {
    if (c <= runHour) cycle = c;
  }

  const cycleMs = Date.UTC(
    runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate(), cycle
  );

  const fhrNum = Math.max(0, Math.min(384, Math.floor((askedMs - cycleMs) / 3600e3)));
  const dateFormatted = new Date(cycleMs).toISOString().slice(0, 10).replace(/-/g, "");

  return {
    date: dateFormatted,
    cycle: String(cycle).padStart(2, "0"),
    fhr: String(fhrNum).padStart(3, "0"),
  };
}

/**
 * Calcula a cobertura e metadados de previsão para uma data/hora UTC.
 */
export function gfsCoverage(atMs, nowInput = new Date()) {
  const nowMs = typeof nowInput === "number" ? nowInput : nowInput.getTime();
  const diffH = Math.round((atMs - nowMs) / 3600e3);

  if (diffH > GFS_MAX_LEAD || diffH < -30 * 24) return null;

  const targetDate = new Date(atMs);
  const hour = targetDate.getUTCHours();
  const dateStr = targetDate.toISOString().slice(0, 10);
  const { cycle, fhr } = resolveCycle(dateStr, hour);

  let kind = "forecast";
  if (diffH <= 0) {
    kind = atMs < nowMs - 2 * 86400e3 ? "archive" : "analysis";
  }

  return {
    leadH: Number(fhr),
    kind,
    cycle: `${cycle}z`,
  };
}

/**
 * Baixa mensagens GRIB2 específicas (variáveis e níveis) usando o filtro NOMADS.
 */
export async function fetchGfsMessages(fetchImpl, dateStr, hour, vars = [], levs = [], now = new Date()) {
  const { date, cycle, fhr } = resolveCycle(dateStr, hour);

  const nomadsUrl = new URL("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl");
  nomadsUrl.searchParams.set("file", `gfs.t${cycle}z.pgrb2.0p25.f${fhr}`);
  for (const v of vars) nomadsUrl.searchParams.set(`var_${v}`, "on");
  for (const l of levs) nomadsUrl.searchParams.set(`lev_${l}`, "on");
  nomadsUrl.searchParams.set("subregion", "");
  nomadsUrl.searchParams.set("leftlon", "0");
  nomadsUrl.searchParams.set("rightlon", "360");
  nomadsUrl.searchParams.set("toplat", "90");
  nomadsUrl.searchParams.set("bottomlat", "-90");
  nomadsUrl.searchParams.set("dir", `/gfs.${date}/${cycle}/atmos`);

  let buf;
  try {
    const r = await fetchImpl(nomadsUrl.toString(), { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`NOMADS HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length >= 16 && b.toString("latin1", 0, 4) === "GRIB") buf = b;
  } catch (e) {
    console.warn(`[gfs] filter falhou: ${e.message}`);
  }

  if (!buf) {
    const s3Url = `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${date}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p25.f${fhr}`;
    try {
      const r = await fetchImpl(s3Url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length >= 16 && b.toString("latin1", 0, 4) === "GRIB") buf = b;
      }
    } catch {}
  }

  if (!buf) {
    throw new Error(`GFS indisponível para ${dateStr} ${hour}h (${cycle}z f${fhr})`);
  }

  const msgs = decodeGrib2(buf);
  return {
    msgs,
    label: `GFS ${dateStr} ${cycle}z +${fhr}h`,
    cycle: `${cycle}z`,
    fhr: Number(fhr),
    bytes: buf.length,
  };
}

/**
 * Baixa GRIB2 de vento a 10m do NOMADS.
 *
 * Retorna Buffer/Uint8Array com o arquivo GRIB2 binário.
 * Se o NOMADS estiver fora, tenta o arquivo direto do AWS S3 (bucket NOAA).
 */
export async function fetchGfsWind(fetchImpl, dateStr, hour) {
  const { date, cycle, fhr } = resolveCycle(dateStr, hour);

  // ─── Tentativa 1: NOMADS GRIB filter ───
  const nomadsUrl = new URL("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl");
  nomadsUrl.searchParams.set("file", `gfs.t${cycle}z.pgrb2.0p25.f${fhr}`);
  nomadsUrl.searchParams.set("lev_10_m_above_ground", "on");
  nomadsUrl.searchParams.set("var_UGRD", "on");
  nomadsUrl.searchParams.set("var_VGRD", "on");
  nomadsUrl.searchParams.set("subregion", "");
  nomadsUrl.searchParams.set("leftlon", "0");
  nomadsUrl.searchParams.set("rightlon", "360");
  nomadsUrl.searchParams.set("toplat", "90");
  nomadsUrl.searchParams.set("bottomlat", "-90");
  nomadsUrl.searchParams.set("dir", `/gfs.${date}/${cycle}/atmos`);

  try {
    console.log(`[gfs] tentando NOMADS: ${nomadsUrl.toString().slice(0, 120)}...`);
    const r = await fetchImpl(nomadsUrl.toString(), {
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      throw new Error(`NOMADS HTTP ${r.status}: ${r.statusText}`);
    }

    const buf = Buffer.from(await r.arrayBuffer());

    // Validação: GRIB2 começa com "GRIB"
    if (buf.length < 16 || buf.toString("latin1", 0, 4) !== "GRIB") {
      // Pode ser HTML de erro
      const preview = buf.toString("utf8", 0, 200);
      throw new Error(`resposta não é GRIB2: ${preview.slice(0, 100)}`);
    }

    console.log(`[gfs] GRIB2 baixado: ${buf.length} bytes`);
    return buf;

  } catch (e) {
    console.warn(`[gfs] NOMADS falhou: ${e.message}`);
  }

  // ─── Tentativa 2: AWS S3 (bucket NOAA aberto) ───
  // O NOAA publica GFS no S3 com ~4h de atraso também
  const s3Url = `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${date}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p25.f${fhr}`;

  try {
    console.log(`[gfs] tentando S3: ${s3Url.slice(0, 100)}...`);
    const r = await fetchImpl(s3Url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      throw new Error(`S3 HTTP ${r.status}: ${r.statusText}`);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 16 || buf.toString("latin1", 0, 4) !== "GRIB") {
      throw new Error("S3 resposta não é GRIB2");
    }

    console.log(`[gfs] GRIB2 baixado do S3: ${buf.length} bytes`);
    return buf;

  } catch (e) {
    console.warn(`[gfs] S3 falhou: ${e.message}`);
  }

  // ─── Tentativa 3: Open-Data do DWD (German Weather Service) ───
  // DWD espelha GFS com menos atraso
  const dwdUrl = `https://opendata.dwd.de/weather/nwp/gfs/gfs${date}_${cycle}/gfs.t${cycle}z.pgrb2.0p25.f${fhr}`;

  try {
    console.log(`[gfs] tentando DWD: ${dwdUrl.slice(0, 100)}...`);
    const r = await fetchImpl(dwdUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      throw new Error(`DWD HTTP ${r.status}: ${r.statusText}`);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 16 || buf.toString("latin1", 0, 4) !== "GRIB") {
      throw new Error("DWD resposta não é GRIB2");
    }

    console.log(`[gfs] GRIB2 baixado do DWD: ${buf.length} bytes`);
    return buf;

  } catch (e) {
    console.warn(`[gfs] DWD falhou: ${e.message}`);
  }

  throw new Error(
    `GFS indisponível em todas as fontes (NOMADS, S3, DWD) para ${dateStr} ${hour}h ` +
    `(tentado ciclo ${cycle}, fhr ${fhr})`
  );
}

/**
 * Mensagens de debug para diagnóstico.
 */
export function gfsDiagnostics() {
  const now = new Date();
  const cycles = [0, 6, 12, 18];
  const currentCycle = cycles.filter((c) => c <= now.getUTCHours()).pop() ?? 0;
  return {
    currentUtcHour: now.getUTCHours(),
    currentCycle: String(currentCycle).padStart(2, "0"),
    nextCycle: String(cycles.find((c) => c > now.getUTCHours()) ?? 0).padStart(2, "0"),
    nomadsBase: "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
    s3Base: "https://noaa-gfs-bdp-pds.s3.amazonaws.com",
    note: "GFS publica com ~4h de atraso. Ciclos: 00z, 06z, 12z, 18z UTC.",
  };
}