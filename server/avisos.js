// server/avisos.js
// -----------------------------------------------------------------------------
// AVISOS METEOROLÓGICOS DO INMET (Alert-AS)
// -----------------------------------------------------------------------------
// A primeira camada do projeto que não mostra uma MEDIDA e sim uma CONSEQUÊNCIA
// declarada por autoridade. Tudo que o app desenha hoje é "quanto está"; isto é
// "o serviço meteorológico nacional diz que isto é perigoso, aqui, até tal
// hora".
//
// O QUE FOI MEDIDO NO FEED REAL (07/09/2026), E NÃO SUPOSTO
//
// 1. LICENÇA. O canal declara `<copyright>public domain</copyright>` e traz um
//    comentário de licença: "O conteudo deste site, podera ser reproduzido
//    desde que citada a fonte". Isto RESOLVE, para este feed, a ambiguidade de
//    licença que existe no resto dos dados do INMET. Reprodução autorizada com
//    citação da fonte — e é o que a camada faz.
//
// 2. NÃO HÁ GEOMETRIA NENHUMA. Esta é a descoberta que muda o desenho. Eu
//    esperava polígono, GeoRSS ou ao menos código de município. O que vem é uma
//    lista de NOMES de mesorregião do IBGE, em texto corrido:
//
//      "Aviso para as Áreas: Sul Baiano, Central Espírito-santense, ..."
//
//    Desenhar isso no mapa exige casar nome com a malha territorial do IBGE, o
//    que é trabalho à parte e falível (acento, grafia, ambiguidade). Por isso a
//    v1 desta camada é uma LISTA, não um polígono — e os nomes saem daqui
//    prontos para o casamento futuro, sem que ninguém precise reprocessar HTML.
//
// 3. A carga tem 42 avisos ativos, severidades "Perigo Potencial" e "Perigo",
//    e eventos como Tempestade, Baixa Umidade, Chuvas Intensas, Geada,
//    Ventos Costeiros, Declínio de Temperatura, Acumulado de Chuva.
//
// FORMATO: RSS 2.0, com o conteúdo útil dentro de um CDATA que contém uma
// TABELA HTML. Não é bonito e não é nossa escolha; é o que a fonte publica.
// -----------------------------------------------------------------------------

export const URL_AVISOS = "https://apiprevmet3.inmet.gov.br/avisos/rss";

/**
 * Os três graus da escala do INMET, do menos para o mais grave.
 *
 * "Perigo Potencial" e "Perigo" foram observados no feed; "Grande Perigo" está
 * declarado na escala oficial e não apareceu na carga medida. Ele está aqui
 * porque a ausência num dia calmo não é evidência de inexistência — e uma
 * severidade desconhecida chegando na tela sem cor é pior que uma prevista.
 */
export const SEVERIDADES = {
  "perigo potencial": { grau: 1, rotulo: "Perigo potencial", cor: "var(--warn)" },
  "perigo": { grau: 2, rotulo: "Perigo", cor: "var(--alert)" },
  "grande perigo": { grau: 3, rotulo: "Grande perigo", cor: "var(--alert)" },
};

const semAcento = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function grauDe(severidade) {
  return SEVERIDADES[semAcento(severidade)] ?? { grau: 0, rotulo: String(severidade ?? "—"), cor: "var(--ink-3)" };
}

/** Desfaz as entidades que o feed usa dentro do CDATA. */
function texto(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * As linhas da tabela HTML dentro do CDATA viram um objeto.
 *
 * Regex e não parser de XML porque o conteúdo é HTML DENTRO de XML, gerado por
 * template — e porque acrescentar uma dependência de parser para ler sete
 * linhas de tabela custa mais do que resolve. A garantia vem do teste, que roda
 * contra uma amostra do feed de verdade.
 */
export function lerTabela(html) {
  const campos = {};
  const re = /<th[^>]*>(.*?)<\/th>\s*<td[^>]*>(.*?)<\/td>/gis;
  let m;
  while ((m = re.exec(String(html ?? ""))) != null) {
    const chave = semAcento(texto(m[1].replace(/<[^>]+>/g, "")));
    campos[chave] = texto(m[2].replace(/<[^>]+>/g, " "));
  }
  return campos;
}

/**
 * "Aviso para as Áreas: A, B, C" → ["A", "B", "C"].
 *
 * Devolve lista vazia, e nunca `[""]`, quando não há área — a diferença
 * importa porque a tela conta áreas para dizer o alcance do aviso.
 */
export function lerAreas(campo) {
  const bruto = String(campo ?? "").replace(/^\s*aviso\s+para\s+as\s+[áa]reas:\s*/i, "");
  return bruto.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * As datas do feed vêm como "2026-09-06 11:20:00.0", SEM fuso declarado.
 *
 * FUSO NÃO CONFIRMADO. Na carga medida, o `pubDate` do item — que traz `+0000`
 * explícito — tem exatamente o mesmo relógio de parede do campo "Início". Isso
 * é evidência de que o feed emite os dois em UTC, e é o que assumimos aqui.
 * Se estiver errado, o erro é de 3 horas e o sintoma seria um aviso aparecendo
 * como vigente 3 h depois de expirar. Por isso `inicioTexto`/`fimTexto` são
 * preservados no resultado: a tela mostra o que a fonte escreveu, e não só a
 * nossa interpretação dela.
 */
export function lerInstante(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [, a, mes, d, h, min] = m;
  const t = Date.UTC(+a, +mes - 1, +d, +h, +min);
  return Number.isFinite(t) ? t : null;
}

/** Extrai os `<item>` do RSS sem depender de parser de XML. */
function itens(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml ?? ""))) != null) out.push(m[1]);
  return out;
}

const dentro = (bloco, tag) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(bloco);
  if (!m) return null;
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(m[1]);
  return cdata ? cdata[1] : texto(m[1]);
};

export function lerAvisos(xml) {
  const avisos = [];
  const descartados = [];

  for (const bloco of itens(xml)) {
    const id = (dentro(bloco, "guid") ?? dentro(bloco, "link") ?? "").split("/").filter(Boolean).pop() ?? null;
    const campos = lerTabela(dentro(bloco, "description") ?? "");

    const evento = campos["evento"] ?? null;
    const severidade = campos["severidade"] ?? null;
    const inicioTexto = campos["inicio"] ?? null;
    const fimTexto = campos["fim"] ?? null;

    // Um aviso sem evento, sem severidade ou sem janela de vigência não é um
    // aviso pela metade: é lixo que viraria um retângulo colorido sem
    // significado. Ele é DESCARTADO e a contagem sai na resposta.
    if (!evento || !severidade || !inicioTexto || !fimTexto) {
      descartados.push({ id, motivo: "campos obrigatórios ausentes" });
      continue;
    }

    const inicio = lerInstante(inicioTexto);
    const fim = lerInstante(fimTexto);
    if (inicio == null || fim == null) {
      descartados.push({ id, motivo: `datas ilegíveis: "${inicioTexto}" / "${fimTexto}"` });
      continue;
    }

    const sev = grauDe(severidade);
    avisos.push({
      id,
      evento,
      severidade: sev.rotulo,
      grau: sev.grau,
      status: campos["status"] ?? null,
      descricao: campos["descricao"] ?? null,
      inicio, fim,
      inicioTexto, fimTexto,
      areas: lerAreas(campos["area"]),
      link: dentro(bloco, "link"),
    });
  }

  // Mais grave primeiro; empatando, o que começa antes.
  avisos.sort((a, b) => b.grau - a.grau || a.inicio - b.inicio);
  return { avisos, descartados };
}

/** O aviso está valendo neste instante? */
export function vigente(a, agora) {
  return a.inicio <= agora && agora <= a.fim;
}

export async function buscarAvisos(fetchImpl, cached, agora = Date.now()) {
  // Cache curto: aviso é a única camada do app em que estar desatualizado é um
  // problema de segurança e não de estética.
  const DEZ_MIN = 10 * 60e3;
  const { avisos, descartados, buscadoEm } = await cached("avisos:inmet", DEZ_MIN, async () => {
    const r = await fetchImpl(URL_AVISOS);
    if (!r.ok) throw Object.assign(new Error(`Alert-AS HTTP ${r.status}`), { status: 502 });
    const xml = await r.text();
    const lido = lerAvisos(xml);
    if (!lido.avisos.length && !lido.descartados.length && !/<item>/i.test(xml)) {
      // Zero itens PODE ser um dia calmo, e pode ser o formato ter mudado. A
      // diferença entre "não há aviso" e "não sei ler mais o feed" é grande
      // demais para ficar implícita.
      throw Object.assign(new Error("o feed do INMET não trouxe nenhum item"), { status: 502 });
    }
    return { ...lido, buscadoEm: Date.now() };
  });

  return {
    avisos,
    vigentes: avisos.filter((a) => vigente(a, agora)).length,
    descartados: descartados.length,
    buscadoEm,
    fonte: "INMET · Alert-AS",
    licenca: "Domínio público, reprodução permitida com citação da fonte (declarado pelo próprio feed)",
    nota:
      "As áreas são nomes de mesorregião do IBGE — o feed não publica geometria. " +
      "As datas vêm sem fuso declarado e são lidas como UTC; o texto original de " +
      "início e fim acompanha cada aviso.",
  };
}
