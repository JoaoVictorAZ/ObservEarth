import { get, has } from "./keys.js";

const BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

/** parser de CSV suficiente para o formato do FIRMS (sem virgula em campo) */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    if (cells.length !== head.length) continue;
    const row = {};
    for (let j = 0; j < head.length; j++) row[head[j]] = cells[j];
    out.push(row);
  }
  return out;
}

/**
 * @param {string} dateStr  YYYY-MM-DD
 * @param {number} days     1..10 (limite do FIRMS)
 * @param {string} source   VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT
 */
export async function fetchFires(fetchImpl, dateStr, days = 1, source = "VIIRS_SNPP_NRT") {
  if (!has("FIRMS_MAP_KEY")) {
    const err = new Error(
      "FIRMS_MAP_KEY ausente. Gere a chave gratuita em " +
      "https://firms.modaps.eosdis.nasa.gov/api/map_key/ e coloque no arquivo .env"
    );
    err.status = 503;
    err.code = "NO_KEY";
    throw err;
  }

  const key = get("FIRMS_MAP_KEY");
  const d = Math.max(1, Math.min(10, Number(days) || 1));
  // area/csv/{KEY}/{SOURCE}/{AREA}/{DAYRANGE}/{DATE}   —  world = -180,-90,180,90
  const url = `${BASE}/${key}/${source}/world/${d}/${dateStr}`;

  const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const err = new Error(`FIRMS HTTP ${r.status}`);
    err.status = r.status === 401 ? 401 : 502;
    throw err;
  }

  const text = await r.text();

  // O FIRMS devolve texto de erro com HTTP 200 quando a chave e invalida
  if (/invalid|not authorized|error/i.test(text.slice(0, 200)) && !text.includes("latitude")) {
    const err = new Error("FIRMS recusou a chave (verifique FIRMS_MAP_KEY)");
    err.status = 401;
    err.code = "BAD_KEY";
    throw err;
  }

  const rows = parseCsv(text);
  const fires = [];
  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // frp = Fire Radiative Power (MW): e a intensidade fisica do foco
    const frp = Number(row.frp) || 0;
    fires.push({
      lat, lng, frp,
      brightness: Number(row.bright_ti4 ?? row.brightness) || 0,
      confidence: row.confidence ?? "",
      acqDate: row.acq_date ?? dateStr,
      acqTime: row.acq_time ?? "",
      daynight: row.daynight ?? "",
    });
  }

  // Um dia global pode passar de 100 mil focos. Enviar tudo trava o navegador,
  // entao mandamos os mais intensos: e o recorte que preserva o sinal.
  fires.sort((a, b) => b.frp - a.frp);
  const capped = fires.slice(0, 4000);

  return {
    provider: "NASA FIRMS",
    dataset: `${source} (${d} dia${d > 1 ? "s" : ""})`,
    date: dateStr,
    total: fires.length,
    returned: capped.length,
    fires: capped,
  };
}
