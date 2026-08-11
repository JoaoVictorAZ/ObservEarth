// src/components/chat/PointChat.tsx
// -----------------------------------------------------------------------------
// TERMINAL DO PONTO — conversa sobre o dossiê, com modelo local.
//
// DUAS REGRAS DE INTERFACE QUE NÃO SÃO ESTÉTICA
//
//   1. O MODELO EM USO FICA VISÍVEL O TEMPO TODO.
//      Um 8B e um 1,5B respondem com a mesma fluência e qualidades muito
//      diferentes. Quem lê precisa saber qual está falando.
//
//   2. O DOSSIÊ É INSPECIONÁVEL.
//      Há um botão que mostra o JSON exato entregue ao modelo. Se a resposta
//      parecer estranha, dá para conferir a fonte em vez de acreditar.
//
// O estado do modelo NÃO vive aqui: vive no chatStore e é sincronizado com o
// singleton do motor na montagem. Ver o comentário no store para o defeito que
// isso corrige.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from "react";
import {
  motor, MODELOS, detectarCapacidade,
  type Capacidade, type EstadoMotor,
} from "../../llm/engine";
import { useChatStore, LARGURA_MIN, LARGURA_MAX } from "../../store/chatStore";

interface Props {
  lat: number;
  lng: number;
  date: string;
  hour: number;
  onFechar: () => void;
}

const GB = (n: number) => `${n.toFixed(1)} GB`;

export function PointChat({ lat, lng, date, hour, onFechar }: Props) {
  const {
    largura, setLargura,
    modeloCarregado, setModeloCarregado,
    modeloEscolhido, setModeloEscolhido,
    msgs, addMsg, patchUltima, trocarPonto,
  } = useChatStore();

  const [cap, setCap] = useState<Capacidade | null>(null);
  const [progresso, setProgresso] = useState<EstadoMotor>({ fase: "ocioso" });
  const [dossie, setDossie] = useState<Record<string, unknown> | null>(null);
  const [erroDossie, setErroDossie] = useState<string | null>(null);
  const [entrada, setEntrada] = useState("");
  const [gerando, setGerando] = useState(false);
  const [verJson, setVerJson] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- SINCRONIZA COM O MOTOR NA MONTAGEM --------------------------------
  // Esta é a correção do "pede para instalar de novo". O motor é um singleton:
  // se ele já tem pesos na VRAM, o painel precisa saber disso ao reabrir, em
  // vez de assumir que nada foi carregado.
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

  // troca de ponto limpa a conversa, mas nunca o modelo
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

  // ---- REDIMENSIONAR ------------------------------------------------------
  // O painel nasce em 560px mas cresce até 1100px. Terminal estreito obriga a
  // rolar para ler uma resposta de dez linhas, e a comparação entre instantes —
  // que é o propósito da coisa — exige ver a série inteira de uma vez.
  const arrastando = useRef(false);
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (!arrastando.current) return;
      setLargura(window.innerWidth - e.clientX - 14);
    };
    const soltar = () => {
      arrastando.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, [setLargura]);

  const carregar = useCallback(async () => {
    if (!modeloEscolhido) return;
    try {
      await motor.carregar(modeloEscolhido, setProgresso);
      setModeloCarregado(modeloEscolhido);
      addMsg({
        autor: "sistema",
        texto: `${modeloEscolhido.rotulo} pronto. O dossiê deste ponto está na memória — pergunte.`,
      });
    } catch { /* o estado de erro já foi publicado pelo motor */ }
  }, [modeloEscolhido, setModeloCarregado, addMsg]);

  const enviar = useCallback(async () => {
    const pergunta = entrada.trim();
    if (!pergunta || gerando || !dossie || !motor.pronto) return;

    setEntrada("");
    addMsg({ autor: "voce", texto: pergunta });
    setGerando(true);
    abortRef.current = new AbortController();

    const sistema = String(dossie.promptSistema ?? "");
    const { promptSistema: _o, ...dados } = dossie;
    const contexto = [
      { role: "system" as const, content: sistema },
      { role: "user" as const, content:
        `DOSSIÊ (JSON):\n${JSON.stringify(dados)}\n\nPERGUNTA: ${pergunta}` },
    ];

    let acc = "";
    addMsg({ autor: "modelo", texto: "" });
    try {
      for await (const t of motor.responder(contexto, abortRef.current.signal)) {
        acc += t;
        patchUltima(acc);
      }
    } catch (e) {
      addMsg({ autor: "sistema", texto: `erro: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setGerando(false);
      abortRef.current = null;
    }
  }, [entrada, gerando, dossie, addMsg, patchUltima]);

  const lugar = (dossie?.ponto as { lugar?: string } | undefined)?.lugar;
  const pronto = modeloCarregado != null;

  return (
    <aside className="ptchat" style={{ width: largura }} role="dialog" aria-label="Terminal do ponto">
      {/* punho de redimensionamento na borda esquerda */}
      <div
        className="ptchat-punho"
        role="separator"
        aria-label="Redimensionar terminal"
        aria-valuenow={largura}
        aria-valuemin={LARGURA_MIN}
        aria-valuemax={LARGURA_MAX}
        tabIndex={0}
        onPointerDown={() => {
          arrastando.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setLargura(largura + 40);
          if (e.key === "ArrowRight") setLargura(largura - 40);
        }}
      />

      <header className="ptchat-head">
        <div>
          <strong>{lugar ?? "Ponto selecionado"}</strong>
          <span className="ptchat-coord">
            {lat.toFixed(3)}°, {lng.toFixed(3)}° · {date} {String(hour).padStart(2, "0")}h UTC
          </span>
        </div>
        <div className="ptchat-acoes">
          <button
            onClick={() => setLargura(largura >= LARGURA_MAX - 20 ? 560 : LARGURA_MAX)}
            title="Alternar largura"
            aria-label="Alternar largura"
          >⇔</button>
          <button onClick={onFechar} aria-label="Fechar terminal">✕</button>
        </div>
      </header>

      {/* ---- carga do modelo: só quando NÃO há modelo na VRAM ------------- */}
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

          {progresso.fase === "erro" && <p className="ptchat-alerta">{progresso.mensagem}</p>}
          <small className="ptchat-rodape">
            Baixa uma vez e fica em cache do navegador. Depois disso funciona sem internet,
            e fechar o terminal não descarrega o modelo.
          </small>
        </div>
      )}

      {/* ---- dossiê ------------------------------------------------------- */}
      <div className="ptchat-dossie">
        {erroDossie ? (
          <span className="ptchat-alerta">dossiê indisponível: {erroDossie}</span>
        ) : dossie ? (
          <>
            <span>
              dossiê pronto · {(dossie.serie as unknown[] | undefined)?.length ?? 0} instantes
              {Array.isArray(dossie.lacunas) && dossie.lacunas.length > 0 &&
                ` · ${dossie.lacunas.length} lacuna(s)`}
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

      {/* ---- conversa ----------------------------------------------------- */}
      <div className="ptchat-log">
        {msgs.length === 0 && pronto && (
          <div className="ptchat-msg ptchat-sistema">
            <span className="ptchat-prompt">·</span>
            <div>
              {modeloCarregado?.rotulo} já carregado. Exemplos: “como a pressão variou
              na janela?”, “compare o vento do primeiro e do último instante”,
              “que dados faltam?”
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
        {" · descreve e compara o dossiê; não interpreta meteorologia"}
      </footer>
    </aside>
  );
}
