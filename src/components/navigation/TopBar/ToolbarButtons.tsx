// src/components/navigation/TopBar/ToolbarButtons.tsx
import React, { useState } from "react";
import { useGlobeStore } from "../../../store/globeStore";
import { RefreshCw, Compass, Home, Camera, Sliders, Sun } from "lucide-react";

export const ToolbarButtons: React.FC<{ onSearchCoord?: (lat: number, lng: number) => void }> = ({ onSearchCoord }) => {
  const { rotate, toggleRotate, dayNight, toggleDayNight } = useGlobeStore();
  const [showSettings, setShowSettings] = useState(false);

  const handleScreenshot = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      alert("Nenhum canvas WebGL detectado.");
      return;
    }
    const link = document.createElement("a");
    link.download = `observatorio-earth-platform-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
      <button
        className={`h-btn ${rotate ? "primary-h-btn" : ""}`}
        onClick={toggleRotate}
        title="Alternar Rotação Automática do Globo"
        style={btnStyle}
      >
        <RefreshCw size={14} strokeWidth={1.5} />
      </button>

      <button
        className={`h-btn ${dayNight ? "primary-h-btn" : ""}`}
        onClick={toggleDayNight}
        title="Alternar Iluminação Solar em Tempo Real"
        style={btnStyle}
      >
        <Sun size={14} strokeWidth={1.5} />
      </button>

      <button
        className="h-btn"
        onClick={() => onSearchCoord?.(-23.5505, -46.6333)}
        title="Travar Norte / Resetar Câmera"
        style={btnStyle}
      >
        <Compass size={14} strokeWidth={1.5} />
      </button>

      <button
        className="h-btn"
        onClick={() => onSearchCoord?.(0, 0)}
        title="Retornar à Posição Inicial"
        style={btnStyle}
      >
        <Home size={14} strokeWidth={1.5} />
      </button>

      <button
        className="h-btn"
        onClick={handleScreenshot}
        title="Capturar Captura de Tela PNG (Download Instantâneo)"
        style={btnStyle}
      >
        <Camera size={14} strokeWidth={1.5} />
      </button>

      <button
        className={`h-btn ${showSettings ? "primary-h-btn" : ""}`}
        onClick={() => setShowSettings(!showSettings)}
        title="Configurações de Renderização e Qualidade"
        style={btnStyle}
      >
        <Sliders size={14} strokeWidth={1.5} />
      </button>

      {/* POPUP DE CONFIGURAÇÕES DE RENDERIZAÇÃO */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            width: 260,
            background: "#0c1017",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: 6,
            padding: 14,
            boxShadow: "0 12px 30px rgba(0,0,0,0.8)",
            zIndex: 100,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "var(--signal)", marginBottom: 8, fontFamily: "var(--mono)" }}>
            CONFIGURAÇÕES DE ENGINE WEBGL
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11, color: "var(--ink-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Resolução Pixel Ratio:</span>
              <strong style={{ color: "#fff" }}>2x (Retina)</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Partículas GPU:</span>
              <strong style={{ color: "#fff" }}>131,072 vetores</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Suavização Anisotrópica:</span>
              <strong style={{ color: "#fff" }}>8x Max</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  padding: 0,
  borderRadius: 4,
};
