// src/components/layout/AppShell.tsx
// -----------------------------------------------------------------------------
// SHELL MESTRE DA ARQUITETURA V2 DO OBSERVATÓRIO 2.0 (2-TIER HEADER)
// -----------------------------------------------------------------------------

import React, { useRef } from "react";
import { TopBar } from "../navigation/TopBar/TopBar";
import { ForecastToolbar } from "../navigation/ForecastToolbar/ForecastToolbar";
import { LeftDock } from "../dock/LeftDock";
import { StatusBar } from "../instrument/StatusBar";
import { GlobeViewport, type GlobeViewportRef } from "../globe/GlobeViewport";
import { ProbePanel } from "../probe/ProbePanel";
import { CommandPalette } from "../navigation/CommandPalette";
import AnalysisModal from "../AnalysisModal";
import { useUIStore } from "../../store/uiStore";
import { useProbeStore } from "../../store/probeStore";
import { useTimelineStore } from "../../store/timelineStore";
import { PointChat } from "../chat/PointChat";

export const AppShell: React.FC = () => {
  const globeRef = useRef<GlobeViewportRef>(null);
  const { analysisTarget, setAnalysisTarget } = useUIStore();
  const { probe } = useProbeStore();
  const { day, hour } = useTimelineStore();
  // O terminal abre por AÇÃO EXPLÍCITA, nunca no clique. Clicar num ponto do
  // globo é gesto de exploração; abrir um painel que quer baixar gigabytes a
  // cada clique seria hostil.
  const [chatAberto, setChatAberto] = React.useState(true);

  // Quando um novo ponto é selecionado, abre o terminal por padrão
  React.useEffect(() => {
    if (probe) setChatAberto(true);
  }, [probe?.lat, probe?.lng]);

  const handleSearchCoord = (lat: number, lng: number) => {
    globeRef.current?.flyTo(lat, lng);
  };

  const handleOrganizarJanelas = () => {
    try {
      localStorage.removeItem("obs:probe:pos:v3");
      localStorage.removeItem("obs:chat:pos:v2");
    } catch { /* segue */ }
    window.dispatchEvent(new Event("resize"));
  };

  return (
    <div className="app">
      <GlobeViewport ref={globeRef} />
      <TopBar onSearchCoord={handleSearchCoord} />
      <ForecastToolbar />
      <LeftDock />
      <ProbePanel onToggleChat={() => setChatAberto((v) => !v)} chatAberto={chatAberto} />
      <StatusBar />
      <CommandPalette onFlyTo={handleSearchCoord} />

      {probe && chatAberto && (
        <PointChat
          lat={probe.lat}
          lng={probe.lng}
          date={day}
          hour={hour}
          onFechar={() => setChatAberto(false)}
          onOrganizarJanelas={handleOrganizarJanelas}
        />
      )}

      {analysisTarget && (
        <AnalysisModal
          lat={analysisTarget.lat}
          lng={analysisTarget.lng}
          place={analysisTarget.place}
          onClose={() => setAnalysisTarget(null)}
        />
      )}
    </div>
  );
};
