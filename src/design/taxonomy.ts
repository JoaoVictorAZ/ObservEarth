// src/design/taxonomy.ts
// -----------------------------------------------------------------------------
// TAXONOMIA DE CAMADAS — o eixo organizador do redesign.
//
// O PROBLEMA
// O painel agrupava por PROCEDÊNCIA: campos GFS, satélite, modelo, sobreposições.
// Isso responde "de onde veio", que é a pergunta de quem construiu o sistema —
// não a de quem o usa. Quem lê o mapa pergunta outra coisa:
//
//     "o que posso ver ao mesmo tempo, e por que isto parece com aquilo?"
//
// Agrupado por procedência, temperatura (raster contínuo) fica ao lado de chuva
// (raster em classes) e de vento (partículas), como se fossem a mesma coisa —
// e nada na tela explica por que ligar uma apaga a outra.
//
// A SOLUÇÃO
// Agrupar pela NATUREZA do dado. E a natureza determina três coisas de uma vez:
//
//   1. a CODIFICAÇÃO visual  (já implementada em server/fields.js)
//   2. se as camadas PODEM COEXISTIR
//   3. que controle é honesto — rádio ou interruptor
//
// O item 3 é o que resolve um defeito real: só existe UM plano de imagem no
// globo. Oferecer temperatura, chuva e WBGT como interruptores independentes é
// prometer o que não se cumpre — ligar a segunda apaga a primeira em silêncio.
// Rádio não promete.
// -----------------------------------------------------------------------------

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

/**
 * AS CINCO FAMÍLIAS.
 *
 * Cinco, e não sete ou dez, porque o número precisa caber na memória de quem
 * abre o painel pela primeira vez. Cada uma responde a uma pergunta diferente
 * sobre a atmosfera, e é por isso que compõem bem entre si.
 */
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

/**
 * Frase curta que explica a REGRA do grupo, exibida sob o título.
 *
 * Existe porque "só um por vez" precisa ser dito ANTES de o usuário descobrir
 * clicando. Interface que só revela sua regra pelo erro é interface que culpa
 * quem a usa.
 */
export function ruleOf(f: Family): string {
  return f.exclusive
    ? "um por vez — dividem o mesmo plano de imagem"
    : "combinam livremente, inclusive com um campo";
}

/**
 * Onde cada camada existente entra.
 *
 * `slotKey` casa com o estado no layerStore. Manter este mapa num só lugar é o
 * que impede a taxonomia de divergir do que a aplicação faz de fato — foi
 * exatamente assim que a legenda passou a descrever cores que o mapa não
 * pintava mais.
 */
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
