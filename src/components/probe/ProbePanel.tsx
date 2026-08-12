// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// SONDA — leitura pontual das condições de superfície.
//
// SOBRE AS CORES, E SOBRE EU TER ERRADO DUAS VEZES NO MESMO LUGAR
//
// Primeira versão: dez matizes do Tailwind, um por linha. Cor decorativa, sem
// relação com o valor.
//
// Eu "consertei" removendo TODAS as cores, com o argumento de que cor é dado e
// dez cores fixas não são dado. O argumento estava certo e a conclusão estava
// errada: um painel todo cinza obriga a ler dez números e comparar de cabeça
// com faixas que só um meteorologista tem decoradas. Tirei a leitura junto com
// o enfeite.
//
// Agora a cor SAI DO VALOR (`src/probe/escalas.ts`). 38 °C fica quente, −5 °C
// fica frio, e o vento usa a MESMA rampa do mapa — se a partícula está branca
// no globo, o número aqui também está. Cada linha tem uma barrinha mostrando
// onde o valor cai na faixa, porque cor sozinha diz "onde nesta escala" mas não
// diz qual é a escala.
//
// E o painel cresceu: era estreito demais para números com unidade, secundário
// e classificação na mesma linha.
// -----------------------------------------------------------------------------

import React from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import {
  Thermometer, Wind, Droplets, Compass, BarChart2, Activity,
  Cloud, Sun, ArrowUpRight, Mountain, Gauge,
} from "lucide-react";
import {
  corDe, posicaoNaFaixa, type Parada,
  TEMPERATURA, ORVALHO, VENTO, RAJADA, UMIDADE, PRESSAO, CHUVA, NUVEM, UV, ELEVACAO,
} from "../../probe/escalas";

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
  /** o número cru, para a cor e a barra saírem do VALOR e não da linha */
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

      {/* A barra é o que transforma a cor de enfeite em leitura: ela mostra
          ONDE na faixa o valor caiu, não só que ele é "quente" ou "frio". */}
      {pos != null && cor && (
        <span className="prow-faixa" aria-hidden="true">
          <span className="prow-marca" style={{ left: `${pos * 100}%`, background: cor }} />
        </span>
      )}
    </div>
  );
};

const ico = { size: 14, strokeWidth: 1.6 } as const;

export const ProbePanel: React.FC = () => {
  const { probe, clearProbe } = useProbeStore();
  const { setAnalysisTarget } = useUIStore();

  if (!probe) return null;

  const vento = fmt(probe.windSpeed, 1, " m/s");
  const ventoSec = [
    fmt(probe.windKmH, 0, " km/h"),
    probe.windCardinal,
    probe.windScale ? `${probe.windScale.nome}` : null,
  ].filter(Boolean).join(" · ") || null;

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
        <Linha icone={<Thermometer {...ico} />} rotulo="Temperatura (2 m)"
          valor={fmt(probe.temperature, 1, " °C")} secundario={fmt(probe.temperatureF, 0, " °F")}
          bruto={probe.temperature} escala={TEMPERATURA} />

        <Linha icone={<Droplets {...ico} />} rotulo="Ponto de orvalho"
          valor={fmt(probe.dewPoint, 1, " °C")} bruto={probe.dewPoint} escala={ORVALHO} />

        {/* Vento e rajada juntos e em destaque: são as duas grandezas de
            segurança, e separá-las faz alguém ler uma achando que leu a outra. */}
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

        {/* Elevação é DERIVADA da pressão por barometria. Sem pressão medida
            não há elevação — e "0 m" seria uma afirmação de nível do mar. */}
        <Linha icone={<Mountain {...ico} />} rotulo="Elevação (barométrica)"
          valor={fmt(probe.elevationM, 0, " m")} bruto={probe.elevationM} escala={ELEVACAO} />
      </div>

      <button
        className="probe-analise"
        onClick={() => setAnalysisTarget({ lat: probe.lat, lng: probe.lng, place: probe.place })}
      >
        <span>Análise completa · séries e sondagem</span>
        <ArrowUpRight size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>

      {probe.windNotice && <p className="probe-aviso" role="note">{probe.windNotice}</p>}
      {probe.source && <p className="probe-fonte">{probe.source}</p>}
      {probe.sourceNote && <p className="probe-fonte">{probe.sourceNote}</p>}
    </div>
  );
};
