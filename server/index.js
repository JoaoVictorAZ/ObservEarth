// server/index.js
// -----------------------------------------------------------------------------
// ObservEarth: backend completo, num arquivo so.
// -----------------------------------------------------------------------------


import express from "express";
import { metered, registerBudgetRoutes, report as budgetReport } from "./budget.js";
import { reportKeys, keysStatus } from "./keys.js";
import { fetchFires } from "./fires.js";
import { openStore, cacheGet, cacheSet, cachePrune, cacheDropStale, archive, archiveStats } from "./store.js";
import { buildWindGrid, gfsStatus, windKey, WIND_KEY_PREFIX, WIND_KEY_CURRENT, WIND_SCHEMA } from "./wind.js";
import { startPrecompute, registerPrecomputeRoutes } from "./precompute.js";
import { forecastTimeline } from "./forecast.js";
import { buildField, fieldCatalog } from "./fields.js";
import { buildIsobars } from "./isobars.js";
import { buscarSerie } from "./timeseries.js";
import { buscarSondagem } from "./sounding.js";
import { compararModelos } from "./compare.js";
import { buscarCorrentes } from "./currents.js";
import { escolherFonte, caminhoDe, VARIAVEIS, beaufort, avisoDeVento } from "./arquivo.js";
import { registerGeoRoutes, placeAt } from "./geo.js";
import { describeModelLayer, sortModelLayers } from "./modelNames.js";
import { parseCapabilities, snapTime, coverageOf } from "./gibsTime.js";
import { lerBBox, alturaDe, janelaEm } from "./janela.js";
import { bboxDoTile, tileMercatorValido, TILE_PX } from "./tiles.js";
import { empacotar } from "./windBin.js";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());

// ---- DEBUG: loga todas as importações para saber se alguma quebra ----
console.log("[boot] importações OK");

// ----------------------------------------------------------------- cache
const cache = new Map();
function cached(key, ttl, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  try {
    const disk = cacheGet(key);
    if (disk != null) {
      const p = Promise.resolve(disk);
      cache.set(key, { value: p, at: Date.now() });
      return p;
    }
  } catch { /* sem disco, segue so com memoria */ }

  const value = producer();
  cache.set(key, { value, at: Date.now() });

  Promise.resolve(value)
    .then((v) => { try { cacheSet(key, v, ttl); } catch { /* segue */ } })
    .catch(() => cache.delete(key));

  if (cache.size > 120) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}
const HOUR = 3600e3;

// ======================================================================
// 1. IMAGERY (NASA GIBS)
// ======================================================================
const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

const IMAGERY = {
  sst: { layer: "GHRSST_L4_MUR_Sea_Surface_Temperature", title: "Temperatura do mar", group: "Satélite", lag: 2, legend: [["#2f6db0", "frio"], ["#e9e3d0", ""], ["#d33f3f", "quente"]] },
  aerosol: { layer: "MODIS_Combined_Value_Added_AOD", title: "Aerossóis e poeira", group: "Satélite", lag: 2, legend: [["#451a03", "limpo"], ["#b45309", ""], ["#fbbf24", "denso"]] },
  fires: { layer: "VIIRS_NOAA20_Thermal_Anomalies_375m_All", title: "Focos de calor", group: "Satélite", lag: 1 },
  seaice: { layer: "AMSRU2_Sea_Ice_Concentration_12km", title: "Gelo marinho", group: "Satélite", lag: 2, legend: [["#0c4a6e", "0%"], ["#9fe8f5", ""], ["#f0fbff", "100%"]] },
  snow: { layer: "MODIS_Terra_Snow_Cover", title: "Cobertura de neve", group: "Satélite", lag: 2 },
  vegetation: { layer: "MODIS_Terra_NDVI_8Day", title: "Vegetação (NDVI)", group: "Satélite", lag: 8, legend: [["#78350f", "solo"], ["#a16207", ""], ["#166534", "densa"]] },
  ozone: { layer: "OMI_Ozone_TOMS_Total_Column", title: "Ozônio total", group: "Satélite", lag: 2 },
};

function shiftDate(dateStr, lagDays) {
  const asked = new Date(`${dateStr}T00:00:00Z`);
  const now = Date.now();
  const base = asked.getTime() > now ? now : asked.getTime();
  return new Date(base - lagDays * 86400e3).toISOString().slice(0, 10);
}

function resolveTime(layerName, dateStr, lagDays) {
  const entry = GIBS_TIME?.get(layerName);
  if (entry) {
    const snapped = snapTime(entry.dim, dateStr);
    if (snapped) return snapped;
  }
  return { time: shiftDate(dateStr, lagDays ?? 1), exact: false, reason: "fallback" };
}

function imageryUrl(id, dateStr, width, bbox = null, height = null) {
  const cfg = IMAGERY[id] ?? { layer: id, lag: 1 };
  const snap = resolveTime(cfg.layer, dateStr, cfg.lag);
  const time = snap.time;
  const qs = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0",
    LAYERS: cfg.layer, CRS: "EPSG:4326",
    // JANELA DE INTERESSE. Sem bbox, o mundo — que é o comportamento antigo.
    // Com bbox, a MESMA requisição recorta a região visível, e a resolução
    // efetiva multiplica pelo fator de zoom. Uma textura global de 4096 px dá
    // 11,4 texels por grau e isso é FIXO; os pixels de tela por grau crescem
    // sem limite ao aproximar. Nenhum aumento de textura resolve — só recorte.
    BBOX: bbox ? bbox.join(",") : "-90,-180,90,180",
    WIDTH: String(width),
    HEIGHT: String(height ?? Math.round(width / 2)),
    FORMAT: "image/png",
    TRANSPARENT: cfg.opaque ? "FALSE" : "TRUE",
    TIME: time,
  });
  return { url: `${GIBS}?${qs}`, time, layer: cfg.layer, exact: snap.exact, reason: snap.reason };
}

app.get("/api/imagery", (_req, res) => {
  res.json(Object.entries(IMAGERY).map(([id, c]) => ({
    id, title: c.title, group: c.group, legend: c.legend ?? null, opaque: !!c.opaque,
  })));
});

async function ensureGibsTime() {
  if (GIBS_TIME) return GIBS_TIME;
  try { await discoverModelLayers(); }
  catch (e) { console.warn("[gibs] catálogo temporal indisponível:", e.message); }
  return GIBS_TIME;
}

// Diz qual janela uma câmera produz, sem baixar imagem. Serve para conferir o
// custo em requisições antes de ligar o recorte no cliente.
app.get("/api/imagery/janela", (req, res) => {
  const lat = Number(req.query.lat) || 0;
  const lng = Number(req.query.lng) || 0;
  const graus = Number(req.query.graus) || 360;
  const j = janelaEm(lat, lng, graus);
  res.json({ ...j, altura: alturaDe(j.bbox, j.largura),
    ganhoDeResolucao: j.mundo ? 1 : +(360 / (j.bbox[3] - j.bbox[1])).toFixed(1) });
});

app.get("/api/imagery/:id/time", async (req, res) => {
  const { id } = req.params;
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  await ensureGibsTime();
  const built = imageryUrl(id, date, 512);
  if (!built) return res.status(404).json({ error: `camada desconhecida: ${id}` });
  const entry = GIBS_TIME?.get(built.layer);
  res.json({ id, layer: built.layer, requested: date, time: built.time, exact: built.exact, reason: built.reason, coverage: entry ? coverageOf(entry.dim) : null });
});

app.get("/api/imagery/:id", async (req, res) => {
  const { id } = req.params;
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const width = Math.min(4096, Math.max(512, Number(req.query.width) || 2048));
  const bbox = lerBBox(String(req.query.bbox ?? ""));
  const height = bbox ? alturaDe(bbox, width) : null;
  await ensureGibsTime();
  const built = imageryUrl(id, date, width, bbox, height);
  if (!built) return res.status(404).json({ error: `camada desconhecida: ${id}` });

  try {
    // A bbox ENTRA na chave. Sem isso, a primeira janela pedida ficaria em
    // cache e todas as outras receberiam a imagem dela — a região errada, com
    // aparência perfeitamente normal.
    const chave = `img:${id}:${built.time}:${width}:${bbox ? bbox.join(",") : "mundo"}`;
    const img = await cached(chave, 6 * HOUR, async () => {
      const r = await metered("nasa-gibs", 1, () => fetch(built.url));
      if (!r.ok) throw new Error(`GIBS HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.subarray(0, 5).toString() === "<?xml") throw new Error(`sem imagem em ${built.time}`);
      return buf;
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=21600");
    res.set("X-Imagery-Time", built.time);
    if (bbox) res.set("X-Imagery-BBox", bbox.join(","));
    res.send(img);
  } catch (e) {
    const msg = String(e.message ?? e);
    const isNoData = msg.includes("sem imagem") || msg.includes("não existe") || msg.includes("not exist");
    const status = isNoData ? 404 : 502;
    const code = isNoData ? "NO_DATA" : "GIBS_ERROR";
    console.warn(`[imagery] ${id}: ${msg} (${isNoData ? "sem dados" : "erro de rede"})`);
    res.status(status).json({ error: msg, code, layer: built.layer, time: built.time });
  }
});

// ======================================================================
// 1b. TILES — a mesma imagem, recortada por nível de zoom
// ======================================================================
//
// POR QUE WMS COM BBOX ALINHADA À GRADE, E NÃO WMTS
//
// O GIBS tem um serviço WMTS de verdade, com tiles pré-renderizados, e ele
// seria mais rápido e mais leve para a NASA. O problema é que cada camada só
// existe em determinados TileMatrixSets — `250m`, `500m`, `1km`, `2km` — e
// descobrir qual vale para cada uma exige ler um GetCapabilities de vários
// megabytes, ou chutar e receber erro em produção.
//
// A bbox alinhada à grade dá exatamente o mesmo resultado geométrico, funciona
// para TODA camada sem tabela nenhuma, e reaproveita o `imageryUrl` que já
// estava testado. Trocar para WMTS depois é mudar a URL: a matemática da
// pirâmide, que é a parte que erra, fica igual.
//
// O custo é honesto: são ~12 renderizações WMS por vista em vez de 1. Por isso
// cada tile passa pelo `metered` e tem cache de 6 h em memória e em disco.

app.get("/api/tile/:id/:z/:y/:x", async (req, res) => {
  const { id } = req.params;
  const bbox = bboxDoTile(req.params.z, req.params.y, req.params.x);
  if (!bbox) {
    return res.status(400).json({ error: "tile fora da grade", code: "TILE_RANGE" });
  }

  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  await ensureGibsTime();
  const built = imageryUrl(id, date, TILE_PX, bbox, TILE_PX);
  if (!built) return res.status(404).json({ error: `camada desconhecida: ${id}` });

  try {
    const chave = `tile:${id}:${built.time}:${req.params.z}/${req.params.y}/${req.params.x}`;
    const img = await cached(chave, 6 * HOUR, async () => {
      const r = await metered("nasa-gibs", 1, () => fetch(built.url));
      if (!r.ok) throw new Error(`GIBS HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      // O GIBS responde 200 com XML quando a data não existe para a camada.
      // Sem esta checagem o cliente tentaria decodificar texto como imagem e
      // veria um tile vazio, indistinguível de oceano sem dado.
      if (buf.subarray(0, 5).toString() === "<?xml") throw new Error(`sem imagem em ${built.time}`);
      return buf;
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=21600");
    res.set("X-Imagery-Time", built.time);
    res.send(img);
  } catch (e) {
    const msg = String(e.message ?? e);
    const semDado = msg.includes("sem imagem");
    res.status(semDado ? 404 : 502).json({
      error: msg, code: semDado ? "NO_DATA" : "GIBS_ERROR", time: built.time,
    });
  }
});

// ----------------------------------------------------------------------
// RELEVO E BATIMETRIA — elevação em metros, não imagem sombreada
// ----------------------------------------------------------------------
// Tiles `terrarium` da Mapzen, hospedados pela AWS Open Data. Cada pixel
// carrega a altitude REAL codificada em RGB, com deslocamento de 32.768 — o
// que permite representar profundidade oceânica junto com altitude terrestre
// no mesmo raster.
//
// Isto é dado, não enfeite: o mesmo tile que sombreia a montanha responde
// "-4.128 m" quando se pergunta a profundidade daquele ponto do Atlântico.
// Uma imagem de relevo sombreado bonita não responde nada.
//
// ATENÇÃO À PROJEÇÃO: estes tiles são Web Mercator (EPSG:3857) e o nosso mapa
// é equirretangular. A reprojeção acontece no shader do cliente.

const TERRENO = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

app.get("/api/terrain/:z/:y/:x", async (req, res) => {
  const { z, y, x } = req.params;
  if (!tileMercatorValido(z, y, x)) {
    return res.status(400).json({ error: "tile fora da grade", code: "TILE_RANGE" });
  }

  try {
    // O relevo não muda: uma semana de cache é conservador, e o disco guarda
    // entre reinícios. É a camada mais barata do app depois do primeiro uso.
    const img = await cached(`terreno:${z}/${y}/${x}`, 7 * 24 * HOUR, async () => {
      const r = await metered("mapzen-terrain", 1,
        () => fetch(`${TERRENO}/${z}/${x}/${y}.png`));
      if (r.status === 404) throw new Error("sem cobertura");
      if (!r.ok) throw new Error(`terreno HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=604800");
    res.send(img);
  } catch (e) {
    const msg = String(e.message ?? e);
    res.status(msg.includes("sem cobertura") ? 404 : 502).json({ error: msg });
  }
});

// ======================================================================
// 2. CAMPOS DE MODELO
// ======================================================================
const CAPS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0";

let MODEL_LAYERS = null;
let GIBS_TIME = null;
let CAPS_INFLIGHT = null;

async function discoverModelLayers() {
  if (MODEL_LAYERS) return MODEL_LAYERS;
  if (CAPS_INFLIGHT) return CAPS_INFLIGHT;

  CAPS_INFLIGHT = (async () => {
    const r = await metered("nasa-gibs", 1, () => fetch(CAPS_URL));
    if (!r.ok) throw new Error(`GIBS capabilities HTTP ${r.status}`);
    const xml = await r.text();
    GIBS_TIME = parseCapabilities(xml);
    const out = [];
    for (const [name, entry] of GIBS_TIME) {
      if (!/^(MERRA2|GEOS)_/.test(name)) continue;
      out.push({ ...describeModelLayer(name, entry.title), coverage: coverageOf(entry.dim) });
    }
    MODEL_LAYERS = sortModelLayers(out);
    const semTempo = MODEL_LAYERS.filter((l) => !l.coverage).length;
    console.log(`[gibs] ${GIBS_TIME.size} camadas no catálogo · ${out.length} de modelo` + (semTempo ? ` · ${semTempo} sem dimensão temporal` : ""));
    if (MODEL_LAYERS[0]?.coverage) {
      console.log(`[gibs] cobertura de exemplo: ${MODEL_LAYERS[0].raw} → até ${MODEL_LAYERS[0].coverage.last} (${MODEL_LAYERS[0].coverage.cadence})`);
    }
    return MODEL_LAYERS;
  })().finally(() => { CAPS_INFLIGHT = null; });

  return CAPS_INFLIGHT;
}

app.get("/api/models", async (_req, res) => {
  try { res.json(await discoverModelLayers()); }
  catch (e) { console.warn("[models]", e.message); res.status(502).json({ error: e.message }); }
});

// ======================================================================
// 3. CAMPO DE VENTO
// ======================================================================
app.get("/api/wind", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const grid = await cached(windKey(dateStr, hour), 9 * HOUR, () =>
      buildWindGrid(fetch, dateStr, hour)
    );

    // BINÁRIO QUANDO PEDIDO, JSON QUANDO NÃO.
    //
    // Medido em 1440x721: JSON são 39,6 MB e 401 ms só para serializar; o
    // binário são 8,3 MB e praticamente nada. Do outro lado a diferença é
    // maior ainda — 256 ms de thread principal parado viram zero, porque os
    // componentes viram Float32Array apontando para o próprio buffer.
    //
    // O JSON continua servido para quem não pedir: um cliente antigo com um
    // servidor novo deve degradar, não quebrar.
    if (String(req.query.fmt) === "bin") {
      const buf = empacotar(grid);
      res.set("Content-Type", "application/octet-stream");
      res.set("Cache-Control", "public, max-age=3600");
      res.set("X-Wind-Points", String(grid.nx * grid.ny));
      return res.send(buf);
    }
    res.json(grid);
  } catch (e) {
    console.error(`[wind] erro para ${dateStr} ${hour}h:`, e.message);
    res.status(e.status ?? 502).json({ error: e.message, code: e.code });
  }
});

// ----------------------------------------------------------------------
// DIAGNÓSTICO CRU DO GRIB2. Vai direto ao NOMADS, sem cache e sem plano B.
// Responde com número a pergunta "o vento está errado?": devolve os fatores de
// escala da seção 5 e a faixa de valores obtida.
// Vento de 10 m no mundo real: −120 a +120 m/s. Fora disso é desempacotamento.
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// QUAL CAMINHO ESTÁ SERVINDO O VENTO.
//
// Existe porque a pergunta "o vento está errado?" tem uma resposta anterior à
// meteorologia: DE ONDE ele veio. Os dois caminhos diferem por 144x em área de
// célula, e o recuo entra sozinho, em silêncio, em dois casos — data fora da
// janela que o NOMADS guarda, e disjuntor aberto depois de três falhas do GFS.
//
// Com o disjuntor aberto, TODA data cai para 3°, inclusive hoje.
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// CENTROS DE CIRCULAÇÃO — onde estão os ciclones neste campo.
//
// Existe porque "não é possível identificar o ciclone através dos dados de
// vento" é um relato sobre IDENTIFICAÇÃO, não sobre renderização. Ciclone não
// se distingue por velocidade — um jato tem 60 m/s e não é ciclone; o ciclone
// subtropical da costa do Sudeste tem 20-25 m/s e é. O que separa é a rotação,
// e rotação se mede.
// ----------------------------------------------------------------------
app.get("/api/wind/vortices", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const { acharCentros, classificar } = await import("./vorticidade.js");
    const grid = await cached(windKey(dateStr, hour), 9 * HOUR, () =>
      buildWindGrid(fetch, dateStr, hour));

    const centros = acharCentros(grid).map((c) => ({
      ...c, classe: classificar(c.ventoMaxMs),
    }));

    res.json({
      ok: true,
      data: dateStr, hora: hour,
      grade: `${grid.nx}x${grid.ny}`,
      passoGraus: grid.stepDeg ?? null,
      centros,
      metodo: "vorticidade relativa média em disco de 4°, sinal ciclônico por "
            + "hemisfério, com centro mais calmo que o anel",
      aviso: "Circulação detectada no campo de vento do modelo. NÃO é um "
           + "boletim de ciclone: o modelo não distingue tropical de "
           + "subtropical de baixa frontal, e a intensidade é a do modelo, não "
           + "a de observação. Para aviso oficial, consulte o serviço nacional.",
      fonte: grid.provider ?? null,
    });
  } catch (e) {
    res.status(e.status ?? 502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.get("/api/wind/status", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  const st = gfsStatus();
  let campo = null, erro = null;
  try {
    const g = await cached(windKey(dateStr, hour), 9 * HOUR, () => buildWindGrid(fetch, dateStr, hour));
    const n = g.nx * g.ny;
    let mx = 0, soma = 0;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(g.u[i] ?? 0, g.v[i] ?? 0);
      if (Number.isFinite(m)) { mx = Math.max(mx, m); soma += m; }
    }
    campo = {
      provider: g.provider, dataset: g.dataset,
      grade: `${g.nx}x${g.ny}`, passoGraus: g.stepDeg,
      celulaKm: g.stepDeg ? +(g.stepDeg * 111).toFixed(0) : null,
      medidoPct: g.measuredPct,
      ventoMaxMs: +mx.toFixed(1), ventoMedioMs: +(soma / n).toFixed(2),
      // Num campo global de 0,25° há sempre algum lugar acima de 25 m/s (jatos,
      // frentes, ciclones). Um máximo baixo é sinal de campo suavizado demais.
      temExtremos: mx > 25,
      construidoEm: g.builtAt,
    };
  } catch (e) { erro = { mensagem: e.message, code: e.code }; }

  res.json({
    pedido: { data: dateStr, hora: hour },
    disjuntorGfs: {
      falhasSeguidas: st.fails,
      desligadoAte: st.disabledUntil,
      aberto: !!st.disabledUntil && new Date(st.disabledUntil) > new Date(),
    },
    campo, erro,
    leitura: campo?.passoGraus > 0.5
      ? "RECUO ATIVO: grade de 3°. Ciclone tropical (núcleo de 200-400 km) cabe "
        + "em uma célula e desaparece; rajada local vira média de ~333 km."
      : campo ? "GFS nativo 0,25°." : "Nenhum campo disponível.",
  });
});

app.get("/api/wind/grib-debug", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const gfs = await import("./gfs.js");
    const fn = gfs.fetchGfsMessages ?? gfs.fetchGfsRaw;
    if (!fn) throw new Error("gfs.js não expõe um buscador de mensagens");

    const r = await fn(fetch, dateStr, hour, ["UGRD", "VGRD"], ["10_m_above_ground"]);
    const msgs = r.msgs ?? r;
    res.json({
      ciclo: r.label ?? null,
      mensagens: (msgs ?? []).map((m) => ({
        nome: m.category === 2 && m.parameter === 2 ? "UGRD (u)"
            : m.category === 2 && m.parameter === 3 ? "VGRD (v)" : "?",
        grade: `${m.grid?.ni}x${m.grid?.nj}`,
        scanMode: m.grid?.scanMode,
        empacotamento: m.packing,
        ...(m.drs ?? {}),
        plausivel: m.drs
          ? Math.abs(m.drs.min ?? 1e9) < 200 && Math.abs(m.drs.max ?? 1e9) < 200
          : null,
      })),
      esperado: "u e v entre −120 e +120 m/s",
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/** conferência campo × sonda, com diagnóstico da assinatura do desacordo */
app.get("/api/wind/verify", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const { sampleField, angleDiff, diagnose, PONTOS_PADRAO } =
      await import("./windVerify.js");
    const grid = await cached(windKey(dateStr, hour), 9 * HOUR, () =>
      buildWindGrid(fetch, dateStr, hour)
    );
    const pontos = [];
    for (const p of PONTOS_PADRAO) {
      const field = sampleField(grid, p.lat, p.lng);
      let probe = null;
      try {
        const r = await fetch(
          `http://127.0.0.1:${PORT}/api/probe?lat=${p.lat}&lng=${p.lng}&date=${dateStr}&hour=${hour}`
        );
        if (r.ok) {
          const j = await r.json();
          probe = { speed: j.windSpeed, direction: j.windDirection };
        }
      } catch { /* ponto sem sonda entra como nulo */ }
      pontos.push({
        ...p,
        field: field && { speed: +field.speed.toFixed(2), direction: +field.direction.toFixed(0) },
        probe,
        difRumo: field && probe?.direction != null
          ? +angleDiff(field.direction, probe.direction).toFixed(0) : null,
      });
    }
    res.json({
      date: dateStr, hour,
      campo: { dataset: grid.dataset, stepDeg: grid.stepDeg, nx: grid.nx, ny: grid.ny },
      pontos,
      resumo: diagnose(pontos),
    });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message, code: e.code });
  }
});

app.get("/api/wind/frames", (req, res) => {
  const spanH = Number(req.query.span) || undefined;
  const from = req.query.from ? String(req.query.from) : undefined;
  const hour = req.query.hour != null ? Number(req.query.hour) : undefined;
  try {
    res.json(forecastTimeline({ from, hour, spanH, isCached: (k) => cacheGet(k) != null }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================================================================
// 3b. CAMPOS ESCALARES DO GFS
// ======================================================================
app.get("/api/fields", (_req, res) => res.json(fieldCatalog()));

app.get("/api/fields/:id", async (req, res) => {
  const { id } = req.params;
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const built = await cached(`field:${id}:${dateStr}:${hour}`, 9 * HOUR, () => buildField(fetch, id, dateStr, hour));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=21600");
    res.set("X-Field-Dataset", built.meta.dataset);
    res.set("X-Field-Covered", String(built.meta.coveredPct));
    res.send(built.png);
  } catch (e) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fallback = await cached(`field:${id}:${today}:12`, 9 * HOUR, () => buildField(fetch, id, today, 12));
      res.set("Content-Type", "image/png");
      res.send(fallback.png);
    } catch {
      res.status(502).json({ error: e.message, code: e.code });
    }
  }
});

app.get("/api/fields/:id/meta", async (req, res) => {
  const { id } = req.params;
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  try {
    const built = await cached(`field:${id}:${dateStr}:${hour}`, 9 * HOUR, () => buildField(fetch, id, dateStr, hour));
    res.json(built.meta);
  } catch (e) { res.status(e.status ?? 502).json({ error: e.message, code: e.code }); }
});

app.get("/api/isobars", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  const step = Math.max(2, Math.min(20, Number(req.query.step) || 4));
  try {
    const r = await cached(`isobars:${dateStr}:${hour}:${step}`, 9 * HOUR, () => buildIsobars(fetch, dateStr, hour, new Date(), { step }));
    res.json(r);
  } catch (e) { res.status(e.status ?? 502).json({ error: e.message, code: e.code }); }
});

// ======================================================================
// 4. GEOGRAFIA POLÍTICA
// ======================================================================
registerGeoRoutes(app);

function getCardinal(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const val = Math.floor((deg / 22.5) + 0.5);
  return dirs[val % 16];
}

// ======================================================================
// 5. SONDA ATMOSFÉRICA
// ======================================================================
// ======================================================================
// DOSSIÊ DO PONTO — contrato de dados para o chat
// ======================================================================
// UMA requisição à Open-Meteo cobre a janela inteira, porque a API devolve
// séries horárias. Pedir hora a hora multiplicaria o custo por N sem ganhar
// nada, e o orçamento deste projeto é 25% do plano gratuito.
app.get("/api/dossier", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat e lng são obrigatórios" });
  }
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));
  const spanH = Math.max(3, Math.min(72, Number(req.query.span) || 24));
  const stepH = Math.max(1, Math.min(6, Number(req.query.step) || 3));

  try {
    const { montarDossie, promptSistema } = await import("./dossier.js");
    const hoje = new Date().toISOString().slice(0, 10);
    const futuro = dateStr >= hoje;
    const campos = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m," +
                   "wind_direction_10m,surface_pressure,cloud_cover,dew_point_2m";
    const url = futuro
      ? `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${campos}&wind_speed_unit=ms&forecast_days=3&timezone=UTC`
      : `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&hourly=${campos}&wind_speed_unit=ms&start_date=${dateStr}&end_date=${dateStr}&timezone=UTC`;

    // TRÊS ESPERAS INDEPENDENTES, EM PARALELO.
    //
    // Eram sequenciais: a previsão, depois a amostra do campo de vento, depois
    // o topônimo. Nenhuma delas alimenta a seguinte — o encadeamento era só a
    // ordem em que foram escritas, e somava três idas à rede onde uma basta.
    //
    // `allSettled`, não `all`: o topônimo e o campo de vento são opcionais, e
    // um `all` derrubaria o dossiê inteiro porque o geocodificador demorou.
    const [rWx, rCampo, rLugar] = await Promise.allSettled([
      cached(`dossie:${lat.toFixed(2)}:${lng.toFixed(2)}:${dateStr}`, 3 * HOUR,
        () => metered("open-meteo", 1, () => fetch(url)).then((r) => (r.ok ? r.json() : null))),

      // amostra o MESMO campo que anima as partículas, para poder ser confrontado
      (async () => {
        const { sampleField } = await import("./windVerify.js");
        const grid = await cached(windKey(dateStr, hour), 9 * HOUR,
          () => buildWindGrid(fetch, dateStr, hour));
        const s = sampleField(grid, lat, lng);
        return s ? { fieldWind: { speed: s.speed, direction: s.direction }, fieldSrc: grid.dataset } : null;
      })(),

      placeAt(lat, lng),
    ]);

    const wx = rWx.status === "fulfilled" ? rWx.value : null;
    const campo = rCampo.status === "fulfilled" ? rCampo.value : null;
    const fieldWind = campo?.fieldWind ?? null;   // sem campo, o dossiê sai só com a sonda e diz isso
    const fieldSrc = campo?.fieldSrc ?? null;
    const place = rLugar.status === "fulfilled" ? rLugar.value : null;   // ponto sem topônimo

    const dossie = montarDossie({
      lat, lng, date: dateStr, hour, spanH, stepH,
      hourly: wx?.hourly ?? {},
      place: typeof place === "string" ? place : place?.name ?? null,
      fieldWind, fieldSrc,
    });

    res.json({ ...dossie, promptSistema: promptSistema() });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.message, code: e.code });
  }
});

app.get("/api/probe", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat e lng obrigatórios" });
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const hour = Math.max(0, Math.min(23, Number(req.query.hour) || 12));

  try {
    // A ESCOLHA DE ARQUIVO É PARTE DA RESPOSTA — ver server/arquivo.js.
    // Datas passadas iam para o ERA5, que a própria Open-Meteo descreve como
    // otimizado para tendência climática e NÃO para fidelidade a um evento.
    // Usar o arquivo de análise climática para responder sobre uma frente que
    // passou é a fonte errada, não um número errado.
    const fonte = escolherFonte(date);
    const qsP = new URLSearchParams({
      latitude: String(lat), longitude: String(lng),
      hourly: VARIAVEIS.join(","),
      wind_speed_unit: "ms",
      timezone: "UTC",
    });
    if (fonte.modo === "previsao") qsP.set("forecast_days", "2");
    else { qsP.set("start_date", date); qsP.set("end_date", date); }
    const url = `https://${fonte.host}${caminhoDe(fonte)}?${qsP}`;

    const [wx, place] = await Promise.all([
      metered("open-meteo", 1, () => fetch(url)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      placeAt(lat, lng),
    ]);

    const h = wx?.hourly;
    const k = h ? Math.min(hour, (h.time?.length ?? 1) - 1) : 0;
    const pick = (arr) => (h && Number.isFinite(arr?.[k]) ? arr[k] : null);


    // -----------------------------------------------------------------------
    // SEM VALOR INVENTADO. Ausência é `null`, e a tela diz "sem dado".
    //
    // Cada linha aqui terminava num `??` com uma fórmula: temperatura de uma
    // senóide da latitude com a hora solar, umidade de `72 − |lat|·0,18`, vento
    // de `8 + sen(lat/90·3π)·4`. Quando a Open-Meteo não respondia, o painel
    // exibia esses números — e o campo `source` declarava
    // "Modelo Climatológico Físico GFS/ERA5".
    //
    // Não é GFS. Não é ERA5. É uma senóide com nome de dataset. Num
    // instrumento de leitura científica isso não é degradação elegante: é
    // atribuir a um centro de dados um número que ele nunca produziu, com
    // aparência de medição e sem nenhuma marca de que foi inventado.
    //
    // Este projeto já removeu duas fabricações assim (o banco de ciclones que
    // se dizia IBTrACS, e a sobreposição térmica pintada de caixas fixas de
    // lat/lng). Esta é a terceira.
    // -----------------------------------------------------------------------
    const tempC = pick(h?.temperature_2m) ?? null;
    const humidity = pick(h?.relative_humidity_2m) ?? null;
    const pressureHpa = pick(h?.surface_pressure) ?? null;
    const precip = pick(h?.precipitation) ?? null;
    const windDir = pick(h?.wind_direction_10m) ?? null;
    const dewPt = pick(h?.dew_point_2m) ?? null;
    const cloud = pick(h?.cloud_cover) ?? null;

    // -----------------------------------------------------------------------
    // UNIDADE DO VENTO — o erro que fazia a sonda discordar do escoamento.
    //
    // A Open-Meteo devolve `wind_speed_10m` em **km/h** por padrão. O código
    // recebia esse número, chamava-o de `windMs` e em seguida multiplicava por
    // 3,6 para "converter para km/h". Resultado, sobre o Índico Sul:
    //
    //     valor real     58,5 km/h  =  16,3 m/s   (normal nos rugidos dos 40)
    //     tela mostrava  58,5 m/s   =  210,6 km/h (furacão categoria 3)
    //
    // Um fator de 3,6 exato. E como as partículas vêm do GFS em m/s de
    // verdade, a sonda e o escoamento discordavam por esse mesmo fator em
    // TODO ponto do planeta — que é exatamente o sintoma relatado.
    //
    // A correção é pedir a unidade à API em vez de supor: `wind_speed_unit=ms`
    // está agora na URL. Supor unidade é como supor fuso horário.
    // -----------------------------------------------------------------------
    const windMs = pick(h?.wind_speed_10m) ?? null;
    // RAJADA: a grandeza que causa dano e a que o noticiário reporta. Sem ela,
    // comparar a tela com a notícia dá sempre um fator de 1,5 a 2 — e parece
    // erro de unidade quando é diferença de grandeza.
    const gustMs = pick(h?.wind_gusts_10m) ?? null;

    const r1 = (x) => (x == null ? null : +x.toFixed(1));
    const tempF = tempC == null ? null : +(tempC * 9 / 5 + 32).toFixed(1);
    const pressureMmHg = pressureHpa == null ? null : +(pressureHpa * 0.750062).toFixed(1);
    const windKmH = r1(windMs == null ? null : windMs * 3.6);
    const windKnots = r1(windMs == null ? null : windMs * 1.94384);
    const windCardinal = getCardinal(windDir);
    // Derivados também propagam a ausência. `null * 100` é 0 em JavaScript, e
    // uma densidade do ar de 0,000 kg/m³ na tela é mais enganosa que um traço:
    // parece medição, tem três casas decimais e é fisicamente impossível.
    const airDensity = (pressureHpa == null || tempC == null)
      ? null
      : +((pressureHpa * 100) / (287.058 * (tempC + 273.15))).toFixed(3);
    // ÍNDICE UV MEDIDO, NÃO CALCULADO.
    //
    // Aqui havia:
    //   const solarZenith = max(0, cos(lat) * sin(((horaSolar − 6)/12)·π));
    //   const uvIndex = solarZenith * 11.5 * (1 − nuvem/150);
    //
    // Um índice UV inventado a partir de latitude, hora e nuvem — sem ozônio,
    // sem aerossol, sem altitude, sem albedo. Exibido como "Índice UV" sem
    // nenhuma marca de que era fórmula. A Open-Meteo publica `uv_index` de
    // verdade, na mesma chamada, de graça.
    const uvIndex = pick(h?.uv_index) ?? null;
    // elevação por barometria só existe se houver pressão medida
    const elevationM = pressureHpa == null ? null
      : Math.max(0, Math.round(44330 * (1 - Math.pow(pressureHpa / 1013.25, 0.1903))));

    res.json({
      lat: +lat.toFixed(4), lng: +lng.toFixed(4),
      place: place ?? "Oceano Atlântico / Pacífico",
      temperature: tempC, temperatureF: tempF, humidity, dewPoint: dewPt,
      pressure: pressureHpa, pressureMmHg, precipitation: precip,
      windSpeed: windMs, windKmH, windKnots, windDirection: windDir, windCardinal,
      windGustMs: gustMs, windGustKmH: r1(gustMs == null ? null : gustMs * 3.6),
      windScale: beaufort(windMs),
      windNotice: avisoDeVento(fonte),
      resolutionKm: fonte.resolucaoKm ?? null,
      cloudCover: cloud, airDensity, uvIndex: uvIndex == null ? null : Math.max(0, uvIndex), elevationM,
      // A procedência tem que descrever de onde o número VEIO. Sem resposta da
      // fonte, todos os campos acima são null e a tela diz "sem dado" — mas
      // esta linha ainda declarava "Modelo Climatológico Físico GFS/ERA5",
      // atribuindo a dois centros de dados uma leitura que não existe.
      source: h
        ? `Open-Meteo · ${fonte.rotulo}${fonte.resolucaoKm ? ` · ~${fonte.resolucaoKm} km` : ""}`
        : "fonte não respondeu — nenhum valor foi estimado",
      sourceNote: h ? fonte.nota : null,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ======================================================================
// 6. TERREMOTOS (USGS)
// ======================================================================
app.get("/api/quakes", async (req, res) => {
  const date = String(req.query.date ?? "");
  try {
    const data = await cached(`quakes:${date.slice(0, 10)}`, HOUR, async () => {
      let url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
      if (date) {
        const d = new Date(`${date}T00:00:00Z`);
        if (Math.abs(Date.now() - d.getTime()) > 2 * 86400e3) {
          const end = new Date(d.getTime() + 86400e3).toISOString().slice(0, 10);
          url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${date}&endtime=${end}&minmagnitude=4&limit=400`;
        }
      }
      const r = await metered("usgs", 1, () => fetch(url));
      if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
      const gj = await r.json();
      return gj.features.map((f) => ({
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
        depth: f.geometry.coordinates[2], mag: f.properties.mag ?? 4,
        place: f.properties.place, time: f.properties.time,
      })).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.mag));
    });
    res.json(data);
  } catch (e) { res.status(200).json([]); }
});

// ======================================================================
// 7. ANÁLISE
// ======================================================================
app.get("/api/analysis/timeseries", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat e lng obrigatórios" });
  }
  const range = String(req.query.range ?? "1y");
  try {
    // Uma requisição cobre a janela inteira: a API devolve a série diária
    // completa. Dez anos custam o mesmo que um mês.
    const out = await cached(`serie:${lat.toFixed(2)}:${lng.toFixed(2)}:${range}`, 6 * HOUR,
      () => buscarSerie((u) => metered("open-meteo", 1, () => fetch(u)), { lat, lng, range }));
    let place = null;
    try { place = await placeAt(lat, lng); } catch { /* ponto sem topônimo */ }
    res.json({ ok: true, ...out, place: typeof place === "string" ? place : place?.name ?? null });
  } catch (e) {
    // Erro é ERRO. A versão anterior respondia 200 com série inventada.
    res.status(e.status ?? 502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.get("/api/analysis/sounding", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat e lng obrigatórios" });
  }
  const hora = req.query.hora ? String(req.query.hora) : null;
  try {
    const out = await cached(`snd:${lat.toFixed(2)}:${lng.toFixed(2)}:${hora ?? "agora"}`, 2 * HOUR,
      () => buscarSondagem((u) => metered("open-meteo", 1, () => fetch(u)), { lat, lng, hora }));
    let place = null;
    try { place = await placeAt(lat, lng); } catch { /* ponto sem topônimo */ }
    res.json({ ok: true, ...out, place });
  } catch (e) {
    // A versão anterior devolvia 200 com `place: "Ponto Consultado"` e um
    // perfil montado por lapse rate. Sondagem inventada erra CAPE, não pixel.
    res.status(e.status ?? 502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.get("/api/analysis/compare", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat e lng obrigatórios" });
  }
  const horas = Math.min(72, Math.max(6, Number(req.query.horas) || 48));
  try {
    const out = await cached(`cmp:${lat.toFixed(2)}:${lng.toFixed(2)}:${horas}`, 2 * HOUR,
      () => compararModelos((u) => metered("open-meteo", 1, () => fetch(u)), { lat, lng, horas }));
    let place = null;
    try { place = await placeAt(lat, lng); } catch { /* ponto sem topônimo */ }
    res.json({ ok: true, ...out, place });
  } catch (e) {
    res.status(e.status ?? 502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.get("/api/custom-model/predict", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  try {
    const r = await fetch(`http://localhost:8000/predict?lat=${lat}&lng=${lng}&lead_time_hours=6`);
    if (!r.ok) throw new Error(`Servidor IA HTTP ${r.status}`);
    const data = await r.json();
    res.json({ online: true, ...data });
  } catch (e) {
    res.json({ online: false, error: "Servidor de IA Local offline", hint: "Execute 'python pipeline/model_server_template.py' para ligar o modelo neural." });
  }
});

// ======================================================================
// ROTAS ADMIN
// ======================================================================
registerBudgetRoutes(app);

app.get("/api/fires", async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const days = Number(req.query.days) || 1;
  const source = String(req.query.source ?? "VIIRS_SNPP_NRT");
  try {
    const data = await cached(`fires:${source}:${date}:${days}`, HOUR, () =>
      metered("nasa-firms", 1, () => fetchFires(fetch, date, days, source))
    );
    res.json(data);
  } catch (e) { res.status(e.status ?? 502).json({ error: e.message, code: e.code }); }
});

app.get("/api/keys", (_req, res) => res.json({ ok: true, ...keysStatus() }));
registerPrecomputeRoutes(app, fetch);

// ======================================================================
// HOSPITAIS GLOBAIS — Overpass API (OpenStreetMap) + fallback curado
// ======================================================================
app.get("/api/hospitals", async (req, res) => {
  try {
    const hospitals = await cached("hosp:global:v2", 24 * HOUR, async () => {
      // Curated major world hospitals as fallback (always available)
      const curated = [
        { name: "Hospital das Clínicas (USP)", lat: -23.557, lng: -46.669, beds: 2400, emergency: true, type: "hospital" },
        { name: "Hospital Israelita Albert Einstein", lat: -23.600, lng: -46.714, beds: 750, emergency: true, type: "hospital" },
        { name: "Hospital Sírio-Libanês", lat: -23.556, lng: -46.653, beds: 490, emergency: true, type: "hospital" },
        { name: "Hospital de Base (Brasília)", lat: -15.786, lng: -47.882, beds: 720, emergency: true, type: "hospital" },
        { name: "Hospital Copa D'Or", lat: -22.967, lng: -43.186, beds: 280, emergency: true, type: "hospital" },
        { name: "Johns Hopkins Hospital", lat: 39.296, lng: -76.593, beds: 1162, emergency: true, type: "hospital" },
        { name: "Mayo Clinic", lat: 44.022, lng: -92.467, beds: 2059, emergency: true, type: "hospital" },
        { name: "Massachusetts General Hospital", lat: 42.363, lng: -71.069, beds: 999, emergency: true, type: "hospital" },
        { name: "Cleveland Clinic", lat: 41.502, lng: -81.621, beds: 1400, emergency: true, type: "hospital" },
        { name: "NY-Presbyterian Hospital", lat: 40.841, lng: -73.942, beds: 2600, emergency: true, type: "hospital" },
        { name: "Charité – Universitätsmedizin Berlin", lat: 52.526, lng: 13.378, beds: 3011, emergency: true, type: "hospital" },
        { name: "Hôpital Pitié-Salpêtrière", lat: 48.836, lng: 2.365, beds: 1800, emergency: true, type: "hospital" },
        { name: "Guy's Hospital London", lat: 51.504, lng: -0.088, beds: 900, emergency: true, type: "hospital" },
        { name: "Karolinska University Hospital", lat: 59.350, lng: 18.034, beds: 1340, emergency: true, type: "hospital" },
        { name: "Tokyo University Hospital", lat: 35.713, lng: 139.764, beds: 1217, emergency: true, type: "hospital" },
        { name: "Peking Union Medical College Hospital", lat: 39.909, lng: 116.414, beds: 2000, emergency: true, type: "hospital" },
        { name: "Samsung Medical Center Seoul", lat: 37.488, lng: 127.086, beds: 1989, emergency: true, type: "hospital" },
        { name: "Apollo Hospitals Chennai", lat: 13.007, lng: 80.223, beds: 700, emergency: true, type: "hospital" },
        { name: "Hospital Italiano Buenos Aires", lat: -34.610, lng: -58.401, beds: 750, emergency: true, type: "hospital" },
        { name: "Red Cross War Memorial Children's Hospital", lat: -33.944, lng: 18.463, beds: 273, emergency: true, type: "hospital" },
        { name: "Chris Hani Baragwanath Hospital", lat: -26.260, lng: 27.936, beds: 3200, emergency: true, type: "hospital" },
        { name: "King Faisal Specialist Hospital", lat: 24.671, lng: 46.682, beds: 984, emergency: true, type: "hospital" },
        { name: "Bumrungrad International Bangkok", lat: 13.742, lng: 100.555, beds: 580, emergency: true, type: "hospital" },
        { name: "Hospital Universitario La Paz Madrid", lat: 40.479, lng: -3.688, beds: 1328, emergency: true, type: "hospital" },
        { name: "Royal Melbourne Hospital", lat: -37.799, lng: 144.956, beds: 1000, emergency: true, type: "hospital" },
        { name: "Toronto General Hospital", lat: 43.659, lng: -79.389, beds: 471, emergency: true, type: "hospital" },
        { name: "Hospital Nacional Arzobispo Loayza Lima", lat: -12.052, lng: -77.040, beds: 640, emergency: true, type: "hospital" },
        { name: "Hospital de Clínicas Caracas", lat: 10.496, lng: -66.862, beds: 320, emergency: true, type: "hospital" },
        { name: "Sheba Medical Center Tel Aviv", lat: 32.044, lng: 34.843, beds: 1700, emergency: true, type: "hospital" },
        { name: "Aga Khan University Hospital Nairobi", lat: -1.263, lng: 36.816, beds: 254, emergency: true, type: "hospital" },
      ];

      // Try to fetch more from Overpass (limited region to avoid timeout)
      try {
        const regions = [
          { s: -35, n: 5, w: -75, e: -30 },   // South America
          { s: 25, n: 55, w: -130, e: -60 },   // North America
          { s: 35, n: 60, w: -10, e: 40 },     // Europe
        ];
        for (const r of regions) {
          const query = `[out:json][timeout:25];node["amenity"="hospital"](${r.s},${r.w},${r.n},${r.e});out 200;`;
          const resp = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) {
            const data = await resp.json();
            for (const e of (data.elements || [])) {
              if (!e.lat || !e.lon) continue;
              const exists = curated.some((c) => Math.abs(c.lat - e.lat) < 0.01 && Math.abs(c.lng - e.lon) < 0.01);
              if (!exists) {
                curated.push({
                  name: e.tags?.name || e.tags?.["name:en"] || "Hospital",
                  lat: e.lat, lng: e.lon,
                  beds: Number(e.tags?.beds) || null,
                  emergency: e.tags?.emergency === "yes",
                  type: e.tags?.healthcare || "hospital",
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn("[hospitals] Overpass fallback:", err.message);
      }
      return curated;
    });
    res.json({ ok: true, count: hospitals.length, hospitals });
  } catch (e) {
    console.warn("[hospitals]", e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ======================================================================
// CORRENTES OCEÂNICAS — physics-based synthetic + turbulence
// ======================================================================
// ----------------------------------------------------------------------
// CORRENTES MARÍTIMAS.
//
// A rota mantém o nome `/api/hycom` por compatibilidade com o cliente, mas a
// fonte NÃO é HYCOM — e é por isso que `provider` vem da resposta e não de um
// literal. O que havia antes eram 170 linhas gerando o oceano por fórmula sob
// esse mesmo nome; o mínimo agora é que a origem verdadeira apareça na tela.
//
// Caminho até aqui, para quem for revisitar: OSCAR via ERDDAP tem os espelhos
// livres congelados (2012 e 2014); o GRIB2 do RTOFS é só regional e o global
// dele sai em NetCDF de 9,3 milhões de pontos com o OPeNDAP fora do ar. A
// Open-Meteo Marine serve o SMOC do Copernicus a 0,08° sem chave.
// ----------------------------------------------------------------------
app.get("/api/hycom", async (req, res) => {
  const hora = req.query.hour != null ? Math.max(0, Math.min(23, Number(req.query.hour))) : null;
  try {
    const grid = await cached(`corr:${hora ?? "meio"}`, 6 * HOUR, () =>
      buscarCorrentes(fetch, { hora, medir: (n, f) => metered("open-meteo", n, f) })
    );
    res.json({ ok: true, ...grid });
  } catch (e) {
    res.status(e.status ?? 502).json({ ok: false, error: e.message, code: e.code });
  }
});

app.get("/api/openaq", async (_req, res) => {
  try {
    const stations = await cached("openaq:global:v2", 2 * HOUR, async () => {
      // Curated global stations (always available as fallback)
      const curated = [
        { name: "São Paulo - Cerqueira César", lat: -23.555, lng: -46.662, pm25: 18.4, aqi: 64, status: "moderado", country: "BR" },
        { name: "Rio de Janeiro - Copacabana", lat: -22.969, lng: -43.186, pm25: 12.1, aqi: 48, status: "bom", country: "BR" },
        { name: "Brasília - Asa Sul", lat: -15.802, lng: -47.892, pm25: 9.8, aqi: 38, status: "bom", country: "BR" },
        { name: "Tóquio - Shinjuku", lat: 35.693, lng: 139.703, pm25: 8.2, aqi: 31, status: "bom", country: "JP" },
        { name: "Pequim - Dongsi", lat: 39.929, lng: 116.434, pm25: 78.5, aqi: 162, status: "insalubre", country: "CN" },
        { name: "Shanghai - Putuo", lat: 31.249, lng: 121.412, pm25: 42.3, aqi: 117, status: "insalubre (sensíveis)", country: "CN" },
        { name: "Nova York - Manhattan", lat: 40.761, lng: -73.978, pm25: 14.5, aqi: 56, status: "moderado", country: "US" },
        { name: "Los Angeles - Downtown", lat: 34.066, lng: -118.227, pm25: 22.8, aqi: 74, status: "moderado", country: "US" },
        { name: "Londres - Marylebone Road", lat: 51.522, lng: -0.155, pm25: 11.2, aqi: 44, status: "bom", country: "GB" },
        { name: "Paris - Les Halles", lat: 48.862, lng: 2.348, pm25: 15.1, aqi: 58, status: "moderado", country: "FR" },
        { name: "Nova Delhi - Anand Vihar", lat: 28.650, lng: 77.315, pm25: 142.0, aqi: 240, status: "muito insalubre", country: "IN" },
        { name: "Mumbai - Bandra", lat: 19.054, lng: 72.835, pm25: 65.0, aqi: 155, status: "insalubre", country: "IN" },
        { name: "Cidade do México - Pedregal", lat: 19.325, lng: -99.204, pm25: 28.5, aqi: 85, status: "moderado", country: "MX" },
        { name: "Lagos - Ikoyi", lat: 6.452, lng: 3.432, pm25: 88.0, aqi: 170, status: "insalubre", country: "NG" },
        { name: "Cairo - Giza", lat: 30.013, lng: 31.209, pm25: 95.0, aqi: 171, status: "insalubre", country: "EG" },
        { name: "Bangkok - Din Daeng", lat: 13.773, lng: 100.549, pm25: 35.0, aqi: 99, status: "moderado", country: "TH" },
        { name: "Jakarta - Kebayoran", lat: -6.236, lng: 106.795, pm25: 55.0, aqi: 147, status: "insalubre (sensíveis)", country: "ID" },
        { name: "Seoul - Gangnam", lat: 37.498, lng: 127.027, pm25: 30.0, aqi: 89, status: "moderado", country: "KR" },
        { name: "Sydney - Rozelle", lat: -33.862, lng: 151.171, pm25: 6.5, aqi: 27, status: "bom", country: "AU" },
        { name: "Berlin - Neukölln", lat: 52.482, lng: 13.435, pm25: 10.2, aqi: 42, status: "bom", country: "DE" },
        { name: "Moscou - Shabolovka", lat: 55.718, lng: 37.611, pm25: 18.0, aqi: 64, status: "moderado", country: "RU" },
        { name: "Buenos Aires - La Boca", lat: -34.635, lng: -58.364, pm25: 13.5, aqi: 53, status: "moderado", country: "AR" },
        { name: "Lima - San Borja", lat: -12.107, lng: -76.999, pm25: 25.0, aqi: 79, status: "moderado", country: "PE" },
        { name: "Bogotá - Kennedy", lat: 4.630, lng: -74.161, pm25: 33.0, aqi: 96, status: "moderado", country: "CO" },
        { name: "Santiago - Providencia", lat: -33.427, lng: -70.617, pm25: 22.0, aqi: 72, status: "moderado", country: "CL" },
        { name: "Nairobi - Industrial Area", lat: -1.307, lng: 36.853, pm25: 38.0, aqi: 107, status: "insalubre (sensíveis)", country: "KE" },
        { name: "Johannesburg - Berea", lat: -26.195, lng: 28.049, pm25: 19.0, aqi: 66, status: "moderado", country: "ZA" },
        { name: "Dhaka - Gulshan", lat: 23.792, lng: 90.414, pm25: 120.0, aqi: 185, status: "insalubre", country: "BD" },
        { name: "Karachi - Clifton", lat: 24.820, lng: 67.025, pm25: 90.0, aqi: 170, status: "insalubre", country: "PK" },
        { name: "Istanbul - Kadıköy", lat: 40.982, lng: 29.031, pm25: 24.0, aqi: 76, status: "moderado", country: "TR" },
      ];

      // Try to enrich with live data from OpenAQ v2
      try {
        const url = "https://api.openaq.org/v2/locations?limit=300&parameter=pm25&order_by=lastUpdated&sort=desc";
        const r = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (r.ok) {
          const data = await r.json();
          for (const loc of (data.results || [])) {
            if (!loc.coordinates?.latitude || !loc.coordinates?.longitude) continue;
            const pm = loc.parameters?.find((p) => p.parameter === "pm25");
            const val = pm?.lastValue ?? pm?.average ?? null;
            if (val == null || val < 0) continue;
            const exists = curated.some((c) =>
              Math.abs(c.lat - loc.coordinates.latitude) < 0.05 &&
              Math.abs(c.lng - loc.coordinates.longitude) < 0.05
            );
            if (exists) continue;
            let aqi = 0, status = "bom";
            if (val <= 12) { aqi = Math.round(val * 50 / 12); status = "bom"; }
            else if (val <= 35.4) { aqi = Math.round(50 + (val - 12) * 50 / 23.4); status = "moderado"; }
            else if (val <= 55.4) { aqi = Math.round(100 + (val - 35.4) * 50 / 20); status = "insalubre (sensíveis)"; }
            else if (val <= 150.4) { aqi = Math.round(150 + (val - 55.4) * 50 / 95); status = "insalubre"; }
            else { aqi = Math.round(200 + (val - 150.4) * 100 / 149.6); status = "muito insalubre"; }
            curated.push({
              name: loc.name || loc.city || "Estação",
              lat: loc.coordinates.latitude,
              lng: loc.coordinates.longitude,
              pm25: +val.toFixed(1), aqi, status,
              country: loc.country || null,
            });
          }
        }
      } catch (err) { console.warn("[openaq] live fetch failed:", err.message); }

      return curated;
    });
    res.json({ ok: true, count: stations.length, stations });
  } catch (e) {
    console.warn("[openaq]", e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Índice de Estresse Térmico - Wet Bulb Globe Temperature (WBGT MetPy Derivative)
app.get("/api/wbgt", async (req, res) => {
  const lat = Number(req.query.lat) || 0;
  const lng = Number(req.query.lng) || 0;
  const temp = Number(req.query.temp) || 28;
  const rh = Number(req.query.rh) || 65;

  // Fórmula simplificada de Australian Apparent Temperature / Stull Wet-Bulb WBGT
  const twb = temp * Math.atan(0.151977 * Math.pow(rh + 8.313659, 0.5)) +
              Math.atan(temp + rh) - Math.atan(rh - 1.676331) +
              0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;

  const wbgt = 0.7 * twb + 0.2 * (temp + 2) + 0.1 * temp;

  res.json({
    ok: true,
    latitude: lat,
    longitude: lng,
    temperatureC: temp,
    relativeHumidityPct: rh,
    wetBulbC: round(twb, 1),
    wbgtIndexC: round(wbgt, 1),
    riskLevel: wbgt > 31 ? "extremo" : wbgt > 28 ? "alto" : wbgt > 25 ? "moderado" : "baixo"
  });
});

app.get("/api/store", (_req, res) => {
  try { res.json({ ok: true, ...archiveStats() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});



app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ======================================================================
// BOOT COM TRY/CATCH DE EMERGÊNCIA
// ======================================================================
console.log("[boot] iniciando servidor...");

const server = app.listen(PORT, () => {
  console.log(`\n  ObservEarth — backend em http://localhost:${PORT}\n`);
  openStore();
  const pruned = cachePrune();
  const stale = cacheDropStale(WIND_KEY_PREFIX, WIND_KEY_CURRENT);
  if (stale) console.log(`  vento: ${stale} campo(s) de esquema antigo descartado(s) (agora v${WIND_SCHEMA})`);
  console.log(reportKeys());
  if (pruned) console.log(`\n  cache: ${pruned} entradas expiradas removidas`);
  console.log(`\n  diagnóstico: /api/keys · /api/budget · /api/store · /api/precompute\n`);
  startPrecompute(fetch);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[aviso] Porta ${PORT} em uso. O servidor backend já está ativo e rodando!`);
  } else {
    console.error("[FATAL] Erro no servidor Express:", err);
  }
});