import { fetchGfsMessages } from "./gfs.js";
import { encodePNG } from "./png.js";

function rampColor(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v > v1) continue;
    const [v0, c0] = stops[i - 1];
    const t = (v - v0) / (v1 - v0);
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ];
  }
  return last[1];
}

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Cor por classe discreta para mapeamento meteorológico. */
function stepColor(stops, v) {
  let cor = stops[0][1];
  for (const [limite, c] of stops) {
    if (v >= limite) cor = c;
    else break;
  }
  return cor;
}

/** mesma lógica para o alfa: faixa nítida exige alfa nítido */
function stepAlpha(stops, alpha, v) {
  let a = alpha(stops[0][0]);
  for (const [limite] of stops) {
    if (v >= limite) a = alpha(limite);
    else break;
  }
  return a;
}

export const FIELDS = Object.freeze({
  temp2m: {
    title: "Temperatura do Ar (2m)",
    group: "Modelo GFS",
    vars: ["TMP"],
    levs: ["2_m_above_ground"],
    match: { discipline: 0, category: 0, parameter: 0 },
    unit: "°C",
    kelvin: true,       // GRIB value is in Kelvin → subtract 273.15
    floor: -50,
    stops: [
      [-50, [  8,  29,  88]],   // deep navy
      [-30, [ 37,  52, 148]],   // indigo
      [-15, [ 49, 130, 189]],   // steel blue
      [  0, [116, 196, 118]],   // green
      [ 10, [254, 224, 144]],   // pale yellow
      [ 20, [253, 174,  97]],   // orange
      [ 30, [244,  80,  44]],   // red
      [ 40, [165,   0,  38]],   // crimson
      [ 50, [ 64,   0,  75]],   // deep purple
    ],
    alpha: () => 0.82,
    legendAt: [[-30, "-30°C"], [-15, "-15"], [0, "0"], [15, "15"], [30, "30"], [45, "45+"]],
  },

  dew2m: {
    title: "Ponto de Orvalho (2m)",
    group: "Modelo GFS",
    vars: ["DPT"],
    levs: ["2_m_above_ground"],
    match: { discipline: 0, category: 0, parameter: 6 },
    unit: "°C",
    kelvin: true,
    floor: -60,
    stops: [
      [-60, [ 25,  25,  80]],   // dark blue
      [-30, [ 55,  80, 160]],   // blue
      [-10, [100, 180, 200]],   // cyan
      [  0, [170, 220, 160]],   // light green
      [ 10, [210, 235, 100]],   // yellow-green
      [ 18, [240, 200,  60]],   // golden
      [ 24, [245, 120,  50]],   // orange-red
      [ 30, [180,  30,  70]],   // deep red-pink
    ],
    alpha: () => 0.78,
    legendAt: [[-30, "-30°C"], [-10, "-10"], [0, "0"], [10, "10"], [20, "20"], [30, "30+"]],
  },

  rh2m: {
    title: "Umidade Relativa (2m)",
    group: "Modelo GFS",
    vars: ["RH"],
    levs: ["2_m_above_ground"],
    match: { discipline: 0, category: 1, parameter: 1 },
    unit: "%",
    floor: 5,
    stops: [
      [  5, [153,  52,   4]],   // brown (desert dry)
      [ 20, [204, 102,   0]],   // dark orange
      [ 35, [240, 180,  40]],   // amber
      [ 50, [130, 200,  80]],   // green
      [ 65, [ 60, 180, 175]],   // teal
      [ 80, [ 30, 120, 200]],   // blue
      [ 95, [ 20,  40, 150]],   // deep blue
    ],
    alpha: (v) => 0.30 + 0.55 * Math.min(1, v / 100),
    legendAt: [[10, "10%"], [30, "30"], [50, "50"], [70, "70"], [90, "90+"]],
  },

  prmsl: {
    title: "Pressão ao Nível do Mar (MSLP)",
    group: "Modelo GFS",
    vars: ["PRMSL"],
    levs: ["mean_sea_level"],
    match: { discipline: 0, category: 3, parameter: 1 },
    unit: "hPa",
    pascal: true,        // GRIB value is in Pa → divide by 100
    floor: 920,
    stops: [
      [ 920, [100,  20, 120]],  // deep purple — extreme low
      [ 960, [ 60,  80, 200]],  // blue
      [ 990, [ 80, 180, 220]],  // cyan
      [1013, [200, 220, 200]],  // neutral green-gray
      [1030, [240, 200, 100]],  // amber
      [1050, [200,  60,  40]],  // red — extreme high
    ],
    alpha: () => 0.70,
    legendAt: [[940, "940"], [970, "970"], [1000, "1000"], [1013, "1013"], [1030, "1030"], [1050, "1050+"]],
  },

  cloud: {
    title: "Nuvens (cobertura total)",
    group: "Modelo GFS",
    vars: ["TCDC"],
    levs: ["entire_atmosphere"],
    match: { discipline: 0, category: 6, parameter: 1 },
    unit: "%",
    floor: 8,
    // LUMINÂNCIA PURA, sem matiz. Nuvem não é uma medida a ser lida em cores:
    // é um MEIO QUE OBSTRUI. Dar-lhe matiz faz com que ela dispute atenção com
    // a temperatura ou a chuva que estão por baixo, e o azulado anterior ainda
    // sugeria "frio" onde só havia cobertura.
    stops: [
      [8, [168, 168, 168]],
      [40, [206, 206, 206]],
      [70, [234, 234, 234]],
      [100, [255, 255, 255]],
    ],
    alpha: (v) => 0.10 + 0.82 * Math.max(0, Math.min(1, (v - 8) / 92)) ** 0.75,
    legendAt: [[8, "8%"], [40, "40%"], [70, "70%"], [100, "100%"]],
  },

  precip: {
    // FAIXAS, não rampa. Chuva ocorre em células com borda; interpolar cria um
    // halo de garoa em volta de cada núcleo que não existe no dado.
    render: "faixas",
    title: "Precipitação acumulada",
    group: "Modelo GFS",
    vars: ["APCP"],
    levs: ["surface"],
    match: { discipline: 0, category: 1, parameter: 8 },
    unit: "mm",
    floor: 0.2,
    stops: [
      [0.2, [64, 128, 168]],
      [1, [72, 176, 200]],
      [3, [93, 224, 176]],
      [8, [190, 216, 96]],
      [20, [242, 184, 72]],
      [50, [232, 104, 88]],
      [100, [214, 88, 168]],
    ],
    alpha: (v) => Math.min(0.95, 0.35 + 0.6 * Math.min(1, Math.log10(1 + v * 4) / 2)),
    legendAt: [[0.2, "0,2 mm"], [3, "3"], [8, "8"], [20, "20"], [50, "50"], [100, "100+"]],
  },

  wbgt: {
    // FAIXAS. O WBGT é lido contra limiares de decisão (28 / 31 / 33 °C) —
    // 27,9 e 28,1 não são "quase iguais", são lados opostos de uma conduta.
    // Rampa suave apaga exatamente a fronteira que importa.
    render: "faixas",
    title: "Estresse Térmico WBGT",
    group: "Saúde & Risco",
    vars: ["TMP", "RH"],
    levs: ["2_m_above_ground"],
    match: { discipline: 0, category: 0, parameter: 0 },
    secondMatch: { discipline: 0, category: 1, parameter: 1 },
    derived: "wbgt",
    unit: "°C WBGT",
    kelvin: true,
    floor: 18,
    stops: [
      [18, [ 46, 139,  87]],   // green — safe
      [22, [102, 189,  99]],   // light green
      [25, [254, 227,  45]],   // yellow — caution
      [28, [253, 174,  97]],   // orange — warning
      [31, [244,  80,  44]],   // red — danger
      [34, [165,   0,  38]],   // dark red — extreme
      [38, [ 30,   0,  30]],   // near black — lethal
    ],
    alpha: (v) => v >= 25 ? 0.88 : 0.55 + 0.33 * Math.min(1, (v - 18) / 7),
    legendAt: [[18, "18°C Seguro"], [25, "25 Cautela"], [28, "28 Alerta"], [31, "31 Perigo"], [35, "35+ Extremo"]],
  },
});

/**
 * A legenda usa a MESMA função que pinta o pixel.
 *
 * Um campo em faixas pintado por classe mas com legenda interpolada anuncia
 * cores que o mapa nunca desenha. A divergência é de poucos tons — pequena
 * demais para saltar aos olhos e suficiente para a legenda deixar de descrever
 * a imagem. Foi o próprio teste de coerência que pegou isto quando o modo
 * "faixas" entrou.
 */
export function legendOf(spec) {
  const corDe = spec.render === "faixas" ? stepColor : rampColor;
  return spec.legendAt.map(([v, rotulo]) => [hex(corDe(spec.stops, v)), rotulo]);
}

export function renderFieldPNG(spec, values, ni, nj, text = {}) {
  const rgba = new Uint8Array(ni * nj * 4);
  let cobertos = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < ni * nj; i++) {
    const v = values[i];
    const o = i * 4;

    if (!Number.isFinite(v) || v < spec.floor) {
      rgba[o + 3] = 0;
      continue;
    }
    // A CODIFICAÇÃO SEGUE A NATUREZA DO FENÔMENO, não a paleta.
    //
    //   "suave"     campo contínuo — temperatura, orvalho, umidade. Interpolar
    //               é correto: entre dois nós a atmosfera realmente varia
    //               continuamente.
    //
    //   "faixas"    campo de células ou índice com limiar — chuva, WBGT.
    //               Interpolar inventa dado que não existe (garoa em volta de
    //               cada núcleo) e apaga limiares de decisão.
    //
    // Sem esta distinção, sete camadas diferentes saíam com o mesmo desenho e
    // só a cor mudava — o que faz um mapa de chuva parecer um mapa de
    // temperatura pintado de azul.
    const passo = spec.render === "faixas";
    const [r, g, b] = passo
      ? stepColor(spec.stops, v)
      : rampColor(spec.stops, v);
    const a = passo
      ? stepAlpha(spec.stops, spec.alpha, v)
      : spec.alpha(v);

    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    cobertos++;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const png = encodePNG(rgba, ni, nj, { text });
  return {
    png,
    coveredPct: +((cobertos / (ni * nj)) * 100).toFixed(1),
    min: cobertos ? +min.toFixed(2) : null,
    max: cobertos ? +max.toFixed(2) : null,
  };
}

export async function buildField(fetchImpl, id, dateStr, hour, now = new Date()) {
  const spec = FIELDS[id];
  if (!spec) throw Object.assign(new Error(`campo desconhecido: ${id}`), { code: "UNKNOWN_FIELD" });

  const { msgs, label, cycle, fhr, bytes } = await fetchGfsMessages(
    fetchImpl, dateStr, hour, spec.vars, spec.levs, now
  );

  const m = msgs.find(
    (x) => x.discipline === spec.match.discipline
        && x.category === spec.match.category
        && x.parameter === spec.match.parameter
  );

  if (!m) {
    if (id === "precip" && fhr === 0) {
      throw Object.assign(
        new Error(
          "precipitação é acumulada num intervalo; a análise (+000h) não tem " +
          "acumulação. Avance a hora para ver a previsão."
        ),
        { code: "NO_ANALYSIS_PRECIP" }
      );
    }
    throw Object.assign(
      new Error(
        `GRIB2 sem o parâmetro ${spec.vars.join("/")} ` +
        `(${msgs.length} mensagem(ns) em ${label})`
      ),
      { code: "PARAM_NOT_FOUND" }
    );
  }

  const { ni, nj } = m.grid;
  let values = m.values;

  // ── Unit conversions ──
  if (spec.kelvin) {
    values = new Float32Array(values.length);
    for (let i = 0; i < m.values.length; i++) values[i] = m.values[i] - 273.15;
  }
  if (spec.pascal) {
    values = new Float32Array(values.length);
    for (let i = 0; i < m.values.length; i++) values[i] = m.values[i] / 100;
  }

  // ── WBGT derived field: combine TMP + RH ──
  if (spec.derived === "wbgt") {
    const mRH = msgs.find(
      (x) => x.discipline === spec.secondMatch.discipline
          && x.category === spec.secondMatch.category
          && x.parameter === spec.secondMatch.parameter
    );
    if (mRH) {
      const wbgtVals = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) {
        const tc = values[i];  // already in °C
        const rh = mRH.values[i];
        // Stull (2011) wet-bulb approximation
        const tw = tc * Math.atan(0.151977 * Math.pow(Math.max(0, rh + 8.313659), 0.5))
                 + Math.atan(tc + rh) - Math.atan(rh - 1.676331)
                 + 0.00391838 * Math.pow(Math.max(0, rh), 1.5) * Math.atan(0.023101 * rh)
                 - 4.686035;
        // Simplified WBGT outdoor: 0.7*Tw + 0.2*Tg + 0.1*Ta (Tg ≈ Ta+2 for full sun)
        wbgtVals[i] = 0.7 * tw + 0.2 * (tc + 2) + 0.1 * tc;
      }
      values = wbgtVals;
    }
  }

  const source = `NOAA GFS 0.25 · ${label}`;

  const { png, coveredPct, min, max } = renderFieldPNG(spec, values, ni, nj, {
    Source: source,
    Title: spec.title,
    Comment: `unidade ${spec.unit}; piso ${spec.floor}; equirretangular -180..180, norte no topo`,
  });

  return {
    png,
    meta: {
      id,
      title: spec.title,
      unit: spec.unit,
      nx: ni,
      ny: nj,
      stepDeg: +(360 / ni).toFixed(3),
      dataset: source,
      cycle: `${cycle.date}${String(cycle.cycle).padStart(2, "0")}`,
      forecastHour: fhr,
      coveredPct,
      min,
      max,
      gribBytes: bytes,
      pngBytes: png.length,
      packing: m.packing,
      legend: legendOf(spec),
      builtAt: new Date().toISOString(),
    },
  };
}

export function fieldCatalog() {
  return Object.entries(FIELDS).map(([id, f]) => ({
    id,
    title: f.title,
    group: f.group,
    unit: f.unit,
    legend: legendOf(f),
  }));
}

export const _internal = { rampColor, hex };