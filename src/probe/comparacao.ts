// src/probe/comparacao.ts
// -----------------------------------------------------------------------------
// O DIA CONTRA TRINTA ANOS — o conteúdo do novo bloco da sonda
// -----------------------------------------------------------------------------
// A sonda mostrava dez linhas idênticas de valor absoluto. Temperatura e
// elevação barométrica com o mesmo peso visual, cada uma com uma barrinha que
// marcava a posição numa escala FIXA — a de temperatura ia de −40 a 50, a mesma
// no Saara e na Groenlândia. Nenhuma das dez linhas respondia a pergunta que
// alguém faz ao clicar num ponto: isso é muito?
//
// Este módulo constrói a resposta. Ele é puro: recebe o que a rota devolveu e
// devolve linhas prontas para desenhar, sem tocar em rede, relógio ou DOM — o
// que permite testar a REGRA (o que a tela pode afirmar) sem montar componente.
//
// A ORDEM DAS LINHAS NÃO É ALFABÉTICA NEM A DA API.
//
// É a ordem em que as grandezas respondem "como foi o dia": máxima, mínima,
// chuva, vento. A média diária vem por último porque quase ninguém a sente —
// ela existe aqui porque é a variável canônica de clima, não porque é a mais
// legível.
// -----------------------------------------------------------------------------

import {
  lerAnomalia, reguaDe, posicaoNaRegua, corDaFaixa,
  type Normal, type Feitio, type Leitura, type Regua,
  // Com extensão de propósito: `allowImportingTsExtensions` já está ligado no
  // tsconfig, o Vite resolve, e assim o arquivo pode ser importado direto pelo
  // teste em Node — que não tem resolvedor de extensão nenhum.
} from "../anomalia.ts";

/** O que a rota `/api/climatologia` devolve. */
export interface NormalDaRota extends Normal {
  amostras: number;
  feitio: Feitio;
  rotulo: string;
}
export interface Climatologia {
  referencia: string;
  diaDoAno: number;
  janelaDias: number;
  anos: number;
  fonte: string;
  nota: string;
  normais: Record<string, NormalDaRota>;
  hoje: { data: string; valores: Record<string, number | null>; fonte: string; nota: string } | null;
}

/**
 * Como cada variável aparece na tela.
 *
 * `casas` é decisão de leitura, não de precisão: chuva com uma casa porque
 * 0,4 mm e 0,0 mm são coisas diferentes; vento com uma casa porque a diferença
 * entre 11 e 12 m/s muda a escala Beaufort.
 */
export const LINHAS: { id: string; rotulo: string; casas: number }[] = [
  { id: "temperature_2m_max", rotulo: "Máxima do dia", casas: 1 },
  { id: "temperature_2m_min", rotulo: "Mínima do dia", casas: 1 },
  { id: "precipitation_sum", rotulo: "Chuva do dia", casas: 1 },
  { id: "wind_speed_10m_max", rotulo: "Vento máximo", casas: 1 },
  { id: "temperature_2m_mean", rotulo: "Média do dia", casas: 1 },
];

export interface Comparacao {
  id: string;
  rotulo: string;
  /** o valor de hoje; null quando a previsão diária não cobriu o ponto */
  valor: number | null;
  unidade: string;
  casas: number;
  leitura: Leitura;
  cor: string | null;
  regua: Regua | null;
  /** posição do marcador na régua, 0 a 1 — em unidade, não em percentil */
  pos: number | null;
  /** extremos da banda usual (p10–p90) na mesma régua */
  banda: { de: number; ate: number } | null;
}

function comparar(id: string, rotulo: string, casas: number, c: Climatologia): Comparacao | null {
  const normal = c.normais?.[id];
  if (!normal) return null;

  const valor = c.hoje?.valores?.[id] ?? null;
  const leitura = lerAnomalia(valor, normal, normal.feitio, casas);
  const regua = reguaDe(normal);
  const pos = posicaoNaRegua(valor, regua);

  const banda = regua
    ? {
        de: (regua.p10 - regua.min) / (regua.max - regua.min),
        ate: (regua.p90 - regua.min) / (regua.max - regua.min),
      }
    : null;

  return {
    id, rotulo, valor, casas,
    unidade: normal.unidade,
    leitura,
    cor: corDaFaixa(leitura.faixa),
    regua, pos, banda,
  };
}

/**
 * A linha que merece ser dita em voz alta, se houver alguma.
 *
 * O critério é a distância ao percentil 50 — quanto mais longe da mediana, mais
 * o dia se afasta do que aquele lugar costuma fazer nesta data. Um dia inteiro
 * dentro do normal NÃO produz manchete: forçar destaque num dia comum treina a
 * pessoa a ignorar o destaque, e aí ele não serve para o dia em que importa.
 */
export function manchete(linhas: Comparacao[]): Comparacao | null {
  let melhor: Comparacao | null = null;
  let maior = 0;
  for (const l of linhas) {
    if (l.leitura.percentil == null) continue;
    if (l.leitura.faixa === "normal" || l.leitura.faixa === "sem referência") continue;
    const d = Math.abs(l.leitura.percentil - 50);
    if (d > maior) { maior = d; melhor = l; }
  }
  return melhor;
}

export interface Painel {
  linhas: Comparacao[];
  manchete: Comparacao | null;
  /** quantas linhas têm valor de hoje E normal utilizável */
  comparaveis: number;
  /** procedência, para a tela nunca afirmar sem dizer contra o quê */
  referencia: string;
  anos: number;
  janelaDias: number;
  fonteNormal: string;
  fonteHoje: string | null;
  dataHoje: string | null;
}

export function montarPainel(c: Climatologia | null | undefined): Painel | null {
  if (!c?.normais) return null;

  const linhas = LINHAS
    .map((l) => comparar(l.id, l.rotulo, l.casas, c))
    .filter((x): x is Comparacao => x != null);

  if (!linhas.length) return null;

  return {
    linhas,
    manchete: manchete(linhas),
    comparaveis: linhas.filter((l) => l.leitura.percentil != null).length,
    referencia: c.referencia,
    anos: c.anos,
    janelaDias: c.janelaDias,
    fonteNormal: c.fonte,
    fonteHoje: c.hoje?.fonte ?? null,
    dataHoje: c.hoje?.data ?? null,
  };
}

/**
 * A frase do topo.
 *
 * Sem manchete ela AFIRMA a normalidade em vez de ficar em branco: "dentro do
 * que este lugar costuma fazer" é uma informação, e é a resposta certa na
 * maioria dos dias. Silêncio ali seria lido como falha de carregamento.
 */
export function frasePainel(p: Painel | null): string | null {
  if (!p) return null;
  if (!p.comparaveis) return "Sem agregado de hoje para comparar com a normal.";
  if (!p.manchete) return `Dia dentro da normal de ${p.referencia} para esta data.`;
  const m = p.manchete;
  return `${m.rotulo}: ${m.leitura.faixa} do normal para esta data.`;
}
