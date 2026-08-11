// src/components/navigation/ForecastToolbar/TimelineSlider.tsx
// -----------------------------------------------------------------------------
// BARRA DE TEMPO HORÁRIA (0H A 23H) DE FÁCIL COMPREENSÃO
// -----------------------------------------------------------------------------

import React from "react";
import { useTimelineStore } from "../../../store/timelineStore";

export const TimelineSlider: React.FC = () => {
  const { hour, setHour } = useTimelineStore();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, margin: "0 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
        <span style={hour === 0 ? activeMarkStyle : undefined}>00h</span>
        <span style={hour === 3 ? activeMarkStyle : undefined}>03h</span>
        <span style={hour === 6 ? activeMarkStyle : undefined}>06h</span>
        <span style={hour === 9 ? activeMarkStyle : undefined}>09h</span>
        <span style={hour === 12 ? activeMarkStyle : undefined}>12h</span>
        <span style={hour === 15 ? activeMarkStyle : undefined}>15h</span>
        <span style={hour === 18 ? activeMarkStyle : undefined}>18h</span>
        <span style={hour === 21 ? activeMarkStyle : undefined}>21h</span>
        <span style={hour === 23 ? activeMarkStyle : undefined}>23h</span>
      </div>
      <input
        type="range"
        min={0}
        max={23}
        step={1}
        value={hour}
        onChange={(e) => setHour(parseInt(e.target.value, 10))}
        className="timeline"
      />
    </div>
  );
};

const activeMarkStyle: React.CSSProperties = {
  color: "#32d6a5",
  fontWeight: 700,
};
