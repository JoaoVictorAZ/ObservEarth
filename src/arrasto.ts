// src/arrasto.ts
// -----------------------------------------------------------------------------
// GEOMETRIA DE ARRASTE DE JANELA — pura, testável, uma só cópia.
// -----------------------------------------------------------------------------
// POR QUE ISTO EXISTE
//
// A mesma geometria estava escrita três vezes (ProbePanel, PointChat, Janela) e
// as três carregavam o mesmo defeito: os modos de redimensionamento são
// combinações das letras d/e/b/c e eram testados com `includes`, mas a palavra
// "mover" CONTÉM UM "e".
//
// Arrastar o cabeçalho entrava no ramo de mover e, logo em seguida, no ramo da
// borda esquerda — que recalcula o x a partir da largura e apagava o
// deslocamento:
//
//   c.x += dx                        ← move
//   c.x = x0 + (w0 - w)              ← e sobrescreve
//
// O resultado visível era a janela ESTICAR para a esquerda com a borda direita
// congelada, em vez de andar. Corrigir em três arquivos independentes deixaria
// o quarto para a próxima vez; por isso a geometria mora aqui.
// -----------------------------------------------------------------------------

export interface Caixa { x: number; y: number; w: number; h: number; }

/** Move a janela inteira, sem tocar no tamanho. */
export const MOVER = "mover";

export interface Limites { minW: number; minH: number; telaW: number; telaH: number; }

/**
 * Mantém a janela ALCANÇÁVEL sem obrigá-la a caber inteira na tela.
 *
 * Prender a caixa toda dentro das margens é o que faz uma janela "grudar" na
 * borda e o que impede uma janela mais larga que a tela de se mexer. O único
 * compromisso real é sobrar um pedaço da barra de título para trazê-la de
 * volta — o resto pode transbordar.
 */
export function travar(c: Caixa, lim: Limites): Caixa {
  const w = Math.max(lim.minW, Math.min(c.w, lim.telaW));
  const h = Math.max(lim.minH, Math.min(c.h, lim.telaH));
  return {
    w, h,
    x: Math.min(lim.telaW - 80, Math.max(80 - w, c.x)),
    y: Math.min(lim.telaH - 40, Math.max(0, c.y)),
  };
}

/**
 * Aplica um arraste a uma caixa.
 *
 * `modo` é `MOVER` ou uma combinação de bordas: "d" direita, "e" esquerda,
 * "b" baixo, "c" cima. Mover e redimensionar são EXCLUSIVOS — ver o cabeçalho
 * deste arquivo.
 */
export function arrastar(modo: string, dx: number, dy: number, inicio: Caixa, lim: Limites): Caixa {
  const c: Caixa = { ...inicio };

  if (modo === MOVER) {
    c.x += dx;
    c.y += dy;
    return travar(c, lim);
  }

  if (modo.includes("d")) c.w = inicio.w + dx;
  if (modo.includes("b")) c.h = inicio.h + dy;

  // Puxar por uma borda "de trás" muda o tamanho E a origem: sem mexer no x, a
  // janela cresceria para o lado errado e a borda puxada ficaria parada.
  if (modo.includes("e")) {
    const w = Math.max(lim.minW, inicio.w - dx);
    c.x = inicio.x + (inicio.w - w);
    c.w = w;
  }
  if (modo.includes("c")) {
    const h = Math.max(lim.minH, inicio.h - dy);
    c.y = inicio.y + (inicio.h - h);
    c.h = h;
  }

  return travar(c, lim);
}
