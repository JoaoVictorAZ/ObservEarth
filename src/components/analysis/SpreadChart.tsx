import React, { useId } from "react";

export interface Modelo { id: string; sigla: string; centro: string; grade: string; }
export interface Disp { n: number; min: number | null; max: number | null; amplitude: number | null; media: number | null; }

interface Props {
  tempo: string[];
  modelos: Modelo[];
  serie: Record<string, (number | null)[] | null>;
  porHora: Disp[];
  rotulo: string;
  unidade: string;
  casas?: number;
}

const L = 46, R = 10, T = 12, B = 24, W = 720, H = 210;
const TRACO = ["", "5 3", "1.5 3"];   // contínua, tracejada, pontilhada

const hora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}Z`;
};

export const SpreadChart: React.FC<Props> = ({
  tempo, modelos, serie, porHora, rotulo, unidade, casas = 1,
}) => {
  const uid = useId().replace(/:/g, "");
  const presentes = modelos.filter((m) => serie[m.id]);

  const todos = presentes.flatMap((m) => (serie[m.id] ?? []).filter((v): v is number => v != null));
  if (!todos.length) {
    return (
      <figure className="grf grf-vazio">
        <figcaption>{rotulo} <span>({unidade})</span></figcaption>
        <p>Nenhum dos três centros publicou este campo aqui.</p>
      </figure>
    );
  }

  const lo = Math.min(...todos), hi = Math.max(...todos);
  const folga = (hi - lo) * 0.08 || 1;
  const y = (v: number) => H - B - ((v - lo + folga) / (hi - lo + 2 * folga)) * (H - T - B);
  const x = (i: number) => L + (i / Math.max(1, tempo.length - 1)) * (W - L - R);

  // Faixa de desacordo: entre o menor e o maior valor de qualquer modelo, hora
  // a hora. Só onde há dois ou mais — com um só, não existe desacordo a medir.
  const comDois = porHora.map((d, i) => ({ d, i })).filter(({ d }) => d.n >= 2 && d.min != null);
  const banda = comDois.length >= 2
    ? `M ${comDois.map(({ d, i }) => `${x(i).toFixed(1)},${y(d.max!).toFixed(1)}`).join(" L ")}` +
      ` L ${[...comDois].reverse().map(({ d, i }) => `${x(i).toFixed(1)},${y(d.min!).toFixed(1)}`).join(" L ")} Z`
    : null;

  const pior = porHora.reduce<{ a: number; i: number } | null>(
    (best, d, i) => (d.amplitude != null && (!best || d.amplitude > best.a) ? { a: d.amplitude, i } : best), null);

  return (
    <figure className="grf esp">
      <figcaption>
        {rotulo} <span>({unidade})</span>
        <small>
          {presentes.length === 3 ? "três centros" : `${presentes.length} de 3 centros`}
          {pior && ` · maior desacordo ${pior.a.toFixed(casas)} ${unidade} em ${hora(tempo[pior.i])}`}
        </small>
      </figcaption>

      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={
          `${rotulo}: ${presentes.map((m) => m.sigla).join(", ")}. ` +
          (pior ? `Maior desacordo entre modelos: ${pior.a.toFixed(casas)} ${unidade}.` : "Sem desacordo medível.")
        }>
        <defs>
          <linearGradient id={`e${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warn)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--warn)" stopOpacity="0.07" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line className="grf-grade" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text className="grf-tick" x={L - 6} y={y(v)} dy="0.32em" textAnchor="end">{v.toFixed(casas)}</text>
            </g>
          );
        })}

        {banda && <path className="esp-banda" d={banda} fill={`url(#e${uid})`} />}

        {presentes.map((m, k) => {
          const vals = serie[m.id]!;
          // A linha quebra onde o modelo não publicou aquela hora.
          const d = vals.reduce((acc, v, i) => {
            if (v == null) return `${acc} `;
            const cmd = i === 0 || vals[i - 1] == null ? "M" : "L";
            return `${acc}${cmd} ${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          }, "");
          return <path key={m.id} className="esp-linha" d={d} strokeDasharray={TRACO[k % 3]} />;
        })}

        {pior && (
          <line className="esp-pior" x1={x(pior.i)} x2={x(pior.i)} y1={T} y2={H - B} />
        )}

        <text className="grf-tick" x={L} y={H - 6}>{hora(tempo[0])}</text>
        <text className="grf-tick" x={W - R} y={H - 6} textAnchor="end">{hora(tempo[tempo.length - 1])}</text>
      </svg>

      <div className="esp-leg">
        {presentes.map((m, k) => (
          <span key={m.id} className="esp-k">
            <svg width="22" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="22" y2="3" strokeDasharray={TRACO[k % 3]} />
            </svg>
            <strong>{m.sigla}</strong> <small>{m.centro} · {m.grade}</small>
          </span>
        ))}
        <span className="esp-k esp-k-banda">faixa = desacordo entre os modelos naquela hora</span>
      </div>
    </figure>
  );
};
