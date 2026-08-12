

/** como o dado é desenhado — espelha o `render` de server/fields.js */
export type Encoding = "suave" | "faixas" | "particulas" | "linhas" | "pontos";

/**
 * Um SLOT é um recurso escasso do globo. Camadas do mesmo slot competem;
 * camadas de slots diferentes compõem.
 */
export type Slot = "raster" | "flow" | "vector" | "marks";

export interface Family {
  id: string;
  /** título curto — o painel não tem largura para frase */
  title: string;
  /** o que este grupo É, em uma linha, para quem nunca viu */
  nature: string;
  encoding: Encoding;
  slot: Slot;
  /** true = rádio (um por vez). false = interruptor (livre) */
  exclusive: boolean;
  /** cor de identificação do grupo, em token — nunca hex cravado */
  accent: string;
}


export const FAMILIES: Family[] = [
  {
    id: "campo",
    title: "Campo contínuo",
    nature: "Varia suavemente em todo ponto — temperatura, orvalho, umidade, pressão.",
    encoding: "suave",
    slot: "raster",
    exclusive: true,
    accent: "var(--fam-campo)",
  },
  {
    id: "classe",
    title: "Campo em classes",
    nature: "Ocorre em células com borda, ou tem limiar de decisão — chuva, nuvem, estresse térmico.",
    encoding: "faixas",
    slot: "raster",
    exclusive: true,
    accent: "var(--fam-classe)",
  },
  {
    id: "escoamento",
    title: "Escoamento",
    nature: "Tem direção e persiste no tempo — vento, correntes oceânicas.",
    encoding: "particulas",
    slot: "flow",
    exclusive: false,
    accent: "var(--fam-escoamento)",
  },
  {
    id: "estrutura",
    title: "Estrutura",
    nature: "A informação está na forma da curva — isóbaras, frentes.",
    encoding: "linhas",
    slot: "vector",
    exclusive: false,
    accent: "var(--fam-estrutura)",
  },
  {
    id: "ocorrencia",
    title: "Ocorrências",
    nature: "Eventos e estações em pontos discretos — sismos, focos de calor, monitoramento.",
    encoding: "pontos",
    slot: "marks",
    exclusive: false,
    accent: "var(--fam-ocorrencia)",
  },
];

export const familyOf = (id: string) => FAMILIES.find((f) => f.id === id) ?? null;

/** Frase curta que explica a regra do grupo. */
export function ruleOf(f: Family): string {
  return f.exclusive
    ? "um por vez — dividem o mesmo plano de imagem"
    : "combinam livremente, inclusive com um campo";
}

/** Mapeamento de camadas existentes para a taxonomia. */
export interface LayerEntry {
  id: string;
  label: string;
  family: string;
  /** unidade física, quando houver — parte da leitura, não decoração */
  unit?: string;
  /** procedência curta */
  source?: string;
}

export const OVERLAY_LAYERS: LayerEntry[] = [
  { id: "wind", label: "Vento à superfície", family: "escoamento", unit: "m/s", source: "GFS 0,25°" },
  { id: "hycom", label: "Correntes oceânicas", family: "escoamento", unit: "m/s", source: "HYCOM" },
  { id: "isobars", label: "Isóbaras", family: "estrutura", unit: "hPa", source: "GFS · PRMSL" },
  { id: "quakes", label: "Sismos", family: "ocorrencia", unit: "M", source: "USGS" },
  { id: "fires", label: "Focos de calor", family: "ocorrencia", unit: "MW", source: "VIIRS 375 m" },
  { id: "openaq", label: "Qualidade do ar", family: "ocorrencia", unit: "µg/m³", source: "OpenAQ" },
  { id: "hospitals", label: "Hospitais", family: "ocorrencia", source: "OSM" },
];

/** campos escalares do GFS, repartidos pela codificação que o servidor usa */
export const FIELD_FAMILY: Record<string, string> = {
  temp2m: "campo",
  dew2m: "campo",
  rh2m: "campo",
  prmsl: "campo",
  cloud: "classe",
  precip: "classe",
  wbgt: "classe",
};
