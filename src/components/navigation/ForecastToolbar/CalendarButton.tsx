// src/components/navigation/ForecastToolbar/CalendarButton.tsx
import React from "react";
import { useTimelineStore } from "../../../store/timelineStore";
import { Calendar } from "lucide-react";

export const CalendarButton: React.FC = () => {
  const { day, setDay, hour } = useTimelineStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", color: "var(--ink-3)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>
        TIMESTAMP
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#121720",
          border: "1px solid #2b3642",
          borderRadius: 4,
          padding: "3px 8px",
        }}
      >
        <Calendar size={12} strokeWidth={1.5} color="var(--signal)" />
        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            color: "#f4f7fa",
            fontSize: 11,
            fontFamily: "var(--mono)",
            outline: "none",
            cursor: "pointer",
          }}
        />
        <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--signal)", fontWeight: 600 }}>
          {String(hour).padStart(2, "0")}:00 UTC
        </span>
      </div>
    </div>
  );
};
