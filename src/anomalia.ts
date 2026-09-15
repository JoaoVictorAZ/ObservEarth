// src/anomalia.ts
// -----------------------------------------------------------------------------
// O NÚMERO CONTRA A HISTÓRIA DO LUGAR
// -----------------------------------------------------------------------------
// "27 °C" não informa nada. Vinte e sete graus é frio em Cuiabá em outubro e é
// recorde em Ushuaia em qualquer mês. O número só vira afirmação quando existe
// uma referência do que é normal ALI, NAQUELA ÉPOCA — e é isso que faltava na
// sonda: dez linhas de valor absoluto, todas com o mesmo peso, nenhuma dizendo
// se aquilo é notável.
//
// A referência é a normal climatológica de 1991–2020, que é o período padrão da
// OMM, calculada por ponto e por dia do ano.
//
// POR QUE PERCENTIL E NÃO DESVIO-PADRÃO
//
// A tentação é dizer "está a 2 desvios da média". Isso pressupõe distribuição
// simétrica, e boa parte das variáveis meteorológicas não é. Precipitação é o
// caso extremo: em muitos lugares a MEDIANA da chuva diária é zero, a média é
// puxada por poucos dias intensos, e "2 desvios acima" pode ser um dia de
// chuvinha. Um desvio-padrão ali descreve uma distribuição que não existe.
//
// Percentil não pressupõe forma nenhuma. Funciona igual para temperatura e para
// chuva, e é o que os serviços meteorológicos usam para dizer "acima do normal".
// O desvio em unidade absoluta continua sendo mostrado — mas só onde ele
// significa alguma coisa.
// -----------------------------------------------------------------------------

/** Quantis em passos de 5%: 21 valores, de p0 a p100. */
export interface Normal {
  /** q[i] é o quantil de i·5% — q[0] = mínimo, q[10] = mediana, q[20] = máximo */
  q: (number | null)[];
  media: number | null;
  /** quantos anos entraram no cálculo; abaixo de 20 a normal é fraca */
  anos: number;
  unidade: string;
}

/**
 * Como a variável se comporta, e por isso o que faz sentido dizer dela.
 *
 * `simetrica`  temperatura, orvalho, pressão — o desvio em unidade é legível
 * `assimetrica` chuva, vento, rajada — só percentil; média engana
 */
export type Feitio = "simetrica" | "assimetrica";

export type Faixa =
  | "muito abaixo" | "abaixo" | "normal" | "acima" | "muito acima" | "sem referência";

export interface Leitura {
  faixa: Faixa;
  /** 0 a 100; null quando não há normal utilizável */
  percentil: number | null;
  /** diferença para a média, só para variáveis simétricas */
  desvio: number | null;
  /** frase curta, pronta para a tela */
  texto: string;
}

const VAZIA: Leitura = { faixa: "sem referência", percentil: null, desvio: null, texto: "sem referência histórica" };

/** Normal utilizável? Menos de 20 anos não sustenta um percentil. */
export function normalUtil(n: Normal | null | undefined): n is Normal {
  if (!n || !Array.isArray(n.q) || n.q.length !== 21) return false;
  if (n.anos < 20) return false;
  return n.q.filter((v) => v != null && Number.isFinite(v)).length >= 15;
}

/**
 * Percentil de um valor dentro dos quantis, por interpolação linear.
 *
 * Os quantis chegam em passos de 5%, então entre dois deles a posição é
 * estimada. É aproximação, e é suficiente: a diferença entre percentil 87 e 89
 * não muda nenhuma decisão, e transportar as 450 amostras brutas por variável
 * custaria mais do que vale.
 */
export function percentilDe(valor: number, n: Normal): number | null {
  if (!Number.isFinite(valor)) return null;
  const q = n.q;

  // Fora das pontas: o valor bateu ou passou o extremo observado em 30 anos.
  const primeiro = q.findIndex((v) => v != null && Number.isFinite(v));
  if (primeiro < 0) return null;
  const ultimo = 20 - [...q].reverse().findIndex((v) => v != null && Number.isFinite(v));

  if (valor <= (q[primeiro] as number)) return primeiro * 5;
  if (valor >= (q[ultimo] as number)) return ultimo * 5;

  for (let i = primeiro; i < ultimo; i++) {
    const a = q[i], b = q[i + 1];
    if (a == null || b == null) continue;
    if (valor >= a && valor <= b) {
      const largura = b - a;
      // Quantis iguais (platô, típico de chuva com muitos zeros): sem
      // interpolação possível, fica na borda de baixo.
      const f = largura <= 0 ? 0 : (valor - a) / largura;
      return (i + f) * 5;
    }
  }
  return null;
}

function faixaDe(p: number): Faixa {
  if (p < 10) return "muito abaixo";
  if (p < 33) return "abaixo";
  if (p <= 66) return "normal";
  if (p <= 90) return "acima";
  return "muito acima";
}

const sinal = (x: number, casas: number) =>
  `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(casas)}`;

/**
 * A leitura completa de um valor contra a sua normal.
 *
 * `casas` controla só a formatação do desvio; o percentil é sempre inteiro.
 */
export function lerAnomalia(
  valor: number | null | undefined,
  normal: Normal | null | undefined,
  feitio: Feitio = "simetrica",
  casas = 1,
): Leitura {
  if (valor == null || !Number.isFinite(valor)) return VAZIA;
  if (!normalUtil(normal)) return VAZIA;

  const p = percentilDe(valor, normal);
  if (p == null) return VAZIA;

  const faixa = faixaDe(p);
  const mediana = normal.q[10];

  // O DESVIO SÓ APARECE ONDE SIGNIFICA.
  //
  // Para temperatura, "+3,4 °C acima da média" é a informação mais útil da
  // frase. Para chuva, a mesma construção produziria "+12 mm acima da média"
  // num lugar onde a média é puxada por três temporais ao ano e a mediana é
  // zero — tecnicamente verdade, e enganoso.
  const desvio = feitio === "simetrica" && normal.media != null && Number.isFinite(normal.media)
    ? valor - normal.media
    : null;

  const pos = `percentil ${Math.round(p)}`;
  let texto: string;

  if (faixa === "normal") {
    texto = desvio != null && Math.abs(desvio) >= 0.05
      ? `dentro do normal (${sinal(desvio, casas)} ${normal.unidade}, ${pos})`
      : `dentro do normal para esta data (${pos})`;
  } else if (desvio != null) {
    texto = `${faixa} do normal · ${sinal(desvio, casas)} ${normal.unidade} · ${pos}`;
  } else {
    // Sem desvio, a mediana dá a âncora: "acima do normal, mediana 0,2 mm/h".
    const ref = mediana != null && Number.isFinite(mediana)
      ? ` · mediana histórica ${(mediana as number).toFixed(casas)} ${normal.unidade}`
      : "";
    texto = `${faixa} do normal · ${pos}${ref}`;
  }

  return { faixa, percentil: p, desvio, texto };
}

/**
 * Posição na faixa histórica, 0 a 1, para desenhar o marcador.
 *
 * É o percentil dividido por 100 — e essa é justamente a mudança de fundo. A
 * barra da sonda mostrava a posição numa escala ABSOLUTA fixa (temperatura de
 * −40 a 50), igual no Saara e na Groenlândia. Agora ela mostra a posição na
 * história DAQUELE ponto, que é a pergunta que alguém realmente faz ao olhar.
 */
export function posicaoHistorica(l: Leitura): number | null {
  return l.percentil == null ? null : Math.max(0, Math.min(1, l.percentil / 100));
}

/**
 * A régua da barra, em UNIDADE e não em percentil.
 *
 * Podia-se desenhar a barra em espaço de percentil: o marcador em p/100 e a
 * banda p10–p90 sempre ocupando de 10% a 90% da largura. Ficaria idêntica para
 * temperatura e para chuva, em qualquer lugar do planeta, e não diria nada —
 * uma banda que nunca muda não é informação.
 *
 * Em espaço de VALOR a barra mostra a forma da distribuição: a banda estreita
 * de um lugar de clima constante, a banda larga de um lugar de estação seca e
 * estação de chuva, e a assimetria da precipitação — mediana colada na
 * esquerda e cauda longa até a direita. A distância entre o marcador e a banda
 * passa a ser lida em graus e em milímetros, que é como a pessoa pensa.
 */
export interface Regua { min: number; p10: number; p50: number; p90: number; max: number; }

export function reguaDe(n: Normal | null | undefined): Regua | null {
  if (!normalUtil(n)) return null;
  const v = (i: number) => n.q[i];
  const [min, p10, p50, p90, max] = [v(0), v(2), v(10), v(18), v(20)];
  if ([min, p10, p50, p90, max].some((x) => x == null || !Number.isFinite(x))) return null;
  // Distribuição degenerada (todos os 30 anos com o mesmo valor): não há régua
  // possível e desenhar uma seria inventar largura.
  if ((max as number) <= (min as number)) return null;
  return { min: min as number, p10: p10 as number, p50: p50 as number, p90: p90 as number, max: max as number };
}

/** Onde um valor cai na régua, 0 a 1. Fora do observado, gruda na ponta. */
export function posicaoNaRegua(valor: number | null | undefined, r: Regua | null): number | null {
  if (r == null || valor == null || !Number.isFinite(valor)) return null;
  return Math.max(0, Math.min(1, (valor - r.min) / (r.max - r.min)));
}

/** Cor da faixa, em variável CSS — o azul é frio/baixo, o âmbar é alto. */
export function corDaFaixa(f: Faixa): string | null {
  switch (f) {
    case "muito abaixo": return "var(--anom-baixo-forte)";
    case "abaixo": return "var(--anom-baixo)";
    case "normal": return "var(--anom-normal)";
    case "acima": return "var(--anom-alto)";
    case "muito acima": return "var(--anom-alto-forte)";
    default: return null;
  }
}
