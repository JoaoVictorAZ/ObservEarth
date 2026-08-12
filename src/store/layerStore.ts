// src/store/layerStore.ts
import { create } from "zustand";

export interface SatLayer {
  id: string;
  title: string;
  group: string;
  legend: [string, string][] | null;
  lag?: number;
}

export interface ModelLayer {
  id: string;
  title: string;
  detail?: string;
  raw?: string;
  coverage?: { first: string; last: string; cadence: string | null; gaps: number } | null;
}

export interface FieldLayer {
  id: string;
  title: string;
  group: string;
  unit: string;
  legend: [string, string][] | null;
}

const DEFAULT_FIELDS: FieldLayer[] = [
  { id: "temp2m", title: "Temperatura do Ar (2m)", group: "Modelo GFS", unit: "°C", legend: null },
  { id: "dew2m", title: "Ponto de Orvalho (2m)", group: "Modelo GFS", unit: "°C", legend: null },
  { id: "rh2m", title: "Umidade Relativa (2m)", group: "Modelo GFS", unit: "%", legend: null },
  { id: "precip", title: "Precipitação Acumulada", group: "Modelo GFS", unit: "mm/h", legend: null },
  { id: "prmsl", title: "Pressão ao Nível do Mar (MSLP)", group: "Modelo GFS", unit: "hPa", legend: null },
  { id: "cloud", title: "Cobertura de Nuvens Total", group: "Modelo GFS", unit: "%", legend: null },
  { id: "wbgt", title: "Estresse Térmico WBGT", group: "Saúde & Risco", unit: "°C WBGT", legend: null },
];

const DEFAULT_SATS: SatLayer[] = [
  { id: "MODIS_Terra_CorrectedReflectance_TrueColor", title: "MODIS Terra (True Color)", group: "NASA GIBS", legend: null },
  { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", title: "VIIRS SNPP (True Color 375m)", group: "NASA GIBS", legend: null },
  { id: "GOES-East_ABI_Band2_Red", title: "GOES-East Geostacionário (América)", group: "NOAA/NASA", legend: null },
  { id: "sst", title: "Temperatura da Superfície do Mar (SST)", group: "Satélite", legend: [["#2f6db0", "frio"], ["#e9e3d0", ""], ["#d33f3f", "quente"]] },
  { id: "aerosol", title: "Aerossóis e Poeira (AOD)", group: "Satélite", legend: [["#451a03", "limpo"], ["#b45309", ""], ["#fbbf24", "denso"]] },
  { id: "seaice", title: "Gelo Marinho (Concentração)", group: "Satélite", legend: [["#0c4a6e", "0%"], ["#9fe8f5", ""], ["#f0fbff", "100%"]] },
  { id: "vegetation", title: "Vegetação NDVI (8 dias)", group: "Satélite", legend: [["#78350f", "solo"], ["#a16207", ""], ["#166534", "densa"]] },
  { id: "snow", title: "Cobertura de Neve (MODIS)", group: "Satélite", legend: null },
  { id: "ozone", title: "Ozônio Total (OMI)", group: "Satélite", legend: null },
];

const DEFAULT_MODELS: ModelLayer[] = [
  { id: "MERRA2_T2M_Monthly", title: "MERRA-2 Temperatura Média 2m", detail: "Reanálise climatológica mensal NASA", coverage: null },
  { id: "MERRA2_PRECTOT_Monthly", title: "MERRA-2 Precipitação Total", detail: "Reanálise climatológica mensal NASA", coverage: null },
  { id: "MERRA2_SLP_Monthly", title: "MERRA-2 Pressão Superfície", detail: "Reanálise climatológica mensal NASA", coverage: null },
  { id: "GEOS_FP_T2M", title: "GEOS-FP Previsão Global Alta Resolução", detail: "Modelo assimilação Goddard Space Flight Center", coverage: null },
];

interface LayerState {
  kind: "model" | "sat" | "field" | null;
  layer: string | null;
  opacity: number;
  activeModelName: string;

  sats: SatLayer[];
  models: ModelLayer[];
  fields: FieldLayer[];

  wind: boolean;
  isobarsOn: boolean;
  quakesOn: boolean;
  firesOn: boolean;
  openaqOn: boolean;
  wbgtOn: boolean;
  hospitalsOn: boolean;
  hycomOn: boolean;
  relevoOn: boolean;

  windInfo: string | null;
  isoInfo: string | null;
  fireInfo: string | null;
  openaqInfo: string | null;
  hospitalInfo: string | null;
  hycomInfo: string | null;
  /** avisos do próprio motor do globo (contornos, geometria) */
  geoInfo: string | null;

  setOpacity: (opacity: number) => void;
  setActiveModelName: (name: string) => void;
  selectLayer: (kind: "model" | "sat" | "field", id: string) => void;
  clearLayer: () => void;

  setSats: (sats: SatLayer[]) => void;
  setModels: (models: ModelLayer[]) => void;
  setFields: (fields: FieldLayer[]) => void;

  setWind: (on: boolean) => void;
  setIsobarsOn: (on: boolean) => void;
  setQuakesOn: (on: boolean) => void;
  setFiresOn: (on: boolean) => void;
  setOpenaqOn: (on: boolean) => void;
  setWbgtOn: (on: boolean) => void;
  setHospitalsOn: (on: boolean) => void;
  setHycomOn: (on: boolean) => void;
  setRelevoOn: (on: boolean) => void;

  setWindInfo: (info: string | null) => void;
  setIsoInfo: (info: string | null) => void;
  setFireInfo: (info: string | null) => void;
  setOpenaqInfo: (info: string | null) => void;
  setHospitalInfo: (info: string | null) => void;
  setHycomInfo: (info: string | null) => void;
  setGeoInfo: (info: string | null) => void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  kind: null,
  layer: null,
  opacity: 0.78,
  activeModelName: "GFS 0.25° (NOAA)",

  sats: DEFAULT_SATS,
  models: DEFAULT_MODELS,
  fields: DEFAULT_FIELDS,

  wind: true,
  isobarsOn: false,
  quakesOn: true,
  firesOn: false,
  openaqOn: true,
  wbgtOn: false,
  hospitalsOn: false,
  relevoOn: false,
  hycomOn: false,

  windInfo: null,
  isoInfo: null,
  fireInfo: null,
  openaqInfo: null,
  hospitalInfo: null,
  hycomInfo: null,
  geoInfo: null,

  setOpacity: (opacity) => set({ opacity }),
  setActiveModelName: (activeModelName) => set({ activeModelName }),
  selectLayer: (kind, id) => {
    const { kind: currentKind, layer: currentLayer } = get();
    if (currentKind === kind && currentLayer === id) {
      set({ kind: null, layer: null });
    } else {
      set({ kind, layer: id });
    }
  },
  clearLayer: () => set({ kind: null, layer: null }),

  setSats: (sats) => set({ sats: sats.length > 0 ? sats : DEFAULT_SATS }),
  setModels: (models) => set({ models: models.length > 0 ? models : DEFAULT_MODELS }),
  setFields: (fields) => set({ fields: fields.length > 0 ? fields : DEFAULT_FIELDS }),

  setWind: (wind) => set({ wind }),
  setIsobarsOn: (isobarsOn) => set({ isobarsOn }),
  setQuakesOn: (quakesOn) => set({ quakesOn }),
  setFiresOn: (firesOn) => set({ firesOn }),
  setOpenaqOn: (openaqOn) => set({ openaqOn }),
  setWbgtOn: (wbgtOn) => set({ wbgtOn }),
  setHospitalsOn: (hospitalsOn) => set({ hospitalsOn }),
  setRelevoOn: (relevoOn) => set({ relevoOn }),
  setHycomOn: (hycomOn) => set({ hycomOn }),

  setWindInfo: (windInfo) => set({ windInfo }),
  setIsoInfo: (isoInfo) => set({ isoInfo }),
  setFireInfo: (fireInfo) => set({ fireInfo }),
  setOpenaqInfo: (openaqInfo) => set({ openaqInfo }),
  setHospitalInfo: (hospitalInfo) => set({ hospitalInfo }),
  setHycomInfo: (hycomInfo) => set({ hycomInfo }),
  setGeoInfo: (geoInfo) => set({ geoInfo }),
}));
