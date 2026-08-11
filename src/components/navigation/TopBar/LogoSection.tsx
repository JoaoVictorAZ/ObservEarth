// src/components/navigation/TopBar/LogoSection.tsx
import React from "react";
import { useUIStore } from "../../../store/uiStore";
import { Globe, PanelLeft } from "lucide-react";

export const LogoSection: React.FC = () => {
  const { toggleSidebar } = useUIStore();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <button
        className="h-btn"
        style={{ padding: "6px 9px", display: "flex", alignItems: "center" }}
        onClick={toggleSidebar}
        title="Alternar Painel Lateral"
      >
        <PanelLeft size={15} strokeWidth={1.5} color="var(--ink-2)" />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Globe size={17} strokeWidth={1.5} color="var(--signal)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", letterSpacing: "0.01em" }}>
          Observatório <strong style={{ color: "#fff" }}>Earth Platform 1.5</strong>
        </span>
        <span className="dot" />
        <span className="workspace">v1.5 PRO WORKSTATION</span>
      </div>
    </div>
  );
};
