// src/components/navigation/TopBar/LogoSection.tsx
// -----------------------------------------------------------------------------
// PLACA DE IDENTIFICAÇÃO.
//
// O QUE ESTAVA ERRADO
//
//   1. O TÍTULO QUEBRAVA EM DUAS LINHAS. "Observatório Earth Platform 1.5"
//      numa faixa de 52 px, sem controle de largura, num flex que espremia.
//      Texto que quebra sem querer é o sintoma mais visível de layout sem
//      hierarquia: nada ali dizia o que era principal.
//
//   2. "v1.5 PRO WORKSTATION". "PRO WORKSTATION" não informa nada — não é uma
//      edição, não é um modo, não é um estado. É ruído com aparência de
//      etiqueta técnica, e ocupava o mesmo peso visual que o nome do produto.
//
//   3. O PONTO PULSANTE NÃO SIGNIFICAVA NADA. Uma bolinha verde piscando ao
//      lado do nome é a convenção universal de "sistema ativo/conectado" — e
//      ela pulsava igual com o backend fora do ar. Agora ele é alimentado por
//      estado real (ver StatusDot).
//
// A COMPOSIÇÃO
// Placa de equipamento: marca desenhada, nome em duas alturas tipográficas na
// MESMA linha, e a versão como carimbo monoespaçado discreto. A hierarquia vem
// de peso e cor, não de tamanho — que é a regra do sistema.
// -----------------------------------------------------------------------------

import React from "react";
import { useUIStore } from "../../../store/uiStore";
import { useLayerStore } from "../../../store/layerStore";
import { PanelLeft } from "lucide-react";
import { Mark } from "./Mark";

/**
 * O ponto de estado, agora com significado.
 *
 * Ele lê a procedência das camadas ligadas. Se alguma delas está reportando
 * falha ou campo degradado, o ponto muda — em vez de pulsar verde enquanto a
 * tela mostra um recuo de 3° ou um erro.
 */
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
