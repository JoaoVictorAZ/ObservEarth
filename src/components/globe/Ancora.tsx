// src/components/globe/Ancora.tsx
// -----------------------------------------------------------------------------
// O CARTÃO ANCORADO — o planeta lembra onde você clicou
// -----------------------------------------------------------------------------
// Até aqui o ciclo era: você lê o valor sob o cursor na régua, clica, uma
// janela abre num canto — e o globo esquece. A coordenada estava escrita no
// cabeçalho da janela, em graus, e ninguém lê graus para saber onde é.
//
// Este cartão fica preso à coordenada e acompanha o planeta enquanto ele gira.
// Ele NÃO substitui a sonda: são objetos com funções diferentes.
//
//   o cartão   é para OLHAR — três números e o nome do lugar, no lugar
//   a janela   é para ESTUDAR — a série, a normal, o terminal, a análise
//
// POR QUE ELE SOME ATRÁS DO PLANETA
//
// Um ponto do outro lado da Terra continua tendo projeção na tela: ele passa
// no clip e cai em cima de outro continente. Sem o teste de horizonte, o
// cartão de Tóquio ficaria desenhado sobre a América do Sul, preso a um ponto
// que ninguém está vendo. Quem faz esse teste é `motor.projetar`.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useProbeStore } from "../../store/probeStore";
import { useUIStore } from "../../store/uiStore";
import type { MotorGeo } from "../../tipos";

const fmt = (v: number | null | undefined, casas: number, un: string) =>
  v == null || !Number.isFinite(v) ? null : `${v.toFixed(casas)}${un}`;

export const Ancora: React.FC<{ motor: MotorGeo | null }> = ({ motor }) => {
  const probe = useProbeStore((s) => s.probe);
  const limpar = useProbeStore((s) => s.clearProbe);
  const { setAnalysisTarget } = useUIStore();
  const [tela, setTela] = useState<{ x: number; y: number; visivel: boolean } | null>(null);

  // O ALVO NUMA REF, e o laço lendo a ref. Reprojetar precisa acontecer a cada
  // quadro em que a câmera se move, e um efeito que dependesse do objeto
  // `probe` inteiro se reiniciaria a cada atualização da sonda.
  const alvo = useRef<{ lat: number; lng: number } | null>(null);
  alvo.current = probe ? { lat: probe.lat, lng: probe.lng } : null;

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    let raf = 0;

    const passo = () => {
      if (!vivo) return;
      const a = alvo.current;
      // `setTela` com o mesmo valor não re-renderiza (React compara por
      // identidade, mas o objeto é novo) — por isso a comparação explícita:
      // sem ela, o cartão re-renderizaria 60 vezes por segundo parado.
      const p = a ? motor.projetar(a.lat, a.lng) : null;
      setTela((antes) => {
        if (p == null && antes == null) return antes;
        if (p && antes && Math.abs(p.x - antes.x) < 0.5 && Math.abs(p.y - antes.y) < 0.5
            && p.visivel === antes.visivel) return antes;
        return p;
      });
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => { vivo = false; cancelAnimationFrame(raf); };
  }, [motor]);

  if (!probe || !tela || !tela.visivel) return null;

  const linhas = [
    fmt(probe.temperature, 1, " °C"),
    fmt(probe.windSpeed, 1, " m/s"),
    fmt(probe.humidity, 0, " %"),
  ].filter(Boolean) as string[];

  return (
    <div className="anc" style={{ left: `${tela.x}px`, top: `${tela.y}px` }}>
      {/* O ponto fica NA coordenada; o cartão sai dela por uma haste. Assim o
          cartão pode ser grande sem esconder o lugar de que ele fala. */}
      <span className="anc-ponto" aria-hidden="true" />
      <span className="anc-haste" aria-hidden="true" />

      <div className="anc-cartao" role="group" aria-label={`Resumo de ${probe.place}`}>
        <div className="anc-topo">
          <span className="anc-lugar">{probe.place}</span>
          <button type="button" className="anc-x" onClick={limpar} aria-label="Fechar">
            <X size={11} strokeWidth={2.2} />
          </button>
        </div>

        {linhas.length > 0 ? (
          <p className="anc-nums">{linhas.join("  ·  ")}</p>
        ) : (
          <p className="anc-sem">sem medida neste ponto</p>
        )}

        <button
          type="button"
          className="anc-abrir"
          onClick={() => setAnalysisTarget({ lat: probe.lat, lng: probe.lng, place: probe.place })}
        >
          Análise completa <ArrowUpRight size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
