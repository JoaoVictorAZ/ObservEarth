// src/store/perfStore.ts
// -----------------------------------------------------------------------------
// ESTADO REAL DO MOTOR — para que o painel de diagnóstico pare de mentir.
//
// O painel de configurações do cabeçalho exibia isto, cravado em texto:
//
//     Resolução Pixel Ratio:      2x (Retina)
//     Partículas GPU:             131,072 vetores
//     Suavização Anisotrópica:    8x Max
//
// Nenhum dos três vinha do motor. O pixel ratio muda com o degrau de qualidade
// (2,0 / 1,5 / 1,0), a contagem de partículas é 160.000 / 90.000 / 40.000, e
// "suavização anisotrópica 8x" não é configurada em lugar nenhum do código.
//
// Um painel de diagnóstico é o ÚNICO lugar da interface onde o número não pode
// ser decorativo: ele existe para responder "por que está lento?". Números
// fixos ali não são imprecisão — são a resposta errada para a única pergunta
// que o painel serve para responder.
// -----------------------------------------------------------------------------

import { create } from "zustand";
import type { FrameStats } from "../perf";

interface PerfState {
  stats: FrameStats | null;
  setStats: (s: FrameStats) => void;
}

export const usePerfStore = create<PerfState>((set) => ({
  stats: null,
  setStats: (stats) => set({ stats }),
}));
