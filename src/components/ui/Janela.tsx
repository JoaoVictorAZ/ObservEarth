// src/components/ui/Janela.tsx
// -----------------------------------------------------------------------------
// Componente de janela flutuante arrastável e redimensionável.
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, X } from "lucide-react";

import { arrastar, travar, MOVER, type Caixa } from "../../arrasto";

export type { Caixa };

interface Props {
  id: string;
  titulo: string;
  subtitulo?: string;
  padrao: Caixa;
  minW?: number;
  minH?: number;
  onFechar?: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}

function ler(id: string, padrao: Caixa): Caixa {
  try {
    const t = localStorage.getItem(`obs:jan:${id}`);
    if (!t) return padrao;
    const c = JSON.parse(t);
    // Uma caixa salva numa tela grande pode não caber na atual. Validar aqui
    // evita a janela nascer fora da vista, onde não dá para trazê-la de volta.
    if ([c.x, c.y, c.w, c.h].every((v) => Number.isFinite(v))) return c;
  } catch { /* sem persistência, usa o padrão */ }
  return padrao;
}

export const Janela: React.FC<Props> = ({
  id, titulo, subtitulo, padrao, minW = 300, minH = 200, onFechar, extra, children,
}) => {
  const [caixa, setCaixa] = useState<Caixa>(() => ler(id, padrao));
  const [movendo, setMovendo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ px: number; py: number; c: Caixa; modo: string } | null>(null);

  const limites = useCallback(() => ({
    minW, minH, telaW: window.innerWidth, telaH: window.innerHeight,
  }), [minW, minH]);

  useEffect(() => {
    const aoRedimensionar = () => setCaixa((c) => travar(c, limites()));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [limites]);

  useEffect(() => {
    try { localStorage.setItem(`obs:jan:${id}`, JSON.stringify(caixa)); } catch { /* segue */ }
  }, [id, caixa]);

  const pegar = (modo: string) => (e: React.PointerEvent) => {
    // Só o botão principal. O secundário abre menu do navegador e deixaria a
    // janela presa ao cursor sem nunca receber o "soltar".
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    inicio.current = { px: e.clientX, py: e.clientY, c: caixa, modo };
    setMovendo(true);
  };

  const mover = (e: React.PointerEvent) => {
    const i = inicio.current;
    if (!i) return;
    setCaixa(arrastar(i.modo, e.clientX - i.px, e.clientY - i.py, i.c, limites()));
  };

  const soltar = (e: React.PointerEvent) => {
    inicio.current = null;
    setMovendo(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* já solto */ }
  };

  const puxador = (modo: string, classe: string) => (
    <div
      className={`jan-puxa ${classe}`}
      onPointerDown={pegar(modo)}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      role="separator"
      aria-label={`Redimensionar ${titulo}`}
    />
  );

  return (
    <div
      ref={ref}
      className={`jan ${movendo ? "jan-movendo" : ""}`}
      style={{ left: caixa.x, top: caixa.y, width: caixa.w, height: caixa.h }}
      role="dialog"
      aria-label={titulo}
    >
      <header
        className="jan-topo"
        onPointerDown={pegar(MOVER)}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
      >
        <GripVertical size={13} strokeWidth={1.5} className="jan-pega" aria-hidden="true" />
        <h2 className="jan-tit">{titulo}</h2>
        {subtitulo && <span className="jan-sub">{subtitulo}</span>}
        {extra}
        {onFechar && (
          <button className="jan-btn" onClick={onFechar} aria-label={`Fechar ${titulo}`}>
            <X size={14} strokeWidth={1.6} />
          </button>
        )}
      </header>

      <div className="jan-corpo">{children}</div>

      {puxador("e", "jan-puxa-e")}
      {puxador("d", "jan-puxa-d")}
      {puxador("b", "jan-puxa-b")}
      {puxador("db", "jan-puxa-c")}
    </div>
  );
};
