// src/store/chatStore.ts
// -----------------------------------------------------------------------------
// ESTADO DO TERMINAL — fora do componente, de propósito.
//
// O DEFEITO QUE ISTO CORRIGE
// O estado do modelo vivia em `useState` dentro do PointChat. Fechar o terminal
// desmonta o componente, o React descarta o estado, e ao reabrir a tela voltava
// para "carregue um modelo" — pedindo um download de 4,6 GB que já estava
// feito.
//
// O modelo nunca havia sido descarregado: o motor é um singleton e continuava
// com os pesos na VRAM. Era só a INTERFACE que esquecia. Um pedido de
// reinstalação para algo já instalado é o tipo de erro que destrói a confiança
// do usuário em tudo o mais que a tela afirma.
//
// Estado que sobrevive ao ciclo de vida do componente não pode morar dentro
// dele. Aqui também ficam a largura do painel e o histórico, pelo mesmo motivo:
// fechar para consultar o mapa e reabrir não deve custar a conversa.
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
