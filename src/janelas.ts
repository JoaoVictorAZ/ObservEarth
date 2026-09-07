// src/janelas.ts
// -----------------------------------------------------------------------------
// O COMPORTAMENTO DE JANELA FLUTUANTE — uma cópia só.
// -----------------------------------------------------------------------------
// `src/arrasto.ts` já guarda a GEOMETRIA do arraste, e o cabeçalho dele conta
// por que: a mesma conta escrita três vezes carregava o mesmo defeito nas três.
//
// O que sobrou duplicado foi tudo em volta — ler a posição salva, validá-la,
// regravá-la, prender os ouvintes de ponteiro, travar no redimensionamento da
// tela, decidir o z-index pelo foco. Sessenta linhas quase idênticas em
// `ProbePanel` e `PointChat`, e a diferença entre elas não era intencional: era
// deriva.
//
// A deriva já custou. O botão "organizar janelas" apagava as chaves do
// `localStorage` e disparava um `resize`, e não movia nada — a posição estava
// em estado de React dentro de cada janela, e cada uma regravava a chave na
// alteração seguinte. Apagar o disco não move o que está na memória. Com o
// comportamento num lugar só, "recolocar" é uma linha e vale para as duas.
// -----------------------------------------------------------------------------

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { arrastar, travar, lerCaixa, type Caixa, type Limites } from "./arrasto";
import { useWindowStore } from "./store/windowStore";

export type { Caixa };
export { MOVER, caixaUsavel, lerCaixa } from "./arrasto";

/** Aviso de "recoloque-se". Ver `handleOrganizarJanelas` no AppShell. */
export const EVENTO_ORGANIZAR = "obs:organizar-janelas";

export interface OpcoesJanela {
  /** identidade no `windowStore`: quem está na frente */
  id: string;
  /** chave de `localStorage` da posição */
  chave: string;
  /** posição e tamanho de fábrica, recalculados a partir do tamanho da tela */
  padrao: () => Caixa;
  minW: number;
  minH: number;
  /** verdade quando não há outra janela e esta deve valer como focada */
  focoPadrao?: boolean;
}

export interface EstadoJanela {
  caixa: Caixa;
  movendo: boolean;
  focada: boolean;
  minimizada: boolean;
  /** `onPointerDown` do cabeçalho e dos puxadores de borda */
  iniciarArrasto: (modo: string) => (e: React.PointerEvent) => void;
  /** `onPointerDownCapture` do contêiner: clicar traz para a frente */
  trazerParaFrente: () => void;
  alternarMinimizar: () => void;
  /** volta ao lugar de fábrica; também responde ao aviso de organizar */
  recolocar: () => void;
  /** `left/top/width/height/zIndex` prontos para o `style` */
  estilo: React.CSSProperties;
}

export function useJanelaFlutuante(opc: OpcoesJanela): EstadoJanela {
  const { id, chave, padrao, minW, minH, focoPadrao = false } = opc;

  const activeWindow = useWindowStore((w) => w.activeWindow);
  const focusWindow = useWindowStore((w) => w.focusWindow);
  const minimizedWindows = useWindowStore((w) => w.minimizedWindows);
  const toggleMinimize = useWindowStore((w) => w.toggleMinimize);

  const padraoRef = useRef(padrao);
  padraoRef.current = padrao;

  const [caixa, setCaixa] = useState<Caixa>(() =>
    lerCaixa(chave, padrao(), window.innerWidth, window.innerHeight));
  const [movendo, setMovendo] = useState(false);

  const caixaRef = useRef(caixa);
  caixaRef.current = caixa;

  const limites = useCallback((): Limites => ({
    minW, minH, telaW: window.innerWidth, telaH: window.innerHeight,
  }), [minW, minH]);

  useEffect(() => {
    const aoRedimensionar = () => setCaixa((c) => travar(c, limites()));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [limites]);

  useEffect(() => {
    try { localStorage.setItem(chave, JSON.stringify(caixa)); } catch { /* segue */ }
  }, [chave, caixa]);

  const recolocar = useCallback(() => {
    setCaixa(travar(padraoRef.current(), limites()));
  }, [limites]);

  useEffect(() => {
    window.addEventListener(EVENTO_ORGANIZAR, recolocar);
    return () => window.removeEventListener(EVENTO_ORGANIZAR, recolocar);
  }, [recolocar]);

  const trazerParaFrente = useCallback(() => focusWindow(id), [focusWindow, id]);

  /**
   * O arraste prende os ouvintes em `window`, e não no elemento.
   *
   * Com eles no elemento, um movimento rápido tira o cursor de cima da janela
   * antes do quadro seguinte e a janela "solta" sozinha no meio do gesto. Em
   * `window` o gesto sobrevive até o `pointerup`, esteja o cursor onde estiver
   * — inclusive fora da aba.
   */
  const iniciarArrasto = useCallback((modo: string) => (e: React.PointerEvent) => {
    // Só o botão principal. O secundário abre o menu do navegador e deixaria a
    // janela presa ao cursor sem nunca receber o "soltar".
    if (e.button !== 0) return;
    // Controles dentro do cabeçalho continuam sendo controles.
    const alvo = e.target as HTMLElement;
    if (alvo.closest("button, input, select, textarea, a")) return;

    e.preventDefault();
    focusWindow(id);

    const px = e.clientX, py = e.clientY;
    const inicio = { ...caixaRef.current };
    setMovendo(true);

    const aoMover = (ev: PointerEvent) => {
      setCaixa(arrastar(modo, ev.clientX - px, ev.clientY - py, inicio, limites()));
    };
    const aoSoltar = () => {
      setMovendo(false);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
  }, [focusWindow, id, limites]);

  const focada = activeWindow === id || (focoPadrao && activeWindow === null);
  const minimizada = !!minimizedWindows[id];

  return {
    caixa, movendo, focada, minimizada,
    iniciarArrasto, trazerParaFrente,
    alternarMinimizar: useCallback(() => toggleMinimize(id), [toggleMinimize, id]),
    recolocar,
    estilo: {
      left: caixa.x,
      top: caixa.y,
      width: caixa.w,
      // Minimizada, a janela é só o cabeçalho: fixar a altura deixaria um
      // retângulo vazio ocupando o mesmo espaço de antes.
      height: minimizada ? "auto" : caixa.h,
      zIndex: focada ? 30 : 20,
    },
  };
}
