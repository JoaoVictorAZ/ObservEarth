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
