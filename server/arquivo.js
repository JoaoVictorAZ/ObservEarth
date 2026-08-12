// server/arquivo.js
// -----------------------------------------------------------------------------
// Seleção de fontes de dados meteorológicos e tratamento de variáveis de superfície.
// -----------------------------------------------------------------------------

/** o arquivo de previsão de alta resolução começa por volta de 2021 */
export const INICIO_ALTA_RES = Date.UTC(2021, 2, 23);

/**
 * Escolhe a fonte para uma data.
 *
 * `agora` é injetável para o teste não depender do relógio.
 */
export function escolherFonte(dateStr, agora = new Date()) {
  const alvo = Date.parse(`${dateStr}T12:00:00Z`);
  const hoje = agora.getTime();

  if (!Number.isFinite(alvo)) {
    return { host: "api.open-meteo.com", modo: "previsao", rotulo: "previsão" };
  }

  // Hoje e futuro: previsão operacional.
  if (alvo >= hoje - 86400e3) {
    return {
      host: "api.open-meteo.com",
      modo: "previsao",
      rotulo: "previsão operacional",
      resolucaoKm: 11,
      nota: "Modelo de alta resolução (ICON 11 km / GFS 13 km, melhor ajuste por local).",
    };
  }

  // Passado dentro da cobertura: arquivo de PREVISÃO, que acompanha o evento.
  if (alvo >= INICIO_ALTA_RES) {
    return {
      host: "historical-forecast-api.open-meteo.com",
      modo: "arquivo-previsao",
      rotulo: "arquivo de previsão de alta resolução",
      resolucaoKm: 11,
      nota: "Séries montadas com as primeiras horas de cada rodada, "
          + "cada uma inicializada com medições reais.",
    };
  }

  // Antes disso só existe reanálise. Ela é a ferramenta certa para clima e a
  // ERRADA para evento — e agora isso vai dito na resposta, não escondido.
  return {
    host: "archive-api.open-meteo.com",
    modo: "reanalise",
    rotulo: "reanálise ERA5",
    resolucaoKm: 25,
    nota: "ERA5 é otimizado para consistência de longo prazo, não para "
        + "fidelidade a um evento. Célula de ~25 km: extremos locais são suavizados.",
  };
}

/** o caminho da rota muda entre previsão e arquivo */
export function caminhoDe(fonte) {
  return fonte.modo === "reanalise" ? "/v1/archive" : "/v1/forecast";
}

/**
 * As variáveis que a sonda pede.
 *
 * `wind_gusts_10m` é a adição que importa: é a grandeza que causa dano, e a
 * que os noticiários reportam. Sem ela, comparar a tela com a notícia sempre
 * dá um fator de 1,5 a 2 de diferença — e parece erro de unidade quando não é.
 */
export const VARIAVEIS = [
  "temperature_2m", "relative_humidity_2m", "dew_point_2m",
  "precipitation", "surface_pressure", "cloud_cover",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
  // UV medido. A sonda calculava o dele por fórmula de latitude, hora e nuvem
  // — sem ozônio, sem aerossol, sem altitude — e exibia como "Índice UV".
  "uv_index",
];

/**
 * Classificação Beaufort do vento SUSTENTADO.
 *
 * Serve para que o número tenha significado sem exigir que quem lê saiba de
 * cor o que são 14 km/h. Os limiares são os da escala, em m/s.
 */
const BEAUFORT = [
  [0.3, 0, "calmaria"], [1.6, 1, "aragem"], [3.4, 2, "brisa leve"],
  [5.5, 3, "brisa fraca"], [8.0, 4, "brisa moderada"], [10.8, 5, "brisa forte"],
  [13.9, 6, "vento fresco"], [17.2, 7, "vento forte"], [20.8, 8, "ventania"],
  [24.5, 9, "ventania forte"], [28.5, 10, "tempestade"], [32.7, 11, "tempestade violenta"],
];

export function beaufort(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  for (const [teto, grau, nome] of BEAUFORT) {
    if (ms < teto) return { grau, nome };
  }
  return { grau: 12, nome: "furacão" };
}

/**
 * O aviso que acompanha qualquer leitura de vento.
 *
 * Ele existe porque a correção de fonte e a adição da rajada NÃO resolvem o
 * problema de fundo: nenhum modelo global resolve microexplosão, efeito de
 * relevo ou canalização urbana. A estação da praia mede o que a célula de
 * 11 km não pode conter.
 */
export function avisoDeVento(fonte) {
  return `Valor de MODELO, não de estação. Célula de ~${fonte.resolucaoKm ?? "?"} km: `
       + "rajadas locais, efeito de relevo e microexplosões não aparecem nesta escala. "
       + "Para alerta e decisão operacional, use a estação meteorológica ou o "
       + "aviso do serviço nacional.";
}
