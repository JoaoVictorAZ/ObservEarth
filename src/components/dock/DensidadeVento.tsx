// src/components/dock/DensidadeVento.tsx
// -----------------------------------------------------------------------------
// CONTROLE DE DENSIDADE DAS PARTÍCULAS.
//
// Mora dentro da própria linha do vento, e não num painel de configurações
// separado, porque é um atributo DAQUELA camada. Um controle longe do que ele
// controla obriga a ir e voltar para ver o efeito.
//
// DUAS COISAS QUE ELE PRECISA FAZER CERTO
//
// 1. NÃO REALOCAR A CADA PIXEL DE ARRASTO.
//    `setWindDensity` chama `resize()`, que destrói e recria as texturas de
//    estado e o buffer de atributos das partículas. Um arrastar normal dispara
//    umas 60 mudanças por segundo; sem espera, são 60 realocações de GPU por
//    segundo. O ponteiro anda macio (é só estado do React) e a aplicação de
//    verdade espera o arrasto sossegar.
//
// 2. MOSTRAR O NÚMERO REAL, NÃO A PORCENTAGEM.
//    "45%" não diz nada. "40.500 partículas" diz — e deixa comparar com o custo
//    que se vê no painel do motor. A porcentagem é do degrau ATUAL, então o
//    número muda sozinho quando o monitor de desempenho degrada; mostrar o
//    absoluto é o que torna isso visível em vez de misterioso.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from "react";
import { useGlobeStore } from "../../store/globeStore";
import { usePerfStore } from "../../store/perfStore";
import { TIERS } from "../../perf";

/**
 * Não recebe referência do motor. Ele só escreve no store, e o `GlobeViewport`
 * — que é quem tem o motor — reage. Passar uma referência do globo até aqui
 * atravessaria quatro componentes e criaria um segundo caminho para mexer na
 * mesma coisa.
 */
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
