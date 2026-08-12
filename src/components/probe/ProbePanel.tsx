// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// SONDA — modal de informações pontuais (janela flutuante com suporte a foco z-index,
// minimização, arraste de cabeçalho e redimensionamento em 8 direções).
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import { useWindowStore } from "../../store/windowStore";
import {
  Thermometer, Wind, Droplets, Compass, BarChart2, Activity,
  Cloud, Sun, ArrowUpRight, Mountain, Gauge, GripVertical, X, Minus, RotateCcw
} from "lucide-react";
import {
  corDe, posicaoNaFaixa, type Parada,
  TEMPERATURA, ORVALHO, VENTO, RAJADA, UMIDADE, PRESSAO, CHUVA, NUVEM, UV, ELEVACAO,
} from "../../probe/escalas";

import { arrastar, travar, MOVER, type Caixa } from "../../arrasto";

export type { Caixa };

const fmt = (v: number | null | undefined, casas: number, unidade: string) =>
  v == null || !Number.isFinite(v) ? null : `${v.toFixed(casas)}${unidade}`;

function coord(lat: number, lng: number) {
  const la = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "L" : "O"}`;
  return `${la}  ${lo}`;
}

const STORAGE_KEY = "obs:probe:pos:v3";
const MIN_W = 340;
const MIN_H = 220;

function lerPadrao(): Caixa {
  const W = typeof window !== "undefined" ? window.innerWidth : 1200;
  const padrao: Caixa = {
    x: Math.max(20, W - 480),
    y: 80,
    w: 450,
    h: 410,
  };
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (!t) return padrao;
    const c = JSON.parse(t);
    if ([c.x, c.y, c.w, c.h].every((v) => Number.isFinite(v))) {
      if (c.x > 0 && c.x < W - 50 && c.y >= 0 && c.y < window.innerHeight - 50) {
        return c;
      }
    }
  } catch { /* usa padrão */ }
  return padrao;
}

interface LinhaProps {
  icone: React.ReactNode;
  rotulo: string;
  valor: string | null;
  secundario?: string | null;
  bruto?: number | null;
  escala?: readonly Parada[];
  destaque?: boolean;
}

const Linha: React.FC<LinhaProps> = ({ icone, rotulo, valor, secundario, bruto, escala, destaque }) => {
  const cor = escala ? corDe(escala, bruto) : null;
  const pos = escala ? posicaoNaFaixa(escala, bruto) : null;

  return (
    <div className={`prow ${valor == null ? "prow-vazio" : ""} ${destaque ? "prow-forte" : ""}`}>
      <span className="prow-rot">
        <span className="prow-ico" style={cor ? { color: cor } : undefined}>{icone}</span>
        {rotulo}
      </span>

      {valor == null ? (
        <span className="prow-sem" title="A fonte não reportou este valor para este ponto e hora">
          sem dado
        </span>
      ) : (
        <strong className="prow-val" style={cor ? { color: cor } : undefined}>
          {valor}
          {secundario && <small>{secundario}</small>}
        </strong>
      )}

      {pos != null && cor && (
        <span className="prow-faixa" aria-hidden="true">
          <span className="prow-marca" style={{ left: `${pos * 100}%`, background: cor }} />
        </span>
      )}
    </div>
  );
};

const ico = { size: 14, strokeWidth: 1.6 } as const;

export interface ProbePanelProps {
  onToggleChat?: () => void;
  chatAberto?: boolean;
}

export const ProbePanel: React.FC<ProbePanelProps> = ({ onToggleChat, chatAberto }) => {
  const { probe, clearProbe } = useProbeStore();
  const { setAnalysisTarget } = useUIStore();
  const { activeWindow, focusWindow, minimizedWindows, toggleMinimize } = useWindowStore();

  const [caixa, setCaixa] = useState<Caixa>(lerPadrao);
  const [movendo, setMovendo] = useState(false);

  const caixaRef = useRef<Caixa>(caixa);
  caixaRef.current = caixa;

  const isFocused = activeWindow === "probe" || activeWindow === null;
  const isMinimized = !!minimizedWindows["probe"];

  const limites = useCallback(() => ({
    minW: MIN_W, minH: MIN_H, telaW: window.innerWidth, telaH: window.innerHeight,
  }), []);

  useEffect(() => {
    const aoRedimensionar = () => setCaixa((c) => travar(c, limites()));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [limites]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(caixa)); } catch { /* segue */ }
  }, [caixa]);

  const iniciarArrasto = (modo: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    e.preventDefault();
    focusWindow("probe");
    const startX = e.clientX;
    const startY = e.clientY;
    const startCaixa = { ...caixaRef.current };

    setMovendo(true);

    const aoMover = (ev: PointerEvent) => {
      setCaixa(arrastar(modo, ev.clientX - startX, ev.clientY - startY, startCaixa, limites()));
    };

    const aoSoltar = () => {
      setMovendo(false);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
    };

    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
  };

  if (!probe) return null;

  const vento = fmt(probe.windSpeed, 1, " m/s");
  const ventoSec = [
    fmt(probe.windKmH, 0, " km/h"),
    probe.windCardinal,
    probe.windScale ? `${probe.windScale.nome}` : null,
  ].filter(Boolean).join(" · ") || null;

  return (
    <div
      className={`probe ${movendo ? "probe-movendo" : ""} ${isFocused ? "win-foco" : ""} ${isMinimized ? "win-minimizada" : ""}`}
      style={{
        left: caixa.x,
        top: caixa.y,
        width: caixa.w,
        height: isMinimized ? "auto" : caixa.h,
        zIndex: isFocused ? 30 : 20,
      }}
      onPointerDownCapture={() => focusWindow("probe")}
      role="dialog"
      aria-label={`Sonda ${probe.place}`}
    >
      <header
        className="probe-header"
        onPointerDown={iniciarArrasto(MOVER)}
        onDoubleClick={() => toggleMinimize("probe")}
        title="Clique duplo para minimizar/expandir"
      >
        <GripVertical size={14} strokeWidth={1.6} className="probe-pega" aria-hidden="true" />
        <div className="probe-titulos">
          <h2 className="probe-tit">{probe.place}</h2>
          <span className="probe-sub">{coord(probe.lat, probe.lng)}</span>
        </div>
        <div className="probe-botoes-topo">
          <button
            type="button"
            className="probe-btn-topo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setCaixa({
                x: Math.max(20, window.innerWidth - 450),
                y: 70,
                w: 420,
                h: 460,
              });
            }}
            title="Resetar posição da janela"
            aria-label="Resetar posição"
          >
            <RotateCcw size={13} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="probe-btn-topo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize("probe");
            }}
            title={isMinimized ? "Expandir janela" : "Minimizar janela"}
            aria-label="Minimizar sonda"
          >
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="probe-btn-fechar"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              clearProbe();
            }}
            aria-label="Fechar sonda"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {!isMinimized && (
        <div className="probe-corpo">
          <div className="prows">
            <Linha icone={<Thermometer {...ico} />} rotulo="Temperatura (2 m)"
              valor={fmt(probe.temperature, 1, " °C")} secundario={fmt(probe.temperatureF, 0, " °F")}
              bruto={probe.temperature} escala={TEMPERATURA} />

            <Linha icone={<Droplets {...ico} />} rotulo="Ponto de orvalho"
              valor={fmt(probe.dewPoint, 1, " °C")} bruto={probe.dewPoint} escala={ORVALHO} />

            <Linha icone={<Wind {...ico} />} rotulo="Vento (10 m)"
              valor={vento} secundario={ventoSec}
              bruto={probe.windSpeed} escala={VENTO} destaque />

            <Linha icone={<Gauge {...ico} />} rotulo="Rajada (10 m)"
              valor={fmt(probe.windGustMs, 1, " m/s")} secundario={fmt(probe.windGustKmH, 0, " km/h")}
              bruto={probe.windGustMs} escala={RAJADA} destaque />

            <Linha icone={<Compass {...ico} />} rotulo="Umidade relativa"
              valor={fmt(probe.humidity, 0, " %")} bruto={probe.humidity} escala={UMIDADE} />

            <Linha icone={<BarChart2 {...ico} />} rotulo="Pressão à superfície"
              valor={fmt(probe.pressure, 0, " hPa")} bruto={probe.pressure} escala={PRESSAO} />

            <Linha icone={<Activity {...ico} />} rotulo="Precipitação"
              valor={fmt(probe.precipitation, 1, " mm/h")} bruto={probe.precipitation} escala={CHUVA} />

            <Linha icone={<Cloud {...ico} />} rotulo="Cobertura de nuvens"
              valor={fmt(probe.cloudCover, 0, " %")} bruto={probe.cloudCover} escala={NUVEM} />

            <Linha icone={<Sun {...ico} />} rotulo="Índice UV"
              valor={fmt(probe.uvIndex, 1, "")} bruto={probe.uvIndex} escala={UV} />

            <Linha icone={<Mountain {...ico} />} rotulo="Elevação (barométrica)"
              valor={fmt(probe.elevationM, 0, " m")} bruto={probe.elevationM} escala={ELEVACAO} />
          </div>

          <div className="probe-acoes">
            {onToggleChat && (
              <button
                type="button"
                className={`probe-analise ${chatAberto ? "probe-analise-ativo" : ""}`}
                onClick={onToggleChat}
              >
                <span>{chatAberto ? "Ocultar Terminal LLM" : "Terminal LLM"}</span>
              </button>
            )}
            <button
              type="button"
              className="probe-analise"
              onClick={() => setAnalysisTarget({ lat: probe.lat, lng: probe.lng, place: probe.place })}
            >
              <span>Análise completa</span>
              <ArrowUpRight size={14} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>

          {probe.windNotice && <p className="probe-aviso" role="note">{probe.windNotice}</p>}
          {probe.source && <p className="probe-fonte">{probe.source}</p>}
          {probe.sourceNote && <p className="probe-fonte">{probe.sourceNote}</p>}
        </div>
      )}

      {/* Puxadores de redimensionamento em 8 direções */}
      <div className="win-puxa win-puxa-n" onPointerDown={iniciarArrasto("c")} />
      <div className="win-puxa win-puxa-s" onPointerDown={iniciarArrasto("b")} />
      <div className="win-puxa win-puxa-e" onPointerDown={iniciarArrasto("d")} />
      <div className="win-puxa win-puxa-w" onPointerDown={iniciarArrasto("e")} />
      <div className="win-puxa win-puxa-nw" onPointerDown={iniciarArrasto("ec")} />
      <div className="win-puxa win-puxa-ne" onPointerDown={iniciarArrasto("dc")} />
      <div className="win-puxa win-puxa-sw" onPointerDown={iniciarArrasto("eb")} />
      <div className="win-puxa win-puxa-se" onPointerDown={iniciarArrasto("db")} />
    </div>
  );
};
