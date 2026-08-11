// src/components/navigation/ForecastToolbar/ForecastToolbar.tsx
// -----------------------------------------------------------------------------
// BARRA DE TEMPO E PREVISÃO HORÁRIA TIER 2 (SEM SELETOR DE MODELO)
// -----------------------------------------------------------------------------

import React from "react";
import { RunSelector } from "./RunSelector";
import { ForecastHourSelector } from "./ForecastHourSelector";
import { CalendarButton } from "./CalendarButton";
import { TimelineSlider } from "./TimelineSlider";
import { PlaybackControls } from "./PlaybackControls";

export const ForecastToolbar: React.FC = () => {
  return (
    <div className="forecast-toolbar">
      <RunSelector />
      <ForecastHourSelector />
      <CalendarButton />
      <TimelineSlider />
      <PlaybackControls />
    </div>
  );
};
