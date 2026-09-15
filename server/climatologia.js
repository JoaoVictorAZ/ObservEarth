// server/climatologia.js
// -----------------------------------------------------------------------------
// A NORMAL CLIMATOLÓGICA DE UM PONTO
// -----------------------------------------------------------------------------
// Serve para responder a pergunta que a sonda não respondia: "27 °C é muito?".
// Sem uma referência do que é normal ALI, NAQUELA ÉPOCA, o número é só um
// número. A referência é 1991–2020, que é a normal padrão da OMM.
//
// COMO O CUSTO CABE NO ORÇAMENTO
//
// São 30 anos de dados diários — 10.958 dias — mas isso é UMA requisição ao
// arquivo do ERA5, porque a Open-Meteo cobra por localização e não por volume.
// E a climatologia de 1991–2020 é um período fechado: não muda amanhã, não
// muda nunca. Por isso o cache é de um ano e a chave é arredondada para a
// grade de 0,25°, a mesma do campo de vento — dois cliques no mesmo bairro
// reaproveitam a mesma resposta.
//
// A JANELA DE ±7 DIAS
//
// A normal de 15 de março não é calculada só com os trinta 15 de março: são os
// dias 8 a 22 de cada ano, 450 amostras em vez de 30. Sem essa janela, os
// quantis ficam grosseiros a ponto de o percentil pular de 3 em 3 pontos, e um
// único ano atípico desloca a mediana visivelmente. É a prática usual em
// climatologia justamente por isso.
// -----------------------------------------------------------------------------

/** Período de referência da OMM. Fechado: começo e fim não se movem. */
export const REF_INICIO = "1991-01-01";
export const REF_FIM = "2020-12-31";
export const JANELA_DIAS = 7;

/**
 * Variáveis com normal, e como cada uma se comporta.
 *
 * `feitio` decide o que a tela pode afirmar: `simetrica` autoriza "+3,4 °C
 * acima da média"; `assimetrica` só autoriza percentil, porque a média de
 * chuva é puxada por poucos dias e descreveria uma distribuição que não
 * existe. Ver `src/anomalia.ts`.
 */
export const VARIAVEIS = {
  temperature_2m_mean: { unidade: "°C", feitio: "simetrica", rotulo: "temperatura média" },
  temperature_2m_max: { unidade: "°C", feitio: "simetrica", rotulo: "temperatura máxima" },
  temperature_2m_min: { unidade: "°C", feitio: "simetrica", rotulo: "temperatura mínima" },
  precipitation_sum: { unidade: "mm", feitio: "assimetrica", rotulo: "precipitação diária" },
  wind_speed_10m_max: { unidade: "m/s", feitio: "assimetrica", rotulo: "vento máximo" },
};

/** Dia do ano, 1 a 366. */
export function diaDoAno(data) {
  const d = data instanceof Date ? data : new Date(`${data}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - inicio) / 86400e3) + 1;
}

/**
 * O dia `alvo` está dentro de ±`janela` dias de `dia`, dando a volta no ano?
 *
 * A volta importa: a normal de 2 de janeiro precisa dos dias 26 a 31 de
 * dezembro. Sem o enrolamento, as duas semanas em torno do Ano-Novo teriam
 * metade das amostras das demais — e ninguém notaria, porque o resultado
 * continuaria parecendo um número normal.
 */
export function dentroDaJanela(dia, alvo, janela = JANELA_DIAS) {
  const d = Math.abs(dia - alvo);
  // 365, não 366, e a diferença de um custa uma semana de amostras.
  //
  // De 26 de dezembro (dia 360) a 2 de janeiro vão 7 dias: cinco até o fim do
  // ano mais dois. Com 366 no lugar do 365 a conta dá 8, e 26 de dezembro fica
  // de fora da janela de 2 de janeiro — a virada do ano perderia amostras e o
  // resultado continuaria parecendo um número perfeitamente normal.
  //
  // O QUE ISTO ERRA, DE PROPÓSITO: o comprimento do ano não é constante, e
  // nenhuma constante única acerta os dois casos. Com 365, o dia 366 de um ano
  // bissexto (31/dez) sai à distância ZERO do dia 1 (1/jan), quando o certo
  // seria 1 — a janela de 31/dez acaba pegando de 24/dez a 8/jan em vez de
  // 24/dez a 7/jan. É um dia a mais num conjunto de quinze, em dois dias do ano,
  // e só nos ~7 anos bissextos dos trinta. Corrigir exigiria carregar o ano de
  // cada amostra até aqui para saber se ele tem 365 ou 366 dias; o erro que
  // isso evitaria é menor que a diferença entre 450 e 480 amostras.
  //
  // O que NÃO é aceitável, e é o que a versão com 366 fazia, é perder amostras:
  // ali 26/dez ficava fora da janela de 2/jan e a virada do ano tinha metade da
  // vizinhança das outras semanas.
  return Math.min(d, 365 - d) <= janela;
}

/**
 * Quantis em passos de 5%, por interpolação linear entre as amostras
 * ordenadas. Devolve 21 valores, de p0 a p100.
 */
export function quantis(valores) {
  const v = valores.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { q: Array(21).fill(null), media: null, n: 0 };

  const q = [];
  for (let i = 0; i <= 20; i++) {
    const pos = (i / 20) * (v.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    q.push(lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo));
  }
  return { q, media: v.reduce((a, b) => a + b, 0) / v.length, n: v.length };
}

/**
 * Monta as normais de um ponto para um dia do ano.
 *
 * `hourly` não entra aqui: a normal é diária. A sonda compara o valor horário
 * contra a distribuição diária, que é uma aproximação declarada — a alternativa
 * seria baixar 30 anos de dados HORÁRIOS por ponto, o que multiplicaria o
 * volume por 24 para uma diferença que não muda a leitura de "acima do normal".
 */
export function montarNormais(diario, dataAlvo) {
  const alvo = diaDoAno(dataAlvo);
  if (alvo == null) throw Object.assign(new Error(`data inválida: ${dataAlvo}`), { status: 400 });

  const tempos = diario?.time ?? [];
  if (!tempos.length) throw Object.assign(new Error("arquivo sem série diária"), { status: 502 });

  // Índices dos dias que caem na janela, em qualquer um dos 30 anos.
  const dentro = [];
  const anos = new Set();
  for (let i = 0; i < tempos.length; i++) {
    const dia = diaDoAno(tempos[i]);
    if (dia != null && dentroDaJanela(dia, alvo)) {
      dentro.push(i);
      anos.add(String(tempos[i]).slice(0, 4));
    }
  }

  const normais = {};
  for (const [nome, cfg] of Object.entries(VARIAVEIS)) {
    const col = diario[nome];
    if (!Array.isArray(col)) continue;
    const { q, media, n } = quantis(dentro.map((i) => col[i]));
    normais[nome] = {
      q, media,
      anos: anos.size,
      amostras: n,
      unidade: cfg.unidade,
      feitio: cfg.feitio,
      rotulo: cfg.rotulo,
    };
  }

  return {
    referencia: `${REF_INICIO.slice(0, 4)}–${REF_FIM.slice(0, 4)}`,
    diaDoAno: alvo,
    janelaDias: JANELA_DIAS,
    anos: anos.size,
    fonte: "ERA5 via Open-Meteo Archive",
    nota:
      `Normal de ${REF_INICIO.slice(0, 4)}–${REF_FIM.slice(0, 4)} (padrão OMM), ` +
      `calculada com os dias a ±${JANELA_DIAS} do dia ${alvo} de cada ano.`,
    normais,
  };
}

/** URL do arquivo. Separada para o teste montar a requisição sem rede. */
export function urlArquivo(lat, lng) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: REF_INICIO,
    end_date: REF_FIM,
    daily: Object.keys(VARIAVEIS).join(","),
    wind_speed_unit: "ms",
    timezone: "UTC",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${qs}`;
}

/**
 * Chave de cache.
 *
 * Arredondada para a grade de 0,25° — a mesma do campo de vento — porque a
 * normal de dois pontos a 20 km é praticamente a mesma e não vale uma segunda
 * requisição de 30 anos. O dia do ano entra: são 366 recortes do mesmo
 * download, mas o download é que custa, e ele é cacheado à parte.
 */
export function chaveCache(lat, lng) {
  const r = (x) => (Math.round(x * 4) / 4).toFixed(2);
  return `clima:${REF_INICIO}:${r(lat)}:${r(lng)}`;
}

/**
 * O download de 30 anos, isolado e cacheado.
 *
 * Separado de `buscarClimatologia` de propósito: a sonda quer a normal de UM
 * dia e a análise quer o envelope do ano INTEIRO, e as duas coisas se calculam
 * do mesmo arquivo. Compartilhando esta função e esta chave, a segunda rota
 * custa zero requisição — ela é aritmética sobre um download que já aconteceu.
 */
export async function baixarArquivo(fetchImpl, lat, lng, cached) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error("lat e lng são obrigatórios"), { status: 400 });
  }

  const ANO = 365 * 24 * 3600e3;
  return cached(chaveCache(lat, lng), ANO, async () => {
    const r = await fetchImpl(urlArquivo(lat, lng));
    if (!r.ok) {
      throw Object.assign(new Error(`arquivo ERA5 HTTP ${r.status}`), { status: 502 });
    }
    const j = await r.json();
    if (!j?.daily?.time?.length) {
      throw Object.assign(new Error("arquivo ERA5 sem série diária"), { status: 502 });
    }
    return j.daily;
  });
}

export async function buscarClimatologia(fetchImpl, lat, lng, dataAlvo, cached) {
  const diario = await baixarArquivo(fetchImpl, lat, lng, cached);
  return montarNormais(diario, dataAlvo);
}
