// src/store/fontesStore.ts
// -----------------------------------------------------------------------------
// O REGISTRO DE TODAS AS FONTES EXTERNAS, NUM LUGAR SÓ
// -----------------------------------------------------------------------------
// Substitui os sete campos soltos que existiam no `layerStore` — `windInfo`,
// `isoInfo`, `fireInfo`, `openaqInfo`, `hospitalInfo`, `hycomInfo`, `geoInfo` —
// cada um uma `string | null` sem estrutura, preenchido por um lugar diferente
// e incapaz de distinguir "buscando" de "falhou" de "está velho".
//
// Aqui cada fonte é um objeto com estado, motivo, idade e backoff (ver
// `src/dados/estado.ts`), e a barra inferior consegue dizer a verdade sobre o
// conjunto em vez de exibir "SISTEMA OPERACIONAL" cravado no código.
// -----------------------------------------------------------------------------

import { create } from "zustand";
import {
  criarFonte, marcarBuscando, marcarSucesso, marcarFalha, resumir,
  type Fonte, type Resumo,
} from "../dados/estado.ts";

interface FontesState {
  fontes: Record<string, Fonte>;
  registrar: (id: string, rotulo: string, validadeMs: number) => void;
  buscando: (id: string) => void;
  sucesso: (id: string, agora?: number) => void;
  falha: (id: string, erro: unknown, agora?: number) => void;
  /** a fonte saiu de cena (camada desligada): volta a ociosa */
  soltar: (id: string) => void;
  resumo: (agora?: number) => Resumo;
}

export const useFontesStore = create<FontesState>((set, get) => ({
  fontes: {},

  registrar: (id, rotulo, validadeMs) =>
    set((s) =>
      // Registrar duas vezes NÃO pode zerar o estado: dois componentes podem
      // observar a mesma fonte, e o segundo apagaria o dado do primeiro.
      s.fontes[id] ? s : { fontes: { ...s.fontes, [id]: criarFonte(id, rotulo, validadeMs) } },
    ),

  buscando: (id) =>
    set((s) => (s.fontes[id] ? { fontes: { ...s.fontes, [id]: marcarBuscando(s.fontes[id]) } } : s)),

  sucesso: (id, agora = Date.now()) =>
    set((s) => (s.fontes[id] ? { fontes: { ...s.fontes, [id]: marcarSucesso(s.fontes[id], agora) } } : s)),

  falha: (id, erro, agora = Date.now()) =>
    set((s) => (s.fontes[id] ? { fontes: { ...s.fontes, [id]: marcarFalha(s.fontes[id], erro, agora) } } : s)),

  soltar: (id) =>
    set((s) => {
      const f = s.fontes[id];
      if (!f) return s;
      // Volta a "ocioso" preservando `atualizadoEm`: se a camada for religada,
      // o app sabe quão velho é o que ele ainda tem em mãos.
      return { fontes: { ...s.fontes, [id]: { ...f, situacao: "ocioso", motivo: null } } };
    }),

  resumo: (agora = Date.now()) => resumir(Object.values(get().fontes), agora),
}));
