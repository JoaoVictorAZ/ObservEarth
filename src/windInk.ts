// src/windInk.ts
// -----------------------------------------------------------------------------
// O MODELO DE TINTA DO RASTRO — a matemática que faz calmaria parecer furacão.
//
// O SINTOMA, DESCRITO POR QUEM OLHOU A TELA:
//   "há trechos que têm vento calmo mas, como ficam esticados, parece que tem
//    um furacão de outro mundo acontecendo ali"
//
// A CAUSA:
// O rastro é um acúmulo. A cada quadro a textura inteira é multiplicada por
// `fade` (0,985) e as partículas pintam por cima com opacidade α.
//
// Uma partícula PARADA pinta o MESMO texel todo quadro. A série geométrica
// converge para α/(1−fade) = 67α — satura em branco quase imediatamente.
// Uma partícula RÁPIDA atravessa dez texels por quadro, deixa α em cada um, e
// cada um já começa a apagar.
//
// Com α constante, o brilho final é INVERSAMENTE proporcional à velocidade.
// E como campo calmo é laminar, o arrasto lento traça um risco reto, longo e
// sólido: exatamente o "furacão" onde não venta quase nada.
//
// A CORREÇÃO é a de uma caneta: para traçar uma linha de densidade constante, a
// tinta tem que sair proporcional à velocidade da mão. Parada, a caneta não
// pode borrar.
//
// Este módulo existe para que isso seja MEDIDO e não argumentado. É a mesma
// aritmética que o shader faz por quadro.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// O QUE A MEDIÇÃO MOSTROU, E QUE EU TINHA ERRADO NA PRIMEIRA TENTATIVA
//
// Meu primeiro conserto foi "tinta proporcional à velocidade, com piso baixo".
// O teste reprovou: a 0,5 m/s a partícula ainda repintava o mesmo texel 176
// vezes e saturava assim mesmo. Então busquei os parâmetros numericamente, e o
// resultado foi mais interessante que o conserto:
//
//     COM TINTA PROPORCIONAL À DISTÂNCIA, O BRILHO DO RASTRO NÃO PODE
//     CODIFICAR VELOCIDADE. Os dois efeitos se cancelam exatamente — a
//     partícula rápida deposita mais tinta por quadro e passa por menos
//     quadros no mesmo texel. Não há escolha de piso e ganho que faça o
//     brilho subir com o vento sem saturar a calmaria.
//
// Isso não é limitação: é a física certa. Numa visualização de escoamento com
// corante, a densidade do traço é uniforme; o que varia é o COMPRIMENTO do
// traço e a COR. Insistir em codificar velocidade no brilho era o que produzia
// o borrão.
//
// Então a divisão de trabalho passa a ser:
//   brilho      -> uniforme (densidade de traço constante)
//   cor         -> velocidade (a rampa, monotônica em luminância)
//   comprimento -> velocidade (a partícula rápida cobre mais chão no mesmo
//                  tempo de decaimento)
//
// O NÚMERO QUE PROVA O DEFEITO ANTERIOR: a 2 m/s e a 25 m/s o rastro tinha
// brilho 1,000 nos dois casos, e levava 259 quadros (4,3 s) para apagar nos
// dois casos. Calmaria e vendaval eram pixel a pixel a MESMA marca.
// -----------------------------------------------------------------------------

/** piso e ganho usados no DRAW_FRAG — mesma fonte, para o teste não transcrever */
export const TINTA_PISO = 0.01;
export const TINTA_GANHO = 0.30;

/** decaimento por quadro do rastro (default de WindGPU.fade) */
export const FADE_PADRAO = 0.975;

/**
 * Opacidade depositada por quadro.
 *
 * Recebe a velocidade normalizada LINEAR, não a perceptual. O shader guarda a
 * perceptual (elevada a 0,6) para a cor e a desfaz aqui com o expoente
 * recíproco: tinta é uma grandeza física — distância percorrida — e não pode
 * herdar a curva que existe só para a leitura da cor.
 */
export function tintaPorQuadro(vLinear: number): number {
  return TINTA_PISO + Math.max(0, Math.min(1, vLinear)) * TINTA_GANHO;
}

/**
 * Brilho de regime de um texel sob uma partícula que o cruza.
 *
 * `texelsPorQuadro` é quantos texels ela anda por quadro; o inverso é quantos
 * quadros ela passa sobre o MESMO texel — as vezes que ele é repintado antes de
 * a partícula sair.
 *
 * Soma da série com decaimento, saturando em 1 (a textura não guarda mais que
 * isso):
 *
 *     B = Σ  α · fade^k ,  k = 0 .. n−1      com n = 1/texelsPorQuadro
 *       = α · (1 − fade^n) / (1 − fade)
 */
export function brilhoDeRegime(vNorm: number, texelsPorQuadro: number, fade: number): number {
  const alfa = tintaPorQuadro(vNorm);
  const n = Math.max(1, 1 / Math.max(1e-6, texelsPorQuadro));
  const soma = fade >= 1 ? alfa * n : (alfa * (1 - Math.pow(fade, n))) / (1 - fade);
  return Math.min(1, soma);
}

/**
 * Quantos texels por quadro uma partícula anda, dada a velocidade em m/s.
 *
 * Espelha a advecção do UPDATE_FRAG: o deslocamento em longitude é
 * `v·uSpeed·dt/(360·cos φ)` em unidades de UV, que multiplicado pela largura da
 * textura dá texels. Aqui, no equador e em latitude alta, para poder mostrar
 * que a compensação de cosseno não quebra o modelo.
 */
export function texelsPorQuadro(
  vMs: number, { uSpeed = 0.12, dt = 1 / 60, larguraTrail = 2048, lat = 0 } = {}
): number {
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.15);
  return (vMs * uSpeed * dt * larguraTrail) / (360 * cos);
}
