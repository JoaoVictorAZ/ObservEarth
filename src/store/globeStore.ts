// src/store/globeStore.ts
import { create } from "zustand";

/** lê a preferência salva sem quebrar se o navegador bloquear o armazenamento */
function densidadeSalva(): number {
  try {
    const v = Number(localStorage.getItem("obs:densidadeVento"));
    return Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : 1;
  } catch { return 1; }
}

export type Modo = "globo" | "mapa";

/** o modo escolhido sobrevive ao recarregamento: é preferência, não estado efêmero */
function modoSalvo(): Modo {
  try { return localStorage.getItem("obs:modo") === "mapa" ? "mapa" : "globo"; }
  catch { return "globo"; }
}

interface GlobeState {
  modo: Modo;
  setModo: (m: Modo) => void;
  toggleModo: () => void;
  dayNight: boolean;
  rotate: boolean;
  /** fração de partículas do vento, 0,1 a 1 */
  windDensity: number;
  setWindDensity: (v: number) => void;
  setDayNight: (on: boolean) => void;
  setRotate: (on: boolean) => void;
  toggleDayNight: () => void;
  toggleRotate: () => void;
}

function guardarModo(modo: Modo) {
  try { localStorage.setItem("obs:modo", modo); } catch { /* sem persistência, segue */ }
}

export const useGlobeStore = create<GlobeState>((set) => ({
  modo: modoSalvo(),
  setModo: (modo) => { guardarModo(modo); set({ modo }); },
  toggleModo: () => set((s) => {
    const modo: Modo = s.modo === "globo" ? "mapa" : "globo";
    guardarModo(modo);
    return { modo };
  }),
  dayNight: true,
  rotate: false,
  windDensity: densidadeSalva(),
  setWindDensity: (windDensity) => {
    set({ windDensity });
    try { localStorage.setItem("obs:densidadeVento", String(windDensity)); } catch { /* sem persistência, segue */ }
  },
  setDayNight: (dayNight) => set({ dayNight }),
  setRotate: (rotate) => set({ rotate }),
  toggleDayNight: () => set((s) => ({ dayNight: !s.dayNight })),
  toggleRotate: () => set((s) => ({ rotate: !s.rotate })),
}));
