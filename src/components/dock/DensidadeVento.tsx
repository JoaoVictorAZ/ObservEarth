import React, { useEffect, useRef, useState } from "react";
import { useGlobeStore } from "../../store/globeStore";
import { usePerfStore } from "../../store/perfStore";
import { TIERS } from "../../perf";


export const DensidadeVento: React.FC = () => {
  const { windDensity, setWindDensity } = useGlobeStore();
  const { stats } = usePerfStore();

  // O ponteiro segue o dedo na hora; a GPU só é mexida quando o arrasto para.
  const [local, setLocal] = useState(windDensity);
  const timer = useRef<number | null>(null);

  useEffect(() => setLocal(windDensity), [windDensity]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const mudar = (v: number) => {
    setLocal(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setWindDensity(v);
    }, 160);
  };

  const degrau = TIERS[(stats?.tier ?? 0) as 0 | 1 | 2];
  const total = Math.max(3000, Math.round(degrau.particles * local));

  return (
    <div className="dens">
      <label className="dens-rot" htmlFor="dens-vento">
        Densidade
        <output htmlFor="dens-vento">
          {total.toLocaleString("pt-BR")} <span>partículas</span>
        </output>
      </label>

      <input
        id="dens-vento"
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={local}
        onChange={(e) => mudar(Number(e.target.value))}
        aria-label="Densidade das partículas de vento"
        aria-valuetext={`${total.toLocaleString("pt-BR")} partículas`}
      />

      {/* O teto vem do degrau de qualidade, e o degrau cai sozinho quando o
          quadro estoura. Dizer o teto evita a leitura de que 100% é sempre o
          mesmo número. */}
      <p className="dens-nota">
        máximo de {degrau.particles.toLocaleString("pt-BR")} no degrau “{degrau.label}”
      </p>
    </div>
  );
};
