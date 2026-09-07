export function parseDuration(p) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(p);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map((x) => (x == null ? 0 : Number(x)));
  const months = y * 12 + mo;
  const ms = d * 86400e3 + h * 3600e3 + mi * 60e3 + s * 1000;
  if (!months && !ms) return null;
  return { months, ms };
}

/** o valor tem hora, ou e so data? preserva o formato na saida */
const hasClock = (s) => s.includes("T");

function fmt(date, withClock) {
  const iso = date.toISOString();
  return withClock ? iso.replace(/\.\d{3}Z$/, "Z") : iso.slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);                     // evita 31/01 + 1 mes virar 03/03
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

const monthsBetween = (a, b) =>
  (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());


export function parseTimeDimension(raw, defaultAttr = null) {
  const ranges = [];
  for (const part of String(raw ?? "").split(",")) {
    const t = part.trim();
    if (!t) continue;

    const bits = t.split("/");
    if (bits.length === 1) {
      const at = new Date(bits[0]);
      if (isNaN(at)) continue;
      ranges.push({ start: at, end: at, period: null, clock: hasClock(bits[0]) });
      continue;
    }
    const [s, e, p] = bits;
    const start = new Date(s);
    const end = new Date(e);
    const period = p ? parseDuration(p) : null;
    if (isNaN(start) || isNaN(end)) continue;
    ranges.push({ start, end, period, clock: hasClock(s) });
  }

  ranges.sort((a, b) => a.start - b.start);
  const def = defaultAttr ? new Date(defaultAttr) : null;

  return {
    ranges,
    def: def && !isNaN(def) ? def : null,
    defRaw: defaultAttr ?? null,
    clock: ranges[0]?.clock ?? false,
    first: ranges[0]?.start ?? null,
    last: ranges.length ? ranges[ranges.length - 1].end : null,
  };
}

/** ultimo instante valido de `r` que seja <= `want` */
function stepDown(r, want) {
  if (!r.period) return r.start;

  if (r.period.months) {
    const total = monthsBetween(r.start, want);
    let idx = Math.floor(total / r.period.months);
    let at = addMonths(r.start, idx * r.period.months);
    while (at > want && idx > 0) at = addMonths(r.start, --idx * r.period.months);
    return at < r.start ? r.start : at;
  }

  const idx = Math.floor((want - r.start) / r.period.ms);
  return new Date(r.start.getTime() + Math.max(0, idx) * r.period.ms);
}

export function snapTime(dim, wantedStr) {
  if (!dim?.ranges?.length) return null;
  const want = new Date(hasClock(wantedStr) ? wantedStr : `${wantedStr}T00:00:00Z`);
  if (isNaN(want)) return null;

  const first = dim.ranges[0];
  const lastRange = dim.ranges[dim.ranges.length - 1];

  // Antes do inicio: nao existe dado anterior, entao mostra o primeiro.
  if (want < first.start) {
    return { time: fmt(first.start, dim.clock), exact: false, reason: "before" };
  }

  if (want > lastRange.end) {
    return { time: fmt(stepDown(lastRange, lastRange.end), dim.clock), exact: false, reason: "after" };
  }

  for (let i = dim.ranges.length - 1; i >= 0; i--) {
    const r = dim.ranges[i];
    if (want < r.start) continue;

    const noBuraco = want > r.end;
    const at = stepDown(r, noBuraco ? r.end : want);
    const exact = !noBuraco && Math.abs(at - want) < 1000;
    return {
      time: fmt(at, dim.clock),
      exact,
      reason: exact ? "exact" : noBuraco ? "gap" : "step",
    };
  }
  return { time: fmt(first.start, dim.clock), exact: false, reason: "before" };
}

/** resumo legivel da cobertura, para a interface mostrar sem interpretar ISO */
export function coverageOf(dim) {
  if (!dim?.ranges?.length) return null;
  const p = dim.ranges[dim.ranges.length - 1].period;
  const cadence =
    !p ? null
    : p.months === 12 ? "anual"
    : p.months === 1 ? "mensal"
    : p.months ? `${p.months} meses`
    : p.ms === 86400e3 ? "diário"
    : p.ms % 86400e3 === 0 ? `${p.ms / 86400e3} dias`
    : `${p.ms / 3600e3} h`;

  return {
    first: fmt(dim.first, false),
    last: fmt(dim.last, false),
    cadence,
    gaps: dim.ranges.length - 1,
  };
}

export function parseCapabilities(xml) {
  const out = new Map();
  const nameRe = /<Name>([^<]+)<\/Name>/;
  const titleRe = /<Title>([^<]*)<\/Title>/;
  const dimRe = /<Dimension\s+name="time"[^>]*?(?:default="([^"]*)")?[^>]*>([^<]*)<\/Dimension>/;

  // fatia em blocos que comecam em <Layer ...> e vao ate o proximo <Layer
  const chunks = xml.split(/<Layer[\s>]/).slice(1);
  for (const chunk of chunks) {
    const n = nameRe.exec(chunk);
    if (!n) continue;
    const name = n[1].trim();
    const d = dimRe.exec(chunk);
    if (!d) continue;                       // grupo sem dado proprio

    const dim = parseTimeDimension(d[2], d[1] ?? null);
    if (!dim.ranges.length) continue;

    out.set(name, { dim, title: titleRe.exec(chunk)?.[1]?.trim() ?? name });
  }
  return out;
}
