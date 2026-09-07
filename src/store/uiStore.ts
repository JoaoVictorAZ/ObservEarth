// src/store/uiStore.ts
import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  dockExpanded: boolean;
  activeDockTab: "layers" | "search" | "bookmarks" | "settings";
  analysisTarget: { lat: number; lng: number; place: string } | null;
  sidebarOpen: boolean;

  /**
   * PEDIDO DE FOCO — "leve a câmera até aqui".
   *
   * A referência do motor mora no `AppShell`, e o painel de camadas é irmão
   * dele: não há como passar `flyTo` de um para o outro sem enfiar a
   * referência por três níveis de componente. O pedido vira estado, e o
   * viewport — que é quem tem o motor — atende.
   *
   * O carimbo `em` existe para que clicar DUAS VEZES no mesmo ponto funcione.
   * Sem ele, o segundo clique escreveria o mesmo objeto, o efeito não
   * dispararia, e o botão pareceria quebrado exatamente quando o usuário
   * insiste porque a câmera ainda não chegou.
   */
  foco: { lat: number; lng: number; altitude?: number; em: number } | null;

  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setDockExpanded: (expanded: boolean) => void;
  toggleDockExpanded: () => void;
  setActiveDockTab: (tab: "layers" | "search" | "bookmarks" | "settings") => void;
  setAnalysisTarget: (target: { lat: number; lng: number; place: string } | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  focar: (lat: number, lng: number, altitude?: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  dockExpanded: false,
  activeDockTab: "layers",
  analysisTarget: null,
  sidebarOpen: true,
  foco: null,

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setDockExpanded: (dockExpanded) => set({ dockExpanded }),
  toggleDockExpanded: () => set((s) => ({ dockExpanded: !s.dockExpanded })),
  setActiveDockTab: (activeDockTab) => set({ activeDockTab }),
  setAnalysisTarget: (analysisTarget) => set({ analysisTarget }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  focar: (lat, lng, altitude) => set({ foco: { lat, lng, altitude, em: Date.now() } }),
}));
