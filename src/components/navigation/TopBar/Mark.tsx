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
