// src/store/globeStore.ts
import { create } from "zustand";

/** lê a preferência salva sem quebrar se o navegador bloquear o armazenamento */
function densidadeSalva(): number {
  try {
    const v = Number(localStorage.getItem("obs:densidadeVento"));
    return Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : 1;
  } catch { return 1; }
}

interface GlobeState {
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

export const useGlobeStore = create<GlobeState>((set) => ({
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
