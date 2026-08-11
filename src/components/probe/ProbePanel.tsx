// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// INSPECIONADOR DE CONDIÇÕES DE SUPERFÍCIE E SONDA ATMOSFÉRICA (MINIMALIST ICONS)
// -----------------------------------------------------------------------------

import React from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import { Thermometer, Wind, Droplets, Compass, BarChart2, Activity, Cloud, Sun, ArrowUpRight } from "lucide-react";

const fmt = (v: number | null | undefined, d: number, s: string) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}${s}`;

export const ProbePanel: React.FC = () => {
  const { probe, clearProbe } = useProbeStore();
  const { setAnalysisTarget } = useUIStore();

  if (!probe) return null;

  const handleOpenAnalysis = () => {
    setAnalysisTarget({ lat: probe.lat, lng: probe.lng, place: probe.place });
  };

  return (
    <div
      className="probe"
      style={{
        width: 330,
        padding: 16,
        background: "rgba(10, 14, 22, 0.94)",
        border: "1px solid rgba(93, 224, 176, 0.3)",
        borderRadius: 8,
        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="phead" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)", paddingBottom: 10, marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 15, color: "#fff", display: "block" }}>{probe.place}</strong>
          <div className="pcoord" style={{ fontSize: 11, color: "var(--signal)", marginTop: 2 }}>
            {probe.lat.toFixed(4)}°S {probe.lng.toFixed(4)}°O · Elevação: <strong>{probe.elevationM ?? 0}m</strong>
          </div>
        </div>
        <button onClick={clearProbe} className="probe-fechar" aria-label="Limpar ponto selecionado">×</button>
      </div>

      <div className="prows" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#f87171" }}>
            <Thermometer size={14} strokeWidth={1.5} color="#f87171" /> Temperatura (2m)
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>
            {fmt(probe.temperature, 1, " °C")} <small style={{ color: "var(--ink-3)", fontWeight: 400 }}>({fmt(probe.temperatureF, 1, "°F")})</small>
          </strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#60a5fa" }}>
            <Droplets size={14} strokeWidth={1.5} color="#60a5fa" /> Ponto de Orvalho (Td)
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.dewPoint, 1, " °C")}</strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#34d399" }}>
            <Wind size={14} strokeWidth={1.5} color="#34d399" /> Vento Superfície (10m)
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>
            {fmt(probe.windSpeed, 1, " m/s")} <small style={{ color: "var(--ink-3)", fontWeight: 400 }}>({fmt(probe.windKmH, 1, "km/h")}) {probe.windCardinal}</small>
          </strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#c084fc" }}>
            <Compass size={14} strokeWidth={1.5} color="#c084fc" /> Umidade Relativa
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.humidity, 0, " %")}</strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#fbbf24" }}>
            <BarChart2 size={14} strokeWidth={1.5} color="#fbbf24" /> Pressão Superfície
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.pressure, 0, " hPa")}</strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8" }}>
            <Activity size={14} strokeWidth={1.5} color="#38bdf8" /> Precipitação Instant.
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.precipitation, 1, " mm/h")}</strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8" }}>
            <Cloud size={14} strokeWidth={1.5} color="#94a3b8" /> Cobertura de Nuvens
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.cloudCover, 0, " %")}</strong>
        </div>

        <div className="prow" style={rowStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#facc15" }}>
            <Sun size={14} strokeWidth={1.5} color="#facc15" /> Índice UV Solar
          </span>
          <strong style={{ fontSize: 13, color: "#fff" }}>{fmt(probe.uvIndex, 1, "")}</strong>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          className="primary-h-btn"
          style={{
            width: "100%",
            height: 38,
            justifyContent: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            boxShadow: "0 4px 14px rgba(93, 224, 176, 0.3)",
          }}
          onClick={handleOpenAnalysis}
        >
          <span>Análise completa · séries e sondagem</span>
          <ArrowUpRight size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 11.5,
  padding: "6px 8px",
  background: "rgba(255, 255, 255, 0.03)",
  borderRadius: 4,
};
