import React, { useState, useRef, useEffect } from "react";
import { useGlobeStore } from "../../../store/globeStore";
import { usePerfStore } from "../../../store/perfStore";
import { TIERS } from "../../../perf";
import { RefreshCw, Home, Camera, Activity, Sun, Map, Globe2 } from "lucide-react";

export const ToolbarButtons: React.FC<{ onSearchCoord?: (lat: number, lng: number) => void }> = ({ onSearchCoord }) => {
  const { rotate, toggleRotate, dayNight, toggleDayNight, modo, toggleModo } = useGlobeStore();
  const { stats } = usePerfStore();
  const [aberto, setAberto] = useState(false);
  const cx = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (cx.current && !cx.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const capturar = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `observearth-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  const t = stats?.tier ?? 0;
  const degrau = TIERS[t as 0 | 1 | 2];

  return (
    <div className="ferramentas" ref={cx}>
      {/* ---- projeção: a escolha mais estrutural, então vem primeiro ------
          Não é um interruptor comum: troca o motor de renderização inteiro.
          O ícone mostra PARA ONDE se vai, não onde se está — é o que o dedo
          espera de um botão que alterna. */}
      <div className="ferramentas-grupo" role="group" aria-label="Projeção">
        <button
          className={`icone-btn ${modo === "mapa" ? "icone-btn-on" : ""}`}
          onClick={toggleModo}
          aria-pressed={modo === "mapa"}
          title={modo === "mapa"
            ? "Voltar ao globo 3D"
            : "Abrir o mapa plano (equirretangular)"}
        >
          {modo === "mapa"
            ? <Globe2 size={14} strokeWidth={1.5} />
            : <Map size={14} strokeWidth={1.5} />}
        </button>
      </div>

      <span className="ferramentas-fio" aria-hidden="true" />

      {/* ---- interruptores: têm estado, ficam acesos --------------------- */}
      <div className="ferramentas-grupo" role="group" aria-label="Modos de exibição">
        <button
          className={`icone-btn ${rotate ? "icone-btn-on" : ""}`}
          onClick={toggleRotate}
          aria-pressed={rotate}
          title={modo === "mapa"
            ? "Deriva automática em longitude"
            : "Rotação automática do globo"}
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
        <button
          className={`icone-btn ${dayNight ? "icone-btn-on" : ""}`}
          onClick={toggleDayNight}
          aria-pressed={dayNight}
          title="Terminador dia/noite na posição solar real"
        >
          <Sun size={14} strokeWidth={1.5} />
        </button>
      </div>

      <span className="ferramentas-fio" aria-hidden="true" />

      {/* ---- ações: acontecem e acabam ---------------------------------- */}
      <div className="ferramentas-grupo" role="group" aria-label="Ações">
        {/* O rótulo agora descreve o destino real. O anterior dizia "Travar
            Norte / Resetar Câmera" e voava para São Paulo. */}
        <button
          className="icone-btn"
          onClick={() => onSearchCoord?.(0, 0)}
          title="Centralizar em 0°, 0° (golfo da Guiné)"
        >
          <Home size={14} strokeWidth={1.5} />
        </button>
        <button className="icone-btn" onClick={capturar} title="Salvar a vista atual em PNG">
          <Camera size={14} strokeWidth={1.5} />
        </button>
      </div>

      <span className="ferramentas-fio" aria-hidden="true" />

      <button
        className={`icone-btn ${aberto ? "icone-btn-on" : ""}`}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        title="Estado do motor de renderização"
      >
        <Activity size={14} strokeWidth={1.5} />
      </button>

      {aberto && (
        <div className="motor" role="dialog" aria-label="Estado do motor">
          <p className="motor-tit">Motor de renderização</p>

          {stats ? (
            <dl className="motor-lista">
              <div><dt>Quadros</dt><dd>{stats.fps} /s <small>({stats.frameMs} ms)</small></dd></div>
              <div><dt>Nosso tempo de CPU</dt><dd>{stats.cpuMs} ms</dd></div>
              <div><dt>Degrau de qualidade</dt><dd>{degrau.label} <small>({t})</small></dd></div>
              <div><dt>Densidade de pixel</dt><dd>{stats.dpr}×</dd></div>
              <div><dt>Partículas de vento</dt><dd>{degrau.particles.toLocaleString("pt-BR")}</dd></div>
              <div><dt>Textura de rastro</dt><dd>{degrau.trail} × {degrau.trail / 2}</dd></div>
              <div><dt>Chamadas de desenho</dt><dd>{stats.calls}</dd></div>
              <div><dt>Texturas / geometrias</dt><dd>{stats.textures} / {stats.geometries}</dd></div>
            </dl>
          ) : (
            <p className="motor-vazio">Aguardando o primeiro quadro medido.</p>
          )}

          <p className="motor-nota">
            O degrau cai sozinho acima de 20 ms por quadro e volta a subir depois de
            folga sustentada. Estes números vêm do motor a cada quadro — antes eram
            texto fixo.
          </p>
        </div>
      )}
    </div>
  );
};
