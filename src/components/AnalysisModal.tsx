// src/components/AnalysisModal.tsx
// -----------------------------------------------------------------------------
// ANÁLISE DO PONTO — série histórica, perfil vertical e dispersão entre modelos.
//
// ESTA TELA ESTAVA INTEIRAMENTE QUEBRADA, DE TRÊS MANEIRAS DIFERENTES.
//
//   1. A ABA DE SÉRIE NUNCA FUNCIONOU. O componente exigia `{ ok, data }` e a
//      rota devolvia `{ stats, series }`. Não havia interseção: caía sempre em
//      "Formato de dados inválido". O seletor de 1 mês a 10 anos mandava
//      `?range=`, e a rota lia `?days=`, com teto de 14.
//
//   2. O QUE SOBRAVA ERA INVENTADO. Sem resposta da fonte, a rota fabricava a
//      série toda — temperatura por `25 − |lat|·0,35 + sen(i/4)·3`, umidade por
//      cosseno, e os próprios carimbos de tempo — e devolvia com status 200. A
//      sondagem vinha de uma reta em pressão. A "comparação GFS vs ECMWF vs
//      ICON" era um modelo só, com +0,4 e −0,2 somados.
//
//   3. O GRÁFICO MENTIA SOBRE O PRÓPRIO EIXO. Filtrava os nulos e espaçava o
//      resto por índice; a legenda colava o valor mínimo na data do primeiro
//      ponto. Detalhado em `src/analysis/series.ts`.
//
// E o botão de exportar CSV levava tudo isso para dentro de uma planilha.
//
// ---------------------------------------------------------------------------
// A ABA DE IA FOI REMOVIDA
// Ela dizia "ONNX Runtime · Inferência Neural Realizada com Sucesso" e exibia
// `confidence_score ?? 0.94` — uma confiança de 94% inventada quando o modelo
// não reportava nenhuma. O microserviço que ela chamava
// (`pipeline/model_server_template.py`, em localhost:8000) é um template que
// não existe treinado. Uma aba que anuncia inferência neural bem-sucedida sobre
// um servidor ausente é a afirmação mais forte da tela inteira, e era a única
// sem nenhum dado atrás. Quando houver modelo, ela volta — com a métrica que o
// modelo realmente reportar.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Calendar, Download, Layers, GitCompare, AlertTriangle } from "lucide-react";
import { useDialog } from "../hooks/useDialog";
import { SeriesChart } from "./analysis/SeriesChart";
import { ProfileChart, type Nivel } from "./analysis/ProfileChart";
import { SpreadChart, type Modelo, type Disp } from "./analysis/SpreadChart";
import { paraCSV, baixar, type SerieDiaria } from "../analysis/csv";

interface AnalysisProps { lat: number; lng: number; place: string; onClose: () => void; }

type Aba = "serie" | "perfil" | "modelos";
type Janela = "1m" | "2m" | "3m" | "6m" | "1y" | "5y" | "10y";

const JANELAS: { id: Janela; rotulo: string }[] = [
  { id: "1m", rotulo: "1 mês" }, { id: "3m", rotulo: "3 meses" }, { id: "6m", rotulo: "6 meses" },
  { id: "1y", rotulo: "1 ano" }, { id: "5y", rotulo: "5 anos" }, { id: "10y", rotulo: "10 anos" },
];

interface Resumo { n: number; ausentes: number; min: number | null; max: number | null; media: number | null; desvio: number | null; soma: number | null; unidade: string; rotulo: string; }
interface Serie extends SerieDiaria { resumos: Record<string, Resumo>; nota: string; place?: string | null; }
interface Sondagem { instante: string; perfil: Nivel[]; camadas: { de: number; ate: number; gradiente: number | null; classe: string | null }[]; ausentes: number; fonte: string; nota: string; derivados: Record<string, string>; }
interface Comparacao { tempo: string[]; modelos: Modelo[]; variaveis: { id: string; rotulo: string; unidade: string; casas: number }[]; serie: Record<string, Record<string, (number | null)[] | null>>; espalhamento: Record<string, { porHora: Disp[]; maiorAmplitude: number | null; quando: string | null; amplitudeMedia: number | null; modelos: string[] }>; avisos: string[]; fonte: string; nota: string; }

/** Uma falha explicada vale mais que um gráfico plausível. */
function Falha({ msg, codigo, aoTentar }: { msg: string; codigo?: string; aoTentar: () => void }) {
  return (
    <div className="an-falha" role="alert">
      <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
      <div>
        <strong>Não foi possível obter estes dados.</strong>
        <p>{msg}</p>
        {codigo && <code>{codigo}</code>}
        <p className="an-falha-nota">Nada foi estimado para preencher o lugar deles.</p>
      </div>
      <button className="h-btn" onClick={aoTentar}>Tentar de novo</button>
    </div>
  );
}

function useRota<T>(url: string | null, dep: unknown[]) {
  const [dado, setDado] = useState<T | null>(null);
  const [erro, setErro] = useState<{ msg: string; codigo?: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!url) return;
    let vivo = true;
    setCarregando(true); setErro(null);
    fetch(url)
      .then(async (r) => {
        // A mensagem do servidor é a informação útil. Reduzir tudo a
        // "HTTP 502" jogava fora o motivo — e o motivo é o que diz se vale
        // tentar outro ponto, outra janela, ou esperar.
        const j = await r.json().catch(() => null);
        if (!r.ok || j?.ok === false) {
          throw Object.assign(new Error(j?.error ?? `HTTP ${r.status}`), { codigo: j?.code });
        }
        return j as T;
      })
      .then((j) => { if (vivo) setDado(j); })
      .catch((e: Error & { codigo?: string }) => {
        if (vivo) { setDado(null); setErro({ msg: e.message, codigo: e.codigo }); }
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dep, tentativa]);

  return { dado, erro, carregando, repetir: () => setTentativa((t) => t + 1) };
}

const grau = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;

export default function AnalysisModal({ lat, lng, place, onClose }: AnalysisProps) {
  const [aba, setAba] = useState<Aba>("serie");
  const [janela, setJanela] = useState<Janela>("1y");

  // Foco preso: o modal cobre a tela. Deixar o Tab escapar para o globo faria
  // a pessoa navegar por um conteúdo que ela não consegue ver.
  const ref = useDialog<HTMLDivElement>({ aberto: true, aoFechar: onClose, prender: true });

  const q = `lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`;
  const serie = useRota<Serie>(
    aba === "serie" ? `/api/analysis/timeseries?${q}&range=${janela}` : null, [q, janela, aba]);
  const sond = useRota<Sondagem>(
    aba === "perfil" ? `/api/analysis/sounding?${q}` : null, [q, aba]);
  const comp = useRota<Comparacao>(
    aba === "modelos" ? `/api/analysis/compare?${q}&horas=48` : null, [q, aba]);

  const exportar = () => {
    if (!serie.dado) return;
    baixar(
      paraCSV(serie.dado, { place, lat, lng }),
      `observatorio_${janela}_${lat.toFixed(2)}_${lng.toFixed(2)}.csv`
    );
  };

  const abas: { id: Aba; rotulo: string; icone: React.ReactNode }[] = [
    { id: "serie", rotulo: "Série histórica", icone: <Calendar size={13} strokeWidth={1.5} /> },
    { id: "perfil", rotulo: "Perfil vertical", icone: <Layers size={13} strokeWidth={1.5} /> },
    { id: "modelos", rotulo: "Dispersão entre modelos", icone: <GitCompare size={13} strokeWidth={1.5} /> },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal-content" role="dialog" aria-modal="true"
        aria-label={`Análise de ${place}`} onClick={(e) => e.stopPropagation()}>

        <header className="modal-header">
          <div>
            <h2>Análise do ponto</h2>
            <p className="subtext">{place} · {grau(lat, "N", "S")}  {grau(lng, "L", "O")}</p>
          </div>
          <div className="an-acoes">
            <button className="h-btn" onClick={exportar} disabled={!serie.dado}
              title={serie.dado ? "Baixar a série diária em CSV" : "Disponível quando a série carregar"}>
              <Download size={13} strokeWidth={1.5} aria-hidden="true" /> Exportar CSV
            </button>
            <button className="close-btn" onClick={onClose} aria-label="Fechar análise">×</button>
          </div>
        </header>

        <div className="tabs" role="tablist">
          {abas.map((a) => (
            <button key={a.id} role="tab" aria-selected={aba === a.id}
              className={aba === a.id ? "active" : ""} onClick={() => setAba(a.id)}>
              {a.icone} {a.rotulo}
            </button>
          ))}
        </div>

        {aba === "serie" && (
          <div className="an-janela" role="radiogroup" aria-label="Janela temporal">
            <span className="an-janela-rot">janela</span>
            {JANELAS.map((j) => (
              <button key={j.id} role="radio" aria-checked={janela === j.id}
                className={`h-btn ${janela === j.id ? "primary-h-btn" : ""}`}
                onClick={() => setJanela(j.id)}>{j.rotulo}</button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {/* ---------------------------------------------------- série ---- */}
          {aba === "serie" && (
            serie.carregando ? <Carregando o="a série diária" /> :
            serie.erro ? <Falha {...serie.erro} aoTentar={serie.repetir} /> :
            serie.dado ? (
              <section className="tab-pane">
                <Resumos d={serie.dado} />
                {serie.dado.variaveis
                  .filter((v) => v !== "wind_direction_10m_dominant")
                  .map((v) => (
                    <SeriesChart key={v}
                      tempo={serie.dado!.serie.time}
                      valores={(serie.dado!.serie[v] as (number | null)[]) ?? []}
                      rotulo={serie.dado!.rotulos[v]}
                      unidade={serie.dado!.unidades[v]}
                      casas={serie.dado!.unidades[v] === "mm" ? 1 : 1}
                    />
                  ))}
                <Procedencia fonte={serie.dado.fonte} nota={serie.dado.nota}
                  extra={serie.dado.lacunas} />
              </section>
            ) : null
          )}

          {/* ---------------------------------------------------- perfil --- */}
          {aba === "perfil" && (
            sond.carregando ? <Carregando o="o perfil vertical" /> :
            sond.erro ? <Falha {...sond.erro} aoTentar={sond.repetir} /> :
            sond.dado ? (
              <section className="tab-pane">
                <p className="an-quando">
                  Sondagem de <strong>{new Date(sond.dado.instante).toISOString().slice(0, 16).replace("T", " ")} UTC</strong>
                  {sond.dado.ausentes > 0 && ` · ${sond.dado.ausentes} nível(is) sem dado`}
                </p>
                <ProfileChart perfil={sond.dado.perfil} />
                <Camadas camadas={sond.dado.camadas} />
                <Procedencia fonte={sond.dado.fonte} nota={sond.dado.nota}
                  extra={Object.values(sond.dado.derivados)} />
              </section>
            ) : null
          )}

          {/* --------------------------------------------------- modelos --- */}
          {aba === "modelos" && (
            comp.carregando ? <Carregando o="as três previsões" /> :
            comp.erro ? <Falha {...comp.erro} aoTentar={comp.repetir} /> :
            comp.dado ? (
              <section className="tab-pane">
                <p className="an-quando">
                  Próximas {comp.dado.tempo.length} horas. A leitura é a <strong>largura da faixa</strong>:
                  onde os três centros divergem, a previsão é menos confiável.
                </p>
                {comp.dado.variaveis.map((v) => (
                  <SpreadChart key={v.id}
                    tempo={comp.dado!.tempo}
                    modelos={comp.dado!.modelos}
                    serie={comp.dado!.serie[v.id]}
                    porHora={comp.dado!.espalhamento[v.id].porHora}
                    rotulo={v.rotulo} unidade={v.unidade} casas={v.casas}
                  />
                ))}
                <Procedencia fonte={comp.dado.fonte} nota={comp.dado.nota} extra={comp.dado.avisos} />
              </section>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const Carregando = ({ o }: { o: string }) => (
  <p className="an-carregando" aria-live="polite">Buscando {o}…</p>
);

/**
 * Resumo com N SEMPRE À VISTA.
 *
 * Uma média de 12 dias e uma média de 3.652 não significam a mesma coisa, e o
 * número sozinho não conta a diferença. A versão anterior mostrava seis
 * números grandes, cada um numa cor do Tailwind, sem nenhuma contagem.
 */
function Resumos({ d }: { d: Serie }) {
  const destaque = ["temperature_2m_mean", "temperature_2m_min", "temperature_2m_max",
    "precipitation_sum", "wind_speed_10m_max"];
  return (
    <div className="stats-cards">
      {destaque.filter((v) => d.resumos[v]).map((v) => {
        const r = d.resumos[v];
        const principal = v === "precipitation_sum" ? r.soma : r.media;
        const legenda = v === "precipitation_sum" ? "acumulado" : "média";
        return (
          <div key={v} className="stat-card">
            <small>{r.rotulo}</small>
            {principal == null ? (
              <strong className="an-sem">sem dado</strong>
            ) : (
              <strong>{principal.toFixed(1)} <span className="an-un">{r.unidade}</span></strong>
            )}
            <p className="an-meta">
              {legenda}
              {r.desvio != null && v !== "precipitation_sum" && ` · σ ${r.desvio.toFixed(2)}`}
              {" · "}n={r.n.toLocaleString("pt-BR")}
              {r.ausentes > 0 && ` (+${r.ausentes} sem dado)`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Estabilidade medida, com o limiar físico dito por extenso. */
function Camadas({ camadas }: { camadas: Sondagem["camadas"] }) {
  const notaveis = camadas.filter((c) => c.classe === "inversão" || c.classe === "superadiabática" || c.classe === "isotérmica");
  if (!notaveis.length) return null;
  return (
    <div className="an-camadas">
      <h3>Camadas notáveis</h3>
      <ul>
        {notaveis.map((c) => (
          <li key={`${c.de}-${c.ate}`}>
            <strong>{c.de}→{c.ate} hPa</strong>
            <span className={`an-classe an-classe-${c.classe === "inversão" ? "inv" : c.classe === "superadiabática" ? "sup" : "iso"}`}>
              {c.classe}
            </span>
            <small>{c.gradiente?.toFixed(2)} °C/km</small>
          </li>
        ))}
      </ul>
      <p className="an-meta">
        Referências: 9,8 °C/km é o gradiente adiabático seco (g/c<sub>p</sub>); gradiente
        negativo é inversão, que tampa a convecção.
      </p>
    </div>
  );
}

function Procedencia({ fonte, nota, extra }: { fonte: string; nota: string; extra?: string[] }) {
  return (
    <footer className="an-proc">
      <p><strong>Fonte:</strong> {fonte}</p>
      <p>{nota}</p>
      {extra?.filter(Boolean).map((e, i) => <p key={i} className="an-proc-extra">{e}</p>)}
    </footer>
  );
}
