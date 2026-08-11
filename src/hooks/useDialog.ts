// src/hooks/useDialog.ts
// -----------------------------------------------------------------------------
// COMPORTAMENTO DE DIÁLOGO — Esc, foco preso, foco devolvido.
//
// A AUDITORIA ENCONTROU TRÊS DIÁLOGOS SEM NENHUM DOS TRÊS:
// PointChat, AnalysisModal e CommandPalette. Nenhum fecha com Esc, nenhum
// move o foco para dentro, nenhum devolve o foco ao fechar.
//
// O que isso significa na prática, para quem navega por teclado:
//
//   · abre o terminal, mas o foco continua no botão que o abriu — atrás do
//     painel. Tab passeia pelo mapa inteiro antes de chegar ao campo de texto.
//   · não há como fechar sem encontrar o ✕ com o cursor.
//   · ao fechar, o foco vai para o começo do documento. A pessoa perde o lugar
//     onde estava e recomeça a navegação do zero.
//
// Nada disso aparece em teste de clique, e nada disso é opcional: WCAG 2.1
// exige 2.1.2 (sem armadilha de teclado) e 2.4.3 (ordem de foco coerente).
//
// Um observatório para trabalho de campo tem chance real de ser usado por
// alguém de mãos ocupadas, com luva, ou num terminal sem mouse decente.
// -----------------------------------------------------------------------------

import { useEffect, useRef } from "react";

const FOCAVEIS = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface OpcoesDialogo {
  aberto: boolean;
  aoFechar: () => void;
  /** prender o foco dentro do painel (modal) ou apenas levar para dentro */
  prender?: boolean;
}

export function useDialog<T extends HTMLElement>({ aberto, aoFechar, prender = false }: OpcoesDialogo) {
  const ref = useRef<T | null>(null);
  const anterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    // 1. guarda quem tinha o foco, para devolver depois
    anterior.current = document.activeElement as HTMLElement | null;

    // 2. leva o foco para dentro — o primeiro elemento útil, não o contêiner
    const dentro = ref.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
    (dentro?.[0] ?? ref.current)?.focus?.();

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); aoFechar(); return; }
      if (e.key !== "Tab" || !prender || !ref.current) return;

      const itens = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCAVEIS))
        .filter((el) => el.offsetParent !== null);
      if (!itens.length) return;

      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      // O ciclo é o que impede a "armadilha invertida": sem ele, Tab no último
      // item joga o foco para a barra de endereços e a pessoa não volta.
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault(); primeiro.focus();
      }
    };

    document.addEventListener("keydown", aoTeclar, true);
    return () => {
      document.removeEventListener("keydown", aoTeclar, true);
      // 3. devolve o foco a quem o tinha — só se ainda estiver no documento
      const alvo = anterior.current;
      if (alvo && document.contains(alvo)) alvo.focus?.();
    };
  }, [aberto, aoFechar, prender]);

  return ref;
}
