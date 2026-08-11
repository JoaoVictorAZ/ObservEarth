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

export const AppShell: React.FC = () => {
  const globeRef = useRef<GlobeViewportRef>(null);
  const { analysisTarget, setAnalysisTarget } = useUIStore();

  const handleSearchCoord = (lat: number, lng: number) => {
    globeRef.current?.flyTo(lat, lng);
  };

  return (
    <div className="app">
      <GlobeViewport ref={globeRef} />
      <TopBar onSearchCoord={handleSearchCoord} />
      <ForecastToolbar />
      <LeftDock />
      <ProbePanel />
      <StatusBar />
      <CommandPalette onFlyTo={handleSearchCoord} />

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
