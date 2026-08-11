// src/store/probeStore.ts
import { create } from "zustand";

export interface Probe {
  lat: number; lng: number; place: string;
  temperature: number | null; temperatureF?: number | null;
  humidity: number | null; dewPoint?: number | null;
  precipitation: number | null; pressure: number | null; pressureMmHg?: number | null;
  windSpeed: number | null; windKmH?: number | null; windKnots?: number | null;
  windDirection: number | null; windCardinal?: string | null;
  cloudCover?: number | null; airDensity?: number | null;
  uvIndex?: number | null; elevationM?: number | null;
  source: string;
}

interface ProbeState {
  probe: Probe | null;
  probing: boolean;
  setProbe: (probe: Probe | null) => void;
  setProbing: (probing: boolean) => void;
  clearProbe: () => void;
}

export const useProbeStore = create<ProbeState>((set) => ({
  probe: null,
  probing: false,
  setProbe: (probe) => set({ probe }),
  setProbing: (probing) => set({ probing }),
  clearProbe: () => set({ probe: null, probing: false }),
}));
