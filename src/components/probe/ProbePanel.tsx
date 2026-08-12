// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// SONDA — leitura pontual das condições de superfície.
//
// DOIS DEFEITOS DE CONTEÚDO CORRIGIDOS AQUI (não eram de estilo)
//
//   1. HEMISFÉRIO CRAVADO NO TEXTO
//      A linha era `{lat.toFixed(4)}°S {lng.toFixed(4)}°O`. Londres saía como
//      "51.50°S -0.13°O" — hemisfério errado E sinal duplicado. Todo ponto ao
//      norte do equador ou a leste de Greenwich exibia uma coordenada falsa,
//      com quatro casas decimais de aparente precisão.
//
//   2. AUSÊNCIA VIRANDO AFIRMAÇÃO
//      `{probe.elevationM ?? 0}m` transformava "sem dado" em "0 m" — nível do
//      mar. O servidor foi corrigido para devolver `null` quando não há pressão
//      medida; a view desfazia isso a três linhas da tela.
//
// SOBRE AS CORES
// Havia dez matizes diferentes, um por linha, vindos da paleta do Tailwind.
// Isso viola a regra do sistema: cor é DADO, não enfeite. Dez cores para dez
// grandezas não informa nada — só compete com o mapa, onde cor significa
// medida. Aqui a hierarquia é peso e alinhamento; o ícone é neutro.
// -----------------------------------------------------------------------------

import React from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import {
  Thermometer, Wind, Droplets, Compass, BarChart2, Activity,
  Cloud, Sun, ArrowUpRight, Mountain,
} from "lucide-react";

/** Ausência é traço, e o traço tem título explicando. Nunca zero, nunca vazio. */
const fmt = (v: number | null | undefined, casas: number, unidade: string) =>
  v == null || !Number.isFinite(v) ? null : `${v.toFixed(casas)}${unidade}`;

/** grau com hemisfério derivado do SINAL, não presumido */
function coord(lat: number, lng: number) {
  const la = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "L" : "O"}`;
  return `${la}  ${lo}`;
}

interface LinhaProps {
  icone: React.ReactNode;
  rotulo: string;
  valor: string | null;
  secundario?: string | null;
}

const Linha: React.FC<LinhaProps> = ({ icone, rotulo, valor, secundario }) => (
  <div className={`prow ${valor == null ? "prow-vazio" : ""}`}>
    <span className="prow-rot">
      {icone}
      {rotulo}
    </span>
    {valor == null ? (
      <span className="prow-sem" title="A fonte não reportou este valor para este ponto e hora">
        sem dado
      </span>
    ) : (
      <strong className="prow-val">
        {valor}
        {secundario && <small>{secundario}</small>}
      </strong>
    )}
  </div>
);

const ico = { size: 13, strokeWidth: 1.5 } as const;

export const ProbePanel: React.FC = () => {
  const { probe, clearProbe } = useProbeStore();
  const { setAnalysisTarget } = useUIStore();

  if (!probe) return null;

  // -------------------------------------------------------------------------
  // VENTO SUSTENTADO E RAJADA SÃO GRANDEZAS DIFERENTES.
  //
  // A tela mostrava só "Vento (10 m)" com o valor SUSTENTADO — média da hora.
  // Quando o noticiário diz "ventos de 100 km/h no Rio", está falando de
  // RAJADA. Sobre terra o fator típico é 1,5 a 2,0, então os dois números nunca
  // batem, e a diferença parece erro de unidade quando é diferença de grandeza.
  //
  // Numa plataforma de monitoramento, a rajada é a variável de segurança: é ela
  // que derruba árvore, telhado e poste. Ela vem agora em destaque igual.
  // -------------------------------------------------------------------------
  const vento = fmt(probe.windSpeed, 1, " m/s");
  const ventoSec = [
    fmt(probe.windKmH, 0, " km/h"),
    probe.windCardinal,
    probe.windScale ? `${probe.windScale.nome} (${probe.windScale.grau} Bft)` : null,
  ].filter(Boolean).join(" · ") || null;

  const rajada = fmt(probe.windGustMs, 1, " m/s");
  const rajadaSec = fmt(probe.windGustKmH, 0, " km/h");

  return (
    <div className="probe" role="region" aria-label={`Condições em ${probe.place}`}>
      <div className="phead">
        <div className="phead-txt">
          <strong>{probe.place}</strong>
          <span className="pcoord">{coord(probe.lat, probe.lng)}</span>
        </div>
        <button onClick={clearProbe} className="probe-fechar" aria-label="Limpar ponto selecionado">×</button>
      </div>

      <div className="prows">
        <Linha
          icone={<Thermometer {...ico} />} rotulo="Temperatura (2 m)"
          valor={fmt(probe.temperature, 1, " °C")}
          secundario={fmt(probe.temperatureF, 0, " °F")}
        />
        <Linha
          icone={<Droplets {...ico} />} rotulo="Ponto de orvalho"
          valor={fmt(probe.dewPoint, 1, " °C")}
        />
        <Linha
          icone={<Wind {...ico} />} rotulo="Vento (10 m)"
          valor={vento} secundario={ventoSec}
        />
        {/* A rajada logo abaixo do sustentado, com o mesmo peso: separá-las
            em lugares diferentes da tela é o que faz alguém ler uma e achar
            que leu a outra. */}
        <Linha
          icone={<Wind {...ico} />} rotulo="Rajada (10 m)"
          valor={rajada} secundario={rajadaSec}
        />
        <Linha
          icone={<Compass {...ico} />} rotulo="Umidade relativa"
          valor={fmt(probe.humidity, 0, " %")}
        />
        <Linha
          icone={<BarChart2 {...ico} />} rotulo="Pressão à superfície"
          valor={fmt(probe.pressure, 0, " hPa")}
        />
        <Linha
          icone={<Activity {...ico} />} rotulo="Precipitação"
          valor={fmt(probe.precipitation, 1, " mm/h")}
        />
        <Linha
          icone={<Cloud {...ico} />} rotulo="Cobertura de nuvens"
          valor={fmt(probe.cloudCover, 0, " %")}
        />
        <Linha
          icone={<Sun {...ico} />} rotulo="Índice UV"
          valor={fmt(probe.uvIndex, 1, "")}
        />
        {/* Elevação é DERIVADA da pressão por barometria. Sem pressão medida
            não há elevação — e "0 m" seria uma afirmação de nível do mar. */}
        <Linha
          icone={<Mountain {...ico} />} rotulo="Elevação (barométrica)"
          valor={fmt(probe.elevationM, 0, " m")}
        />
      </div>

      <button
        className="probe-analise"
        onClick={() => setAnalysisTarget({ lat: probe.lat, lng: probe.lng, place: probe.place })}
      >
        <span>Análise completa · séries e sondagem</span>
        <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {/* ---------------------------------------------------------------
          O AVISO NÃO É RODAPÉ. Ele fica antes da procedência e com marca de
          alerta porque é a informação que impede alguém de tomar decisão
          operacional com um número de modelo.

          Nenhuma correção de fonte resolve isto: modelo global não resolve
          microexplosão, canalização urbana nem efeito de relevo. A estação da
          praia mede o que a célula de 11 km não pode conter.
          --------------------------------------------------------------- */}
      {probe.windNotice && (
        <p className="probe-aviso" role="note">{probe.windNotice}</p>
      )}

      {probe.source && <p className="probe-fonte">{probe.source}</p>}
      {probe.sourceNote && <p className="probe-fonte">{probe.sourceNote}</p>}
    </div>
  );
};
