
import { useEffect, useRef } from "react";
import { entrar, sair, noTopo, type Ficha } from "../pilhaDialogos";

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
  /**
   * LEVAR O FOCO PARA DENTRO AO ABRIR.
   *
   * Verdade para MODAL: quem abre um modal quer operá-lo, e deixar o foco lá
   * fora é o defeito de acessibilidade mais comum que existe.
   *
   * FALSO para janela flutuante, e isto foi um defeito de verdade. O terminal
   * do ponto é uma janela, não um modal: ela convive com o globo em vez de
   * bloqueá-lo. Puxando o foco na montagem, cada clique no globo tirava o
   * cursor de onde a pessoa estava e o jogava dentro do terminal — e como o
   * terminal remonta a cada ponto novo, isso acontecia a cada clique.
   */
  focar?: boolean;
}

export function useDialog<T extends HTMLElement>({
  aberto, aoFechar, prender = false, focar = prender,
}: OpcoesDialogo) {
  const ref = useRef<T | null>(null);
  const anterior = useRef<HTMLElement | null>(null);

  // A FUNÇÃO DE FECHAR NUMA REFERÊNCIA, e não na lista de dependências.
  //
  // Quem chama passa uma arrow criada no corpo do componente, então ela tem
  // identidade nova a cada renderização. Com ela na lista, o efeito desmontava
  // e remontava a cada renderização do pai: o ouvinte de tecla era removido e
  // recolocado, a pilha de diálogos era refeita, e — pior — a devolução de
  // foco da limpeza disparava no meio da digitação. Bastava a hora da linha do
  // tempo mudar para o cursor pular.
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;

    const ficha: Ficha = entrar();

    // guarda quem tinha o foco, para devolver depois
    anterior.current = document.activeElement as HTMLElement | null;

    if (focar) {
      // o primeiro elemento útil, não o contêiner
      const dentro = ref.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
      (dentro?.[0] ?? ref.current)?.focus?.();
    }

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // SÓ A SUPERFÍCIE DO TOPO REAGE. Ver `src/pilhaDialogos.ts`: com todos
        // reagindo, um `Esc` para fechar o modal fechava o terminal atrás dele.
        if (!noTopo(ficha)) return;
        e.stopPropagation();
        fechar.current();
        return;
      }
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
      sair(ficha);
      // devolve o foco a quem o tinha — só se ele foi tomado, e só se o dono
      // anterior ainda estiver no documento
      if (!focar) return;
      const alvo = anterior.current;
      if (alvo && document.contains(alvo)) alvo.focus?.();
    };
  }, [aberto, prender, focar]);

  return ref;
}
