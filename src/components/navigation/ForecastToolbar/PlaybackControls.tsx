// src/components/navigation/ForecastToolbar/PlaybackControls.tsx
import React, { useEffect } from "react";
import { useTimelineStore } from "../../../store/timelineStore";
import { Play, Pause, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

export const PlaybackControls: React.FC = () => {
  const { playing, togglePlay, hour, setHour } = useTimelineStore();

  const prevFrame = () => setHour((hour - 1 + 24) % 24);
  const nextFrame = () => setHour((hour + 1) % 24);
  const resetFrame = () => setHour(0);

  // Animação de reprodução automática hora a hora
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      useTimelineStore.setState((state) => ({ hour: (state.hour + 1) % 24 }));
    }, 1200);
    return () => clearInterval(timer);
  }, [playing]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button className="h-btn" onClick={resetFrame} title="Início do Dia (00:00 UTC)">
        <RotateCcw size={13} strokeWidth={1.5} />
      </button>
      <button className="h-btn" onClick={prevFrame} title="Hora Anterior (-1h)">
        <ChevronLeft size={14} strokeWidth={1.5} />
      </button>
      <button
        className={`h-btn ${playing ? "primary-h-btn" : ""}`}
        onClick={togglePlay}
        title={playing ? "Pausar Reprodução" : "Iniciar Animação Horária (00h-23h)"}
        style={{ padding: "6px 12px", display: "flex", alignItems: "center" }}
      >
        {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
      </button>
      <button className="h-btn" onClick={nextFrame} title="Próxima Hora (+1h)">
        <ChevronRight size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
};
