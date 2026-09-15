// src/components/probe/ProbePanel.tsx
// -----------------------------------------------------------------------------
// SONDA — o que se sabe sobre um ponto do planeta
// -----------------------------------------------------------------------------
// A versão anterior era uma lista de dez linhas IDÊNTICAS. Temperatura do ar e
// elevação barométrica com o mesmo tamanho de fonte, o mesmo ícone cinza, a
// mesma barrinha embaixo — e a barrinha marcava a posição numa escala ABSOLUTA
// fixa: a de temperatura ia de −40 a 50, igual no Saara e na Groenlândia.
//
// O problema não era estético. Uma lista sem hierarquia obriga a pessoa a ler
// as dez linhas para descobrir qual importa, e a barra em escala global fazia
// 27 °C parecer o mesmo em Cuiabá e em Ushuaia. A tela mostrava medições e não
// respondia a única pergunta que se faz ao clicar num ponto: isso é muito?
//
// O QUE MUDOU
//
// 1. AGORA — a medição do instante, com hierarquia: a temperatura em corpo
//    grande, o vento em seguida, e o resto numa grade densa. Cor continua
//    valendo (cor é dado), mas as barras de escala absoluta saíram, porque
//    posição numa régua global não era informação sobre este lugar.
//
// 2. HOJE CONTRA 1991–2020 — o bloco novo. Máxima, mínima, chuva e vento do dia
//    confrontados com a distribuição dos últimos trinta anos NESTE ponto e
//    NESTA data. A régua de cada barra é a história do lugar; o marcador é
//    hoje. Ver src/probe/comparacao.ts para o porquê de cada escolha, e
//    src/anomalia.ts para o porquê de percentil em vez de desvio-padrão.
// -----------------------------------------------------------------------------

import React from "react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import { useBlocoStore } from "../../store/blocoStore";
import {
  Thermometer, Wind, Droplets, Compass, BarChart2, Activity,
  Cloud, Sun, ArrowUpRight, Mountain, Gauge, GripVertical, X, Minus, RotateCcw,
  History,
} from "lucide-react";
import {
  corDe,
  TEMPERATURA, ORVALHO, VENTO, RAJADA, UMIDADE, PRESSAO, CHUVA, NUVEM, UV, ELEVACAO,
  type Parada,
} from "../../probe/escalas";
import { montarPainel, frasePainel, type Comparacao } from "../../probe/comparacao.ts";
import { useClimatologia } from "../../probe/useClimatologia.ts";
import { useFonte } from "../../dados/usarFonte.ts";

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
  // Mais alta que antes: o bloco de anomalia é conteúdo novo, e nascer com
  // rolagem escondendo justamente a parte que responde "isso é muito?" seria
  // desfazer o motivo de ela existir.
  const W = typeof window !== "undefined" ? window.innerWidth : 1200;
  const H = typeof window !== "undefined" ? window.innerHeight : 900;
  return { x: Math.max(20, W - 500), y: 80, w: 470, h: Math.min(620, Math.max(420, H - 140)) };
}

/**
 * Uma célula da grade do instante.
 *
 * Sem barra. A barra que existia aqui mostrava a posição numa escala absoluta
 * fixa e por isso era igual em qualquer lugar do planeta — a comparação com o
 * lugar mora no bloco de baixo, onde há uma referência de verdade.
 */
const Celula: React.FC<{
  icone: React.ReactNode; rotulo: string; valor: string | null;
  secundario?: string | null; bruto?: number | null; escala?: readonly Parada[];
}> = ({ icone, rotulo, valor, secundario, bruto, escala }) => {
  const cor = escala ? corDe(escala, bruto) : null;
  return (
    <div className={`pcel ${valor == null ? "pcel-vazio" : ""}`}>
      <span className="pcel-rot">
        <span className="pcel-ico" style={cor ? { color: cor } : undefined}>{icone}</span>
        {rotulo}
      </span>
      {valor == null ? (
        <span className="pcel-sem" title="A fonte não reportou este valor para este ponto e hora">
          sem dado
        </span>
      ) : (
        <strong className="pcel-val" style={cor ? { color: cor } : undefined}>
          {valor}
          {secundario && <small>{secundario}</small>}
        </strong>
      )}
    </div>
  );
};

/**
 * Uma linha do bloco de anomalia.
 *
 * A régua é a distribuição de 1991–2020 DAQUELE ponto para ESTA data, em
 * unidade: a banda clara é o intervalo usual (p10–p90), o traço fino é a
 * mediana, o ponto é hoje. Quando o valor de hoje falta, a régua continua
 * desenhada — a história do lugar não deixou de existir por a previsão diária
 * não ter coberto o ponto —, só não há marcador.
 */
const LinhaNormal: React.FC<{ c: Comparacao }> = ({ c }) => {
  const num = (v: number) => v.toFixed(c.casas);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

  return (
    <div className={`pnl ${c.pos == null ? "pnl-vazio" : ""}`}>
      <div className="pnl-topo">
        <span className="pnl-rot">{c.rotulo}</span>
        {c.valor == null ? (
          <span className="pnl-sem">sem dado de hoje</span>
        ) : (
          <strong className="pnl-val" style={c.cor ? { color: c.cor } : undefined}>
            {num(c.valor)} <small>{c.unidade}</small>
          </strong>
        )}
      </div>

      {c.regua && (
        <div className="pnl-eixo">
          <small className="pnl-lim">{num(c.regua.min)}</small>
          <span
            className="pnl-regua"
            title={`Entre ${num(c.regua.min)} e ${num(c.regua.max)} ${c.unidade} nos últimos 30 anos nesta data. Mediana ${num(c.regua.p50)}.`}
          >
            {c.banda && (
              <span
                className="pnl-banda"
                style={{ left: pct(c.banda.de), width: pct(Math.max(0, c.banda.ate - c.banda.de)) }}
                aria-hidden="true"
              />
            )}
            <span
              className="pnl-mediana"
              style={{ left: pct((c.regua.p50 - c.regua.min) / (c.regua.max - c.regua.min)) }}
              aria-hidden="true"
            />
            {c.pos != null && (
              <span
                className="pnl-marca"
                style={{ left: pct(c.pos), background: c.cor ?? "var(--ink)" }}
                aria-hidden="true"
              />
            )}
          </span>
          <small className="pnl-lim">{num(c.regua.max)}</small>
        </div>
      )}

      <p className="pnl-leitura" style={c.cor ? { color: c.cor } : undefined}>
        {c.leitura.texto}
      </p>
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

  // O hook roda ANTES do `if (!probe)` — a ordem dos hooks não pode depender
  // de haver sonda aberta, senão o React perde o pareamento entre renders.
  const clima = useClimatologia(probe?.lat ?? null, probe?.lng ?? null);

  // O CONTEXTO QUE FALTAVA. "Percentil 92 para esta data" é uma afirmação
  // correta e solitária: ela não diz se o ano inteiro está torto. O ONI diz.
  //
  // Ele é global e não depende do ponto, então a validade é longa e a busca é
  // compartilhada com qualquer outra parte da tela que precise dela.
  const oni = useFonte<{ frase: string | null; nota: string }>({
    id: "oni",
    rotulo: "Fase do ENSO",
    url: "/api/oni",
    validadeMs: 6 * 3600_000,
  });
  const painel = montarPainel(clima.dado);
  const frase = frasePainel(painel);

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
          {/* ---- AGORA: a medição do instante, com hierarquia --------------- */}
          <section className="pb-agora">
            <div className="pb-heroi">
              <div className="pb-heroi-temp">
                <span className="pb-heroi-rot">
                  <Thermometer {...ico} /> Ar a 2 m
                </span>
                {probe.temperature == null ? (
                  <span className="pcel-sem">sem temperatura</span>
                ) : (
                  <>
                    <strong style={{ color: corDe(TEMPERATURA, probe.temperature) ?? undefined }}>
                      {probe.temperature.toFixed(1)}
                      <span className="pb-heroi-un">°C</span>
                    </strong>
                    <small>{fmt(probe.temperatureF, 0, " °F")}</small>
                  </>
                )}
              </div>
              <div className="pb-heroi-vento">
                <span className="pb-heroi-rot">
                  <Wind {...ico} /> Vento a 10 m
                </span>
                {vento == null ? (
                  <span className="pcel-sem">sem dado</span>
                ) : (
                  <>
                    <strong style={{ color: corDe(VENTO, probe.windSpeed) ?? undefined }}>{vento}</strong>
                    {ventoSec && <small>{ventoSec}</small>}
                  </>
                )}
              </div>
            </div>

            <div className="pb-grade">
              <Celula icone={<Gauge {...ico} />} rotulo="Rajada"
                valor={fmt(probe.windGustMs, 1, " m/s")} secundario={fmt(probe.windGustKmH, 0, " km/h")}
                bruto={probe.windGustMs} escala={RAJADA} />
              <Celula icone={<Droplets {...ico} />} rotulo="Ponto de orvalho"
                valor={fmt(probe.dewPoint, 1, " °C")} bruto={probe.dewPoint} escala={ORVALHO} />
              <Celula icone={<Compass {...ico} />} rotulo="Umidade"
                valor={fmt(probe.humidity, 0, " %")} bruto={probe.humidity} escala={UMIDADE} />
              <Celula icone={<Activity {...ico} />} rotulo="Precipitação"
                valor={fmt(probe.precipitation, 1, " mm/h")} bruto={probe.precipitation} escala={CHUVA} />
              <Celula icone={<Cloud {...ico} />} rotulo="Nuvens"
                valor={fmt(probe.cloudCover, 0, " %")} bruto={probe.cloudCover} escala={NUVEM} />
              <Celula icone={<Sun {...ico} />} rotulo="Índice UV"
                valor={fmt(probe.uvIndex, 1, "")} bruto={probe.uvIndex} escala={UV} />
              <Celula icone={<BarChart2 {...ico} />} rotulo="Pressão"
                valor={fmt(probe.pressure, 0, " hPa")} bruto={probe.pressure} escala={PRESSAO} />
              <Celula icone={<Mountain {...ico} />} rotulo="Elevação"
                valor={fmt(probe.elevationM, 0, " m")} bruto={probe.elevationM} escala={ELEVACAO} />
            </div>
          </section>

          {/* ---- HOJE CONTRA A NORMAL --------------------------------------
              O bloco que responde "isso é muito?". Ele tem estado próprio: a
              sonda não espera trinta anos de série para mostrar a medição do
              instante. */}
          <section className="pb-normal">
            <h3 className="pb-tit">
              <History size={13} strokeWidth={1.6} aria-hidden="true" />
              Hoje contra {painel?.referencia ?? "1991–2020"}
            </h3>

            {clima.carregando && (
              <p className="pb-estado" role="status">Buscando trinta anos de série para este ponto…</p>
            )}

            {clima.erro && (
              <p className="pb-estado pb-estado-falha" role="alert">
                Sem referência histórica: {clima.erro}. As medições acima continuam válidas;
                nada foi estimado para preencher o lugar dela.
              </p>
            )}

            {/* O ÍNDICE, E NUNCA O EFEITO. A relação entre ENSO e clima local
                muda de sinal dentro do próprio Brasil — El Niño costuma trazer
                chuva ao Sul e seca ao Nordeste. Escrever "por causa do El Niño"
                aqui seria falso em metade do país, então a linha diz em que
                fase o Pacífico está e para. */}
            {oni.dado?.frase && (
              <p className="pb-enso" title={oni.dado.nota}>{oni.dado.frase}</p>
            )}

            {painel && (
              <>
                {frase && (
                  <p
                    className="pb-frase"
                    style={painel.manchete?.cor ? { color: painel.manchete.cor } : undefined}
                  >
                    {frase}
                  </p>
                )}
                <div className="pnls">
                  {painel.linhas.map((c) => <LinhaNormal key={c.id} c={c} />)}
                </div>
                <p className="probe-fonte">
                  Normal de {painel.referencia} · {painel.anos} anos · janela de ±{painel.janelaDias} dias
                  no dia do ano · {painel.fonteNormal}
                  {painel.fonteHoje && ` · agregado de hoje: ${painel.fonteHoje}`}
                </p>
              </>
            )}
          </section>

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
