// src/components/dock/LeftDock.tsx
// -----------------------------------------------------------------------------
// EXPLORADOR DE CAMADAS E MODELOS CLIMÁTICOS NA BARRA LATERAL (v1.5 PRO WORKSTATION)
// -----------------------------------------------------------------------------

import React, { useState, useEffect } from "react";
import * as Switch from "@radix-ui/react-switch";
import { useLayerStore } from "../../store/layerStore";
import { useUIStore } from "../../store/uiStore";
import { ChevronDown, ChevronRight, Wind, Satellite, Database, Layers, CheckCircle2, Cpu } from "lucide-react";

export const LeftDock: React.FC = () => {
  const {
    kind, layer, selectLayer, clearLayer,
    fields, sats, models,
    setFields, setSats, setModels,
    activeModelName, setActiveModelName,
    wind, setWind,
    isobarsOn, setIsobarsOn,
    quakesOn, setQuakesOn,
    firesOn, setFiresOn,
    openaqOn, setOpenaqOn,
    wbgtOn, setWbgtOn,
    hospitalsOn, setHospitalsOn,
    hycomOn, setHycomOn,
  } = useLayerStore();

  const { sidebarOpen } = useUIStore();

  useEffect(() => {
    fetch("/api/imagery")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && data.length > 0 && setSats(data))
      .catch(() => {});

    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && data.length > 0 && setModels(data))
      .catch(() => {});

    fetch("/api/fields")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && data.length > 0 && setFields(data))
      .catch(() => {});
  }, [setFields, setSats, setModels]);

  const [openSection, setOpenSection] = useState<{ [key: string]: boolean }>({
    modelsSel: true,
    fields: true,
    sats: true,
    models: true,
    overlays: true,
  });

  if (!sidebarOpen) return null;

  const toggleSec = (sec: string) => {
    setOpenSection((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  return (
    <aside className="panel">
      {/* 0. SELETOR DE MODELO NUMÉRICO / PREVISÃO */}
      <div className="section" style={{ background: "rgba(18, 23, 32, 0.6)", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <div
          className="label"
          onClick={() => toggleSec("modelsSel")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--signal)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Cpu size={14} strokeWidth={1.5} color="var(--signal)" />
            <strong style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>MODELO NUMÉRICO PRINCIPAL</strong>
          </div>
          {openSection.modelsSel ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        </div>

        {openSection.modelsSel && (
          <div style={{ marginTop: 8 }}>
            <select
              style={{
                width: "100%",
                background: "#0c1017",
                border: "1px solid var(--signal)",
                borderRadius: 4,
                padding: "7px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                outline: "none",
                cursor: "pointer",
                fontFamily: "var(--sans)",
              }}
              value={activeModelName}
              onChange={(e) => setActiveModelName(e.target.value)}
            >
              <option value="GFS 0.25° (NOAA)">NOAA GFS 0.25° (Alta Resolução)</option>
              <option value="ECMWF HRES">ECMWF HRES (IFS Integrated System)</option>
              <option value="ICON Global (DWD)">DWD ICON Global (Alemanha)</option>
              <option value="MERRA-2 (NASA)">NASA MERRA-2 (Reanálise Climática)</option>
              <option value="GEOS-FP (NASA Goddard)">NASA GEOS-FP Goddard</option>
            </select>
            <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4, fontFamily: "var(--mono)" }}>
              Ativo: <strong style={{ color: "var(--signal)" }}>{activeModelName}</strong>
            </div>
          </div>
        )}
      </div>

      {/* CAMADA ATIVA SELECIONADA */}
      {layer && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.12)", background: "rgba(93, 224, 176, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", color: "var(--signal)", fontFamily: "var(--mono)" }}>
              CAMADA EM EXIBIÇÃO NO GLOBO
            </span>
            <button onClick={clearLayer} style={{ fontSize: 10, color: "var(--ink-3)", cursor: "pointer", textDecoration: "underline" }}>
              Desativar
            </button>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
            <CheckCircle2 size={13} strokeWidth={1.5} color="var(--signal)" />
            {layer} <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>({kind})</span>
          </div>
        </div>
      )}

      {/* 1. CAMPOS ESCALARES GFS (0.25°) - AZUL (#3b82f6) */}
      <div className="section">
        <div
          className="label"
          onClick={() => toggleSec("fields")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#60a5fa" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} />
            <Wind size={14} strokeWidth={1.5} color="#60a5fa" />
            <strong style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>CAMPOS ESCALARES GFS (0.25°)</strong>
          </div>
          {openSection.fields ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        </div>

        {openSection.fields && (
          <div className="layers" style={{ marginTop: 8 }}>
            {fields.map((f) => {
              const active = kind === "field" && layer === f.id;
              return (
                <div
                  key={f.id}
                  className={`layer ${active ? "active" : ""}`}
                  onClick={() => selectLayer("field", f.id)}
                  style={{
                    borderLeft: active ? "3px solid #3b82f6" : "3px solid transparent",
                    background: active ? "rgba(59, 130, 246, 0.16)" : "rgba(255,255,255,0.02)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    marginBottom: 4,
                    cursor: "pointer",
                  }}
                >
                  <div className="lhead">
                    <span className="ltitle" style={{ fontWeight: active ? 600 : 400, color: active ? "#fff" : "var(--ink-2)" }}>
                      {f.title}
                    </span>
                    <span style={{ fontSize: 9, padding: "2px 5px", background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", borderRadius: 3, fontFamily: "var(--mono)" }}>
                      NOAA 0.25°
                    </span>
                  </div>
                  <small style={{ color: "var(--ink-3)" }}>{f.group} · {f.unit}</small>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. SATÉLITE - OBSERVAÇÃO DIRETA - VERDE (#10b981) */}
      <div className="section">
        <div
          className="label"
          onClick={() => toggleSec("sats")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#34d399" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
            <Satellite size={14} strokeWidth={1.5} color="#34d399" />
            <strong style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>SATÉLITE · OBSERVAÇÃO DIRETA</strong>
          </div>
          {openSection.sats ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        </div>

        {openSection.sats && (
          <div className="layers" style={{ marginTop: 8 }}>
            {sats.map((s) => {
              const active = kind === "sat" && layer === s.id;
              return (
                <div
                  key={s.id}
                  className={`layer ${active ? "active" : ""}`}
                  onClick={() => selectLayer("sat", s.id)}
                  style={{
                    borderLeft: active ? "3px solid #10b981" : "3px solid transparent",
                    background: active ? "rgba(16, 185, 129, 0.16)" : "rgba(255,255,255,0.02)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    marginBottom: 4,
                    cursor: "pointer",
                  }}
                >
                  <div className="lhead">
                    <span className="ltitle" style={{ fontWeight: active ? 600 : 400, color: active ? "#fff" : "var(--ink-2)" }}>
                      {s.title}
                    </span>
                    <span style={{ fontSize: 9, padding: "2px 5px", background: "rgba(16, 185, 129, 0.2)", color: "#6ee7b7", borderRadius: 3, fontFamily: "var(--mono)" }}>
                      NASA GIBS
                    </span>
                  </div>
                  <small style={{ color: "var(--ink-3)" }}>{s.group}</small>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. MODELO DE REANÁLISE MERRA-2 - ROXO (#a855f7) */}
      <div className="section">
        <div
          className="label"
          onClick={() => toggleSec("models")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#c084fc" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7" }} />
            <Database size={14} strokeWidth={1.5} color="#c084fc" />
            <strong style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>REANÁLISE MERRA-2 / GEOS</strong>
          </div>
          {openSection.models ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        </div>

        {openSection.models && (
          <div className="layers" style={{ marginTop: 8 }}>
            {models.slice(0, 15).map((m) => {
              const active = kind === "model" && layer === m.id;
              return (
                <div
                  key={m.id}
                  className={`layer ${active ? "active" : ""}`}
                  onClick={() => selectLayer("model", m.id)}
                  style={{
                    borderLeft: active ? "3px solid #a855f7" : "3px solid transparent",
                    background: active ? "rgba(168, 85, 247, 0.16)" : "rgba(255,255,255,0.02)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    marginBottom: 4,
                    cursor: "pointer",
                  }}
                >
                  <div className="lhead">
                    <span className="ltitle" style={{ fontWeight: active ? 600 : 400, color: active ? "#fff" : "var(--ink-2)" }}>
                      {m.title}
                    </span>
                    <span style={{ fontSize: 9, padding: "2px 5px", background: "rgba(168, 85, 247, 0.2)", color: "#e9d5ff", borderRadius: 3, fontFamily: "var(--mono)" }}>
                      MERRA-2
                    </span>
                  </div>
                  <small style={{ color: "var(--ink-3)" }}>{m.detail ?? "Reanálise global NASA"}</small>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. SOBREPOSIÇÕES GLOBAIS - ÂMBAR (#f59e0b) */}
      <div className="section">
        <div
          className="label"
          onClick={() => toggleSec("overlays")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#fbbf24" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
            <Layers size={14} strokeWidth={1.5} color="#fbbf24" />
            <strong style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>SOBREPOSIÇÕES GLOBAIS OPEN DATA</strong>
          </div>
          {openSection.overlays ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        </div>

        {openSection.overlays && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <div style={switchRowStyle}>
              <span style={{ color: wind ? "#fff" : "var(--ink-2)" }}>Vento · partículas GPU (GFS 0.25°)</span>
              <Switch.Root checked={wind} onCheckedChange={setWind} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(wind)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: isobarsOn ? "#fff" : "var(--ink-2)" }}>Isóbaras · pressão nível mar</span>
              <Switch.Root checked={isobarsOn} onCheckedChange={setIsobarsOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(isobarsOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: quakesOn ? "#fff" : "var(--ink-2)" }}>Sismos · USGS ao vivo</span>
              <Switch.Root checked={quakesOn} onCheckedChange={setQuakesOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(quakesOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: openaqOn ? "#fff" : "var(--ink-2)" }}>Qualidade do Ar · OpenAQ POIs</span>
              <Switch.Root checked={openaqOn} onCheckedChange={setOpenaqOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(openaqOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: firesOn ? "#fff" : "var(--ink-2)" }}>Focos de calor · VIIRS 375 m</span>
              <Switch.Root checked={firesOn} onCheckedChange={setFiresOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(firesOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: wbgtOn ? "#fff" : "var(--ink-2)" }}>Estresse Térmico · WBGT MetPy</span>
              <Switch.Root checked={wbgtOn} onCheckedChange={setWbgtOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(wbgtOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: hospitalsOn ? "#fff" : "var(--ink-2)" }}>Hospitais · OSM Global</span>
              <Switch.Root checked={hospitalsOn} onCheckedChange={setHospitalsOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(hospitalsOn)} />
              </Switch.Root>
            </div>

            <div style={switchRowStyle}>
              <span style={{ color: hycomOn ? "#fff" : "var(--ink-2)" }}>Correntes Oceânicas · HYCOM</span>
              <Switch.Root checked={hycomOn} onCheckedChange={setHycomOn} style={switchRootStyle}>
                <Switch.Thumb style={switchThumbStyle(hycomOn)} />
              </Switch.Root>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

const switchRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 11.5,
  color: "var(--ink-2)",
  padding: "6px 8px",
  background: "rgba(255, 255, 255, 0.03)",
  borderRadius: 4,
};

const switchRootStyle: React.CSSProperties = {
  width: 32,
  height: 18,
  backgroundColor: "rgba(255, 255, 255, 0.14)",
  borderRadius: 10,
  position: "relative",
  border: "none",
  cursor: "pointer",
};

const switchThumbStyle = (checked: boolean): React.CSSProperties => ({
  display: "block",
  width: 14,
  height: 14,
  backgroundColor: checked ? "var(--signal)" : "#6b7787",
  borderRadius: 8,
  transition: "transform 100ms",
  transform: checked ? "translateX(15px)" : "translateX(2px)",
});
