// server/timeseries.js
// -----------------------------------------------------------------------------
// Consulta e agregação de séries históricas temporais diárias.
// -----------------------------------------------------------------------------

/** janelas oferecidas na interface, em dias */
export const JANELAS = {
  "1m": 30, "2m": 60, "3m": 90, "6m": 182,
  "1y": 365, "5y": 1826, "10y": 3652,
};

/**
 * Variáveis diárias que a Open-Meteo realmente publica no arquivo histórico.
 *
 * `surface_pressure_mean` NÃO está nesta lista de propósito: não existe como
 * agregado diário na API. A versão anterior a pedia e recebia `undefined`, que
 * virava coluna vazia no CSV com cabeçalho "Pressão(hPa)" — um cabeçalho
 * prometendo dado que nunca vem é pior que a ausência da coluna.
 */
export const DIARIAS = [
  "temperature_2m_mean",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "shortwave_radiation_sum",
];

/** unidades, para o CSV e para a tela nunca discordarem */
export const UNIDADES = {
  temperature_2m_mean: "°C",
  temperature_2m_max: "°C",
  temperature_2m_min: "°C",
  precipitation_sum: "mm",
  wind_speed_10m_max: "m/s",
  wind_direction_10m_dominant: "°",
  shortwave_radiation_sum: "MJ/m²",
};

export const ROTULOS = {
  temperature_2m_mean: "Temperatura média",
  temperature_2m_max: "Temperatura máxima",
  temperature_2m_min: "Temperatura mínima",
  precipitation_sum: "Precipitação acumulada",
  wind_speed_10m_max: "Vento máximo",
  wind_direction_10m_dominant: "Direção dominante",
  shortwave_radiation_sum: "Radiação de onda curta",
};

export function intervalo(range, agora = new Date()) {
  const dias = JANELAS[range] ?? JANELAS["1y"];
  // O arquivo da Open-Meteo tem ~5 dias de atraso de consolidação. Pedir até
  // ontem devolve uma cauda de nulos que parece falha de dado.
  const fim = new Date(agora.getTime() - 6 * 86400e3);
  const inicio = new Date(fim.getTime() - (dias - 1) * 86400e3);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(inicio), end: iso(fim), dias };
}

/**
 * Estatísticas de uma série, com a contagem sempre à vista.
 *
 * `n` e `ausentes` acompanham cada resumo porque uma média de 12 dias e uma
 * média de 3.652 não significam a mesma coisa, e o número sozinho não conta
 * essa diferença.
 *
 * Desvio padrão AMOSTRAL (divide por n−1). A série observada é uma amostra do
 * clima, não a população inteira — dividir por n subestima a dispersão, e num
 * trabalho que vai a banca isso é o tipo de detalhe que se cobra.
 */
export function resumo(valores) {
  const bons = valores.filter((v) => v != null && Number.isFinite(v));
  const n = bons.length;
  if (!n) {
    return { n: 0, ausentes: valores.length, min: null, max: null, media: null, desvio: null, soma: null };
  }
  const soma = bons.reduce((a, b) => a + b, 0);
  const media = soma / n;
  const desvio = n > 1
    ? Math.sqrt(bons.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1))
    : null;
  const r2 = (x) => (x == null ? null : +x.toFixed(2));
  return {
    n, ausentes: valores.length - n,
    min: r2(Math.min(...bons)), max: r2(Math.max(...bons)),
    media: r2(media), desvio: r2(desvio), soma: r2(soma),
  };
}

/**
 * Busca a série diária. Sem plano B inventado: se não vier, é erro.
 */
export async function buscarSerie(fetchImpl, { lat, lng, range = "1y", agora = new Date() }) {
  const { start, end, dias } = intervalo(range, agora);

  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: start,
    end_date: end,
    daily: DIARIAS.join(","),
    // Pedir a unidade em vez de supor. Supor foi o que fez a sonda mostrar
    // 58,5 m/s onde havia 58,5 km/h — um fator de 3,6 em todo o planeta.
    wind_speed_unit: "ms",
    timezone: "UTC",
  });

  const r = await fetchImpl(`https://archive-api.open-meteo.com/v1/archive?${qs}`);
  if (!r.ok) {
    throw Object.assign(
      new Error(`arquivo histórico indisponível (HTTP ${r.status}) para ${start}..${end}`),
      { code: "ARQUIVO_INDISPONIVEL", status: 502 }
    );
  }
  const j = await r.json();
  const d = j?.daily;
  if (!d?.time?.length) {
    throw Object.assign(
      new Error(`a Open-Meteo não retornou série diária para ${lat}, ${lng} em ${start}..${end}`),
      { code: "SEM_SERIE", status: 502 }
    );
  }

  const resumos = {};
  for (const v of DIARIAS) {
    resumos[v] = { ...resumo(d[v] ?? []), unidade: UNIDADES[v], rotulo: ROTULOS[v] };
  }

  // Lacunas declaradas: um gráfico com buraco precisa dizer que tem buraco,
  // senão a linha ligando os dois lados inventa o que faltou.
  const lacunas = Object.entries(resumos)
    .filter(([, s]) => s.ausentes > 0)
    .map(([v, s]) => `${ROTULOS[v]}: ${s.ausentes} de ${s.n + s.ausentes} dias sem dado`);

  return {
    lat, lng, range,
    intervalo: { start, end, dias },
    variaveis: DIARIAS,
    unidades: UNIDADES,
    rotulos: ROTULOS,
    serie: { time: d.time, ...Object.fromEntries(DIARIAS.map((v) => [v, d[v] ?? []])) },
    resumos,
    lacunas,
    fonte: "Open-Meteo · reanálise ERA5 (arquivo histórico)",
    nota: "Ausência é null e nunca foi estimada. Desvio padrão amostral (n−1).",
    obtidoEm: new Date().toISOString(),
  };
}
