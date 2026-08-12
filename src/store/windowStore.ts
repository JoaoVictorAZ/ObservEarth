/**
 * @file src/store/windowStore.ts
 * @description Estado global de gerenciamento de janelas flutuantes (foco z-index, minimização e organização de layout).
 */

import { create } from "zustand";

interface WindowState {
  activeWindow: string | null;
  minimizedWindows: Record<string, boolean>;
  focusWindow: (id: string) => void;
  toggleMinimize: (id: string) => void;
  resetMinimize: (id: string) => void;
}

export const useWindowStore = create<WindowState>((set) => ({
  activeWindow: "probe",
  minimizedWindows: {},
  focusWindow: (id: string) => set({ activeWindow: id }),
  toggleMinimize: (id: string) =>
    set((s) => ({
      minimizedWindows: {
        ...s.minimizedWindows,
        [id]: !s.minimizedWindows[id],
      },
    })),
  resetMinimize: (id: string) =>
    set((s) => ({
      minimizedWindows: {
        ...s.minimizedWindows,
        [id]: false,
      },
    })),
}));
