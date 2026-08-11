// src/components/navigation/ForecastToolbar/ForecastHourSelector.tsx
import React from "react";
import { useTimelineStore } from "../../../store/timelineStore";

export const ForecastHourSelector: React.FC = () => {
  const { frameIdx, setFrameIdx, timeline } = useTimelineStore();

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    setFrameIdx(idx);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", color: "var(--ink-3)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
        FORECAST HOUR
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
        value={frameIdx}
        onChange={handleSelect}
      >
        {timeline?.frames?.map((f, i) => (
          <option key={i} value={i}>
            +{f.offsetH}h ({f.date} {String(f.hour).padStart(2, "0")}h)
          </option>
        )) || <option value={0}>+0h</option>}
      </select>
    </div>
  );
};
