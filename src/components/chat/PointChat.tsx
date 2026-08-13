// src/components/chat/PointChat.tsx
// -----------------------------------------------------------------------------
// Terminal do ponto — conversa sobre o dossiê com modelo local LLM (8B).
// Janela flutuante com foco z-index, minimização, arraste e redimensionamento em 8 direções.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from "react";
import { GripVertical, X, Minus, RotateCcw, Layers } from "lucide-react";
import {
  motor, MotorLocal, MODELOS, detectarCapacidade,
  type Capacidade, type EstadoMotor,
} from "../../llm/engine";
import { useChatStore } from "../../store/chatStore";
import { fecharResposta } from "../../llm/resposta";
import { dossieParaTexto, tokensAprox } from "../../llm/contexto";
import { explicarFalhaGpu } from "../../llm/falhas";
import { useWindowStore } from "../../store/windowStore";
import { useDialog } from "../../hooks/useDialog";
import { arrastar, travar, MOVER } from "../../arrasto";

interface Props {
  lat: number;
  lng: number;
  date: string;
  hour: number;
  onFechar: () => void;
  onOrganizarJanelas?: () => void;
}

const CHAT_STORAGE_KEY = "obs:chat:pos:v2";
const MIN_W = 340;
const MIN_H = 220;

function lerPadraoChat(): { x: number; y: number; w: number; h: number } {
  const W = typeof window !== "undefined" ? window.innerWidth : 1200;
  const H = typeof window !== "undefined" ? window.innerHeight : 800;

  const padrao = {
    x: Math.max(20, W - 520),
    y: Math.min(140, H - 450),
    w: 460,
    h: 380,
  };

  try {
    const t = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!t) return padrao;
    const c = JSON.parse(t);
    if ([c.x, c.y, c.w, c.h].every((v: number) => Number.isFinite(v))) {
      if (c.x > 0 && c.x < W - 50 && c.y >= 0 && c.y < H - 50) {
        return c;
      }
    }
  } catch { /* usa padrão */ }
  return padrao;
}

const GB = (n: number) => `${n.toFixed(1)} GB`;

export function PointChat({ lat, lng, date, hour, onFechar, onOrganizarJanelas }: Props) {
  const {
    modeloCarregado, setModeloCarregado,
    modeloEscolhido, setModeloEscolhido,
    msgs, addMsg, patchUltima, trocarPonto, setOcupado,
  } = useChatStore();

  const { activeWindow, focusWindow, minimizedWindows, toggleMinimize } = useWindowStore();

  const [caixa, setCaixa] = useState(lerPadraoChat);
  const [movendo, setMovendo] = useState(false);

  const caixaRef = useRef(caixa);
  caixaRef.current = caixa;

  const isFocused = activeWindow === "chat";
  const isMinimized = !!minimizedWindows["chat"];

  const [cap, setCap] = useState<Capacidade | null>(null);
  const [progresso, setProgresso] = useState<EstadoMotor>({ fase: "ocioso" });
  const [dossie, setDossie] = useState<Record<string, unknown> | null>(null);
  const [erroDossie, setErroDossie] = useState<string | null>(null);
  const [entrada, setEntrada] = useState("");
  const [gerando, setGerando] = useState(false);
  const [verJson, setVerJson] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const painelRef = useDialog<HTMLElement>({ aberto: true, aoFechar: onFechar });
  const abortRef = useRef<AbortController | null>(null);

  const limites = useCallback(() => ({
    minW: MIN_W, minH: MIN_H, telaW: window.innerWidth, telaH: window.innerHeight,
  }), []);

  useEffect(() => {
    const aoRedimensionar = () => setCaixa((c) => travar(c, limites()));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [limites]);

  useEffect(() => {
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(caixa)); } catch { /* segue */ }
  }, [caixa]);

  const iniciarArrasto = (modo: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest("input") ||
      (e.target as HTMLElement).closest("select")
    ) return;

    e.preventDefault();
    focusWindow("chat");
    const startX = e.clientX;
    const startY = e.clientY;
    const startCaixa = { ...caixaRef.current };

    setMovendo(true);

    const aoMover = (ev: PointerEvent) => {
      setCaixa(arrastar(modo, ev.clientX - startX, ev.clientY - startY, startCaixa, limites()));
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
  };

  useEffect(() => {
    if (motor.pronto && motor.modelo) {
      setModeloCarregado(motor.modelo);
      setProgresso({ fase: "pronto", modelo: motor.modelo });
    }
  }, [setModeloCarregado]);

  useEffect(() => {
    detectarCapacidade().then((c) => {
      setCap(c);
      if (!useChatStore.getState().modeloEscolhido) setModeloEscolhido(c.recomendado);
    });
  }, [setModeloEscolhido]);

  useEffect(() => {
    trocarPonto(`${lat.toFixed(3)}:${lng.toFixed(3)}:${date}:${hour}`);
  }, [lat, lng, date, hour, trocarPonto]);

  useEffect(() => {
    let vivo = true;
    setErroDossie(null);
    setDossie(null);
    fetch(`/api/dossier?lat=${lat}&lng=${lng}&date=${date}&hour=${hour}&span=24&step=3`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j;
      })
      .then((d) => { if (vivo) setDossie(d); })
      .catch((e) => { if (vivo) setErroDossie(String(e.message ?? e)); });
    return () => { vivo = false; };
  }, [lat, lng, date, hour]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  // ---------------------------------------------------------------------
  // AVISA QUE A GPU ESTÁ OCUPADA.
  //
  // Baixar e gerar acontecem na MESMA placa que desenha o planeta. Sem este
  // sinal, o motor gráfico continuava com 40 mil partículas a 60 Hz e o
  // console ficava lento a ponto de parecer travado.
  //
  // A limpeza devolve a GPU mesmo se a janela for fechada no meio de uma
  // geração — senão o mapa ficaria pausado para sempre.
  // ---------------------------------------------------------------------
  const ocupada = gerando || progresso.fase === "baixando";
  useEffect(() => {
    setOcupado(ocupada);
    return () => setOcupado(false);
  }, [ocupada, setOcupado]);

  const carregar = useCallback(async () => {
    if (!modeloEscolhido) return;
    try {
      await motor.carregar(modeloEscolhido, setProgresso);
      setModeloCarregado(modeloEscolhido);
      addMsg({
        autor: "sistema",
        texto: `${modeloEscolhido.rotulo} pronto. O dossiê deste ponto está na memória — pergunte.`,
      });
    } catch { /* erro já publicado pelo motor */ }
  }, [modeloEscolhido, setModeloCarregado, addMsg]);

  /**
   * VOLTA PARA A LISTA DE MODELOS.
   *
   * Isto não existia. Depois de carregar um modelo, `pronto` virava true e a
   * tela de escolha desaparecia para sempre — inclusive quando o modelo
   * escolhido não cabia na GPU e nada mais funcionava. O único jeito de trocar
   * era recarregar a página, e nem isso era dito em lugar nenhum.
   */
  const trocarModelo = useCallback(async (aviso?: string) => {
    abortRef.current?.abort();
    await motor.descarregar();
    setModeloCarregado(null);
    setProgresso({ fase: "ocioso" });
    if (aviso) addMsg({ autor: "sistema", texto: aviso });
  }, [setModeloCarregado, addMsg]);

  const enviar = useCallback(async () => {
    const pergunta = entrada.trim();
    if (!pergunta || gerando || !dossie || !motor.pronto) return;

    setEntrada("");
    addMsg({ autor: "voce", texto: pergunta });
    setGerando(true);
    abortRef.current = new AbortController();

    const sistema = String(dossie.promptSistema ?? "");
    const { promptSistema: _o, ...dados } = dossie;

    // O dossiê vai como TEXTO, não como JSON cru. Medido no mesmo ponto do
    // print: 3.783 caracteres de JSON contra 1.667 de texto, 56% a menos, sem
    // perder um número sequer. Ver src/llm/contexto.ts para o porquê.
    const corpo = dossieParaTexto(dados);
    const contexto = [
      { role: "system" as const, content: sistema },
      { role: "user" as const, content: `${corpo}\n\nPERGUNTA: ${pergunta}` },
    ];
    const tokensEnviados = tokensAprox(sistema + corpo + pergunta);

    let acc = "";
    let motivo: string | null = null;
    motor.ultimoMotivo = null;
    addMsg({ autor: "modelo", texto: "" });

    // UMA ATUALIZAÇÃO POR QUADRO, NÃO UMA POR TOKEN.
    //
    // `patchUltima` a cada token re-renderizava a janela inteira — a lista de
    // mensagens, o cabeçalho, o rodapé — setecentas vezes numa resposta. Isso
    // ocupa a CPU exatamente enquanto a GPU está gerando, e era metade da
    // travada. Agora o texto se acumula e o React vê no máximo 60 versões por
    // segundo, que é o teto do que a tela mostra de qualquer forma.
    let pendente = false;
    const publicar = () => {
      pendente = false;
      patchUltima(acc);
    };
    const agendar = () => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(publicar);
    };

    try {
      for await (const t of motor.responder(contexto, abortRef.current.signal)) {
        acc += t;
        agendar();
      }
      // SEGUNDA TENTATIVA, SEM FLUXO.
      //
      // Se o fluxo terminou sem um único token e sem erro, a chamada direta ou
      // funciona — e aí o problema estava no streaming — ou falha com uma
      // mensagem de verdade. De um jeito ou de outro, deixa de ser "não veio
      // nada" e vira informação.
      if (!acc.trim() && !abortRef.current?.signal.aborted) {
        const r = await motor.responderDeUmaVez(contexto);
        acc = r.texto;
        motivo = r.motivo ?? motor.ultimoMotivo;
      }
    } catch (e) {
      // Dispositivo perdido: não adianta tentar de novo, os pesos sumiram da
      // VRAM. Descarrega e devolve o usuário à lista, com o motivo escrito.
      if (MotorLocal.ehDispositivoPerdido(e)) {
        void trocarModelo(
          "A GPU perdeu o dispositivo — quase sempre é falta de VRAM para o " +
          "modelo escolhido. O motor foi descarregado; escolha um modelo menor.",
        );
      } else {
        addMsg({ autor: "sistema", texto: `erro: ${e instanceof Error ? e.message : String(e)}` });
      }
    } finally {
      // A bolha nunca fica em branco: ver src/llm/resposta.ts
      patchUltima(fecharResposta(acc, !!abortRef.current?.signal.aborted,
        { tokensEnviados, motivo: motivo ?? motor.ultimoMotivo }).texto);
      setGerando(false);
      abortRef.current = null;
    }
  }, [entrada, gerando, dossie, addMsg, patchUltima, trocarModelo]);

  const lugar = (dossie?.ponto as { lugar?: string } | undefined)?.lugar;
  const pronto = modeloCarregado != null;

  return (
    <aside
      ref={painelRef}
      className={`ptchat ${movendo ? "ptchat-movendo" : ""} ${isFocused ? "win-foco" : ""} ${isMinimized ? "win-minimizada" : ""}`}
      style={{
        left: caixa.x,
        top: caixa.y,
        width: caixa.w,
        height: isMinimized ? "auto" : caixa.h,
        zIndex: isFocused ? 30 : 21,
      }}
      onPointerDownCapture={() => focusWindow("chat")}
      role="dialog"
      aria-label="Terminal LLM do ponto"
    >
      <header
        className="ptchat-head"
        onPointerDown={iniciarArrasto(MOVER)}
        onDoubleClick={() => toggleMinimize("chat")}
        title="Clique duplo para minimizar/expandir"
      >
        <GripVertical size={14} className="ptchat-pega" aria-hidden="true" />
        <div className="ptchat-titulos">
          <strong className="ptchat-tit">Terminal LLM 8B</strong>
          <span className="ptchat-coord">
            {lat.toFixed(3)}°, {lng.toFixed(3)}° · {lugar ?? "Ponto selecionado"}
          </span>
        </div>
        <div className="ptchat-botoes-topo">
          {/* O CAMINHO DE VOLTA.
              Ficava só a tela de escolha, e ela sumia assim que um modelo
              carregava — inclusive quando o modelo não cabia na GPU e nada
              mais respondia. Recarregar a página era a única saída, e não
              estava escrito em lugar nenhum. */}
          {pronto && (
            <button
              type="button"
              className="ptchat-btn-topo"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); void trocarModelo(); }}
              disabled={gerando}
              title="Descarregar este modelo e voltar à lista"
              aria-label="Trocar de modelo"
            >
              <Layers size={13} strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            className="ptchat-btn-topo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setCaixa({
                x: Math.max(20, window.innerWidth - 520),
                y: Math.min(140, window.innerHeight - 450),
                w: 460,
                h: 380,
              });
            }}
            title="Resetar posição da janela"
            aria-label="Resetar posição"
          >
            <RotateCcw size={13} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="ptchat-btn-topo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize("chat");
            }}
            title={isMinimized ? "Expandir janela" : "Minimizar janela"}
            aria-label="Minimizar terminal"
          >
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="ptchat-btn-fechar"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onFechar();
            }}
            aria-label="Fechar terminal"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {!isMinimized && (
        <>
          {!pronto && (
            <div className="ptchat-setup">
              {cap && (
                <p className={cap.webgpu ? "ptchat-nota" : "ptchat-alerta"}>{cap.motivo}</p>
              )}

              <label className="ptchat-campo">
                <span>modelo</span>
                <select
                  value={modeloEscolhido?.id ?? ""}
                  disabled={progresso.fase === "baixando"}
                  onChange={(e) =>
                    setModeloEscolhido(MODELOS.find((m) => m.id === e.target.value) ?? null)}
                >
                  {MODELOS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.rotulo} · {m.params} · {GB(m.downloadGB)}
                    </option>
                  ))}
                </select>
              </label>
              {modeloEscolhido && <p className="ptchat-nota">{modeloEscolhido.nota}</p>}

              {progresso.fase === "baixando" ? (
                <div className="ptchat-prog">
                  <div className="ptchat-bar"><i style={{ width: `${progresso.pct}%` }} /></div>
                  <small>{progresso.pct}% · {progresso.texto}</small>
                </div>
              ) : (
                <button className="ptchat-go" onClick={carregar} disabled={!modeloEscolhido}>
                  Carregar {modeloEscolhido?.rotulo} ({GB(modeloEscolhido?.downloadGB ?? 0)})
                </button>
              )}

              {/* O ERRO CRU DIZIA O QUE, NÃO O QUE FAZER.
                  Um caminho do Dawn e um código hexadecimal, mostrados dentro
                  do seletor de modelos, sugerem que a culpa é do modelo — e a
                  pessoa desce a lista inteira sem sair do lugar. */}
              {progresso.fase === "erro" && (() => {
                const exp = explicarFalhaGpu(progresso.mensagem);
                if (!exp) return <p className="ptchat-alerta">{progresso.mensagem}</p>;
                return (
                  <div className="ptchat-alerta">
                    <p>{exp.causa}</p>
                    <p><strong>{exp.acao}</strong></p>
                    {!exp.trocarModeloAjuda && (
                      <p>Trocar de modelo não resolve este caso.</p>
                    )}
                    <details>
                      <summary>mensagem original do navegador</summary>
                      <code>{progresso.mensagem}</code>
                    </details>
                  </div>
                );
              })()}
              <small className="ptchat-rodape">
                Baixa uma vez e fica em cache do navegador. Roda 100% local via WebGPU.
              </small>
            </div>
          )}

          <div className="ptchat-dossie">
            {erroDossie ? (
              <span className="ptchat-alerta">dossiê indisponível: {erroDossie}</span>
            ) : dossie ? (
              <>
                <span>
                  dossiê pronto · {(dossie.serie as unknown[] | undefined)?.length ?? 0} instantes
                </span>
                <button onClick={() => setVerJson((v) => !v)}>
                  {verJson ? "ocultar" : "ver"} JSON
                </button>
              </>
            ) : (
              <span>montando dossiê…</span>
            )}
          </div>
          {verJson && dossie && (
            <pre className="ptchat-json">{JSON.stringify(dossie, null, 2)}</pre>
          )}

          <div
            className="ptchat-log"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-busy={gerando}
          >
            {msgs.length === 0 && pronto && (
              <div className="ptchat-msg ptchat-sistema">
                <span className="ptchat-prompt">·</span>
                <div>
                  {modeloCarregado?.rotulo} pronto. Pergunte sobre este ponto (ex: "como a temperatura variou?", "descreva o vento").
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ptchat-msg ptchat-${m.autor}`}>
                <span className="ptchat-prompt">
                  {m.autor === "voce" ? "›" : m.autor === "modelo" ? "◆" : "·"}
                </span>
                <div>{m.texto || (gerando && i === msgs.length - 1 ? "▊" : "")}</div>
              </div>
            ))}
            <div ref={fimRef} />
          </div>

          <form className="ptchat-entrada" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <span className="ptchat-prompt">›</span>
            <input
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder={pronto ? "pergunte sobre este ponto…" : "carregue um modelo para começar"}
              disabled={!pronto || !dossie || gerando}
            />
            {gerando ? (
              <button type="button" onClick={() => abortRef.current?.abort()}>parar</button>
            ) : (
              <button type="submit" disabled={!pronto || !dossie}>enviar</button>
            )}
          </form>

          <footer className="ptchat-rodape">
            {modeloCarregado
              ? `${modeloCarregado.rotulo} · ${modeloCarregado.params} · local, sem rede`
              : "nenhum modelo carregado"}
          </footer>
        </>
      )}

      {/* Puxadores de redimensionamento em 8 direções */}
      <div className="win-puxa win-puxa-n" onPointerDown={iniciarArrasto("c")} />
      <div className="win-puxa win-puxa-s" onPointerDown={iniciarArrasto("b")} />
      <div className="win-puxa win-puxa-e" onPointerDown={iniciarArrasto("d")} />
      <div className="win-puxa win-puxa-w" onPointerDown={iniciarArrasto("e")} />
      <div className="win-puxa win-puxa-nw" onPointerDown={iniciarArrasto("ec")} />
      <div className="win-puxa win-puxa-ne" onPointerDown={iniciarArrasto("dc")} />
      <div className="win-puxa win-puxa-sw" onPointerDown={iniciarArrasto("eb")} />
      <div className="win-puxa win-puxa-se" onPointerDown={iniciarArrasto("db")} />
    </aside>
  );
}
