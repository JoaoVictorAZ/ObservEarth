// src/globo/entrada.ts
// -----------------------------------------------------------------------------
// A PRIMEIRA VISTA
// -----------------------------------------------------------------------------
// A câmera nascia parada na altitude de trabalho: o planeta já enquadrado, já
// no lugar, sem nada acontecendo. Funciona, e desperdiça o único instante em
// que a pessoa está olhando para a tela inteira em vez de para um controle.
//
// A aproximação existe para uma coisa: o primeiro quadro mostra a Terra INTEIRA
// contra as estrelas, com o terminador atravessando o disco, e só depois ela se
// aproxima até a distância em que se trabalha. É o enquadramento que diz o que
// este programa é, antes de qualquer texto de interface.
//
// TRÊS REGRAS, E NENHUMA É NEGOCIÁVEL
//
// 1. INTERROMPÍVEL. Qualquer toque, clique, tecla ou rolagem cancela a
//    aproximação NA POSIÇÃO EM QUE ELA ESTÁ. Uma animação que ignora a pessoa
//    por dois segundos é uma tela travada, e ela vai clicar de novo achando
//    que não funcionou.
// 2. `prefers-reduced-motion` DESLIGA. Não é preferência estética: movimento de
//    câmera desencadeia enjoo vestibular em quem tem sensibilidade, e um voo
//    de aproximação é o caso clássico.
// 3. UMA VEZ POR SESSÃO. A animação é abertura, não transição. Repeti-la a cada
//    troca de aba transforma o efeito em pedágio.
//
// A curva é `easeOutCubic`: começa rápida e freia no fim. A oposta —
// acelerando até o corte — dá a sensação de colisão, porque no mundo físico o
// que se aproxima e para desacelera.
// -----------------------------------------------------------------------------

export interface Quadro {
  lat: number;
  lng: number;
  altitude: number;
}

/** Onde a câmera nasce e onde ela para. */
export const PARTIDA: Quadro = { lat: -8, lng: -48, altitude: 3.4 };
export const CHEGADA: Quadro = { lat: -15, lng: -48, altitude: 1.7 };
export const DURACAO_MS = 2600;

/**
 * Freia no fim, não no começo.
 *
 * A curva simétrica (`easeInOut`) faz a câmera sair devagar, e o primeiro meio
 * segundo — que é quando a pessoa decide se aquilo está travado — não mostra
 * movimento nenhum.
 */
export function suavizar(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

/**
 * O quadro em um instante da animação.
 *
 * A ALTITUDE INTERPOLA EM ESCALA LOGARÍTMICA. Em escala linear, a mesma fração
 * de tempo cobre a mesma fração de distância — e como o tamanho aparente do
 * planeta é inversamente proporcional à distância, o disco cresce devagar no
 * começo e explode no fim. Em logaritmo, cada intervalo de tempo multiplica a
 * distância por um fator constante, e o crescimento aparente fica uniforme. É
 * a mesma razão pela qual zoom de mapa é potência de dois e não soma.
 */
export function quadroEm(
  t: number,
  de: Quadro = PARTIDA,
  ate: Quadro = CHEGADA,
): Quadro {
  const k = suavizar(t);
  return {
    lat: de.lat + (ate.lat - de.lat) * k,
    lng: de.lng + (ate.lng - de.lng) * k,
    altitude: Math.exp(Math.log(de.altitude) + (Math.log(ate.altitude) - Math.log(de.altitude)) * k),
  };
}

/**
 * A entrada deve acontecer?
 *
 * `reduzido` vem de `prefers-reduced-motion`. `jaViu` vem de quem controla a
 * sessão. Os dois são recusas, e recusa não se discute — por isso nenhuma
 * outra condição pode reabilitá-la.
 */
export function deveAnimar(op: { reduzido: boolean; jaViu: boolean }): boolean {
  return !op.reduzido && !op.jaViu;
}

export interface Voo {
  /** avança o relógio e devolve o quadro; `null` quando acabou ou foi cancelado */
  passo(agoraMs: number): Quadro | null;
  cancelar(): void;
  readonly ativo: boolean;
  /** 0 a 1 — usado para o fade de entrada das partículas */
  readonly progresso: number;
}

/**
 * O voo de abertura.
 *
 * Recebe o relógio de fora, em vez de chamar `performance.now()` por dentro:
 * assim ele é testável quadro a quadro, sem esperar 2,6 segundos reais e sem
 * depender de a máquina do teste ser rápida.
 */
export function criarVoo(inicioMs: number, duracao = DURACAO_MS, de = PARTIDA, ate = CHEGADA): Voo {
  let cancelado = false;
  let progresso = 0;

  return {
    get ativo() { return !cancelado && progresso < 1; },
    get progresso() { return progresso; },
    cancelar() { cancelado = true; },
    passo(agoraMs: number) {
      if (cancelado) return null;
      // Duração zero ou negativa não é erro de chamada, é uma máquina cujo
      // relógio não avançou: entregar o destino é a resposta certa, e dividir
      // por zero não é.
      progresso = duracao > 0 ? Math.max(0, Math.min(1, (agoraMs - inicioMs) / duracao)) : 1;
      const q = quadroEm(progresso, de, ate);
      if (progresso >= 1) return q;
      return q;
    },
  };
}

/**
 * A opacidade das partículas de vento durante a entrada.
 *
 * Elas ficam apagadas na primeira metade e entram na segunda. Aparecer junto
 * com a câmera lá em cima seria mostrar uma malha de linhas sobre um planeta
 * pequeno demais para elas fazerem sentido — o vento só é legível quando o
 * disco já ocupa a tela.
 */
export function fadeDoVento(progresso: number): number {
  return suavizar(Math.max(0, (progresso - 0.45) / 0.55));
}
