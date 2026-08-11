// src/components/instrument/StatusBar.tsx
// -----------------------------------------------------------------------------
// BARRA DE STATUS INFERIOR COM METADADOS DO MODELO E DIAGNÓSTICO (ZUSTAND)
// -----------------------------------------------------------------------------

import React from "react";
import { useLayerStore } from "../../store/layerStore";
import { Activity, ShieldCheck } from "lucide-react";

export const StatusBar: React.FC = () => {
  const { windInfo, isoInfo, fireInfo, geoInfo, layer, kind } = useLayerStore();

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 26,
        zIndex: 10,
        background: "rgba(4, 6, 10, 0.88)",
        borderTop: "1px solid var(--rule-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        fontSize: 11,
        fontFamily: "var(--mono)",
        color: "var(--ink-3)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--signal)" }}>
          <ShieldCheck size={12} /> SISTEMA OPERACIONAL
        </span>
        {kind && layer && (
          <span>CAMADA: <strong style={{ color: "var(--ink)" }}>{layer}</strong> ({kind})</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {windInfo && <span>{windInfo}</span>}
        {isoInfo && <span>{isoInfo}</span>}
        {fireInfo && <span>{fireInfo}</span>}
        {/* aviso do próprio motor do globo: contorno que não baixou não pode
            sumir em silêncio — sem isto, mapa sem estados é indistinguível
            de mapa onde aquelas fronteiras não existem */}
        {geoInfo && <span className="warn">{geoInfo}</span>}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Activity size={11} color="var(--signal)" /> 60 FPS
        </span>
      </div>
    </div>
  );
};
