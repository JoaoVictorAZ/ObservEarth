
export const PROVIDERS = {
  "open-meteo": {
    label: "Open-Meteo",
    free: 10000,          // limite documentado para uso nao comercial
    share: 0.25,          // -> 2.500 chamadas/dia
    // A Open-Meteo limita em TRES janelas, nao so por dia:
    //   < 10.000/dia · 5.000/hora · 600/minuto
    // Contar apenas o dia deixa passar a rajada: percorrer a linha do tempo
    // depressa cabe folgado no teto diario e ainda assim leva 429 por minuto.
    freeHour: 5000,
    freeMinute: 600,
    note: "Sem chave. Limites por dia, hora e minuto. CC BY 4.0 exige atribuição.",
  },
  "nasa-gibs": {
    label: "NASA GIBS",
    free: 40000,          // sem teto rigido publicado; adotamos um teto proprio
    share: 0.25,          // -> 10.000 requisicoes/dia
    note: "Sem chave. Servico de imagem; cache de 6 h reduz a quase nada.",
  },
  usgs: {
    label: "USGS Earthquakes",
    free: 20000,          // sem teto publicado; teto conservador proprio
    share: 0.25,          // -> 5.000
    note: "Sem chave. Feed GeoJSON.",
  },
  "nasa-firms": {
    label: "NASA FIRMS",
    free: 4320,           // 5.000 transacoes por 10 min -> teto pratico diario
    share: 0.25,          // -> 1.080
    freeMinute: 500,
    note: "Exige MAP_KEY gratuita. Limite por janela de 10 minutos.",
  },
  "nasa-power": {
    label: "NASA POWER",
    free: 5000,
    share: 0.25,          // -> 1.250
    note: "Sem chave. Usado para radiacao e series climatologicas.",
  },
};

import { loadUsage, saveUsage } from "./store.js";

const state = new Map();   // provider -> { day, used, denied, lastAt, hour, minute }

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function slot(provider) {
  const now = Date.now();
  const day = utcDay();
  const hourKey = Math.floor(now / 3600e3);
  const minKey = Math.floor(now / 60e3);

  let s = state.get(provider);
  if (!s || s.day !== day) {

    // Trinta reinicios num dia de desenvolvimento furavam o teto sem aviso.
    // Agora o total do dia e recuperado do disco.
    let restored = null;
    try { restored = loadUsage(provider, day); } catch { /* disco indisponivel */ }
    s = {
      day,
      used: restored?.used ?? 0,
      denied: restored?.denied ?? 0,
      lastAt: restored?.lastAt ?? null,
      hourKey, hourUsed: 0,     // janelas curtas nao precisam sobreviver ao boot:
      minKey, minUsed: 0,       // reiniciar leva mais tempo que a janela inteira
    };
    state.set(provider, s);
  }
  // janelas deslizantes: zeram sozinhas quando viram
  if (s.hourKey !== hourKey) { s.hourKey = hourKey; s.hourUsed = 0; }
  if (s.minKey !== minKey) { s.minKey = minKey; s.minUsed = 0; }
  return s;
}

/** teto efetivo do provedor numa janela: limite x fracao permitida */
export function capOf(provider, window = "day") {
  const p = PROVIDERS[provider];
  if (!p) return Infinity;
  const base =
    window === "hour" ? p.freeHour :
    window === "minute" ? p.freeMinute : p.free;
  if (!base) return Infinity;
  return Math.floor(base * p.share);
}

/** primeira janela estourada, ou null se ha orcamento em todas */
function blocked(provider, n) {
  const s = slot(provider);
  if (s.used + n > capOf(provider, "day")) return "dia";
  if (s.hourUsed + n > capOf(provider, "hour")) return "hora";
  if (s.minUsed + n > capOf(provider, "minute")) return "minuto";
  return null;
}

/** ha orcamento para mais `n` chamadas em TODAS as janelas? */
export function canSpend(provider, n = 1) {
  if (!PROVIDERS[provider]) return true;
  return blocked(provider, n) === null;
}

/** registra consumo; devolve false se estourou (e nao consome) */
export function spend(provider, n = 1) {
  if (!PROVIDERS[provider]) return true;
  const s = slot(provider);
  const hit = blocked(provider, n);
  if (hit) {
    s.denied += n;
    persist(provider, s);
    return false;
  }
  s.used += n;
  s.hourUsed += n;
  s.minUsed += n;
  s.lastAt = new Date().toISOString();
  persist(provider, s);
  return true;
}

/** grava o total do dia; falha de disco nunca derruba a chamada */
function persist(provider, s) {
  try { saveUsage(provider, s.day, s.used, s.denied, s.lastAt); } catch { /* segue */ }
}

/** qual janela bloqueou — usado na mensagem de erro */
export function blockedWindow(provider, n = 1) {
  return PROVIDERS[provider] ? blocked(provider, n) : null;
}

/**
 * Envolve um fetch com contabilidade e recusa controlada.
 * `n` declara quantas chamadas a operacao gasta (um lote de 3 requisicoes
 * declara 3), para o orcamento refletir a realidade e nao a contagem de funcoes.
 */
export async function metered(provider, n, fn) {
  const win = blockedWindow(provider, n);
  if (!spend(provider, n)) {
    const p = PROVIDERS[provider];
    const err = new Error(
      `orçamento por ${win} de ${p?.label ?? provider} atingido ` +
      `(${capOf(provider, win === "dia" ? "day" : win === "hora" ? "hour" : "minute")} chamadas = ` +
      `${Math.round((p?.share ?? 0) * 100)}% do limite gratuito nessa janela)`
    );
    err.code = "BUDGET_EXCEEDED";
    err.window = win;
    err.status = 429;
    throw err;
  }
  return fn();
}

/** relatorio para a interface e para diagnostico */
export function report() {
  const out = [];
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const s = slot(id);
    const cap = capOf(id);
    out.push({
      id,
      label: p.label,
      freeLimit: p.free,
      sharePct: Math.round(p.share * 100),
      cap,
      used: s.used,
      hour: p.freeHour ? { cap: capOf(id, "hour"), used: s.hourUsed } : null,
      minute: p.freeMinute ? { cap: capOf(id, "minute"), used: s.minUsed } : null,
      remaining: Math.max(0, cap - s.used),
      usedPctOfCap: cap ? +((s.used / cap) * 100).toFixed(1) : 0,
      usedPctOfFree: p.free ? +((s.used / p.free) * 100).toFixed(2) : 0,
      denied: s.denied,
      lastAt: s.lastAt,
      note: p.note,
    });
  }
  return { day: utcDay(), providers: out };
}

/**
 * Zera o consumo de um provedor (ou de todos).
 *
 * O orcamento e uma salvaguarda NOSSA, nao o limite do provedor. Quando uma
 * sequencia de tentativas falhas queima a cota do dia — como aconteceu com o
 * GFS caindo e o fallback gastando 21 requisicoes por fatia — a plataforma fica
 * travada por horas sem que o provedor tenha recusado nada. O operador precisa
 * poder destravar.
 */
export function resetUsage(provider) {
  const day = utcDay();
  const ids = provider ? [provider] : Object.keys(PROVIDERS);
  for (const id of ids) {
    state.delete(id);
    try { saveUsage(id, day, 0, 0, null); } catch { /* sem disco, so memoria */ }
  }
  return ids;
}

export function registerBudgetRoutes(app) {
  app.get("/api/budget", (_req, res) => res.json({ ok: true, ...report() }));

  app.post("/api/budget/reset", (req, res) => {
    const p = req.query.provider ? String(req.query.provider) : null;
    if (p && !PROVIDERS[p]) {
      return res.status(404).json({ ok: false, error: `provedor desconhecido: ${p}` });
    }
    const cleared = resetUsage(p);
    console.log(`[budget] consumo zerado: ${cleared.join(", ")}`);
    res.json({ ok: true, cleared, ...report() });
  });
}
