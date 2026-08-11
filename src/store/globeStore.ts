// src/store/globeStore.ts
import { create } from "zustand";

interface GlobeState {
  dayNight: boolean;
  rotate: boolean;
  setDayNight: (on: boolean) => void;
  setRotate: (on: boolean) => void;
  toggleDayNight: () => void;
  toggleRotate: () => void;
}

export const useGlobeStore = create<GlobeState>((set) => ({
  dayNight: true,
  rotate: false,
  setDayNight: (dayNight) => set({ dayNight }),
  setRotate: (rotate) => set({ rotate }),
  toggleDayNight: () => set((s) => ({ dayNight: !s.dayNight })),
  toggleRotate: () => set((s) => ({ rotate: !s.rotate })),
}));
