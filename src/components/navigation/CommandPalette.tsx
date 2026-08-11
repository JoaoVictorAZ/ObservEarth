// src/components/navigation/CommandPalette.tsx
// -----------------------------------------------------------------------------
// PALETA DE COMANDOS GLOBAL (CTRL + K) USANDO CMDK
// -----------------------------------------------------------------------------

import React, { useEffect } from "react";
import { Command } from "cmdk";
import { useUIStore } from "../../store/uiStore";
import { useLayerStore } from "../../store/layerStore";
import { useGlobeStore } from "../../store/globeStore";
import { useDialog } from "../../hooks/useDialog";
import { Search, Globe2, Layers, Wind, Flame, Eye, Activity } from "lucide-react";

export const CommandPalette: React.FC<{ onFlyTo?: (lat: number, lng: number) => void }> = ({ onFlyTo }) => {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const { fields, sats, models, selectLayer, setWind, setIsobarsOn, setFiresOn, wind, isobarsOn, firesOn } = useLayerStore();
  const { rotate, toggleRotate, dayNight, toggleDayNight } = useGlobeStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Paleta de comandos é modal: prende o foco e fecha com Esc. Sem isso, a
  // pessoa abria com Ctrl+K e não tinha como sair sem o mouse — o atalho
  // levava a um beco.
  const paletaRef = useDialog<HTMLDivElement>({
    aberto: commandPaletteOpen,
    aoFechar: () => setCommandPaletteOpen(false),
    prender: true,
  });

  if (!commandPaletteOpen) return null;

  return (
    <div
      ref={paletaRef}
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(4, 6, 10, 0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          background: "#0c1017",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          borderRadius: 8,
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.75)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Observatório Earth Platform Command Palette">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.10)",
            }}
          >
            <Search size={16} color="var(--signal)" />
            <Command.Input
              placeholder="Digite um comando, cidade ou camada (ex: Vento, São Paulo, MERRA-2)..."
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#f4f7fa",
                fontSize: 14,
                fontFamily: "var(--sans)",
              }}
            />
            <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>ESC</span>
          </div>

          <Command.List style={{ maxHeight: 360, overflowY: "auto", padding: 8 }}>
            <Command.Empty style={{ padding: 16, fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
              Nenhum resultado encontrado.
            </Command.Empty>

            <Command.Group heading="Ações Rápidas">
              <Command.Item
                onSelect={() => { toggleRotate(); setCommandPaletteOpen(false); }}
                style={itemStyle}
              >
                <Globe2 size={14} color="var(--signal)" />
                <span>{rotate ? "Desativar Rotação Automática" : "Ativar Rotação Automática"}</span>
              </Command.Item>
              <Command.Item
                onSelect={() => { toggleDayNight(); setCommandPaletteOpen(false); }}
                style={itemStyle}
              >
                <Eye size={14} color="var(--signal)" />
                <span>{dayNight ? "Desativar Iluminação Solar" : "Ativar Iluminação Solar"}</span>
              </Command.Item>
              <Command.Item
                onSelect={() => { setWind(!wind); setCommandPaletteOpen(false); }}
                style={itemStyle}
              >
                <Wind size={14} color="var(--signal)" />
                <span>{wind ? "Ocultar Partículas de Vento GPU" : "Exibir Partículas de Vento GPU"}</span>
              </Command.Item>
              <Command.Item
                onSelect={() => { setIsobarsOn(!isobarsOn); setCommandPaletteOpen(false); }}
                style={itemStyle}
              >
                <Activity size={14} color="var(--signal)" />
                <span>{isobarsOn ? "Ocultar Isóbaras MSLP" : "Exibir Isóbaras MSLP"}</span>
              </Command.Item>
              <Command.Item
                onSelect={() => { setFiresOn(!firesOn); setCommandPaletteOpen(false); }}
                style={itemStyle}
              >
                <Flame size={14} color="var(--signal)" />
                <span>{firesOn ? "Ocultar Focos FIRMS" : "Exibir Focos FIRMS"}</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Cidades & Localidades">
              <Command.Item onSelect={() => { onFlyTo?.(-23.5505, -46.6333); setCommandPaletteOpen(false); }} style={itemStyle}>
                <span>São Paulo, Brasil</span>
              </Command.Item>
              <Command.Item onSelect={() => { onFlyTo?.(-22.9068, -43.1729); setCommandPaletteOpen(false); }} style={itemStyle}>
                <span>Rio de Janeiro, Brasil</span>
              </Command.Item>
              <Command.Item onSelect={() => { onFlyTo?.(35.6762, 139.6503); setCommandPaletteOpen(false); }} style={itemStyle}>
                <span>Tóquio, Japão</span>
              </Command.Item>
              <Command.Item onSelect={() => { onFlyTo?.(40.7128, -74.0060); setCommandPaletteOpen(false); }} style={itemStyle}>
                <span>Nova York, EUA</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Camadas Escalares (GFS 0.25°)">
              {fields.map((f) => (
                <Command.Item
                  key={f.id}
                  onSelect={() => { selectLayer("field", f.id); setCommandPaletteOpen(false); }}
                  style={itemStyle}
                >
                  <Layers size={14} color="var(--signal)" />
                  <span>{f.title} ({f.group})</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Sensores de Satélite Direto">
              {sats.map((s) => (
                <Command.Item
                  key={s.id}
                  onSelect={() => { selectLayer("sat", s.id); setCommandPaletteOpen(false); }}
                  style={itemStyle}
                >
                  <Layers size={14} color="var(--signal)" />
                  <span>{s.title} ({s.group})</span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Modelos de Reanálise (MERRA-2)">
              {models.slice(0, 10).map((m) => (
                <Command.Item
                  key={m.id}
                  onSelect={() => { selectLayer("model", m.id); setCommandPaletteOpen(false); }}
                  style={itemStyle}
                >
                  <Layers size={14} color="var(--signal)" />
                  <span>{m.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  borderRadius: 4,
  fontSize: 12,
  color: "#a8b4c2",
  cursor: "pointer",
  marginBottom: 2,
};
