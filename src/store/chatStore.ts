// src/store/chatStore.ts
// -----------------------------------------------------------------------------
// Estado global do terminal de conversação LLM (Zustand store).
// -----------------------------------------------------------------------------

import { create } from "zustand";
import type { ModeloLLM } from "../llm/engine";

export interface MsgChat { autor: "voce" | "modelo" | "sistema"; texto: string }

/** limites de largura do painel, em px */
export const LARGURA_MIN = 380;
export const LARGURA_MAX = 1100;
export const LARGURA_PADRAO = 560;

interface ChatState {
  aberto: boolean;
  largura: number;
  /** modelo efetivamente carregado na VRAM — espelha o singleton do motor */
  modeloCarregado: ModeloLLM | null;
  /** modelo escolhido no seletor, ainda não necessariamente carregado */
  modeloEscolhido: ModeloLLM | null;
  msgs: MsgChat[];
  /** ponto a que a conversa se refere, para detectar troca de ponto */
  pontoChave: string | null;

  abrir: () => void;
  fechar: () => void;
  setLargura: (px: number) => void;
  setModeloCarregado: (m: ModeloLLM | null) => void;
  setModeloEscolhido: (m: ModeloLLM | null) => void;
  addMsg: (m: MsgChat) => void;
  patchUltima: (texto: string) => void;
  /**
   * Troca de ponto limpa a conversa, mas NÃO o modelo.
   * Manter respostas sobre o Pacífico visíveis depois de clicar na Amazônia
   * convidaria a lê-las como se fossem do novo ponto.
   */
  trocarPonto: (chave: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  aberto: false,
  largura: LARGURA_PADRAO,
  modeloCarregado: null,
  modeloEscolhido: null,
  msgs: [],
  pontoChave: null,

  abrir: () => set({ aberto: true }),
  fechar: () => set({ aberto: false }),
  setLargura: (px) =>
    set({ largura: Math.max(LARGURA_MIN, Math.min(LARGURA_MAX, Math.round(px))) }),
  setModeloCarregado: (modeloCarregado) => set({ modeloCarregado }),
  setModeloEscolhido: (modeloEscolhido) => set({ modeloEscolhido }),
  addMsg: (m) => set({ msgs: [...get().msgs, m] }),
  patchUltima: (texto) =>
    set(() => {
      const c = [...get().msgs];
      if (!c.length) return {};
      c[c.length - 1] = { ...c[c.length - 1], texto };
      return { msgs: c };
    }),
  trocarPonto: (chave) => {
    if (get().pontoChave === chave) return;
    set({ pontoChave: chave, msgs: [] });
  },
}));
