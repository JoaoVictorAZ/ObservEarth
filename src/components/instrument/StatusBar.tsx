// src/components/instrument/StatusBar.tsx
// -----------------------------------------------------------------------------
// A BARRA INFERIOR — e a mentira que ela contava
// -----------------------------------------------------------------------------
// A versão anterior exibia "SISTEMA OPERACIONAL" em verde, cravado no código,
// ao lado de três strings de aviso soltas (`windInfo`, `isoInfo`, `fireInfo`).
// O texto não dependia de nada: com a NOAA fora do ar, o USGS mudo e o mapa
// desenhando dado de seis horas atrás, ele continuava dizendo, em verde, que o
// sistema estava operacional.
//
// Agora ele lê `resumir()` de `src/dados/estado.ts` e diz o que está
// acontecendo de verdade: quantas fontes estão frescas, quantas estão velhas e
// quantas não responderam. Verde só quando é verde.
//
// A CONTAGEM DE AVISOS FICA AQUI PORQUE ELA NÃO É DECORAÇÃO. É a única
// informação da tela inteira que fala de risco declarado por autoridade, e ela
// precisa estar visível mesmo com todas as janelas fechadas.
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import { useLayerStore } from "../../store/layerStore";
import { useFontesStore } from "../../store/fontesStore.ts";
import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle } from "lucide-react";

interface Props {
  /** quantos avisos estão vigentes agora; null enquanto não se sabe */
  avisosVigentes?: number | null;
  aoAbrirAvisos?: () => void;
}

export const StatusBar: React.FC<Props> = ({ avisosVigentes = null, aoAbrirAvisos }) => {
  const { layer, kind } = useLayerStore();
  const fontes = useFontesStore((s) => s.fontes);

  // Um relógio próprio: "há 3 min" precisa virar "há 4 min" sem que nada mais
  // na tela mude. Trinta segundos é a granularidade da frase.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const r = useFontesStore.getState().resumo(agora);
  void fontes; // a assinatura acima é quem faz o componente re-renderizar

  const tudoBem = r.indisponiveis === 0 && r.degradadas === 0;
  const Icone = r.indisponiveis > 0 ? ShieldX : r.degradadas > 0 ? ShieldAlert : ShieldCheck;
  const cor = r.indisponiveis > 0 ? "var(--alert)" : r.degradadas > 0 ? "var(--warn)" : "var(--signal)";

  const rotulo =
    r.total === 0 ? "SEM FONTES ATIVAS"
    : tudoBem ? `${r.prontas} FONTE${r.prontas === 1 ? "" : "S"} ATUALIZADA${r.prontas === 1 ? "" : "S"}`
    : [
        r.indisponiveis > 0 ? `${r.indisponiveis} SEM DADO` : null,
        r.degradadas > 0 ? `${r.degradadas} DESATUALIZADA${r.degradadas === 1 ? "" : "S"}` : null,
      ].filter(Boolean).join(" · ");

  return (
    <div className="statusbar">
      <div className="statusbar-lado">
        <span
          className="statusbar-saude"
          style={{ color: cor }}
          title={
            r.avisos.length
              ? r.avisos.map((a) => `${a.rotulo}: ${a.frase}`).join("\n")
              : "Todas as fontes ligadas responderam e o dado está dentro da validade"
          }
        >
          <Icone size={12} strokeWidth={1.8} /> {rotulo}
        </span>

        {kind && layer && (
          <span>CAMADA: <strong>{layer}</strong> ({kind})</span>
        )}
      </div>

      <div className="statusbar-lado">
        {/* A primeira fonte listada é a pior notícia — `resumir` já ordena
            indisponível antes de degradada. */}
        {r.avisos[0] && (
          <span className="statusbar-falha" title={r.avisos.map((a) => `${a.rotulo}: ${a.frase}`).join("\n")}>
            {r.avisos[0].rotulo}: {r.avisos[0].frase}
            {r.avisos.length > 1 && ` (+${r.avisos.length - 1})`}
          </span>
        )}

        {avisosVigentes != null && avisosVigentes > 0 && (
          <button type="button" className="statusbar-avisos" onClick={aoAbrirAvisos}>
            <AlertTriangle size={12} strokeWidth={1.8} />
            {avisosVigentes} aviso{avisosVigentes === 1 ? "" : "s"} do INMET
          </button>
        )}
      </div>
    </div>
  );
};
