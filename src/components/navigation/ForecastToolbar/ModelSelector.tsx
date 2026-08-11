// src/components/navigation/ForecastToolbar/ModelSelector.tsx
import React from "react";
import { useLayerStore } from "../../../store/layerStore";

export const ModelSelector: React.FC = () => {
  const { fields, selectLayer, kind, layer } = useLayerStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={labelStyle}>MODELO</span>
      <select
        style={selectStyle}
        value={kind === "field" && layer ? layer : "wind"}
        onChange={(e) => selectLayer("field", e.target.value)}
      >
        <option value="wind">NOAA GFS 0.25°</option>
        <option value="temp2m">GFS Temperatura (2m)</option>
        <option value="precip">GFS Precipitação</option>
        <option value="prmsl">GFS Pressão Nível Mar</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.title}
          </option>
        ))}
      </select>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.14em",
  color: "var(--ink-3)",
  fontFamily: "var(--mono)",
  textTransform: "uppercase",
};

const selectStyle: React.CSSProperties = {
  background: "#121720",
  border: "1px solid #2b3642",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 11,
  color: "#f4f7fa",
  outline: "none",
  cursor: "pointer",
  fontFamily: "var(--sans)",
};
