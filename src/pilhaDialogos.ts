// src/pilhaDialogos.ts
// -----------------------------------------------------------------------------
// QUEM O `ESC` FECHA.
// -----------------------------------------------------------------------------
// O PROBLEMA QUE ISTO RESOLVE
//
// Três superfícies do aplicativo respondem a `Escape`: o terminal do ponto, o
// modal de análise e a paleta de comandos. Cada uma registrava o próprio
// ouvinte em `document`, na fase de CAPTURA, e chamava `stopPropagation`.
//
// `stopPropagation` não faz o que parece aqui. Ele impede que o evento SUBA
// para outros nós — e não tem efeito nenhum sobre os outros ouvintes
// registrados no MESMO nó. Os três estavam em `document`. Então uma tecla
// `Esc` com o modal aberto por cima do terminal disparava os três: o modal
// fechava, o terminal fechava junto, e a paleta também. Uma tecla, três
// superfícies embora — e a pessoa só queria fechar a de cima.
//
// (`stopImmediatePropagation` resolveria a briga, mas transformaria a ordem de
// REGISTRO na regra de desempate. Quem montou primeiro venceria, o que não tem
// relação nenhuma com quem está por cima na tela.)
//
// A REGRA CERTA É A PILHA. `Esc` fecha a superfície do TOPO — a última que
// abriu — e as de baixo não escutam. É o que todo sistema de janelas faz, e é
// o que a pessoa espera sem precisar aprender.
//
// A pilha mora aqui, fora do React e fora do DOM, porque é uma decisão sobre
// ORDEM e uma ordem se testa sem navegador nenhum.
// -----------------------------------------------------------------------------

export type Ficha = { readonly id: number };

let seq = 0;
let pilha: Ficha[] = [];

/** Entra na pilha e vira o topo. Guarde a ficha para sair depois. */
export function entrar(): Ficha {
  const f: Ficha = { id: ++seq };
  pilha.push(f);
  return f;
}

/**
 * Sai da pilha, de qualquer posição.
 *
 * Não é sempre o topo: fechar o terminal enquanto o modal está aberto tira uma
 * superfície do MEIO. Remover cegamente o último faria o modal herdar a saída
 * do terminal e a pilha passaria a mentir sobre quem está por cima.
 */
export function sair(f: Ficha | null | undefined): void {
  if (!f) return;
  const i = pilha.lastIndexOf(f);
  if (i >= 0) pilha.splice(i, 1);
}

/** Esta ficha é a do topo? Só ela deve reagir a `Esc`. */
export function noTopo(f: Ficha | null | undefined): boolean {
  return !!f && pilha.length > 0 && pilha[pilha.length - 1] === f;
}

/** Quantas superfícies estão abertas. Usado em teste e em diagnóstico. */
export function altura(): number {
  return pilha.length;
}

/** Só para teste: devolve a pilha a zero entre casos. */
export function _limpar(): void {
  pilha = [];
}
