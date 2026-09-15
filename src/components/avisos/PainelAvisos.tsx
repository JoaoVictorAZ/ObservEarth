// src/components/avisos/PainelAvisos.tsx
// -----------------------------------------------------------------------------
// AVISOS DO INMET — a primeira tela do app que não mostra medida
// -----------------------------------------------------------------------------
// Todo o resto do ObservEarth responde "quanto está". Isto responde "o serviço
// meteorológico nacional diz que isto é perigoso, aqui, até tal hora".
//
// POR QUE É LISTA E NÃO POLÍGONO NO MAPA
//
// Porque o feed não publica geometria — medido, não suposto. As áreas vêm como
// NOMES de mesorregião do IBGE em texto corrido. Desenhá-las exige casar nome
// com a malha territorial do IBGE, o que é trabalho à parte e falível.
//
// Desenhar um polígono aproximado enquanto isso seria a pior das opções: um
// aviso de tempestade sobre a área errada é pior que aviso nenhum. A lista diz
// exatamente o que a fonte diz, e a tela declara que a geometria não existe.
// -----------------------------------------------------------------------------

import React from "react";
import { AlertTriangle, X, GripVertical, Minus, RotateCcw, RefreshCw } from "lucide-react";
import { useJanelaFlutuante, MOVER, type Caixa } from "../../janelas";
import { situacaoEfetiva, frase as fraseDaFonte, type Fonte } from "../../dados/estado.ts";

export interface Aviso {
  id: string | null;
  evento: string;
  severidade: string;
  grau: number;
  status: string | null;
  descricao: string | null;
  inicio: number;
  fim: number;
  inicioTexto: string;
  fimTexto: string;
  areas: string[];
  link: string | null;
}

export interface Resposta {
  avisos: Aviso[];
  vigentes: number;
  descartados: number;
  fonte: string;
  licenca: string;
  nota: string;
}

const CHAVE = "obs:avisos:pos:v1";

function padrao(): Caixa {
  const H = typeof window !== "undefined" ? window.innerHeight : 900;
  return { x: 24, y: 96, w: 430, h: Math.min(560, Math.max(360, H - 180)) };
}

/** Cor pelo grau, e não pelo texto: o texto muda, o grau é a escala. */
const corDoGrau = (g: number) =>
  g >= 2 ? "var(--alert)" : g === 1 ? "var(--warn)" : "var(--ink-3)";

const hora = (ms: number) =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const Linha: React.FC<{ a: Aviso; agora: number }> = ({ a, agora }) => {
  const vigente = a.inicio <= agora && agora <= a.fim;
  const futuro = agora < a.inicio;
  const cor = corDoGrau(a.grau);

  return (
    <article className={`avi ${vigente ? "avi-vigente" : ""}`}>
      <header className="avi-topo">
        <span className="avi-sev" style={{ background: cor }} aria-hidden="true" />
        <h4 className="avi-evento">{a.evento}</h4>
        <span className="avi-grau" style={{ color: cor }}>{a.severidade}</span>
      </header>

      <p className="avi-quando">
        {/* Um aviso que já passou continua na lista porque o feed o traz — mas
            ele é rotulado, e nunca desenhado como se estivesse valendo. */}
        {vigente ? "vigente agora" : futuro ? "começa em breve" : "encerrado"}
        {" · "}{hora(a.inicio)} → {hora(a.fim)}
      </p>

      {a.descricao && <p className="avi-desc">{a.descricao}</p>}

      {a.areas.length > 0 && (
        <details className="avi-areas">
          <summary>{a.areas.length} {a.areas.length === 1 ? "área" : "áreas"}</summary>
          <p>{a.areas.join(" · ")}</p>
        </details>
      )}
    </article>
  );
};

/**
 * A BUSCA NÃO MORA AQUI, e isso é deliberado.
 *
 * O contador de avisos vigentes precisa aparecer na barra inferior mesmo com
 * esta janela fechada — é a única informação da tela que fala de risco
 * declarado por autoridade. Se o `useFonte` estivesse dentro deste componente,
 * fechar a janela apagaria o contador, e o app ficaria em silêncio justamente
 * quando há aviso de tempestade. Quem busca é o `AppShell`, uma vez só, e
 * entrega o resultado para a barra e para esta janela.
 */
export const PainelAvisos: React.FC<{
  aberto: boolean;
  aoFechar: () => void;
  dado: Resposta | null;
  fonte: Fonte;
  repetir: () => void;
}> = ({ aberto, aoFechar, dado, fonte, repetir }) => {
  const jan = useJanelaFlutuante({ id: "avisos", chave: CHAVE, padrao, minW: 320, minH: 240 });

  if (!aberto) return null;

  const agora = Date.now();
  const sit = situacaoEfetiva(fonte, agora);
  const avisos = dado?.avisos ?? [];

  return (
    <div
      className={`probe avisos ${jan.movendo ? "probe-movendo" : ""} ${jan.focada ? "win-foco" : ""} ${jan.minimizada ? "win-minimizada" : ""}`}
      style={jan.estilo}
      onPointerDownCapture={jan.trazerParaFrente}
      role="dialog"
      aria-label="Avisos meteorológicos do INMET"
    >
      <header className="probe-header" onPointerDown={jan.iniciarArrasto(MOVER)} onDoubleClick={jan.alternarMinimizar}>
        <GripVertical size={14} strokeWidth={1.6} className="probe-pega" aria-hidden="true" />
        <div className="probe-titulos">
          <h2 className="probe-tit">Avisos meteorológicos</h2>
          <span className="probe-sub">
            {dado ? `${dado.vigentes} vigente${dado.vigentes === 1 ? "" : "s"} de ${avisos.length}` : "INMET · Alert-AS"}
          </span>
        </div>
        <div className="probe-botoes-topo">
          <button type="button" className="probe-btn-topo" title="Buscar de novo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); repetir(); }}>
            <RefreshCw size={13} strokeWidth={1.6} />
          </button>
          <button type="button" className="probe-btn-topo" title="Resetar posição"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); jan.recolocar(); }}>
            <RotateCcw size={13} strokeWidth={1.6} />
          </button>
          <button type="button" className="probe-btn-topo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); jan.alternarMinimizar(); }}>
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button type="button" className="probe-btn-fechar"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); aoFechar(); }} aria-label="Fechar avisos">
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {!jan.minimizada && (
        <div className="probe-corpo">
          {/* O ESTADO DA FONTE VEM PRIMEIRO, e não escondido no rodapé. Uma
              lista de avisos de duas horas atrás parece uma lista de avisos. */}
          {sit !== "pronto" && (
            <p className={`avi-estado ${sit === "indisponivel" ? "avi-estado-falha" : ""}`} role="status">
              <AlertTriangle size={13} strokeWidth={1.6} aria-hidden="true" />
              {fraseDaFonte(fonte, agora)}
              {sit === "degradado" && avisos.length > 0 && " — a lista abaixo é a última que chegou."}
            </p>
          )}

          {avisos.length === 0 && sit === "pronto" && (
            <p className="avi-vazio">
              Nenhum aviso publicado agora. Isso é uma resposta da fonte, não uma falha de carregamento.
            </p>
          )}

          <div className="avis">
            {avisos.map((a, i) => <Linha key={a.id ?? i} a={a} agora={agora} />)}
          </div>

          {dado && (
            <footer className="avi-proc">
              <p><strong>Fonte:</strong> {dado.fonte}</p>
              <p>{dado.licenca}</p>
              <p>{dado.nota}</p>
              {dado.descartados > 0 && (
                <p className="avi-proc-alerta">
                  {dado.descartados} item(ns) do feed não pôde(puderam) ser lido(s) e ficaram de fora.
                </p>
              )}
            </footer>
          )}
        </div>
      )}

      <div className="win-puxa win-puxa-n" onPointerDown={jan.iniciarArrasto("c")} />
      <div className="win-puxa win-puxa-s" onPointerDown={jan.iniciarArrasto("b")} />
      <div className="win-puxa win-puxa-e" onPointerDown={jan.iniciarArrasto("d")} />
      <div className="win-puxa win-puxa-w" onPointerDown={jan.iniciarArrasto("e")} />
      <div className="win-puxa win-puxa-nw" onPointerDown={jan.iniciarArrasto("ec")} />
      <div className="win-puxa win-puxa-ne" onPointerDown={jan.iniciarArrasto("dc")} />
      <div className="win-puxa win-puxa-sw" onPointerDown={jan.iniciarArrasto("eb")} />
      <div className="win-puxa win-puxa-se" onPointerDown={jan.iniciarArrasto("db")} />
    </div>
  );
};
