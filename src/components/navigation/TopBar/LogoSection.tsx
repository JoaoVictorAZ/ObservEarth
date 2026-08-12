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

      {/* O nome inteiro fica no span FORTE, e não partido entre os dois.
          O span fraco é caixa-alta com entreletra larga e some abaixo de
          900px — partir "ObservEarth" nele renderizaria "Observ  E A R T H"
          na tela cheia e só "Observ" no notebook. O fraco carrega o
          descritor, que é justamente o que pode cair sem perder a marca. */}
      <h1 className="plaqueta-nome">
        <span className="plaqueta-nome-forte">ObservEarth</span>
        <span className="plaqueta-nome-fraco">Observação da Terra</span>
      </h1>

      {/* Carimbo de versão: monoespaçado, apagado, do tamanho de um metadado.
          É informação de manutenção, não de identidade. */}
      <span className="plaqueta-versao" title="Versão da plataforma">1.5</span>
    </div>
  );
};
