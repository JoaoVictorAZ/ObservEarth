import { buildWindGrid, windKey } from "./wind.js";
import { cacheSet, cacheGet, archive } from "./store.js";
import { canSpend, capOf, report as budgetReport } from "./budget.js";
import { forecastTimeline, DEFAULT_SPAN_H } from "./forecast.js";

// ─── constantes ───
const HEADROOM_STOP = 0.6;
const ESSENTIAL = 4;
const REFRESH_MS = 6 * 3600e3;
const TTL_MS = 9 * 3600e3;
const SPAN_H = DEFAULT_SPAN_H;
const GAP_MS = 2000;
const MAX_ERRORS_KEPT = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const status = {
  enabled: false,
  running: false,
  lastRun: null,
  lastDurationMs: null,
  slotsWarm: 0,
  slotsTotal: 0,
  calls: 0,
  skippedFresh: 0,
  errors: [],
  nextRunAt: null,
};

// ─── helpers ───
function dailyUsedFraction() {
  const p = budgetReport().providers.find((x) => x.id === "open-meteo");
  const cap = capOf("open-meteo", "day");
  if (!p || !cap || cap <= 0) return 1;
  return Math.min(1, p.used / cap);
}

function dailyExhausted() {
  return dailyUsedFraction() >= 1;
}

function slots() {
  return forecastTimeline({ spanH: SPAN_H }).frames.map((f) => [f.date, f.hour]);
}

// ─── execução principal ───
async function runOnce(fetchImpl, { force = false } = {}) {
  if (status.running) return status;
  status.running = true;
  const t0 = Date.now();
  const errs = [];
  let calls = 0;
  let warm = 0;
  let skipped = 0;
  let list = [];                    // ⬅️ declara fora do try para estar no escopo do finally

  try {
    list = slots();
    for (let i = 0; i < list.length; i++) {
      const [date, hour] = list[i];
      const key = windKey(date, hour);

      if (!force && cacheGet(key)) {
        skipped++;
        warm++;
        continue;
      }

      if (i >= ESSENTIAL && dailyUsedFraction() > HEADROOM_STOP) {
        errs.push(
          `parou em +${i * 3}h: ${Math.round(dailyUsedFraction() * 100)}% do teto ` +
          `diário usado (o resto carrega sob demanda)`
        );
        break;
      }

      let waited = 0;
      while (!canSpend("open-meteo", 4) && waited < 180_000) {
        if (!canSpend("open-meteo", 1) && dailyExhausted()) break;
        await sleep(5000);
        waited += 5000;
      }
      if (!canSpend("open-meteo", 4)) {
        errs.push(`sem folga de orçamento para ${date} ${hour}h (aguardou ${waited / 1000}s)`);
        continue;
      }

      try {
        const grid = await buildWindGrid(fetchImpl, date, hour);
        cacheSet(key, grid, TTL_MS);
        archive("wind", key, grid, "Open-Meteo");
        calls += grid.requests ?? 2;
        warm++;
      } catch (e) {
        errs.push(`${date} ${hour}h: ${e.message}`);
        if (e.code === "BUDGET_EXCEEDED") break;
      }
      await sleep(GAP_MS);
    }
  } finally {
    status.running = false;
    status.lastRun = new Date().toISOString();
    status.lastDurationMs = Date.now() - t0;
    status.slotsWarm = warm;
    status.slotsTotal = list.length;
    status.calls = calls;
    status.skippedFresh = skipped;
    status.errors = errs.slice(0, MAX_ERRORS_KEPT);
    status.nextRunAt = new Date(Date.now() + REFRESH_MS).toISOString();

    console.log(
      `[precompute] ${warm}/${list.length} fatias quentes · ${calls} chamadas · ` +
      `${skipped} já em cache · ${(status.lastDurationMs / 1000).toFixed(1)}s` +
      (errs.length ? ` · ${errs.length} erro(s)` : "")
    );
  }
  return status;
}

// ─── lifecycle ───
export function startPrecompute(fetchImpl, { delayMs = 8000 } = {}) {
  if (process.env.PRECOMPUTE === "off") {
    console.log("[precompute] desligado por PRECOMPUTE=off");
    return null;
  }
  status.enabled = true;
  status.nextRunAt = new Date(Date.now() + delayMs).toISOString();

  const boot = setTimeout(() => {
    runOnce(fetchImpl).catch((e) => console.warn("[precompute] falhou:", e.message));
  }, delayMs);
  if (typeof boot.unref === "function") boot.unref();

  const timer = setInterval(() => {
    runOnce(fetchImpl).catch((e) => console.warn("[precompute] falhou:", e.message));
  }, REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop: () => {
      clearTimeout(boot);
      clearInterval(timer);
      status.enabled = false;
    },
  };
}

export function precomputeStatus() {
  const list = slots();
  const detail = list.map(([d, h]) => ({
    date: d,
    hour: h,
    warm: !!cacheGet(windKey(d, h)),
  }));
  return {
    ...status,
    refreshHours: REFRESH_MS / 3600e3,
    ttlHours: TTL_MS / 3600e3,
    estimatedCallsPerDay: (24 / (REFRESH_MS / 3600e3)) * list.length * 2,
    slots: detail,
  };
}

export function registerPrecomputeRoutes(app, fetchImpl) {
  app.get("/api/precompute", (_req, res) => res.json({ ok: true, ...precomputeStatus() }));
  app.post("/api/precompute/run", async (_req, res) => {
    try {
      res.json({ ok: true, ...(await runOnce(fetchImpl, { force: false })) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}