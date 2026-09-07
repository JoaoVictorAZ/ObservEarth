// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// SONDA — modal de informações pontuais (janela flutuante com suporte a foco z-index,
// minimização, arraste de cabeçalho e redimensionamento em 8 direções).
// -----------------------------------------------------------------------------

import React from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import { useBlocoStore } from "../../store/blocoStore";
import {
  Thermometer, Wind, Droplets, Compass, BarChart2, Activity,
  Cloud, Sun, ArrowUpRight, Mountain, Gauge, GripVertical, X, Minus, RotateCcw
} from "lucide-react";
import {
  corDe, posicaoNaFaixa, type Parada,
  TEMPERATURA, ORVALHO, VENTO, RAJADA, UMIDADE, PRESSAO, CHUVA, NUVEM, UV, ELEVACAO,
} from "../../probe/escalas";

import { useJanelaFlutuante, MOVER, type Caixa } from "../../janelas";

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

/**
 * O lugar de fábrica, recalculado a partir da tela.
 *
 * É uma FUNÇÃO e não uma constante porque o botão "organizar janelas" a chama
 * de novo: a tela pode ter mudado de tamanho desde a montagem, e recolocar a
 * janela numa coordenada de outra resolução seria o mesmo problema que o
 * `caixaUsavel` existe para evitar.
 */
function padraoSonda(): Caixa {
  const W = typeof window !== "undefined" ? window.innerWidth : 1200;
  return { x: Math.max(20, W - 480), y: 80, w: 450, h: 410 };
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
  const abrirBloco = useBlocoStore((b) => b.abrir);

  // Todo o comportamento de janela — posição salva, arraste, foco, minimizar,
  // recolocar — mora em `src/janelas.ts`. Ver o cabeçalho de lá para o porquê.
  const jan = useJanelaFlutuante({
    id: "probe",
    chave: STORAGE_KEY,
    padrao: padraoSonda,
    minW: MIN_W,
    minH: MIN_H,
    // A sonda é a primeira janela da sessão: com `activeWindow` ainda nulo ela
    // vale como focada, senão nasceria atrás de nada.
    focoPadrao: true,
  });

  if (!probe) return null;

  const vento = fmt(probe.windSpeed, 1, " m/s");
  const ventoSec = [
    fmt(probe.windKmH, 0, " km/h"),
    probe.windCardinal,
    probe.windScale ? `${probe.windScale.nome}` : null,
  ].filter(Boolean).join(" · ") || null;

  return (
    <div
      className={`probe ${jan.movendo ? "probe-movendo" : ""} ${jan.focada ? "win-foco" : ""} ${jan.minimizada ? "win-minimizada" : ""}`}
      style={jan.estilo}
      onPointerDownCapture={jan.trazerParaFrente}
      role="dialog"
      aria-label={`Sonda ${probe.place}`}
    >
      <header
        className="probe-header"
        onPointerDown={jan.iniciarArrasto(MOVER)}
        onDoubleClick={jan.alternarMinimizar}
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
            // O BOTÃO USA O MESMO LUGAR DE FÁBRICA que a montagem.
            //
            // Ele cravava outra caixa aqui — 420x460 em x = W−450 — enquanto a
            // janela nascia com 450x410 em x = W−480. Duas "posições padrão"
            // para a mesma janela, e resetar a movia para um lugar onde ela
            // nunca tinha estado.
            onClick={(e) => { e.stopPropagation(); jan.recolocar(); }}
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
              jan.alternarMinimizar();
            }}
            title={jan.minimizada ? "Expandir janela" : "Minimizar janela"}
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

      {!jan.minimizada && (
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
            {/* O RECORTE 3D é a resposta para "como é AQUI", e o globo não
                consegue dar: ali a câmera orbita o centro da Terra e a vertical
                cabe em milésimos de raio. Ver src/bloco/cena.ts. */}
            <button
              type="button"
              className="probe-analise"
              onClick={() => abrirBloco(probe.lat, probe.lng)}
            >
              <span>Recorte 3D da região</span>
            </button>
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
      <div className="win-puxa win-puxa-n" onPointerDown={jan.iniciarArrasto("c")} />
      <div className="win-puxa win-puxa-s" onPointerDown={jan.iniciarArrasto("b")} />
      <div className="win-puxa win-puxa-e" onPointerDown={jan.iniciarArrasto("d")} />
      <div className="win-puxa win-puxa-w" onPointerDown={jan.iniciarArrasto("e")} />
      <div className="win-puxa win-puxa-nw" onPointerDown={jan.iniciarArrasto("ec")} />
      <div className="win-puxa win-puxa-ne" onPointerDown={jan.iniciarArrasto("dc")} />
      <div className="win-puxa win-puxa-sw" onPointerDown={jan.iniciarArrasto("eb")} />
      <div className="win-puxa win-puxa-se" onPointerDown={jan.iniciarArrasto("db")} />
    </div>
  );
};
