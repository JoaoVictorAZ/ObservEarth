// src/store/cursorStore.ts
// -----------------------------------------------------------------------------
// O QUE ESTÁ SOB O PONTEIRO
// -----------------------------------------------------------------------------
// Um store minúsculo e de propósito. Quem SABE a coordenada é o motor (globo ou
// mapa); quem sabe AMOSTRAR é o viewport, que tem as grades carregadas; e quem
// precisa do resultado é a régua, que fica noutro canto da árvore. Passar isso
// por props atravessaria cinco componentes que não têm nada a ver com o assunto.
//
// POR QUE ELE É SEPARADO DO `fontesStore`
//
// Este estado muda a cada quadro de ponteiro — dezenas de vezes por segundo. O
// `fontesStore` muda a cada minutos. Juntar os dois faria toda a barra de
// estado, e todo componente inscrito nela, re-renderizar ao mover o mouse.
// -----------------------------------------------------------------------------

import { create } from "zustand";

export interface Cursor {
  coord: { lat: number; lng: number } | null;
  /** o valor da camada ativa naquele ponto; `null` é ausência, não zero */
  valor: number | null;
  /** a camada ativa permite leitura contínua? */
  amostravel: boolean;
}

interface CursorState extends Cursor {
  definir: (c: Cursor) => void;
  limpar: () => void;
}

const VAZIO: Cursor = { coord: null, valor: null, amostravel: false };

export const useCursorStore = create<CursorState>((set) => ({
  ...VAZIO,
  definir: (c) => set(c),
  limpar: () => set(VAZIO),
}));
