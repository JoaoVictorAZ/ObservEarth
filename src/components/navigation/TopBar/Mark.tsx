// src/components/navigation/TopBar/Mark.tsx
// -----------------------------------------------------------------------------
// A MARCA — desenhada, não escolhida de uma biblioteca.
//
// Antes era o `Globe` do lucide: o mesmo desenho que aparece em milhares de
// aplicações, ao lado do mesmo ícone de painel. Um instrumento não se
// identifica com o ícone genérico de "internet".
//
// O que este desenho é: um RETÍCULO GEOGRÁFICO. Um círculo (o limbo), o
// equador e um meridiano centrais, dois paralelos em elipse, e um pequeno
// tique no polo. É a redução mínima de uma projeção ortográfica — a mesma que
// o globo do aplicativo usa — e é o que uma lente de observação mostra quando
// se olha por ela.
//
// As elipses dos paralelos usam rx = R·cos(φ) e ry pequeno: é a projeção de
// verdade, não uma curva a olho. Em 30° e −30°, cos φ = 0,866.
//
// O ponto de sinal fica FORA do desenho, na composição, porque ele carrega
// estado (ver StatusDot) e o desenho não deve mudar de significado.
// -----------------------------------------------------------------------------

import React from "react";

export const Mark: React.FC<{ size?: number }> = ({ size = 22 }) => {
  const R = 10;
  const cos30 = Math.cos((30 * Math.PI) / 180);   // 0,8660

  return (
    <svg
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      className="marca"
      role="img"
      aria-label="Observatório da Terra"
    >
      {/* limbo */}
      <circle r={R} className="marca-limbo" />

      {/* equador e meridiano central: as duas retas da ortográfica */}
      <line x1={-R} y1="0" x2={R} y2="0" className="marca-fio" />
      <line x1="0" y1={-R} x2="0" y2={R} className="marca-fio" />

      {/* paralelos de ±30°: projeção real, rx = R·cos(φ) */}
      <ellipse cx="0" cy={-R * 0.5} rx={R * cos30} ry={R * 0.17} className="marca-fio" />
      <ellipse cx="0" cy={R * 0.5} rx={R * cos30} ry={R * 0.17} className="marca-fio" />

      {/* tique polar: o detalhe que faz o desenho parecer instrumento */}
      <line x1="0" y1={-R - 2.5} x2="0" y2={-R + 1} className="marca-tique" />
    </svg>
  );
};
