// src/probe/useClimatologia.ts
// -----------------------------------------------------------------------------
// A normal do ponto, buscada em segundo plano.
//
// A sonda ABRE ANTES. Trinta anos de série diária demoram; a medição do
// instante não. Fazer a janela esperar a climatologia para mostrar a
// temperatura seria trocar uma resposta imediata por uma barra de progresso.
//
// Por isso o painel de anomalia entra depois, sem deslocar o que já está lido:
// ele tem lugar reservado na tela e um estado de carregamento próprio.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Climatologia } from "./comparacao.ts";

export interface EstadoClima {
  dado: Climatologia | null;
  carregando: boolean;
  erro: string | null;
}

/** Dia UTC — o mesmo fuso que o servidor usa para pedir o agregado. */
export function diaUTC(agora = new Date()): string {
  return agora.toISOString().slice(0, 10);
}

export function useClimatologia(lat: number | null, lng: number | null): EstadoClima {
  const [estado, setEstado] = useState<EstadoClima>({ dado: null, carregando: false, erro: null });

  // Arredondado para a mesma grade de 0,25° do cache do servidor: arrastar a
  // sonda dois quilômetros ao lado não redispara uma busca de 30 anos.
  const chave = lat == null || lng == null
    ? null
    : `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lng * 4) / 4).toFixed(2)}`;

  useEffect(() => {
    if (chave == null || lat == null || lng == null) {
      setEstado({ dado: null, carregando: false, erro: null });
      return;
    }
    let vivo = true;
    const abortar = new AbortController();
    setEstado({ dado: null, carregando: true, erro: null });

    const q = `lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&date=${diaUTC()}`;
    fetch(`/api/climatologia?${q}`, { signal: abortar.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // A mensagem do servidor é a informação útil. "HTTP 502" não diz se
        // vale tentar de novo, outro ponto, ou nada.
        if (!r.ok || j?.ok === false) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as Climatologia;
      })
      .then((j) => { if (vivo) setEstado({ dado: j, carregando: false, erro: null }); })
      .catch((e: Error) => {
        if (!vivo || e.name === "AbortError") return;
        // Sem normal a sonda continua útil: ela volta a ser o que era, com os
        // valores do instante. O que ela não faz é inventar uma referência.
        setEstado({ dado: null, carregando: false, erro: e.message });
      });

    return () => { vivo = false; abortar.abort(); };
  }, [chave, lat, lng]);

  return estado;
}
