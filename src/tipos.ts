// src/tipos.ts
// -----------------------------------------------------------------------------
// Tipos de dado compartilhados pelos motores de visualização.
// -----------------------------------------------------------------------------
// Estes moravam dentro de `globe.ts`. Saíram de lá quando o motor 2D nasceu:
// deixá-los onde estavam obrigaria o mapa plano a importar `globe.ts`, e com
// ele o globe.gl e o three-globe inteiros — dependência de biblioteca 3D num
// arquivo que só desenha planos.
//
// `globe.ts` reexporta tudo daqui, então nada que importava de lá quebrou.
// -----------------------------------------------------------------------------

import type { FrameStats } from "./perf";

export interface Quake {
  lat: number; lng: number; mag: number; depth: number; place: string; time: number;
}

/**
 * Campo vetorial numa grade equirretangular.
 *
 * u/v aceitam Float32Array: o cliente converte o JSON assim que ele chega, o
 * que corta pela metade a memória de cada campo (ver src/forecastPlayer.ts).
 */
export interface WindGrid {
  nx: number; ny: number;
  u: number[] | Float32Array;
  v: number[] | Float32Array;
  valid?: number[] | Uint8Array;

  /** Procedência declarada pelo servidor. A tela tem que LER isto, não supor.
   *  Havia um literal "NOAA GFS 0.25° · 100% medido" fixo na view, que
   *  continuava afirmando GFS quando o campo vinha do recuo de 3°. */
  provider?: string;
  dataset?: string;
  /** passo da grade em graus: 0,25 no GFS, 3 no recuo — 144x mais grosso */
  stepDeg?: number;
  measuredPct?: number;
  builtAt?: string;
}

export interface PlaceLabel {
  name: string; lat: number; lng: number;
  rank?: number; pop?: number; admin?: string;
}

export interface LabelSets {
  countries: PlaceLabel[];
  states: PlaceLabel[];
  cities: PlaceLabel[];
}

/** isóbaras e centros de pressão, vindos de /api/isobars */
export interface IsobarSet {
  step: number;
  unit: string;
  min: number;
  max: number;
  dataset?: string;
  forecastHour?: number;
  points?: number;
  /** resolução da grade em que o contorno foi traçado, em graus */
  stepDeg?: number;
  contours: { hPa: number; major: boolean; points: [number, number][] }[];
  centers: { lat: number; lng: number; hPa: number; kind: "H" | "L" }[];
}

/** foco de calor do NASA FIRMS. `frp` = Fire Radiative Power em MW. */
export interface Fire {
  lat: number; lng: number; frp: number;
  brightness: number; confidence: string; acqDate: string; daynight: string;
}

// -----------------------------------------------------------------------------
// O CONTRATO DOS MOTORES
// -----------------------------------------------------------------------------
// Globo e mapa plano são intercambiáveis porque cumprem esta interface. O
// `GlobeViewport` fala só com ela e nunca sabe qual dos dois está montado —
// é o que permite trocar de modo sem duplicar toda a fiação de estado.
//
// A lista é exatamente o que a aplicação usa hoje. Não inventei métodos "para
// o futuro": um contrato com buraco é pior que contrato nenhum, porque o
// segundo motor implementa o buraco com um corpo vazio e ninguém percebe.
// -----------------------------------------------------------------------------

export interface MotorGeo {
  /** quantos focos de calor o motor de fato desenhou depois do corte de orçamento */
  readonly firesDrawn: number;

  mount(container: HTMLElement): void;
  dispose(): void;

  onClick(fn: (lat: number, lng: number) => void): void;
  onNotice(fn: (msg: string | null) => void): void;
  onStats(fn: (s: FrameStats) => void): void;

  /** centraliza a vista num ponto */
  flyTo(lat: number, lng: number, altitude?: number): void;

  setAutoRotate(on: boolean): void;
  setDayNight(on: boolean): void;
  setTime(d: Date): void;

  setImagery(id: string | null, date: Date, opacity?: number): void;
  setImageryOpacity(o: number): void;

  setWind(grid: WindGrid | null, key?: string): void;
  setWindVisible(on: boolean): void;
  setWindDensity(frac: number): void;

  setCurrents(grid: WindGrid | null): void;
  setCurrentsVisible(on: boolean): void;

  setIsobars(data: IsobarSet | null): void;
  setIsobarsVisible(on: boolean): void;

  setQuakes(list: Quake[]): void;
  setFires(list: Fire[]): void;
  setOpenAQ(list: unknown[]): void;
  setHospitals(list: unknown[]): void;
  setClickMarker(lat: number | null, lng: number | null): void;
}
