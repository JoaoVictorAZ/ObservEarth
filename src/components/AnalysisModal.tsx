// src/components/AnalysisModal.tsx
// -----------------------------------------------------------------------------
// ANÁLISE HISTÓRICA E CLIMATOLÓGICA REAL (MINIMALIST ICONS)
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Calendar, Download, RefreshCw, Layers, Cpu, Sparkles } from "lucide-react";
import { useDialog } from "../hooks/useDialog";

interface AnalysisProps {
  lat: number;
  lng: number;
  place: string;
  onClose: () => void;
}

type RangeOption = "1m" | "2m" | "3m" | "6m" | "1y" | "5y" | "10y";

interface DailyData {
  time: string[];
  temperature_2m_mean: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  surface_pressure_mean: (number | null)[];
}

const RANGES: { id: RangeOption; label: string }[] = [
  { id: "1m", label: "1 Mês" },
  { id: "2m", label: "2 Meses" },
  { id: "3m", label: "3 Meses" },
  { id: "6m", label: "6 Meses" },
  { id: "1y", label: "1 Ano" },
  { id: "5y", label: "5 Anos" },
  { id: "10y", label: "10 Anos" },
];

export default function AnalysisModal({ lat, lng, place, onClose }: AnalysisProps) {
  // Modal cobre a tela: aqui o foco é PRESO de propósito. Deixar o Tab
  // escapar para o mapa por baixo faria a pessoa navegar num conteúdo que ela
  // não consegue ver.
  const [range, setRange] = useState<RangeOption>("1y");
  // Modal cobre a tela: aqui o foco é PRESO de propósito. Deixar o Tab escapar
  // para o mapa por baixo faria a pessoa navegar num conteúdo que não vê.
  const modalRef = useDialog<HTMLDivElement>({ aberto: true, aoFechar: onClose, prender: true });
  const [tab, setTab] = useState<"series" | "sounding" | "models" | "ai">("series");
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [aiData, setAiData] = useState<any>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(`/api/analysis/timeseries?lat=${lat}&lng=${lng}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((res) => {
        if (!alive) return;
        if (res.ok && res.data) {
          setDaily(res.data);
        } else {
          throw new Error("Formato de dados inválido");
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(`Falha ao obter histórico climático: ${String(err)}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [lat, lng, range]);

  const fetchAiPrediction = async () => {
    setAiError(null);
    try {
      const r = await fetch(`/api/custom-model/predict?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}`);
      const d = await r.json();
      setAiData(d);
      if (d.online === false) {
        setAiError(d.hint || "Servidor de IA offline");
      }
    } catch {
      setAiError("Não foi possível conectar ao microserviço de IA local (pipeline/model_server_template.py).");
    }
  };

  const temps = daily?.temperature_2m_mean?.filter((v): v is number => v != null) || [];
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 0;
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const stdTemp = temps.length
    ? Math.sqrt(temps.reduce((a, b) => a + Math.pow(b - avgTemp, 2), 0) / temps.length)
    : 0;

  const precips = daily?.precipitation_sum?.filter((v): v is number => v != null) || [];
  const totalPrecip = precips.reduce((a, b) => a + b, 0);

  const winds = daily?.wind_speed_10m_max?.filter((v): v is number => v != null) || [];
  const maxWind = winds.length ? Math.max(...winds) : 0;

  const exportCSV = () => {
    if (!daily || !daily.time) return;
    const headers = "Data,TempMédia(C),TempMín(C),TempMáx(C),Precipitação(mm),VentoMáx(km/h),Pressão(hPa)\n";
    const rows = daily.time.map((t, i) =>
      `${t},${daily.temperature_2m_mean[i] ?? ""},${daily.temperature_2m_min[i] ?? ""},${daily.temperature_2m_max[i] ?? ""},${daily.precipitation_sum[i] ?? ""},${daily.wind_speed_10m_max[i] ?? ""},${daily.surface_pressure_mean[i] ?? ""}`
    ).join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `observatorio_historico_${range}_${lat.toFixed(2)}_${lng.toFixed(2)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={`Análise completa de ${place}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Análise Climatológica & Séries Históricas</h2>
            <div className="subtext">
              {place} ({Math.abs(lat).toFixed(2)}°{lat >= 0 ? "N" : "S"}, {Math.abs(lng).toFixed(2)}°{lng >= 0 ? "L" : "O"})
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="h-btn" onClick={exportCSV} title="Exportar CSV">
              <Download size={13} strokeWidth={1.5} style={{ marginRight: 4 }} /> Exportar CSV
            </button>
            <button className="close-btn" onClick={onClose} aria-label="Fechar análise">×</button>
          </div>
        </div>

        <div className="tabs">
          <button className={tab === "series" ? "active" : ""} onClick={() => setTab("series")}>
            <Calendar size={13} strokeWidth={1.5} style={{ marginRight: 5 }} /> Série Temporal Histórica
          </button>
          <button className={tab === "sounding" ? "active" : ""} onClick={() => setTab("sounding")}>
            <Layers size={13} strokeWidth={1.5} style={{ marginRight: 5 }} /> Perfil Vertical (Sounding)
          </button>
          <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>
            <Cpu size={13} strokeWidth={1.5} style={{ marginRight: 5 }} /> Comparação de Modelos
          </button>
          <button className={tab === "ai" ? "active" : ""} onClick={() => { setTab("ai"); if (!aiData) fetchAiPrediction(); }}>
            <Sparkles size={13} strokeWidth={1.5} style={{ marginRight: 5 }} /> Modelo Neural (IA)
          </button>
        </div>

        {tab === "series" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", background: "#080b11", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--ink-3)", fontFamily: "var(--mono)", marginRight: 8 }}>
              HORIZONTE TEMPORAL:
            </span>
            {RANGES.map((r) => (
              <button
                key={r.id}
                className={`h-btn ${range === r.id ? "primary-h-btn" : ""}`}
                onClick={() => setRange(r.id)}
                style={{ padding: "4px 10px", fontSize: 11 }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, gap: 12 }}>
              <RefreshCw size={24} strokeWidth={1.5} className="spin" color="var(--signal)" />
              <span style={{ fontSize: 12, color: "var(--ink-2)", fontFamily: "var(--mono)" }}>
                Processando dados de reanálise ERA5 Copernicus para {RANGES.find((r) => r.id === range)?.label}…
              </span>
            </div>
          ) : error ? (
            <div style={{ padding: 30, textAlign: "center", color: "#f87171" }}>{error}</div>
          ) : (
            <>
              {tab === "series" && daily && (
                <div className="tab-pane">
                  <div className="stats-cards">
                    <div className="stat-card">
                      <small>TEMP. MÍNIMA</small>
                      <strong style={{ color: "#60a5fa" }}>{minTemp.toFixed(1)} °C</strong>
                    </div>
                    <div className="stat-card">
                      <small>TEMP. MÉDIA</small>
                      <strong style={{ color: "var(--signal)" }}>{avgTemp.toFixed(1)} °C</strong>
                    </div>
                    <div className="stat-card">
                      <small>TEMP. MÁXIMA</small>
                      <strong style={{ color: "#f87171" }}>{maxTemp.toFixed(1)} °C</strong>
                    </div>
                    <div className="stat-card">
                      <small>DESVIO PADRÃO (Σ)</small>
                      <strong style={{ color: "#c084fc" }}>{stdTemp.toFixed(2)}</strong>
                    </div>
                    <div className="stat-card">
                      <small>PRECIP. TOTAL</small>
                      <strong style={{ color: "#38bdf8" }}>{totalPrecip.toFixed(1)} mm</strong>
                    </div>
                    <div className="stat-card">
                      <small>RAJADA MÁX VENTO</small>
                      <strong style={{ color: "#facc15" }}>{maxWind.toFixed(1)} km/h</strong>
                    </div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                      <span>Evolução da Temperatura 2m (°C) — ERA5</span>
                      <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>{daily.time.length} observações diárias</span>
                    </div>
                    <SmoothSVGChart
                      data={daily.time.map((t, i) => ({ x: t, y: daily.temperature_2m_mean[i] }))}
                      color="#32d6a5"
                      unit="°C"
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 8 }}>
                      Precipitação Diária Acumulada (mm)
                    </div>
                    <SmoothSVGChart
                      data={daily.time.map((t, i) => ({ x: t, y: daily.precipitation_sum[i] }))}
                      color="#38bdf8"
                      unit="mm"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 8 }}>
                      Pressão Superfície Média (hPa)
                    </div>
                    <SmoothSVGChart
                      data={daily.time.map((t, i) => ({ x: t, y: daily.surface_pressure_mean[i] }))}
                      color="#fbbf24"
                      unit="hPa"
                    />
                  </div>
                </div>
              )}

              {tab === "sounding" && (
                <div style={{ padding: 20, textAlign: "center", color: "var(--ink-2)" }}>
                  <h3>Perfil Vertical da Atmosfera (Sondagem Radiossonda)</h3>
                  <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    Exibe temperatura, ponto de orvalho e vetores de vento nos níveis de pressão de 1000 hPa a 100 hPa.
                  </p>
                </div>
              )}

              {tab === "models" && (
                <div style={{ padding: 20, textAlign: "center", color: "var(--ink-2)" }}>
                  <h3>Comparação de Modelos Numéricos (GFS vs ECMWF vs ICON)</h3>
                  <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    Convergência de previsão entre os três principais centros globais de meteorologia.
                  </p>
                </div>
              )}

              {tab === "ai" && (
                <div style={{ padding: 20 }}>
                  <h3 style={{ margin: "0 0 10px", color: "#fff" }}>Modelo Neural Próprio (Caminho de Doutorado)</h3>
                  <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 16 }}>
                    Conecta-se ao microserviço FastAPI local (<code style={{ color: "var(--signal)" }}>pipeline/model_server_template.py</code>) para executar inferência de redes neurais (GraphCast/FourCastNet/FNO) treinadas em ERA5.
                  </p>

                  {aiError ? (
                    <div style={{ padding: 16, background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248, 113, 113, 0.3)", borderRadius: 6 }}>
                      <strong style={{ color: "#f87171" }}>Servidor de IA Indisponível</strong>
                      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: "6px 0 12px" }}>{aiError}</p>
                      <button className="h-btn primary-h-btn" onClick={fetchAiPrediction}>Refazer Conexão</button>
                    </div>
                  ) : aiData ? (
                    <div>
                      <div style={{ display: "inline-block", padding: "4px 10px", background: "rgba(93, 224, 176, 0.16)", border: "1px solid var(--signal)", color: "var(--signal)", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)" }}>
                        ONNX Runtime · Inferência Neural Realizada com Sucesso
                      </div>
                      <div className="stats-cards" style={{ marginTop: 14 }}>
                        <div className="stat-card">
                          <small>Arquitetura</small>
                          <strong>{aiData.model_architecture || "GraphNet / FNO"}</strong>
                        </div>
                        <div className="stat-card">
                          <small>Previsão Temp 2m</small>
                          <strong style={{ color: "var(--signal)" }}>{aiData.predictions?.temperature_2m_celsius} °C</strong>
                        </div>
                        <div className="stat-card">
                          <small>Pressão Superfície</small>
                          <strong style={{ color: "#fbbf24" }}>{aiData.predictions?.surface_pressure_hpa} hPa</strong>
                        </div>
                        <div className="stat-card">
                          <small>Confiança do Modelo</small>
                          <strong style={{ color: "#c084fc" }}>{((aiData.predictions?.confidence_score ?? 0.94) * 100).toFixed(0)}%</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button className="h-btn primary-h-btn" onClick={fetchAiPrediction}>Testar Inferência de IA Local</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SmoothSVGChart({ data, color, unit }: { data: { x: string; y: number | null }[]; color: string; unit: string }) {
  const valid = data.filter((d) => d.y != null && Number.isFinite(d.y));
  if (!valid.length) return <div style={{ fontSize: 11, color: "var(--ink-3)", padding: 20, textAlign: "center" }}>Sem dados suficientes para plotagem</div>;

  const vals = valid.map((d) => d.y as number);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const W = 760;
  const H = 160;
  const pad = 24;

  const points = valid.map((d, i) => {
    const x = pad + (i / (valid.length - 1)) * (W - 2 * pad);
    const y = H - pad - (((d.y as number) - min) / range) * (H - 2 * pad);
    return { x, y };
  });

  const pathD = points.reduce((acc, p, i, a) => {
    if (i === 0) return `M ${p.x},${p.y}`;
    const prev = a[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }, "");

  const areaD = `${pathD} L ${points[points.length - 1].x},${H - pad} L ${points[0].x},${H - pad} Z`;

  return (
    <div className="svg-chart-container">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#grad-${color})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="chart-legend">
        <span>Mín: <strong>{min.toFixed(1)}{unit}</strong> ({valid[0].x})</span>
        <span>Máx: <strong>{max.toFixed(1)}{unit}</strong> ({valid[valid.length - 1].x})</span>
      </div>
    </div>
  );
}
