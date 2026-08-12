// server/compare.js
// -----------------------------------------------------------------------------
// Comparação entre modelos numéricos globais (GFS, ICON, ECMWF).
// -----------------------------------------------------------------------------

/**
 * Os três centros globais. `id` é o parâmetro da API; o resto é para a tela
 * não precisar saber decodificar nome de modelo.
 */
export const MODELOS = [
  { id: "gfs_seamless",  sigla: "GFS",   centro: "NOAA · Estados Unidos",  grade: "0,11°/0,25°" },
  { id: "icon_seamless", sigla: "ICON",  centro: "DWD · Alemanha",         grade: "11 km" },
  { id: "ecmwf_ifs025",  sigla: "ECMWF", centro: "ECMWF · Europa",         grade: "0,25°" },
];

export const VARIAVEIS = [
  { id: "temperature_2m",   rotulo: "Temperatura (2 m)",     unidade: "°C",  casas: 1 },
  { id: "wind_speed_10m",   rotulo: "Vento (10 m)",          unidade: "m/s", casas: 1 },
  { id: "surface_pressure", rotulo: "Pressão à superfície",  unidade: "hPa", casas: 1 },
  { id: "precipitation",    rotulo: "Precipitação",          unidade: "mm",  casas: 1 },
];

/**
 * Dispersão entre modelos num instante: amplitude e desvio.
 *
 * Com menos de dois modelos NÃO existe dispersão — e o campo é null, não zero.
 * Zero significaria "os modelos concordam perfeitamente", que é a conclusão
 * oposta de "só um modelo respondeu".
 */
export function dispersao(valores) {
  const bons = valores.filter((v) => v != null && Number.isFinite(v));
  if (bons.length < 2) {
    return { n: bons.length, min: null, max: null, amplitude: null, media: null, desvio: null };
  }
  const min = Math.min(...bons), max = Math.max(...bons);
  const media = bons.reduce((a, b) => a + b, 0) / bons.length;
  const desvio = Math.sqrt(
    bons.reduce((s, v) => s + (v - media) ** 2, 0) / (bons.length - 1)
  );
  const r = (x) => +x.toFixed(2);
  return { n: bons.length, min: r(min), max: r(max), amplitude: r(max - min), media: r(media), desvio: r(desvio) };
}

export async function compararModelos(fetchImpl, { lat, lng, horas = 48 }) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: VARIAVEIS.map((v) => v.id).join(","),
    models: MODELOS.map((m) => m.id).join(","),
    wind_speed_unit: "ms",
    timezone: "UTC",
    forecast_days: String(Math.max(1, Math.ceil(horas / 24))),
  });

  const r = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!r.ok) {
    throw Object.assign(
      new Error(`comparação de modelos indisponível (HTTP ${r.status})`),
      { code: "MODELOS_INDISPONIVEIS", status: 502 }
    );
  }
  const j = await r.json();
  const h = j?.hourly;
  if (!h?.time?.length) {
    throw Object.assign(
      new Error(`a Open-Meteo não retornou séries por modelo para ${lat}, ${lng}`),
      { code: "SEM_MODELOS", status: 502 }
    );
  }

  const n = Math.min(horas, h.time.length);
  const tempo = h.time.slice(0, n).map((t) => `${t}Z`);

  // Quais modelos realmente responderam. Um modelo pedido que volta só com
  // nulos precisa aparecer como AUSENTE, e não como uma linha reta no gráfico.
  const serie = {};
  const presentes = {};
  for (const v of VARIAVEIS) {
    serie[v.id] = {};
    presentes[v.id] = [];
    for (const m of MODELOS) {
      // Com um único modelo a API não sufixa; com vários, sufixa sempre.
      const col = h[`${v.id}_${m.id}`] ?? (MODELOS.length === 1 ? h[v.id] : undefined);
      const vals = (col ?? []).slice(0, n).map((x) => (x == null || !Number.isFinite(x) ? null : x));
      const temAlgo = vals.some((x) => x != null);
      serie[v.id][m.id] = temAlgo ? vals : null;
      if (temAlgo) presentes[v.id].push(m.id);
    }
  }

  // Dispersão hora a hora, e o resumo da janela.
  const espalhamento = {};
  for (const v of VARIAVEIS) {
    const porHora = [];
    for (let i = 0; i < n; i++) {
      porHora.push(dispersao(MODELOS.map((m) => serie[v.id][m.id]?.[i] ?? null)));
    }
    const amplitudes = porHora.map((d) => d.amplitude).filter((x) => x != null);
    espalhamento[v.id] = {
      porHora,
      // O pior desacordo e QUANDO ele acontece: é isso que diz se vale confiar
      // na previsão de amanhã à tarde ou não.
      maiorAmplitude: amplitudes.length ? +Math.max(...amplitudes).toFixed(2) : null,
      quando: amplitudes.length
        ? tempo[porHora.findIndex((d) => d.amplitude === Math.max(...amplitudes))]
        : null,
      amplitudeMedia: amplitudes.length
        ? +(amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length).toFixed(2)
        : null,
      horasComparaveis: amplitudes.length,
      modelos: presentes[v.id],
    };
  }

  const semNenhum = VARIAVEIS.filter((v) => presentes[v.id].length === 0).map((v) => v.rotulo);
  const soUm = VARIAVEIS.filter((v) => presentes[v.id].length === 1).map((v) => v.rotulo);

  return {
    lat, lng,
    tempo,
    modelos: MODELOS,
    variaveis: VARIAVEIS,
    serie,
    espalhamento,
    avisos: [
      ...semNenhum.map((r2) => `${r2}: nenhum modelo publicou este campo aqui.`),
      ...soUm.map((r2) => `${r2}: só um modelo respondeu — sem dois não há dispersão a medir.`),
    ],
    fonte: "Open-Meteo · GFS (NOAA), ICON (DWD) e IFS (ECMWF), consultados na mesma requisição",
    nota: "A dispersão é medida entre os modelos que responderam. Nenhum valor foi derivado de outro.",
    obtidoEm: new Date().toISOString(),
  };
}
