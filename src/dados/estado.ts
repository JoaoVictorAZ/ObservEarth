// src/dados/estado.ts
// -----------------------------------------------------------------------------
// O ESTADO DE CADA FONTE EXTERNA
// -----------------------------------------------------------------------------
// O app depende de uma dúzia de servidores que não são nossos: NOAA, INMET,
// USGS, NASA, OpenAQ. Eles caem, mudam endereço, ficam lentos e devolvem 500.
// Isso não é exceção — é o funcionamento normal de um agregador.
//
// O QUE HAVIA ANTES
//
// Um campo `string | null` por camada no `layerStore`: `windInfo`, `isoInfo`,
// `fireInfo`, `openaqInfo`, `hospitalInfo`, `hycomInfo`, `geoInfo`. Sete
// variáveis com sete setters, cada uma preenchida por um lugar diferente, e
// nenhuma delas capaz de distinguir as três situações que importam:
//
//   1. está buscando          → a tela deve dizer que está buscando
//   2. falhou e não há dado   → a tela não desenha nada e diz por quê
//   3. falhou e há dado VELHO → a tela desenha, e tem que dizer que é velho
//
// A terceira é a perigosa, e é a que uma string solta não expressa. Um mapa de
// vento de seis horas atrás desenhado como se fosse agora não parece defeito
// nenhum: parece um mapa de vento. O usuário toma a decisão dele com dado
// vencido e nada na tela o avisou.
//
// DEGRADADO É UM ESTADO DE PRIMEIRA CLASSE
//
// Por isso `degradado` existe aqui ao lado de `pronto` e `indisponivel`. É a
// mesma regra que o resto do projeto já segue com valores — ausência é `null`
// e nunca zero — aplicada ao tempo: dado velho é velho e nunca "atual".
//
// PURO DE PROPÓSITO: nada aqui toca rede, relógio global, DOM ou React. O
// instante entra por parâmetro, o que torna backoff e envelhecimento
// testáveis sem esperar minutos reais.
// -----------------------------------------------------------------------------

export type Situacao =
  | "ocioso"        // nunca foi pedido
  | "carregando"    // pedido em voo, sem dado anterior
  | "pronto"        // dado fresco
  | "degradado"     // há dado, mas ele é velho ou a última tentativa falhou
  | "indisponivel"; // não há dado, e falhou

export interface Fonte {
  id: string;
  rotulo: string;
  situacao: Situacao;
  /** frase pronta para a tela; nunca um código HTTP cru */
  motivo: string | null;
  /** instante da última resposta boa, em ms epoch */
  atualizadoEm: number | null;
  /** falhas consecutivas desde a última resposta boa */
  falhas: number;
  /** antes deste instante não vale a pena tentar de novo */
  proximaTentativa: number | null;
  /** de quanto em quanto tempo o dado desta fonte envelhece */
  validadeMs: number;
}

/** Espera entre tentativas: dobra a cada falha, com teto. */
export const ESPERA_INICIAL_MS = 15_000;
export const ESPERA_MAXIMA_MS = 10 * 60_000;

export function criarFonte(id: string, rotulo: string, validadeMs: number): Fonte {
  return {
    id, rotulo, validadeMs,
    situacao: "ocioso",
    motivo: null,
    atualizadoEm: null,
    falhas: 0,
    proximaTentativa: null,
  };
}

/**
 * Traduz uma falha para uma frase que alguém consegue ler.
 *
 * "HTTP 503" não diz se vale tentar de novo, se o problema é nosso ou se aquele
 * ponto simplesmente não tem cobertura. Cada faixa de status significa uma
 * coisa diferente para quem está olhando o mapa, e é essa coisa que a tela
 * precisa dizer.
 */
export function explicarFalha(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { name?: string; status?: number; message?: string };

    if (err.name === "AbortError") return "busca cancelada";
    if (err.name === "TimeoutError") return "a fonte não respondeu a tempo";

    const s = err.status;
    if (typeof s === "number") {
      if (s === 404) return "a fonte não tem dado para este pedido";
      if (s === 401 || s === 403) return "a fonte recusou o acesso";
      if (s === 429) return "limite de requisições atingido; a busca volta em instantes";
      if (s >= 500) return "a fonte está fora do ar";
      if (s >= 400) return "o pedido foi recusado pela fonte";
    }

    // Falha de rede do navegador vem como TypeError com mensagem genérica.
    if (err.name === "TypeError") return "sem conexão com a fonte";
    if (err.message) return err.message;
  }
  return "falha desconhecida ao buscar o dado";
}

export function marcarBuscando(f: Fonte): Fonte {
  return {
    ...f,
    // Só vira "carregando" se NÃO houver dado. Havendo, a tela continua
    // mostrando o que tem — trocar um mapa por um spinner a cada atualização
    // faria a camada piscar de minuto em minuto.
    situacao: f.atualizadoEm == null ? "carregando" : f.situacao,
  };
}

export function marcarSucesso(f: Fonte, agora: number): Fonte {
  return {
    ...f,
    situacao: "pronto",
    motivo: null,
    atualizadoEm: agora,
    falhas: 0,
    proximaTentativa: null,
  };
}

export function marcarFalha(f: Fonte, erro: unknown, agora: number): Fonte {
  const falhas = f.falhas + 1;
  const espera = Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** (falhas - 1));
  const motivo = explicarFalha(erro);
  const temDado = f.atualizadoEm != null;

  return {
    ...f,
    // A DISTINÇÃO QUE JUSTIFICA ESTE ARQUIVO. Com dado anterior, a camada
    // continua desenhada e a tela diz que ela está velha. Sem dado anterior,
    // não se desenha nada — meio mapa é pior que nenhum mapa.
    situacao: temDado ? "degradado" : "indisponivel",
    motivo,
    falhas,
    proximaTentativa: agora + espera,
  };
}

/** Idade do dado em ms; `null` quando nunca houve dado. */
export function idade(f: Fonte, agora: number): number | null {
  return f.atualizadoEm == null ? null : Math.max(0, agora - f.atualizadoEm);
}

/**
 * O dado passou da validade?
 *
 * Vencido não é o mesmo que falhado. Uma fonte pode estar respondendo 200 e
 * ainda assim entregando um ciclo antigo — o GFS roda de 6 em 6 horas, e às
 * 05:59 o campo mais novo tem quase 6 horas. É legítimo, e a tela tem que
 * poder dizer.
 */
export function vencido(f: Fonte, agora: number): boolean {
  const i = idade(f, agora);
  return i != null && i > f.validadeMs;
}

/** A situação levando o envelhecimento em conta. */
export function situacaoEfetiva(f: Fonte, agora: number): Situacao {
  if (f.situacao === "pronto" && vencido(f, agora)) return "degradado";
  return f.situacao;
}

export function deveTentar(f: Fonte, agora: number): boolean {
  if (f.situacao === "carregando") return false;
  if (f.proximaTentativa != null && agora < f.proximaTentativa) return false;
  if (f.situacao === "ocioso" || f.situacao === "indisponivel") return true;
  return vencido(f, agora);
}

/** "há 3 min", "há 2 h" — nunca um timestamp cru na tela. */
export function idadeEmTexto(f: Fonte, agora: number): string | null {
  const i = idade(f, agora);
  if (i == null) return null;
  const s = Math.floor(i / 1000);
  if (s < 45) return "agora há pouco";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/**
 * A frase da camada, pronta para a tela.
 *
 * Nunca devolve string vazia: uma linha de procedência em branco é
 * indistinguível de uma linha que não carregou.
 */
export function frase(f: Fonte, agora: number): string {
  const sit = situacaoEfetiva(f, agora);
  const quando = idadeEmTexto(f, agora);

  switch (sit) {
    case "ocioso":
      return "camada desligada";
    case "carregando":
      return "buscando…";
    case "pronto":
      return quando ? `atualizado ${quando}` : "atualizado";
    case "degradado":
      return f.motivo
        ? `dado de ${quando} — ${f.motivo}`
        : `dado de ${quando}, sem atualização nova`;
    case "indisponivel":
      return f.motivo ?? "sem dado";
  }
}

export interface Resumo {
  total: number;
  prontas: number;
  degradadas: number;
  indisponiveis: number;
  carregando: number;
  /** as que a tela precisa avisar, já ordenadas: pior primeiro */
  avisos: { id: string; rotulo: string; situacao: Situacao; frase: string }[];
}

/**
 * O panorama, para o indicador global.
 *
 * Camadas OCIOSAS não entram na conta. Uma camada desligada não é uma falha, e
 * contá-la como tal encheria o painel de alertas sobre coisas que ninguém
 * pediu — que é o jeito mais rápido de treinar alguém a ignorar alertas.
 */
export function resumir(fontes: Fonte[], agora: number): Resumo {
  let prontas = 0, degradadas = 0, indisponiveis = 0, carregando = 0, total = 0;
  const avisos: Resumo["avisos"] = [];

  for (const f of fontes) {
    const sit = situacaoEfetiva(f, agora);
    if (sit === "ocioso") continue;
    total++;
    if (sit === "pronto") prontas++;
    else if (sit === "carregando") carregando++;
    else {
      if (sit === "degradado") degradadas++; else indisponiveis++;
      avisos.push({ id: f.id, rotulo: f.rotulo, situacao: sit, frase: frase(f, agora) });
    }
  }

  // Indisponível antes de degradado: "não tem dado" é pior que "tem dado
  // velho", e a lista tem que abrir pela pior notícia.
  const peso = (s: Situacao) => (s === "indisponivel" ? 0 : 1);
  avisos.sort((a, b) => peso(a.situacao) - peso(b.situacao) || a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  return { total, prontas, degradadas, indisponiveis, carregando, avisos };
}
