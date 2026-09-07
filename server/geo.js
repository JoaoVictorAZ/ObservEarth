import { gzipSync } from "node:zlib";

const CDN = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson";
const SRC = {
  countries: `${CDN}/ne_110m_admin_0_countries.geojson`,
  states: `${CDN}/ne_50m_admin_1_states_provinces.geojson`,
  places: `${CDN}/ne_50m_populated_places_simple.geojson`,
};


function dp(points, tol) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const den = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    let d;
    if (den === 0) {
      d = (px - ax) ** 2 + (py - ay) ** 2;
    } else {
      let t = ((px - ax) * dx + (py - ay) * dy) / den;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
    }
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol * tol) {
    return [...dp(points.slice(0, idx + 1), tol).slice(0, -1), ...dp(points.slice(idx), tol)];
  }
  return [points[0], points[points.length - 1]];
}

function simplifyGeom(geom, tol) {
  if (!geom) return geom;
  const ring = (r) => (r.length > 4 ? dp(r, tol) : r);
  const poly = (p) => p.map(ring).filter((r) => r.length >= 4);
  if (geom.type === "Polygon") {
    const c = poly(geom.coordinates);
    return c.length ? { type: "Polygon", coordinates: c } : null;
  }
  if (geom.type === "MultiPolygon") {
    const c = geom.coordinates.map(poly).filter((p) => p.length);
    return c.length ? { type: "MultiPolygon", coordinates: c } : null;
  }
  return geom;
}

function countVertices(fc) {
  let n = 0;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) for (const r of p) n += r.length;
  }
  return n;
}

/** O Natural Earth mistura MAIUSCULAS e minusculas entre arquivos. */
function prop(o, ...keys) {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

const mem = { countries: null, states: null, places: null, boundaries: null, labels: null };

async function load(kind) {
  if (mem[kind]) return mem[kind];
  const r = await fetch(SRC[kind], { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`Natural Earth ${kind} HTTP ${r.status}`);
  mem[kind] = await r.json();
  return mem[kind];
}

/**
 * Fronteiras por NIVEL, servidas separadamente.
 *
 * Mandar paises e estados juntos custava ~4.850 poligonos numa unica chamada a
 * `polygonsData`. O three-globe monta uma geometria por feicao, e o navegador
 * gastava ~140 ms por quadro (7 FPS). Separando por nivel, a vista planetaria
 * carrega 177 feicoes e os estados so entram quando ha zoom para justifica-los.
 *
 * @param {0|1} level 0 = paises, 1 = estados
 */
export async function getBoundaries(level = 0) {
  const cacheKey = level === 1 ? "b1" : "b0";
  if (mem[cacheKey]) return mem[cacheKey];

  const features = [];

  if (level === 0) {
    const gj = await load("countries");
    for (const f of gj.features ?? []) {
      const g = simplifyGeom(f.geometry, 0.05);
      if (!g) continue;
      features.push({
        type: "Feature",
        properties: {
          rank: 0,
          name: prop(f.properties, "NAME_PT", "NAME", "name", "ADMIN", "admin"),
          admin: prop(f.properties, "ADMIN", "admin", "NAME", "name"),
          iso: prop(f.properties, "ISO_A2", "iso_a2"),
        },
        geometry: g,
      });
    }
  } else {
    const gj = await load("states");
    for (const f of gj.features ?? []) {
      const g = simplifyGeom(f.geometry, 0.03);
      if (!g) continue;
      features.push({
        type: "Feature",
        properties: {
          rank: 1,
          name: prop(f.properties, "name_pt", "name", "NAME", "gn_name"),
          admin: prop(f.properties, "admin", "ADMIN"),
        },
        geometry: g,
      });
    }
  }

  if (!features.length) throw new Error("nenhuma fronteira disponível");
  const fc = { type: "FeatureCollection", features };
  console.log(`[geo] nível ${level}: ${features.length} feições, ${countVertices(fc).toLocaleString("pt-BR")} vértices`);
  mem[cacheKey] = fc;
  return fc;
}

/** usado pelo placeAt: precisa dos dois niveis, mas nunca vai para o cliente */
async function getAllForLookup() {
  if (mem.lookup) return mem.lookup;
  const [a, b] = await Promise.allSettled([getBoundaries(0), getBoundaries(1)]);
  const features = [
    ...(b.status === "fulfilled" ? b.value.features : []),   // estado primeiro
    ...(a.status === "fulfilled" ? a.value.features : []),
  ];
  if (!features.length) throw new Error("nenhuma fronteira disponível");
  mem.lookup = { features };
  return mem.lookup;
}

// rotulos
export async function getLabels() {
  if (mem.labels) return mem.labels;

  const [c0, c1, cp] = await Promise.allSettled([
    load("countries"), load("states"), load("places"),
  ]);

  const countries = [];
  if (c0.status === "fulfilled") {
    for (const f of c0.value.features ?? []) {
      const p = f.properties;
      const lng = Number(prop(p, "LABEL_X", "label_x"));
      const lat = Number(prop(p, "LABEL_Y", "label_y"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      countries.push({
        name: prop(p, "NAME_PT", "NAME", "name"),
        lat, lng,
        rank: Number(prop(p, "LABELRANK", "labelrank")) || 5,
      });
    }
  }

  const states = [];
  if (c1.status === "fulfilled") {
    for (const f of c1.value.features ?? []) {
      const p = f.properties;
      const lat = Number(prop(p, "latitude", "LATITUDE"));
      const lng = Number(prop(p, "longitude", "LONGITUDE"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      states.push({
        name: prop(p, "name_pt", "name", "NAME"),
        lat, lng,
        admin: prop(p, "admin", "ADMIN"),
      });
    }
  }

  const cities = [];
  if (cp.status === "fulfilled") {
    for (const f of cp.value.features ?? []) {
      const p = f.properties;
      const lat = Number(prop(p, "latitude", "LATITUDE"));
      const lng = Number(prop(p, "longitude", "LONGITUDE"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      cities.push({
        name: prop(p, "name", "NAME", "nameascii"),
        lat, lng,
        rank: Number(prop(p, "scalerank", "SCALERANK")) ?? 10,
        pop: Number(prop(p, "pop_max", "POP_MAX")) || 0,
      });
    }
    cities.sort((a, b) => a.rank - b.rank || b.pop - a.pop);
    cities.length = Math.min(cities.length, 1200);
  }

  if (!countries.length && !states.length && !cities.length) {
    const err = new Error("catálogo de rótulos indisponível (sem rede?)");
    err.status = 502;
    throw err;
  }

  mem.labels = { countries, states, cities };
  return mem.labels;
}

// ponto -> nome
function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hit(f, lat, lng) {
  const g = f.geometry;
  if (!g) return false;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const poly of polys) {
    if (!poly.length || !inRing(lat, lng, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(lat, lng, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

export async function placeAt(lat, lng) {
  try {
    const gj = await getAllForLookup();
    let country = null;
    let state = null;
    for (const f of gj.features) {
      if (!hit(f, lat, lng)) continue;
      if (f.properties.rank === 1 && !state) state = f.properties;
      else if (f.properties.rank === 0 && !country) country = f.properties;
      if (state && country) break;
    }
    if (state) {
      const adm = state.admin && state.admin !== state.name ? `, ${state.admin}` : "";
      return `${state.name}${adm}`;
    }
    if (country) return country.name;
  } catch { /* sem rede: cai para oceano */ }
  return lat > 66.5 ? "Ártico" : lat < -60 ? "Antártica" : "Oceano";
}

// rotas

function sendJsonGz(req, res, obj, maxAge) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${maxAge}`);
  if ((req.headers["accept-encoding"] ?? "").includes("gzip")) {
    const gz = gzipSync(body);
    res.set("Content-Encoding", "gzip");
    return res.end(gz);
  }
  return res.end(body);
}

export function registerGeoRoutes(app) {
  app.get("/api/boundaries", async (req, res) => {
    try {
      const level = Number(req.query.level) === 1 ? 1 : 0;
      const gj = await getBoundaries(level);
      sendJsonGz(req, res, gj, 604800);            // 7 dias: dado estático
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get("/api/labels", async (req, res) => {
    try {
      const l = await getLabels();
      sendJsonGz(req, res, l, 604800);
    } catch (e) {
      res.status(e.status ?? 502).json({ error: e.message });
    }
  });
}
