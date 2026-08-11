// server/gibsTime.js
// -----------------------------------------------------------------------------
// DIMENSAO TEMPORAL DAS CAMADAS DO GIBS.
//
// O DEFEITO QUE ISTO CORRIGE
// Todas as camadas de modelo pediam `TIME = hoje - 1 dia`. Nenhuma MERRA-2
// aceita isso. Verificado no proprio GetCapabilities, em 06/08/2026:
//
//   <Dimension name="time" units="ISO8601" default="2026-03-01" nearestValue="0">
//     1980-01-01/2023-11-01/P1M,2024-02-01/2024-04-01/P1M,2024-06-01/2026-03-01/P1M
//   </Dimension>
//
// Tres fatos nessa linha, e cada um sozinho ja quebrava o pedido:
//
//   1. O periodo e P1M — so existe imagem no PRIMEIRO DIA de cada mes. Pedir
//      dia 05 nao devolve o mes 08: devolve excecao.
//   2. A cobertura termina em 2026-03-01. A MERRA-2 e REANALISE: passa por
//      controle de qualidade e sai com meses de atraso. Pedir "ontem" e pedir
//      dado que ainda nao foi produzido.
//   3. `nearestValue="0"` significa que o GIBS NAO arredonda por conta propria.
//      O valor tem de chegar exato.
//
// E ha BURACOS no meio da serie (nada entre 2023-11 e 2024-02). Tratar a
// cobertura como um intervalo continuo produziria pedidos invalidos no meio da
// faixa, que e o tipo de falha que aparece so as vezes e custa caro para
// diagnosticar.
//
// O `lag` fixo que existia antes era um palpite. Isto le o que o servico
// publica.
// -----------------------------------------------------------------------------

/**
 * Duracao ISO 8601 -> {months, ms}.
 *
 * Meses e anos ficam SEPARADOS dos milissegundos de proposito: mes nao tem
 * duracao fixa. Somar "30 dias" a 31 de janeiro erra o alvo, e ao longo de 45
 * anos de serie mensal o erro acumulado passa de um ano inteiro.
 */
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

/**
 * Interpreta o conteudo de <Dimension name="time">.
 *
 * Formato: uma ou mais faixas separadas por virgula, cada uma
 * `inicio/fim/periodo`. Uma faixa pode ser um instante solto, sem barras.
 */
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
    // O DIA DO MES pode empurrar o resultado para depois de `want`: uma serie
    // que comeca em 31/01 tem instantes no dia 31, e pedir 15/04 daria 30/04.
    // Recuar um passo resolve, e o laco cobre o caso de meses curtos.
    while (at > want && idx > 0) at = addMonths(r.start, --idx * r.period.months);
    return at < r.start ? r.start : at;
  }

  const idx = Math.floor((want - r.start) / r.period.ms);
  return new Date(r.start.getTime() + Math.max(0, idx) * r.period.ms);
}

/**
 * Converte a data pedida no instante valido mais proximo, para tras.
 *
 * "Para tras" e uma escolha, nao um detalhe: avancar mostraria dado de DEPOIS
 * da data que o usuario escolheu — num instrumento de leitura cientifica, isso
 * seria mentir sobre o que esta na tela.
 *
 * Devolve tambem `exact`, para a interface poder dizer que o que aparece nao e
 * exatamente o que foi pedido.
 */
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

  // Depois do fim da cobertura. E o caso das MERRA-2 hoje: reanalise sai com
  // meses de atraso, entao "hoje" esta sempre fora da serie.
  //
  // ATENCAO: devolver `end` cru esta ERRADO. O fim declarado de uma faixa NAO
  // precisa cair na grade do periodo — em `2000-01-01/2020-01-01/P8D` sao 7.305
  // dias entre as pontas, que nao e multiplo de 8, entao 2020-01-01 nao e um
  // instante da serie. Passar o fim pelo mesmo degrau garante um valor que
  // existe de verdade.
  if (want > lastRange.end) {
    return { time: fmt(stepDown(lastRange, lastRange.end), dim.clock), exact: false, reason: "after" };
  }

  for (let i = dim.ranges.length - 1; i >= 0; i--) {
    const r = dim.ranges[i];
    if (want < r.start) continue;

    // Dentro da faixa usa a propria data; num BURACO entre faixas, recua para o
    // fim da faixa anterior. Sem este segundo caso, um pedido entre 2023-11 e
    // 2024-02 viraria um TIME que o GIBS recusa.
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

/**
 * Extrai o catalogo temporal de um GetCapabilities do WMS.
 *
 * Percorre por blocos <Layer>, nao por expressao unica sobre o documento
 * inteiro: as camadas sao ANINHADAS (ha <Layer> de grupo, como "Temperature",
 * envolvendo as de dado) e uma expressao global casaria o nome de um grupo com
 * a dimensao de outra camada.
 */
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
