// src/vista/estado.ts
// -----------------------------------------------------------------------------
// A VISTA INTEIRA NUMA URL.
// -----------------------------------------------------------------------------
// Câmera, data, hora, projeção, camadas ligadas e o ponto sondado cabem num
// fragmento de endereço. Quem abre o link vê exatamente o que quem mandou via.
//
// O uso que motivou isto não é social, é VERIFICAÇÃO. Um documento que afirma
// "a Amazônia tem buraco de cobertura" vale mais se vier com um endereço que
// abre o globo naquela vista, com a camada de estações ligada. Quem lê deixa de
// acreditar e passa a conferir — que é a diferença entre um relatório e uma
// prova.
//
// -----------------------------------------------------------------------------
// POR QUE FRAGMENTO, E NÃO CONSULTA
// -----------------------------------------------------------------------------
// `#...` e não `?...`. O fragmento **nunca é enviado ao servidor**: fica no
// navegador, não entra em log de acesso, não vai em `Referer`.
//
// E o que está aqui dentro é coordenada — onde alguém olhou, e quando. Isso é
// informação sobre uma pessoa, não sobre o tempo. Com `?` o endereço de um
// usuário viraria linha no log de qualquer proxy no caminho. Não há motivo para
// pagar esse preço: o cliente é quem lê este estado, e o servidor não precisa
// dele.
//
// -----------------------------------------------------------------------------
// O QUE O LINK CARREGA, E O QUE ELE DELIBERADAMENTE NÃO CARREGA
// -----------------------------------------------------------------------------
// Ele carrega o ponto sondado como COORDENADA. Não carrega a temperatura que
// estava na tela.
//
// A distinção é o princípio do projeto aplicado a endereços: o link diz **onde
// olhar**, e quem abre vai buscar o valor de novo. Guardar o número faria um
// endereço de ontem mostrar o tempo de ontem com cara de agora — dado velho
// vestido de medição. Reabrir e re-sondar pode dar outro valor, e é isso mesmo
// que tem que acontecer.
// -----------------------------------------------------------------------------

/** As chaves ligáveis, e o nome curto de cada uma no endereço. */
export const CAMADAS = {
  vento: "wind",
  isobaras: "isobarsOn",
  sismos: "quakesOn",
  fogo: "firesOn",
  ar: "openaqOn",
  wbgt: "wbgtOn",
  hospitais: "hospitalsOn",
  estacoes: "estacoesOn",
  correntes: "hycomOn",
  relevo: "relevoOn",
} as const;

export type NomeCamada = keyof typeof CAMADAS;
export const NOMES = Object.keys(CAMADAS) as NomeCamada[];

export interface Vista {
  lat: number;
  lng: number;
  /** altitude da câmera em raios terrestres, como o globe.gl usa */
  alt: number;
  /** `YYYY-MM-DD` */
  dia: string;
  /** 0 a 23, UTC */
  hora: number;
  modo: "globo" | "mapa";
  /** a camada de fundo escolhida, se houver */
  camada: { tipo: "field" | "sat" | "model"; id: string } | null;
  /** opacidade da camada de fundo, 0 a 1 */
  opacidade: number;
  /** TODAS as camadas ligadas — ver a nota em `paraHash` */
  ligadas: NomeCamada[];
  /** o ponto sondado, só a coordenada */
  sonda: { lat: number; lng: number } | null;
}

export const PADRAO: Vista = {
  lat: 0, lng: 0, alt: 1.7,
  dia: "", hora: 0,
  modo: "globo",
  camada: null,
  opacidade: 0.78,
  ligadas: ["vento", "sismos", "ar"],
  sonda: null,
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Arredonda sem deixar `-0` nem notação exponencial. */
function num(v: number, casas: number): string {
  const x = Number(v.toFixed(casas));
  return String(Object.is(x, -0) ? 0 : x);
}

function faixa(v: unknown, min: number, max: number): number | null {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) && x >= min && x <= max ? x : null;
}

/**
 * A vista -> fragmento de endereço.
 *
 * QUATRO CASAS DECIMAIS, e não as quinze que o float carrega. Quatro casas são
 * ~11 m no equador: mais fino que qualquer célula de modelo que o app desenha,
 * e mais fino que a precisão com que alguém clica. As outras onze casas seriam
 * precisão falsa ocupando espaço no endereço.
 *
 * E A LISTA DE CAMADAS VAI INTEIRA, inclusive as que hoje já vêm ligadas por
 * padrão. Escrever só a diferença daria um endereço mais curto e um link que
 * MUDA DE SIGNIFICADO quando o padrão do app mudar — um link de hoje, aberto
 * depois de alguém desligar o vento por padrão, mostraria outra coisa sem
 * avisar. Um instrumento de verificação não pode depender da versão que o abre.
 */
export function paraHash(v: Vista): string {
  const p: string[] = [];
  p.push(`p=${num(v.lat, 4)},${num(v.lng, 4)},${num(v.alt, 3)}`);
  if (DIA.test(v.dia)) p.push(`t=${v.dia},${String(v.hora).padStart(2, "0")}`);
  if (v.modo !== PADRAO.modo) p.push(`m=${v.modo}`);
  if (v.camada) p.push(`c=${v.camada.tipo}:${v.camada.id}`);
  if (Math.abs(v.opacidade - PADRAO.opacidade) > 0.005) {
    p.push(`o=${Math.round(v.opacidade * 100)}`);
  }
  p.push(`l=${v.ligadas.join(".")}`);
  if (v.sonda) p.push(`s=${num(v.sonda.lat, 4)},${num(v.sonda.lng, 4)}`);
  return p.join("&");
}

/**
 * Fragmento -> vista. **Nunca lança.**
 *
 * Um endereço é dado de fora: pode vir truncado por um cliente de e-mail,
 * colado pela metade, ou escrito por uma versão futura que conhece chaves que
 * esta não conhece. Em todos esses casos o certo é abrir o app — com o que deu
 * para entender e o padrão no resto — e não uma tela de erro.
 *
 * Chave desconhecida é IGNORADA em silêncio, de propósito: é o que permite
 * acrescentar campos sem quebrar os links já enviados.
 *
 * Valor fora de faixa CAI PARA O PADRÃO em vez de ser usado. Uma latitude 5000
 * não é uma vista excêntrica, é lixo — e aceitar lixo põe a câmera num lugar
 * que ninguém consegue explicar depois.
 */
export function deHash(bruto: string): Vista {
  const v: Vista = { ...PADRAO, ligadas: [...PADRAO.ligadas] };
  const s = (bruto ?? "").replace(/^#/, "").trim();
  if (!s) return v;

  const campos = new Map<string, string>();
  for (const par of s.split("&")) {
    const i = par.indexOf("=");
    if (i > 0) campos.set(par.slice(0, i), decodeURIComponent(par.slice(i + 1)));
  }

  const p = campos.get("p")?.split(",");
  if (p && p.length >= 2) {
    const lat = faixa(p[0], -90, 90);
    const lng = faixa(p[1], -180, 180);
    // O teto de 8 raios não é estético: acima disso o planeta é um ponto e o
    // app deixa de mostrar qualquer coisa. O piso de 0,02 é a superfície.
    const alt = p[2] !== undefined ? faixa(p[2], 0.02, 8) : null;
    if (lat !== null && lng !== null) { v.lat = lat; v.lng = lng; }
    if (alt !== null) v.alt = alt;
  }

  const t = campos.get("t")?.split(",");
  if (t && DIA.test(t[0])) {
    v.dia = t[0];
    const h = t[1] !== undefined ? faixa(t[1], 0, 23) : null;
    v.hora = h === null ? 0 : Math.round(h);
  }

  const m = campos.get("m");
  if (m === "mapa" || m === "globo") v.modo = m;

  const c = campos.get("c");
  if (c) {
    const i = c.indexOf(":");
    const tipo = c.slice(0, i);
    const id = c.slice(i + 1);
    // O id NÃO é validado contra um catálogo aqui: as camadas do GIBS vêm do
    // `GetCapabilities` em tempo de execução, e esta função é pura. Quem não
    // achar o id trata isso como camada ausente, que é o mesmo caminho de uma
    // camada que a NASA aposentou.
    if (id && (tipo === "field" || tipo === "sat" || tipo === "model")) {
      v.camada = { tipo, id };
    }
  }

  const o = faixa(campos.get("o"), 0, 100);
  if (o !== null) v.opacidade = o / 100;

  const l = campos.get("l");
  if (l !== undefined) {
    // `l=` vazio é uma escolha legítima: todas desligadas. Por isso o teste é
    // `!== undefined` e não `if (l)`.
    v.ligadas = l.split(".").filter((n): n is NomeCamada => NOMES.includes(n as NomeCamada));
  }

  const sd = campos.get("s")?.split(",");
  if (sd && sd.length >= 2) {
    const lat = faixa(sd[0], -90, 90);
    const lng = faixa(sd[1], -180, 180);
    if (lat !== null && lng !== null) v.sonda = { lat, lng };
  }

  return v;
}

/** O endereço completo, pronto para copiar. */
export function enderecoDe(v: Vista, base = ""): string {
  return `${base}#${paraHash(v)}`;
}
