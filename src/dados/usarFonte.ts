// src/dados/usarFonte.ts
// -----------------------------------------------------------------------------
// UM HOOK PARA TODA FONTE EXTERNA
// -----------------------------------------------------------------------------
// Cada camada nova do app repetia o mesmo bloco: `useEffect`, `fetch`, `try`,
// `setState`, e uma string de erro guardada em algum lugar diferente. O bloco
// nunca era idêntico, e por isso cada camada falhava de um jeito próprio.
//
// Aqui ele é um só, e todo o comportamento difícil — não rebuscar antes do
// backoff, não trocar dado bom por spinner, manter o dado velho na tela quando
// a atualização falha — vem de `estado.ts`, que é testado.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useFontesStore } from "../store/fontesStore.ts";
import { criarFonte, deveTentar, type Fonte } from "./estado.ts";

export interface Opcoes {
  id: string;
  rotulo: string;
  url: string | null;
  /** de quanto em quanto tempo o dado envelhece */
  validadeMs: number;
  /** desligada, a fonte não é buscada e não conta como falha */
  ligada?: boolean;
}

export interface Resultado<T> {
  dado: T | null;
  fonte: Fonte;
  /** força uma nova tentativa agora, ignorando o backoff */
  repetir: () => void;
}

export function useFonte<T>({ id, rotulo, url, validadeMs, ligada = true }: Opcoes): Resultado<T> {
  const [dado, setDado] = useState<T | null>(null);
  const [gatilho, setGatilho] = useState(0);

  const registrar = useFontesStore((s) => s.registrar);
  const buscando = useFontesStore((s) => s.buscando);
  const sucesso = useFontesStore((s) => s.sucesso);
  const falha = useFontesStore((s) => s.falha);
  const soltar = useFontesStore((s) => s.soltar);
  const fonte = useFontesStore((s) => s.fontes[id]);

  useEffect(() => { registrar(id, rotulo, validadeMs); }, [id, rotulo, validadeMs, registrar]);

  // `deveTentar` lê o estado no instante da decisão. Guardá-lo numa ref evita
  // que o efeito dependa do objeto inteiro da fonte — que muda a cada
  // atualização e reiniciaria o efeito em laço.
  const refFonte = useRef(fonte);
  refFonte.current = fonte;
  /** pedido explícito de nova tentativa, que ignora o backoff */
  const forcar = useRef(false);

  useEffect(() => {
    if (!ligada || !url) { soltar(id); return; }

    let vivo = true;
    const abortar = new AbortController();

    const tentar = () => {
      const atual = refFonte.current ?? criarFonte(id, rotulo, validadeMs);
      // "Tentar de novo" pedido por uma pessoa ATRAVESSA o backoff. O backoff
      // existe para não martelar a fonte sozinho; quem clicou já sabe que a
      // coisa falhou e está pedindo outra tentativa agora.
      if (forcar.current) forcar.current = false;
      else if (!deveTentar(atual, Date.now())) return;

      buscando(id);
      fetch(url, { signal: abortar.signal })
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          // O erro carrega o status para `explicarFalha` poder traduzir a faixa
          // — 404, 429 e 503 dizem coisas diferentes a quem olha o mapa.
          if (!r.ok || j?.ok === false) {
            throw Object.assign(new Error(j?.error ?? `HTTP ${r.status}`), { status: r.status });
          }
          return j as T;
        })
        .then((j) => { if (vivo) { setDado(j); sucesso(id); } })
        .catch((e: Error) => {
          if (!vivo || e.name === "AbortError") return;
          // O DADO ANTERIOR NÃO É APAGADO. É o que permite a fonte ficar
          // "degradada" em vez de "indisponível", e a camada continuar
          // desenhada com o aviso de que está velha.
          falha(id, e);
        });
    };

    tentar();
    // O relógio é curto porque quem decide se vale tentar é `deveTentar`, com
    // o backoff dentro dele. Este intervalo só dá a ele a chance de decidir.
    const t = setInterval(tentar, 20_000);
    return () => { vivo = false; abortar.abort(); clearInterval(t); };
  }, [id, url, ligada, validadeMs, rotulo, gatilho, buscando, sucesso, falha, soltar]);

  return {
    dado,
    fonte: fonte ?? criarFonte(id, rotulo, validadeMs),
    repetir: () => { forcar.current = true; setGatilho((g) => g + 1); },
  };
}
