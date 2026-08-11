// src/store/uiStore.ts
import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  dockExpanded: boolean;
  activeDockTab: "layers" | "search" | "bookmarks" | "settings";
  analysisTarget: { lat: number; lng: number; place: string } | null;
  sidebarOpen: boolean;

  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setDockExpanded: (expanded: boolean) => void;
  toggleDockExpanded: () => void;
  setActiveDockTab: (tab: "layers" | "search" | "bookmarks" | "settings") => void;
  setAnalysisTarget: (target: { lat: number; lng: number; place: string } | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  dockExpanded: false,
  activeDockTab: "layers",
  analysisTarget: null,
  sidebarOpen: true,

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setDockExpanded: (dockExpanded) => set({ dockExpanded }),
  toggleDockExpanded: () => set((s) => ({ dockExpanded: !s.dockExpanded })),
  setActiveDockTab: (activeDockTab) => set({ activeDockTab }),
  setAnalysisTarget: (analysisTarget) => set({ analysisTarget }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
