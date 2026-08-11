// src/components/chat/PointChat.tsx
// -----------------------------------------------------------------------------
// TERMINAL DO PONTO — conversa sobre o dossiê, com modelo local.
//
// DUAS REGRAS DE INTERFACE QUE NÃO SÃO ESTÉTICA
//
//   1. O MODELO EM USO FICA VISÍVEL O TEMPO TODO.
//      Um 8B e um 1,5B respondem com a mesma fluência e qualidades muito
//      diferentes. Quem lê precisa saber qual está falando, sempre — não só na
//      hora de escolher.
//
//   2. O DOSSIÊ É INSPECIONÁVEL.
//      Há um botão que mostra o JSON exato que foi entregue ao modelo. Se a
//      resposta parecer estranha, dá para conferir a fonte em dois cliques em
//      vez de acreditar. Num instrumento científico, a caixa não pode ser preta.
//
// O download de ~4,6 GB só acontece com confirmação explícita. Baixar isso
// porque alguém clicou num ponto do mapa seria abusivo.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from "react";
import {
  motor, MODELOS, detectarCapacidade,
  type ModeloLLM, type Capacidade, type EstadoMotor,
} from "../../llm/engine";

interface Msg { autor: "voce" | "modelo" | "sistema"; texto: string }

interface Props {
  lat: number;
  lng: number;
  date: string;
  hour: number;
  onFechar: () => void;
}

const GB = (n: number) => `${n.toFixed(1)} GB`;

export function PointChat({ lat, lng, date, hour, onFechar }: Props) {
  const [cap, setCap] = useState<Capacidade | null>(null);
  const [modelo, setModelo] = useState<ModeloLLM | null>(null);
  const [estado, setEstado] = useState<EstadoMotor>({ fase: "ocioso" });
  const [dossie, setDossie] = useState<Record<string, unknown> | null>(null);
  const [erroDossie, setErroDossie] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [entrada, setEntrada] = useState("");
  const [gerando, setGerando] = useState(false);
  const [verJson, setVerJson] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- capacidade do dispositivo, antes de qualquer download --------------
  useEffect(() => {
    detectarCapacidade().then((c) => { setCap(c); setModelo(c.recomendado); });
  }, []);

  // ---- dossiê do ponto ----------------------------------------------------
  useEffect(() => {
    let vivo = true;
    setErroDossie(null);
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

  const carregar = useCallback(async () => {
    if (!modelo) return;
    try {
      await motor.carregar(modelo, setEstado);
      setMsgs((m) => [...m, {
        autor: "sistema",
        texto: `${modelo.rotulo} carregado. O dossiê deste ponto está na memória — pergunte.`,
      }]);
    } catch { /* o estado de erro já foi publicado pelo motor */ }
  }, [modelo]);

  const enviar = useCallback(async () => {
    const pergunta = entrada.trim();
    if (!pergunta || gerando || !dossie || !motor.pronto) return;

    setEntrada("");
    setMsgs((m) => [...m, { autor: "voce", texto: pergunta }]);
    setGerando(true);
    abortRef.current = new AbortController();

    // O dossiê inteiro vai em TODA pergunta. É o que impede o modelo de
    // responder de memória sobre um ponto que já saiu de contexto — e o que
    // garante que todo número citado esteja diante dele.
    const sistema = String(dossie.promptSistema ?? "");
    const { promptSistema: _omitir, ...dados } = dossie;
    const contexto = [
      { role: "system" as const, content: sistema },
      { role: "user" as const, content:
        `DOSSIÊ (JSON):\n${JSON.stringify(dados)}\n\nPERGUNTA: ${pergunta}` },
    ];

    let acc = "";
    setMsgs((m) => [...m, { autor: "modelo", texto: "" }]);
    try {
      for await (const t of motor.responder(contexto, abortRef.current.signal)) {
        acc += t;
        setMsgs((m) => {
          const c = [...m];
          c[c.length - 1] = { autor: "modelo", texto: acc };
          return c;
        });
      }
    } catch (e) {
      setMsgs((m) => [...m, { autor: "sistema", texto: `erro: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setGerando(false);
      abortRef.current = null;
    }
  }, [entrada, gerando, dossie]);

  const lugar = (dossie?.ponto as { lugar?: string } | undefined)?.lugar;

  return (
    <aside className="ptchat" role="dialog" aria-label="Terminal do ponto">
      <header className="ptchat-head">
        <div>
          <strong>{lugar ?? "Ponto selecionado"}</strong>
          <span className="ptchat-coord">
            {lat.toFixed(3)}°, {lng.toFixed(3)}° · {date} {String(hour).padStart(2, "0")}h UTC
          </span>
        </div>
        <button onClick={onFechar} aria-label="Fechar terminal">✕</button>
      </header>

      {/* ---- escolha e carga do modelo ------------------------------------ */}
      {estado.fase !== "pronto" && (
        <div className="ptchat-setup">
          {cap && !cap.webgpu && (
            <p className="ptchat-alerta">{cap.motivo}</p>
          )}
          {cap?.webgpu && (
            <p className="ptchat-nota">{cap.motivo}</p>
          )}

          <label className="ptchat-campo">
            <span>modelo</span>
            <select
              value={modelo?.id ?? ""}
              disabled={estado.fase === "baixando"}
              onChange={(e) => setModelo(MODELOS.find((m) => m.id === e.target.value) ?? null)}
            >
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.rotulo} · {m.params} · {GB(m.downloadGB)}
                </option>
              ))}
            </select>
          </label>
          {modelo && <p className="ptchat-nota">{modelo.nota}</p>}

          {estado.fase === "baixando" ? (
            <div className="ptchat-prog">
              <div className="ptchat-bar"><i style={{ width: `${estado.pct}%` }} /></div>
              <small>{estado.pct}% · {estado.texto}</small>
            </div>
          ) : (
            <button className="ptchat-go" onClick={carregar} disabled={!modelo}>
              Carregar {modelo?.rotulo} ({GB(modelo?.downloadGB ?? 0)})
            </button>
          )}

          {estado.fase === "erro" && <p className="ptchat-alerta">{estado.mensagem}</p>}
          <small className="ptchat-rodape">
            Baixa uma vez e fica em cache. Depois disso funciona sem internet.
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
              dossiê pronto ·{" "}
              {(dossie.serie as unknown[] | undefined)?.length ?? 0} instantes
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

      <form
        className="ptchat-entrada"
        onSubmit={(e) => { e.preventDefault(); void enviar(); }}
      >
        <span className="ptchat-prompt">›</span>
        <input
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder={
            estado.fase === "pronto"
              ? "compare a pressão do começo ao fim da janela…"
              : "carregue um modelo para começar"
          }
          disabled={estado.fase !== "pronto" || !dossie || gerando}
        />
        {gerando ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>parar</button>
        ) : (
          <button type="submit" disabled={estado.fase !== "pronto" || !dossie}>enviar</button>
        )}
      </form>

      {/* O modelo em uso fica visível SEMPRE, não só na escolha. */}
      <footer className="ptchat-rodape">
        {estado.fase === "pronto"
          ? `${estado.modelo.rotulo} · ${estado.modelo.params} · local, sem rede`
          : "nenhum modelo carregado"}
        {" · descreve e compara o dossiê; não interpreta meteorologia"}
      </footer>
    </aside>
  );
}
