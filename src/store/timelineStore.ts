// src/store/timelineStore.ts
import { create } from "zustand";
import type { Timeline } from "../forecastPlayer";

function getInitialDateTime() {
  const now = new Date();
  // Subtrai exatamente 6 horas da hora/data atual (com rollback automático para o dia anterior se for nas primeiras 6h do dia)
  now.setHours(now.getHours() - 6);

  const day = now.toISOString().slice(0, 10);
  const hour = now.getHours();

  return { day, hour };
}

const initialTime = getInitialDateTime();

interface TimelineState {
  day: string;
  hour: number;
  playing: boolean;
  speed: number;
  timeline: Timeline | null;
  frameIdx: number;
  buffering: boolean;
  setDay: (day: string) => void;
  setHour: (hour: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setTimeline: (t: Timeline | null) => void;
  setFrameIdx: (idx: number) => void;
  setBuffering: (b: boolean) => void;
  togglePlay: () => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  day: initialTime.day,
  hour: initialTime.hour,
  playing: false,
  speed: 1,
  timeline: null,
  frameIdx: 0,
  buffering: false,
  setDay: (day) => set({ day }),
  setHour: (hour) => set({ hour }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setTimeline: (timeline) => set({ timeline }),
  setFrameIdx: (frameIdx) => set({ frameIdx }),
  setBuffering: (buffering) => set({ buffering }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
}));
