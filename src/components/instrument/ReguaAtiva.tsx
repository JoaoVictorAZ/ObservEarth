// src/components/instrument/ReguaAtiva.tsx
// -----------------------------------------------------------------------------
// A PONTE ENTRE AS LOJAS E A RÉGUA
// -----------------------------------------------------------------------------
// A régua (`Regua.tsx`) não sabe nada sobre o app: recebe paradas, unidade e um
// valor. Este arquivo liga as lojas nela.
//
// A REGRA EDITORIAL — qual camada manda na escala — NÃO mora mais aqui. Ela
// está em `src/legenda/ativa.ts`, com teste próprio, porque duas peças precisam
// da mesma resposta: esta, para desenhar a escala, e o amostrador do cursor no
// viewport, para ler a grade certa. Escrita nos dois lugares, ela diverge — e o
// sintoma seria a régua dizendo "Corrente oceânica" com o número do vento
// embaixo, plausível e errado.
//
// PROCEDÊNCIA VEM DA RESPOSTA, NÃO DE UM LITERAL
//
// Este arquivo tinha `procedencia="GFS 0,25°"` cravado no vento — exatamente o
// defeito que o comentário do viewport descreve em cima da mesma camada. O
// servidor tem dois caminhos (GFS a 0,25° e Open-Meteo a 3°) e o rótulo fixo
// afirmava o primeiro mesmo quando chegava o segundo, 144× mais grosso em área.
// Agora sai de `windInfo`/`hycomInfo`, que são calculados a partir do que o
// servidor devolveu.
// -----------------------------------------------------------------------------

import React from "react";
import { Regua } from "./Regua.tsx";
import { useLayerStore } from "../../store/layerStore";
import { useCursorStore } from "../../store/cursorStore.ts";
import { useFontesStore } from "../../store/fontesStore.ts";
import { useMalhaStore } from "../../store/malhaStore";
import { useGlobeStore } from "../../store/globeStore";
import { VENTO, CORRENTE, type Parada as ParadaHex } from "../../probe/escalas";
import { escalaAtiva } from "../../legenda/ativa.ts";
import type { Parada } from "../../legenda/regua.ts";

/**
 * As escalas de `src/probe/escalas.ts` guardam a cor em hexadecimal, porque a
 * sonda pinta texto com elas. A régua precisa de RGB.
 *
 * A conversão fica aqui, e não lá, para as duas telas continuarem lendo a MESMA
 * fonte de verdade — duas listas de cores para a mesma grandeza é como a
 * legenda passa a discordar do mapa.
 */
function paraRGB(escala: readonly ParadaHex[]): Parada[] {
  const hex3 = (c: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
  return escala.map(([v, c]) => [v, hex3(c)] as Parada);
}

const STOPS_VENTO = paraRGB(VENTO);
const STOPS_CORRENTE = paraRGB(CORRENTE);

export const ReguaAtiva: React.FC = () => {
  const { kind, layer, fields, wind, hycomOn, windInfo, hycomInfo } = useLayerStore();
  const cursor = useCursorStore();
  const fontes = useFontesStore((s) => s.fontes);
  const malha = useMalhaStore();
  const modo = useGlobeStore((g) => g.modo);

  const campo = kind === "field" && layer ? fields.find((f) => f.id === layer) ?? null : null;

  const esc = escalaAtiva({
    modo,
    malha: {
      ativa: malha.ativa,
      titulo: malha.campo?.titulo ?? null,
      unidade: malha.campo?.unidade ?? null,
      stops: malha.escala?.stops ?? null,
      modo: malha.escala?.modo ?? "rampa",
      temValores: !!malha.campo,
    },
    campo,
    correntes: hycomOn,
    // A grade das correntes fica no viewport, como a do vento. Quem sabe se ela
    // chegou é o cursor: `amostravel` só é verdadeiro quando há grade lá.
    correntesNoCliente: cursor.amostravel,
    vento: wind,
    ventoNoCliente: cursor.amostravel,
    stopsVento: STOPS_VENTO,
    stopsCorrente: STOPS_CORRENTE,
  });

  if (!esc) return null;

  // A procedência das camadas vetoriais é calculada pelo viewport a partir da
  // RESPOSTA do servidor — passo, provedor, cobertura, e o aviso de campo
  // grosso quando é o caso.
  const procedencia =
    esc.chave === "vento" ? windInfo
    : esc.chave === "corrente" ? hycomInfo
    : esc.procedencia;

  return (
    <Regua
      titulo={esc.titulo}
      unidade={esc.unidade}
      stops={esc.stops}
      modo={esc.modo}
      piso={esc.piso}
      casas={esc.casas}
      valor={esc.amostravel ? cursor.valor : null}
      amostravel={esc.amostravel}
      coord={cursor.coord}
      fonte={esc.fonteId ? fontes[esc.fonteId] ?? null : null}
      procedencia={procedencia}
    />
  );
};
