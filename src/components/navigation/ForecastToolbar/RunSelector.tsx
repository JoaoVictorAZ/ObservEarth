// src/components/navigation/ForecastToolbar/RunSelector.tsx
import React from "react";
import { useTimelineStore } from "../../../store/timelineStore";

export const RunSelector: React.FC = () => {
  const { hour, setHour } = useTimelineStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", color: "var(--ink-3)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
        CICLO / RUN
      </span>
      <select
        style={{
          background: "#121720",
          border: "1px solid #2b3642",
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 11,
          color: "#f4f7fa",
          outline: "none",
          cursor: "pointer",
          fontFamily: "var(--mono)",
        }}
        value={hour}
        onChange={(e) => setHour(parseInt(e.target.value, 10))}
      >
        <option value={0}>00 UTC</option>
        <option value={6}>06 UTC</option>
        <option value={12}>12 UTC</option>
        <option value={18}>18 UTC</option>
      </select>
    </div>
  );
};
