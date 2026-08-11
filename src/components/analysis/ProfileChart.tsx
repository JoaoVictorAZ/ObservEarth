// src/components/analysis/ProfileChart.tsx
// -----------------------------------------------------------------------------
// PERFIL VERTICAL — diagrama de temperatura e orvalho contra pressão.
//
// POR QUE O EIXO VERTICAL É LOGARÍTMICO
// A atmosfera não se distribui igualmente na pressão: entre 1000 e 500 hPa há
// ~5,5 km, e entre 500 e 100 hPa há mais ~10 km. Num eixo linear em pressão, a
// metade superior da troposfera fica espremida e a tropopausa — que é o que se
// procura numa sondagem — some. Todo diagrama aeronáutico (skew-T, tefigrama)
// usa log de pressão pelo mesmo motivo: em log(p), a altura fica quase linear.
//
// AS DUAS CURVAS
// Temperatura e ponto de orvalho. A DISTÂNCIA entre elas é a leitura principal:
// juntas significam ar saturado (nuvem), afastadas significam ar seco. Por isso
// elas ficam no mesmo par de eixos, e não em gráficos separados.
//
// O orvalho é derivado por Magnus-Tetens no servidor e vai rotulado como
// derivado — a legenda diz isso, não fica só no comentário do código.
// -----------------------------------------------------------------------------

import React from "react";

export interface Nivel {
  pressao: number;
  altura: number | null;
  temperatura: number | null;
  umidade: number | null;
  orvalho: number | null;
  ventoVel: number | null;
  ventoDir: number | null;
}

const L = 44, R = 92, T = 12, B = 26, W = 720, H = 340;

/** seta de vento na convenção meteorológica: aponta PARA ONDE o ar vai */
const Barbela: React.FC<{ x: number; y: number; dir: number; vel: number }> = ({ x, y, dir, vel }) => {
  const r = 4 + Math.min(9, vel / 4);
  const rad = ((dir + 180) * Math.PI) / 180;   // dir = de onde vem
  const dx = Math.sin(rad) * r, dy = -Math.cos(rad) * r;
  return (
    <g className="prf-vento">
      <line x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} />
      <circle cx={x + dx} cy={y + dy} r="1.6" />
    </g>
  );
};

export const ProfileChart: React.FC<{ perfil: Nivel[] }> = ({ perfil }) => {
  const validos = perfil.filter((p) => p.temperatura != null);
  if (!validos.length) return null;

  const temps = validos.flatMap((p) => [p.temperatura!, p.orvalho ?? p.temperatura!]);
  const tMin = Math.floor(Math.min(...temps) / 10) * 10;
  const tMax = Math.ceil(Math.max(...temps) / 10) * 10;

  const pTopo = Math.min(...perfil.map((p) => p.pressao));
  const pBase = Math.max(...perfil.map((p) => p.pressao));

  // log(p): é o que torna a altura quase linear no eixo.
  const lp = (p: number) => Math.log(p);
  const y = (p: number) => T + ((lp(pBase) - lp(p)) / (lp(pBase) - lp(pTopo))) * (H - T - B);
  const x = (t: number) => L + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * (W - L - R);

  const traco = (campo: "temperatura" | "orvalho") =>
    perfil
      .filter((p) => p[campo] != null)
      .map((p, i) => `${i ? "L" : "M"} ${x(p[campo]!).toFixed(1)},${y(p.pressao).toFixed(1)}`)
      .join(" ");

  const tTicks: number[] = [];
  for (let t = tMin; t <= tMax; t += 10) tTicks.push(t);

  return (
    <figure className="prf">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Perfil vertical: ${validos.length} níveis com temperatura, de ${pBase} a ${pTopo} hPa`}>
        {tTicks.map((t) => (
          <g key={t}>
            <line className={`prf-grade ${t === 0 ? "prf-zero" : ""}`} x1={x(t)} x2={x(t)} y1={T} y2={H - B} />
            <text className="prf-tick" x={x(t)} y={H - 8} textAnchor="middle">{t}</text>
          </g>
        ))}

        {perfil.map((p) => (
          <g key={p.pressao}>
            <line className="prf-grade prf-nivel" x1={L} x2={W - R} y1={y(p.pressao)} y2={y(p.pressao)} />
            <text className="prf-tick" x={L - 6} y={y(p.pressao)} dy="0.32em" textAnchor="end">{p.pressao}</text>
            {/* Altura geopotencial MEDIDA, não altitude de tabela. A própria
                Open-Meteo avisa que 1000 hPa fica entre 60 e 160 m. */}
            {p.altura != null && (
              <text className="prf-alt" x={W - R + 8} y={y(p.pressao)} dy="0.32em">
                {(p.altura / 1000).toFixed(1)} km
              </text>
            )}
            {p.ventoVel != null && p.ventoDir != null && (
              <Barbela x={W - R - 16} y={y(p.pressao)} dir={p.ventoDir} vel={p.ventoVel} />
            )}
          </g>
        ))}

        <path className="prf-orvalho" d={traco("orvalho")} />
        <path className="prf-temp" d={traco("temperatura")} />

        {perfil.filter((p) => p.temperatura != null).map((p) => (
          <circle key={p.pressao} className="prf-pt" cx={x(p.temperatura!)} cy={y(p.pressao)} r="2" />
        ))}
      </svg>

      <figcaption className="prf-leg">
        <span className="prf-k prf-k-temp">temperatura</span>
        <span className="prf-k prf-k-orv">orvalho <small>(derivado de T e UR)</small></span>
        <span className="prf-k prf-k-vento">vento — a seta aponta para onde o ar vai</span>
        <span className="prf-eixo">eixo vertical em log(pressão); alturas à direita são geopotenciais medidas</span>
      </figcaption>
    </figure>
  );
};
