// src/components/layout/AppShell.tsx
// -----------------------------------------------------------------------------
// SHELL MESTRE — quem monta o quê, e o que pode aparecer sozinho.
// -----------------------------------------------------------------------------
// A REGRA DESTE ARQUIVO: nada abre sozinho.
//
// O globo é uma superfície de exploração, e clicar num ponto é um gesto barato
// que se repete dezenas de vezes por minuto. Toda janela que nasce desse gesto
// precisa custar quase nada; a que custa caro só entra por decisão explícita.
// -----------------------------------------------------------------------------

import React, { useCallback, useRef } from "react";
import { TopBar } from "../navigation/TopBar/TopBar";
import { ForecastToolbar } from "../navigation/ForecastToolbar/ForecastToolbar";
import { LeftDock } from "../dock/LeftDock";
import { StatusBar } from "../instrument/StatusBar";
import { GlobeViewport, type GlobeViewportRef } from "../globe/GlobeViewport";
import { ProbePanel } from "../probe/ProbePanel";
import { CommandPalette } from "../navigation/CommandPalette";
import AnalysisModal from "../AnalysisModal";
import { useUIStore } from "../../store/uiStore";
import { useProbeStore } from "../../store/probeStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useWindowStore } from "../../store/windowStore";
import { PointChat } from "../chat/PointChat";
import { BlocoPanel } from "../bloco/BlocoPanel";
import { EVENTO_ORGANIZAR } from "../../janelas";
import { Limite } from "../Limite";

const CHAVE_CHAT = "obs:chat:aberto";

/**
 * O terminal começa FECHADO, e a escolha sobrevive à sessão.
 *
 * O código anterior fazia o oposto em dois lugares ao mesmo tempo: nascia com
 * `useState(true)` e tinha um efeito que o forçava a `true` a cada ponto novo.
 * Fechar não adiantava — o clique seguinte no globo o trazia de volta, por
 * cima do planeta, e não havia como manter o globo limpo enquanto se explorava.
 *
 * O comentário que ficava logo acima daquele estado dizia, textualmente, que o
 * terminal abre "por AÇÃO EXPLÍCITA, nunca no clique". A intenção estava
 * escrita e o código fazia o contrário.
 *
 * E o custo não é só de espaço na tela: o terminal quer baixar de 1 a 4,7 GB
 * de modelo. Um painel com esse apetite não pode ser o padrão de um gesto de
 * exploração.
 */
function lerChatAberto(): boolean {
  try { return localStorage.getItem(CHAVE_CHAT) === "1"; } catch { return false; }
}

export const AppShell: React.FC = () => {
  const globeRef = useRef<GlobeViewportRef>(null);
  const { analysisTarget, setAnalysisTarget } = useUIStore();
  const { probe } = useProbeStore();
  const { day, hour } = useTimelineStore();
  const focusWindow = useWindowStore((w) => w.focusWindow);

  const [chatAberto, setChatAberto] = React.useState(lerChatAberto);

  const definirChat = useCallback((aberto: boolean) => {
    setChatAberto(aberto);
    try { localStorage.setItem(CHAVE_CHAT, aberto ? "1" : "0"); } catch { /* segue */ }
    // A JANELA QUE ABRE VAI PARA A FRENTE.
    //
    // Sem isto o terminal nascia com `activeWindow` ainda em "probe", ou seja
    // com z-index MENOR que o da sonda — abria atrás dela. O usuário clicava
    // no botão, algo acontecia atrás de outra janela, e parecia que o botão
    // não funcionou.
    if (aberto) focusWindow("chat");
  }, [focusWindow]);

  const alternarChat = useCallback(() => {
    setChatAberto((v) => {
      const novo = !v;
      try { localStorage.setItem(CHAVE_CHAT, novo ? "1" : "0"); } catch { /* segue */ }
      if (novo) focusWindow("chat");
      return novo;
    });
  }, [focusWindow]);

  const fecharChat = useCallback(() => definirChat(false), [definirChat]);

  const handleSearchCoord = useCallback((lat: number, lng: number) => {
    globeRef.current?.flyTo(lat, lng);
  }, []);

  /**
   * ORGANIZAR JANELAS — e por que a versão anterior não fazia nada.
   *
   * Ela apagava as chaves do `localStorage` e disparava um `resize`. Só que a
   * posição já estava em estado de React dentro de cada janela, e cada uma
   * regrava a chave na alteração seguinte. Apagar o disco não move nada que
   * está na memória: as janelas ficavam exatamente onde estavam, e o botão
   * parecia quebrado.
   *
   * O aviso agora vai para as JANELAS, que sabem se recolocar. Ver
   * `src/janelas.ts`.
   */
  const handleOrganizarJanelas = useCallback(() => {
    window.dispatchEvent(new Event(EVENTO_ORGANIZAR));
  }, []);

  const fecharAnalise = useCallback(() => setAnalysisTarget(null), [setAnalysisTarget]);

  return (
    <div className="app">
      <GlobeViewport ref={globeRef} />
      <TopBar onSearchCoord={handleSearchCoord} />
      <ForecastToolbar />
      <LeftDock />
      {/* Cada painel pesado vai dentro do seu próprio limite. Sem isso, um erro
          não previsto em QUALQUER um deles desmonta a árvore inteira e a tela
          fica em branco — ver o cabeçalho de `src/components/Limite.tsx`. */}
      <Limite nome="O painel do ponto">
        <ProbePanel onToggleChat={alternarChat} chatAberto={chatAberto} />
      </Limite>
      <Limite nome="O recorte 3D">
        <BlocoPanel />
      </Limite>
      <StatusBar />
      <CommandPalette onFlyTo={handleSearchCoord} />

      {probe && chatAberto && (
        <Limite nome="O terminal de análise">
        <PointChat
          lat={probe.lat}
          lng={probe.lng}
          date={day}
          hour={hour}
          onFechar={fecharChat}
          onOrganizarJanelas={handleOrganizarJanelas}
        />
        </Limite>
      )}

      {analysisTarget && (
        <AnalysisModal
          lat={analysisTarget.lat}
          lng={analysisTarget.lng}
          place={analysisTarget.place}
          onClose={fecharAnalise}
        />
      )}
    </div>
  );
};
