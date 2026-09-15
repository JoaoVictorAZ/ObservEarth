// src/globo/vento.ts
// -----------------------------------------------------------------------------
// O PESO DE CADA PARTÍCULA, E O COMPRIMENTO DO RASTRO
// -----------------------------------------------------------------------------
// O campo de vento desenhava todas as partículas com o mesmo peso. Uma brisa de
// 2 m/s sobre a Amazônia recebia a mesma opacidade que a corrente de jato a
// 60 m/s, e a diferença ficava só na cor. O resultado é um tapete uniforme onde
// as estruturas que importam — jato, ciclone, convergência — não se destacam do
// fundo, porque tudo tem o mesmo brilho.
//
// A opacidade por velocidade resolve isso sem inventar nada: velocidade é dado
// medido, e usá-la para decidir quanto uma partícula pesa na imagem é a mesma
// escolha que usar cor. O vento fraco continua desenhado, só que discreto; o
// forte fica evidente à distância.
//
// POR QUE NÃO BLENDING ADITIVO
//
// Seria o caminho óbvio para "mais vivo", e é o errado aqui. Aditivo soma a
// cor da partícula ao que já está no quadro: sobre o lado NOTURNO do planeta,
// que é quase preto, os rastros ganham brilho; sobre o lado DIURNO da textura
// Blue Marble, que tem nuvens e deserto perto do branco, a soma satura e o
// rastro DESAPARECE justo onde o fundo é mais claro. Trocaríamos legibilidade
// em metade do planeta por brilho na outra metade.
// -----------------------------------------------------------------------------

/**
 * Quanto uma partícula pesa na imagem, de 0 a 1, pela velocidade normalizada.
 *
 * O piso de 0,35 é deliberado: zero apagaria as regiões calmas, e uma região
 * calma é uma informação — a zona de convergência intertropical, o olho de um
 * ciclone e a sombra de vento de uma cordilheira são todos ausência de vento, e
 * some se o desenho decidir que vento fraco não merece pixel.
 */
export const PESO_MINIMO = 0.35;

const suave = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function pesoPorVelocidade(vNormalizada: number): number {
  return PESO_MINIMO + (1 - PESO_MINIMO) * suave(0.05, 0.55, vNormalizada);
}

/**
 * Quantos quadros um rastro sobrevive, dado o fator de decaimento por quadro.
 *
 * O rastro é uma textura que é multiplicada por `fade` a cada quadro. Depois de
 * n quadros, o que restou é fade^n. Tomando 1% como o limite do que ainda se vê
 * sobre o fundo, o comprimento é log(0,01) / log(fade).
 *
 * A conta importa porque a intuição erra feio nessa faixa: 0,985 dá ~305
 * quadros e 0,992 dá ~573 — quase o dobro, para uma diferença de sete
 * milésimos que ninguém adivinha olhando o número.
 */
export const LIMIAR_VISIVEL = 0.01;

export function quadrosDeRastro(fade: number, limiar = LIMIAR_VISIVEL): number {
  if (!(fade > 0) || fade >= 1) return Infinity;
  return Math.log(limiar) / Math.log(fade);
}

/** Decaimento que produz um rastro do comprimento pedido, em quadros. */
export function fadeParaQuadros(quadros: number, limiar = LIMIAR_VISIVEL): number {
  if (!(quadros > 0)) return 0;
  return Math.pow(limiar, 1 / quadros);
}
