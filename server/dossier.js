// server/dossier.js
// -----------------------------------------------------------------------------
// DOSSIÊ DO PONTO — o contrato de dados que o chat consome.
//
// Ao clicar num ponto, o usuário passa a poder conversar sobre ele. Para que
// essa conversa seja confiável, o modelo de linguagem precisa receber um objeto
// que satisfaça quatro condições. Nenhuma delas é opcional.
//
//   1. TODO VALOR TEM PROCEDÊNCIA
//      Cada número diz de onde veio e em que unidade está. Sem isso o modelo
//      mistura GFS com Open-Meteo numa frase só, e quem lê não tem como saber.
//
//   2. AUSÊNCIA É EXPLÍCITA
//      Falta de dado é `null` com motivo declarado, nunca zero nem estimativa.
//      Este projeto já removeu três fabricações que se apresentavam como
//      medição; um dossiê que preenche buraco reintroduz a quarta.
//
//   3. A ARITMÉTICA É FEITA AQUI, NÃO PELO MODELO
//      Diferenças entre instantes, máximos, mínimos e tendências vêm
//      pré-calculados. Modelo de linguagem erra conta — e erra com fluência,
//      produzindo número plausível que ninguém confere. Se ele só precisa LER
//      um delta já calculado, não há onde inventar.
//
//   4. UMA REQUISIÇÃO, MUITOS INSTANTES
//      A Open-Meteo devolve séries HORÁRIAS numa chamada só. Pedir hora a hora
//      seria multiplicar o custo por N sem ganhar nada — e o orçamento deste
//      projeto é 25% do plano gratuito.
// -----------------------------------------------------------------------------

/** o que cada variável significa, em que unidade, e de onde vem */
export const ESQUEMA = {
  temperatura:  { unidade: "°C",    fonte: "Open-Meteo", campo: "temperature_2m",       desc: "temperatura do ar a 2 m" },
  orvalho:      { unidade: "°C",    fonte: "Open-Meteo", campo: "dew_point_2m",         desc: "ponto de orvalho a 2 m" },
  umidade:      { unidade: "%",     fonte: "Open-Meteo", campo: "relative_humidity_2m", desc: "umidade relativa a 2 m" },
  pressao:      { unidade: "hPa",   fonte: "Open-Meteo", campo: "surface_pressure",     desc: "pressão à superfície" },
  precipitacao: { unidade: "mm/h",  fonte: "Open-Meteo", campo: "precipitation",        desc: "precipitação na hora" },
  nuvens:       { unidade: "%",     fonte: "Open-Meteo", campo: "cloud_cover",          desc: "cobertura de nuvens" },
  ventoVel:     { unidade: "m/s",   fonte: "Open-Meteo", campo: "wind_speed_10m",       desc: "velocidade do vento a 10 m" },
  ventoDir:     { unidade: "° (de onde vem)", fonte: "Open-Meteo", campo: "wind_direction_10m", desc: "direção meteorológica" },
};

/** número com uma casa, preservando o nulo */
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(1));

/**
 * Estatísticas de uma série, ignorando ausências — e DIZENDO quantas foram.
 *
 * `n` e `ausentes` não são detalhe: uma média de 2 valores num intervalo de 24
 * horas não significa a mesma coisa que uma média de 24, e o modelo só tem como
 * saber disso se o número estiver ali.
 */
function estatisticas(valores) {
  const bons = valores.filter((v) => v != null && Number.isFinite(v));
  if (!bons.length) {
    return { n: 0, ausentes: valores.length, min: null, max: null, media: null, delta: null, tendencia: null };
  }
  const min = Math.min(...bons);
  const max = Math.max(...bons);
  const media = bons.reduce((a, b) => a + b, 0) / bons.length;

  // Variação entre a PRIMEIRA e a ÚLTIMA leitura válida — não entre min e max.
  // São perguntas diferentes: "quanto mudou do começo ao fim" e "qual a
  // amplitude". Confundi-las já produziu relatório dizendo que a temperatura
  // subiu 12° num dia em que ela subiu e desceu de volta.
  const primeiro = bons[0], ultimo = bons[bons.length - 1];
  const delta = ultimo - primeiro;

  return {
    n: bons.length,
    ausentes: valores.length - bons.length,
    min: r1(min), max: r1(max), media: r1(media),
    delta: r1(delta),
    tendencia: Math.abs(delta) < 0.05 ? "estável" : delta > 0 ? "subindo" : "descendo",
  };
}

/**
 * Delta circular para direção do vento — de novo a lição do 350°→10°.
 * A diferença entre 350 e 10 é 20 graus, não 340.
 */
function deltaAngular(a, b) {
  if (a == null || b == null) return null;
  let d = ((b - a + 540) % 360) - 180;
  return +d.toFixed(0);
}

/**
 * Monta o dossiê.
 *
 * @param {object} o
 * @param {number} o.lat
 * @param {number} o.lng
 * @param {string} o.date        AAAA-MM-DD
 * @param {number} o.hour        hora UTC de referência
 * @param {number} [o.spanH]     janela em horas ao redor da referência
 * @param {number} [o.stepH]     passo entre instantes
 * @param {object} o.hourly      resposta `hourly` da Open-Meteo
 * @param {string} [o.place]
 * @param {object} [o.fieldWind] { speed, direction } amostrado do GFS
 * @param {string} [o.fieldSrc]
 */
export function montarDossie(o) {
  const spanH = o.spanH ?? 24;
  const stepH = o.stepH ?? 3;
  const h = o.hourly ?? {};
  const tempos = h.time ?? [];

  const refIso = `${o.date}T${String(o.hour).padStart(2, "0")}:00`;
  const iRef = tempos.findIndex((t) => String(t).startsWith(refIso));

  // instantes centrados na referência, dentro do que a série realmente cobre
  const idx = [];
  const meio = Math.floor(spanH / stepH / 2);
  for (let k = -meio; k <= meio; k++) {
    const i = (iRef >= 0 ? iRef : 0) + k * stepH;
    if (i >= 0 && i < tempos.length) idx.push(i);
  }

  const chaves = Object.keys(ESQUEMA);
  const serie = idx.map((i) => {
    const valores = {};
    for (const k of chaves) {
      const arr = h[ESQUEMA[k].campo];
      const v = Array.isArray(arr) ? arr[i] : undefined;
      valores[k] = v == null || !Number.isFinite(v) ? null : r1(v);
    }
    return { at: tempos[i], ref: i === iRef, valores };
  });

  // ---- resumo pré-calculado, para o modelo não precisar somar nada --------
  const resumo = {};
  for (const k of chaves) {
    const s = estatisticas(serie.map((p) => p.valores[k]));
    if (k === "ventoDir") {
      const bons = serie.map((p) => p.valores.ventoDir).filter((v) => v != null);
      s.delta = bons.length >= 2 ? deltaAngular(bons[0], bons[bons.length - 1]) : null;
      s.tendencia = s.delta == null ? null
        : Math.abs(s.delta) < 10 ? "constante"
        : s.delta > 0 ? "rodando à direita" : "rodando à esquerda";
      s.nota = "delta angular pelo caminho curto; 350°→10° são 20°, não 340°";
    }
    resumo[k] = { ...s, unidade: ESQUEMA[k].unidade };
  }

  // ---- lacunas, declaradas ------------------------------------------------
  const lacunas = [];
  for (const k of chaves) {
    const a = resumo[k].ausentes;
    if (a > 0) lacunas.push(`${k}: ${a} de ${serie.length} instantes sem dado`);
  }

  const instanteRef = serie.find((p) => p.ref) ?? serie[Math.floor(serie.length / 2)] ?? null;

  return {
    versao: 1,
    ponto: {
      lat: +o.lat.toFixed(4),
      lng: +o.lng.toFixed(4),
      lugar: o.place ?? null,
    },
    referencia: { data: o.date, horaUTC: o.hour, janelaH: spanH, passoH: stepH },
    esquema: ESQUEMA,
    /** o campo que MOVE as partículas na tela, para poder ser confrontado */
    campoNoPonto: o.fieldWind
      ? {
          ventoVel: r1(o.fieldWind.speed),
          ventoDir: o.fieldWind.direction == null ? null : Math.round(o.fieldWind.direction),
          fonte: o.fieldSrc ?? "GFS 0,25°",
          unidade: "m/s",
          nota: "amostrado da mesma grade que anima as partículas",
        }
      : null,
    serie,
    resumo,
    lacunas,
    instanteReferencia: instanteRef,
    aviso:
      "Ausência é null e nunca foi estimada. Todos os deltas e estatísticas " +
      "foram calculados no servidor: nenhuma aritmética deve ser refeita.",
  };
}

/**
 * Instruções para o modelo de linguagem.
 *
 * Vai junto do dossiê e é deliberadamente restritivo. O usuário escolheu que o
 * chat apenas DESCREVA e COMPARE — não interprete meteorologia. Um modelo
 * pequeno rodando no navegador afirmando mecanismo físico ("a queda de pressão
 * indica frente fria") soaria idêntico a um meteorologista e não teria como ser
 * conferido por quem lê.
 */
export function promptSistema() {
  return [
    "Você lê um dossiê JSON de um ponto geográfico e responde perguntas sobre ele.",
    "",
    "REGRAS ABSOLUTAS:",
    "1. Use SOMENTE números presentes no JSON. Nunca calcule, estime ou arredonde de cabeça.",
    "2. Diferenças e tendências já estão em `resumo`. Cite-as; não as recalcule.",
    "3. Valor `null` significa SEM DADO. Diga 'sem dado', nunca 'zero' nem 'estável'.",
    "4. Sempre cite a unidade e a fonte, que estão em `esquema`.",
    "5. Não explique causas meteorológicas nem preveja o que não está no JSON.",
    "   Se perguntarem o porquê, responda que o dossiê traz medições, não diagnóstico.",
    "6. Se a informação não estiver no JSON, diga que não está. Não deduza.",
    "",
    "Responda em português do Brasil, de forma direta e curta.",
  ].join("\n");
}
