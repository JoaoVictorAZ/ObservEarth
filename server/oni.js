// server/oni.js
// -----------------------------------------------------------------------------
// ONI — ÍNDICE OCEÂNICO NIÑO
// -----------------------------------------------------------------------------
// O contexto que faltava para as anomalias do app significarem alguma coisa.
//
// Hoje a sonda diz "a máxima de hoje está no percentil 92 para esta data". É
// uma afirmação correta e solitária: ela não diz se o ano inteiro está torto.
// O ONI diz. Ele é a anomalia de temperatura da superfície do mar na região
// Niño 3.4, em média móvel de três meses, e é o índice que o serviço
// meteorológico dos EUA usa para declarar El Niño e La Niña.
//
// FORMATO: um arquivo de texto, colunas separadas por espaço.
//
//   SEAS YR   TOTAL ANOM
//   DJF  1950 24.72 -1.53
//   JFM  1950 25.17 -1.34
//
// `SEAS` é um trimestre sobreposto, nomeado pelas iniciais dos três meses em
// inglês. Cada trimestre é ancorado no MÊS DO MEIO: DJF pertence a janeiro,
// JFM a fevereiro, e assim por diante até NDJ, que pertence a dezembro.
//
// UM TRIMESTRE ACIMA DE 0,5 NÃO É UM EL NIÑO
//
// Este é o erro clássico com este dado, e é fácil de cometer porque o número
// está bem ali. O critério oficial exige CINCO trimestres sobrepostos
// CONSECUTIVOS no mesmo lado do limiar. Um mês isolado em +0,6 não é episódio
// nenhum — é ruído. Por isso `episodios()` existe, e por isso a classificação
// de cada trimestre depende dos vizinhos dele e não só do próprio valor.
// -----------------------------------------------------------------------------

export const URL_ONI = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt";

/** Limiar do critério oficial, em °C de anomalia. */
export const LIMIAR = 0.5;
/** Trimestres sobrepostos consecutivos exigidos para declarar episódio. */
export const MINIMO_CONSECUTIVO = 5;

/**
 * Trimestre sobreposto → mês âncora (o do meio), 1 a 12.
 *
 * A ordem não é alfabética nem óbvia; é a sequência do calendário, e escrevê-la
 * por extenso evita a tentação de derivá-la das iniciais — que quebraria em
 * NDJ, o único que atravessa a virada do ano.
 */
export const MES_DO_TRIMESTRE = {
  DJF: 1, JFM: 2, FMA: 3, MAM: 4, AMJ: 5, MJJ: 6,
  JJA: 7, JAS: 8, ASO: 9, SON: 10, OND: 11, NDJ: 12,
};

/**
 * Lê o arquivo do CPC.
 *
 * Linhas ilegíveis são puladas em silêncio de propósito: o arquivo tem
 * cabeçalho e às vezes linhas em branco no fim, e nenhum dos dois é anomalia
 * de dado. O que NÃO é silencioso é o arquivo inteiro sair vazio — isso é
 * erro, e vira exceção em `buscarONI`.
 */
export function lerONI(texto) {
  const linhas = String(texto ?? "").split(/\r?\n/);
  const fora = [];

  for (const linha of linhas) {
    const p = linha.trim().split(/\s+/);
    if (p.length < 4) continue;
    const [seas, yr, total, anom] = p;

    const mes = MES_DO_TRIMESTRE[seas.toUpperCase()];
    const ano = Number(yr);
    const valor = Number(anom);
    if (mes == null || !Number.isFinite(ano) || !Number.isFinite(valor)) continue;

    fora.push({
      trimestre: seas.toUpperCase(),
      ano, mes,
      tsm: Number.isFinite(Number(total)) ? Number(total) : null,
      anomalia: valor,
    });
  }

  fora.sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  return fora;
}

/**
 * Marca cada trimestre com a fase a que ele pertence.
 *
 * Um trimestre só recebe `el nino` ou `la nina` se estiver dentro de uma
 * corrida de pelo menos cinco trimestres consecutivos do mesmo lado. Fora
 * disso ele é `neutro`, ainda que o próprio número passe do limiar — que é
 * exatamente o caso que o critério oficial existe para não contar.
 */
export function episodios(serie, limiar = LIMIAR, minimo = MINIMO_CONSECUTIVO) {
  const lado = (v) => (v >= limiar ? 1 : v <= -limiar ? -1 : 0);
  const fase = new Array(serie.length).fill("neutro");

  let i = 0;
  while (i < serie.length) {
    const l = lado(serie[i].anomalia);
    if (l === 0) { i++; continue; }
    let j = i;
    while (j < serie.length && lado(serie[j].anomalia) === l) j++;
    if (j - i >= minimo) {
      for (let k = i; k < j; k++) fase[k] = l > 0 ? "el nino" : "la nina";
    }
    i = j;
  }

  return serie.map((s, k) => ({ ...s, fase: fase[k] }));
}

/**
 * Intensidade do episódio, pela escala usual do CPC.
 *
 * Só faz sentido para trimestres que JÁ pertencem a um episódio; para um
 * trimestre neutro devolve `null`, porque "La Niña fraca" e "neutro com −0,6"
 * são coisas diferentes e a segunda não tem nome.
 */
export function intensidade(registro) {
  if (!registro || registro.fase === "neutro") return null;
  const a = Math.abs(registro.anomalia);
  if (a >= 2.0) return "muito forte";
  if (a >= 1.5) return "forte";
  if (a >= 1.0) return "moderado";
  return "fraco";
}

/** O trimestre que corresponde a um ano e mês. */
export function em(serie, ano, mes) {
  return serie.find((s) => s.ano === ano && s.mes === mes) ?? null;
}

/**
 * A frase para a tela.
 *
 * A RESSALVA NÃO É OPCIONAL. A relação entre ENSO e clima local muda de sinal
 * dentro do próprio Brasil: El Niño costuma trazer chuva ao Sul e seca ao
 * Nordeste. Uma frase única para o país inteiro seria falsa, e por isso esta
 * frase descreve o ÍNDICE e nunca o efeito.
 */
export function frase(registro) {
  if (!registro) return null;
  const sinal = registro.anomalia >= 0 ? "+" : "−";
  const n = `${sinal}${Math.abs(registro.anomalia).toFixed(1)} °C`;

  if (registro.fase === "neutro") {
    return `ENSO neutro (ONI ${n} no trimestre ${registro.trimestre})`;
  }
  const nome = registro.fase === "el nino" ? "El Niño" : "La Niña";
  return `${nome} ${intensidade(registro)} (ONI ${n} no trimestre ${registro.trimestre})`;
}

export async function buscarONI(fetchImpl, cached) {
  // Seis horas de cache para um arquivo que muda uma vez por mês é folgado de
  // propósito: o custo de estar seis horas atrasado num índice trimestral é
  // zero, e o de bater no CPC a cada clique não é.
  const SEIS_HORAS = 6 * 3600e3;
  return cached("oni:cpc", SEIS_HORAS, async () => {
    const r = await fetchImpl(URL_ONI);
    if (!r.ok) throw Object.assign(new Error(`ONI HTTP ${r.status}`), { status: 502 });
    const serie = episodios(lerONI(await r.text()));
    if (!serie.length) {
      throw Object.assign(new Error("arquivo do ONI sem nenhuma linha legível"), { status: 502 });
    }
    const ultimo = serie[serie.length - 1];
    return {
      serie,
      ultimo,
      frase: frase(ultimo),
      fonte: "NOAA · Climate Prediction Center",
      licenca: "Domínio público (NOAA)",
      nota:
        `Anomalia de TSM da região Niño 3.4 em média de 3 meses. Episódio exige ` +
        `${MINIMO_CONSECUTIVO} trimestres sobrepostos consecutivos além de ±${LIMIAR} °C. ` +
        `O índice descreve o Pacífico, não o clima de um ponto: no Brasil o efeito ` +
        `muda de sinal entre Sul e Nordeste.`,
    };
  });
}
