// server/modelNames.js
// -----------------------------------------------------------------------------
// Tradução e mapeamento de nomes de modelos e produtos NASA GIBS / MERRA-2.
// -----------------------------------------------------------------------------

/** familia do produto -> como cita-la */
const FAMILIES = {
  MERRA2: { label: "MERRA-2", kind: "Reanálise", agency: "NASA GMAO" },
  GEOS: { label: "GEOS", kind: "Assimilação", agency: "NASA GMAO" },
};

/**
 * Termos do identificador -> portugues.
 * Ordem importa: as chaves mais longas sao testadas primeiro, para que
 * "Sea_Surface_Temperature" ganhe de "Temperature".
 */
const TERMS = [
  ["Total_Precipitable_Water_Vapor", "Água precipitável total"],
  ["Precipitation_Bias_Corrected", "Precipitação corrigida"],
  ["Snow_Depth_Over_Glaciated_Surface", "Espessura de neve sobre gelo"],
  ["Sea_Surface_Temperature", "Temperatura da superfície do mar"],
  ["Soil_Water_Root_Zone", "Água no solo (zona radicular)"],
  ["SO2_Column_Mass_Density", "Densidade de coluna de SO₂"],
  ["CO_Column_Mass_Density", "Densidade de coluna de CO"],
  ["Dust_Column_Mass_Density", "Densidade de coluna de poeira"],
  ["Sulfate_Column_Mass_Density", "Densidade de coluna de sulfato"],
  ["Carbon_Monoxide", "Monóxido de carbono"],
  ["Ozone_Mixing_Ratio", "Razão de mistura de ozônio"],
  ["Total_Column_Ozone", "Ozônio em coluna total"],
  ["Relative_Humidity_After_Moist", "Umidade relativa"],
  ["Relative_Humidity", "Umidade relativa"],
  ["Specific_Humidity", "Umidade específica"],
  ["Surface_Wind_Speed", "Velocidade do vento à superfície"],
  ["Wind_Speed", "Velocidade do vento"],
  ["Surface_Pressure", "Pressão à superfície"],
  ["Sea_Level_Pressure", "Pressão ao nível do mar"],
  ["Surface_Albedo", "Albedo da superfície"],
  ["Surface_Air_Temperature", "Temperatura do ar à superfície"],
  ["Air_Temperature", "Temperatura do ar"],
  ["Skin_Temperature", "Temperatura de superfície"],
  ["Open_Water_Latent_Energy_Flux", "Fluxo de calor latente sobre água"],
  ["Latent_Energy_Flux", "Fluxo de calor latente"],
  ["Sensible_Heat_Flux", "Fluxo de calor sensível"],
  ["Longwave_Flux", "Fluxo de onda longa"],
  ["Shortwave_Flux", "Fluxo de onda curta"],
  ["Aerosol_Optical_Depth", "Profundidade óptica de aerossóis"],
  ["Cloud_Fraction", "Fração de nuvens"],
  ["Snowfall", "Precipitação de neve"],
  ["Precipitation", "Precipitação"],
  ["Evaporation", "Evaporação"],
  ["Temperature", "Temperatura"],
  ["Humidity", "Umidade"],
  ["Pressure", "Pressão"],
  ["Ozone", "Ozônio"],
  ["Nitrogen_Dioxide", "Dióxido de nitrogênio"],
  ["Black_Carbon", "Carbono negro"],
  ["Sea_Ice", "Gelo marinho"],
  ["Snow", "Neve"],
  ["Dust", "Poeira"],
  ["Wind", "Vento"],
];

/** sufixos de cadencia */
const CADENCE = [
  ["_Monthly", "mensal"],
  ["_Daily", "diário"],
  ["_8Day", "8 dias"],
  ["_Weekly", "semanal"],
];

/**
 * Nivel vertical embutido no identificador, ex.: 50hPa, 500hPa, 2m, 10m.
 *
 * `(?:^|_)` e necessario, nao decorativo: em `MERRA2_2m_Air_Temperature` o
 * nivel vem NO INICIO do corpo, sem underscore antes. Exigindo o underscore, o
 * "2m" passava batido e a camada aparecia como "Temperatura do ar" — nome
 * identico ao da versao assimilada, duas linhas indistinguiveis no painel.
 */
function levelOf(id) {
  const hpa = /(?:^|_)(\d+)hPa/i.exec(id);
  if (hpa) return `${hpa[1]} hPa`;
  const m = /(?:^|_)(\d+)m(?:_|$)/.exec(id);
  if (m) return `${m[1]} m`;
  return null;
}

/**
 * Qualificadores de PRODUTO, nao de fenomeno.
 *
 * "Assimilated" nao muda o que esta sendo medido — muda como o valor foi
 * obtido. Sem ele, `MERRA2_2m_Air_Temperature_Monthly` e
 * `MERRA2_2m_Air_Temperature_Assimilated_Monthly` viram a MESMA linha na tela,
 * e escolher entre elas vira sorteio. Numa banca, ter duas entradas iguais com
 * dados diferentes e pior do que ter o nome feio.
 */
const QUALIFIERS = [
  ["_Assimilated", "assimilado"],
  ["_Bias_Corrected", "com viés corrigido"],
  ["_Anomaly", "anomalia"],
  ["_Climatology", "climatologia"],
];

/**
 * Converte um identificador do GIBS num nome de fenomeno.
 * Devolve tambem a proveniencia, para a interface mostrar como metadado.
 */
export function describeModelLayer(id, gibsTitle = "") {
  const famKey = Object.keys(FAMILIES).find((k) => id.startsWith(k + "_"));
  const fam = famKey ? FAMILIES[famKey] : null;

  // corpo do identificador, sem familia e sem cadencia
  let body = famKey ? id.slice(famKey.length + 1) : id;
  let cadence = null;
  for (const [suffix, label] of CADENCE) {
    if (body.endsWith(suffix)) {
      cadence = label;
      body = body.slice(0, -suffix.length);
      break;
    }
  }

  // qualificadores saem do corpo mas voltam no titulo
  const quals = [];
  for (const [needle, label] of QUALIFIERS) {
    if (body.includes(needle)) {
      quals.push(label);
      body = body.replace(needle, "");
    }
  }

  const level = levelOf(body);
  if (level) body = body.replace(/(^|_)\d+(hPa|m)(?=_|$)/i, "$1");

  // maior termo que casa
  let phenomenon = null;
  for (const [needle, label] of TERMS) {
    if (body.includes(needle)) { phenomenon = label; break; }
  }

  // Sem regra conhecida: usa o titulo do proprio GIBS, e so em ultimo caso o
  // identificador com underscores trocados. Nunca deixamos a tela em branco.
  if (!phenomenon) {
    phenomenon = gibsTitle && !/^MERRA2|^GEOS/.test(gibsTitle)
      ? gibsTitle
      : body.replace(/_/g, " ");
  }

  const parts = [phenomenon];
  if (level) parts.push(`· ${level}`);
  if (quals.length) parts.push(`(${quals.join(", ")})`);
  const title = parts.join(" ");

  const src = fam ? `${fam.kind} ${fam.label}` : "Modelo";
  const detail = [src, cadence].filter(Boolean).join(" · ");

  return {
    id,
    title,                 // "Razão de mistura de ozônio · 50 hPa"
    detail,                // "Reanálise MERRA-2 · mensal"
    family: fam?.label ?? null,
    agency: fam?.agency ?? null,
    cadence,
    level,
    raw: id,               // identificador original, para citar em metodologia
  };
}

/** ordena por fenomeno, para a lista ficar navegavel por assunto */
export function sortModelLayers(list) {
  return [...list].sort((a, b) =>
    a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id)
  );
}
