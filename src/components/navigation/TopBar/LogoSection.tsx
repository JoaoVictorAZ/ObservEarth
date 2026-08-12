import React from "react";
import { useUIStore } from "../../../store/uiStore";
import { useLayerStore } from "../../../store/layerStore";
import { PanelLeft } from "lucide-react";
import { Mark } from "./Mark";

const StatusDot: React.FC = () => {
  const { windInfo, isoInfo, fireInfo, geoInfo } = useLayerStore();
  const linhas = [windInfo, isoInfo, fireInfo, geoInfo].filter(Boolean) as string[];

  const falha = linhas.some((l) => /indisponível|erro|não respondeu|falh/i.test(l));
  const degradado = linhas.some((l) => /⚠|campo grosso|recuo/i.test(l));

  const estado = falha ? "falha" : degradado ? "degradado" : "ok";
  const titulo = falha
    ? "Alguma camada não conseguiu carregar"
    : degradado
      ? "Alguma camada está servindo um campo degradado"
      : "Camadas ativas sem falha reportada";

  return <span className={`plaqueta-ponto plaqueta-ponto-${estado}`} title={titulo} aria-hidden="true" />;
};

export const LogoSection: React.FC = () => {
  const { toggleSidebar, sidebarOpen } = useUIStore();

  return (
    <div className="plaqueta">
      <button
        className="icone-btn"
        onClick={toggleSidebar}
        aria-pressed={sidebarOpen}
        aria-label={sidebarOpen ? "Recolher painel de camadas" : "Abrir painel de camadas"}
        title={sidebarOpen ? "Recolher painel de camadas" : "Abrir painel de camadas"}
      >
        <PanelLeft size={15} strokeWidth={1.5} />
      </button>

      <span className="plaqueta-fio" aria-hidden="true" />

      <div className="plaqueta-marca">
        <Mark size={22} />
        <StatusDot />
      </div>

      <h1 className="plaqueta-nome">
        <span className="plaqueta-nome-forte">Observatório</span>
        <span className="plaqueta-nome-fraco">da Terra</span>
      </h1>

      {/* Carimbo de versão: monoespaçado, apagado, do tamanho de um metadado.
          É informação de manutenção, não de identidade. */}
      <span className="plaqueta-versao" title="Versão da plataforma">1.5</span>
    </div>
  );
};
