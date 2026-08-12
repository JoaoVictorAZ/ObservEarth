import React, { useId, useMemo } from "react";
import { pontos, envelope, extremos, trechos, escala, marcas, type Ponto } from "../../analysis/series";

const L = 52;    // canaleta do eixo vertical
const R = 8;
const T = 10;
const B = 22;    // canaleta do eixo do tempo
const W = 720;
const H = 190;

interface Props {
  tempo: string[];
  valores: (number | null)[];
  rotulo: string;
  unidade: string;
  casas?: number;
  /** vão além do qual dois pontos deixam de ser vizinhos (ms) */
  vaoMax?: number;
}

const dataCurta = (ms: number) =>
  new Date(ms).toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/");

const dataLonga = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const SeriesChart: React.FC<Props> = ({
  tempo, valores, rotulo, unidade, casas = 1, vaoMax = 2 * 86400e3,
}) => {
  // `useId` em vez de um id derivado da cor. O anterior gerava
  // `id="grad-#32d6a5"`, referenciado como `url(#grad-#32d6a5)` — o `#` no meio
  // quebra a referência, e dois gráficos da mesma cor colidiam de id.
  const uid = useId().replace(/:/g, "");

  const calc = useMemo(() => {
    const ps: Ponto[] = pontos(tempo, valores);
    const cols = envelope(ps, Math.round(W - L - R));
    const ext = extremos(ps);
    if (!cols.length || !ext) return null;

    const lo0 = Math.min(...cols.map((c) => c.min));
    const hi0 = Math.max(...cols.map((c) => c.max));
    const esc = escala(lo0, hi0);
    const t0 = cols[0].t, t1 = cols[cols.length - 1].t;
    const spanT = Math.max(1, t1 - t0);

    const x = (t: number) => L + ((t - t0) / spanT) * (W - L - R);
    const y = (v: number) => H - B - ((v - esc.lo) / Math.max(1e-9, esc.hi - esc.lo)) * (H - T - B);

    const partes = trechos(cols, vaoMax * 3);
    const linha = partes.map((p) =>
      p.map((c, i) => `${i ? "L" : "M"} ${x(c.t).toFixed(2)},${y(c.media).toFixed(2)}`).join(" ")
    );
    // Faixa só onde há mais de uma observação por coluna: com uma, min = max e
    // a faixa seria uma linha grudada na média, sugerindo dispersão inexistente.
    const reduziu = cols.some((c) => c.n > 1);
    const faixa = reduziu ? partes.map((p) => {
      const ida = p.map((c) => `${x(c.t).toFixed(2)},${y(c.max).toFixed(2)}`).join(" L ");
      const volta = [...p].reverse().map((c) => `${x(c.t).toFixed(2)},${y(c.min).toFixed(2)}`).join(" L ");
      return `M ${ida} L ${volta} Z`;
    }) : [];

    return {
      cols, ext, esc, x, y, linha, faixa, reduziu,
      nObs: ps.filter((p) => p.v != null).length,
      nFalt: ps.length - ps.filter((p) => p.v != null).length,
      buracos: partes.length - 1,
      t0, t1,
    };
  }, [tempo, valores, vaoMax]);

  const f = (v: number) => v.toFixed(casas);

  if (!calc) {
    return (
      <figure className="grf grf-vazio">
        <figcaption>{rotulo} <span>({unidade})</span></figcaption>
        <p>A fonte não publicou nenhum valor desta grandeza no período. Nada foi estimado.</p>
      </figure>
    );
  }

  const { ext, esc, x, y, linha, faixa, reduziu, nObs, nFalt, buracos, t0, t1 } = calc;
  const ticks = marcas(esc.lo, esc.hi, esc.passo);

  return (
    <figure className="grf">
      <figcaption>
        {rotulo} <span>({unidade})</span>
        <small>
          {nObs.toLocaleString("pt-BR")} observações
          {nFalt > 0 && ` · ${nFalt.toLocaleString("pt-BR")} sem dado`}
          {reduziu && " · faixa = variação dentro de cada coluna"}
        </small>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          `${rotulo} de ${dataLonga(t0)} a ${dataLonga(t1)}. ` +
          `Mínimo ${f(ext.min.valor)} ${unidade} em ${dataLonga(ext.min.t)}, ` +
          `máximo ${f(ext.max.valor)} ${unidade} em ${dataLonga(ext.max.t)}. ` +
          (nFalt ? `${nFalt} dias sem dado.` : "Sem lacunas.")
        }
      >
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--signal)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line className="grf-grade" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="grf-tick" x={L - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {v.toFixed(esc.passo < 1 ? 1 : 0)}
            </text>
          </g>
        ))}

        {faixa.map((d, i) => <path key={`f${i}`} className="grf-faixa" d={d} fill={`url(#g${uid})`} />)}
        {linha.map((d, i) => <path key={`l${i}`} className="grf-linha" d={d} />)}

        <circle className="grf-ext" cx={x(ext.min.t)} cy={y(ext.min.valor)} r="2.5" />
        <circle className="grf-ext" cx={x(ext.max.t)} cy={y(ext.max.valor)} r="2.5" />

        <text className="grf-tick" x={L} y={H - 6}>{dataCurta(t0)}</text>
        <text className="grf-tick" x={W - R} y={H - 6} textAnchor="end">{dataCurta(t1)}</text>
      </svg>

      {/* A legenda diz o valor E A DATA EM QUE ELE OCORREU. A anterior colava o
          mínimo da série na data do primeiro ponto. */}
      <div className="grf-leg">
        <span>mín <strong>{f(ext.min.valor)} {unidade}</strong> em {dataLonga(ext.min.t)}</span>
        <span>máx <strong>{f(ext.max.valor)} {unidade}</strong> em {dataLonga(ext.max.t)}</span>
        {buracos > 0 && (
          <span className="grf-buraco" title="A linha quebra onde não há observação">
            {buracos} interrupç{buracos > 1 ? "ões" : "ão"}
          </span>
        )}
      </div>
    </figure>
  );
};
