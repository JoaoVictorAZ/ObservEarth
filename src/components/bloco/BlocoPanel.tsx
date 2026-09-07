// src/components/bloco/BlocoPanel.tsx
// -----------------------------------------------------------------------------
// A JANELA DO RECORTE 3D.
// -----------------------------------------------------------------------------
// A regra de leitura desta janela, e ela é a razão de o painel existir separado
// do globo: TUDO que aparece aqui tem duas verticais, e elas não são a mesma.
//
//   O TERRENO está em metros de altitude, com exagero declarado.
//   A MALHA DO CAMPO está em unidade do campo, e a altura dela é VALOR.
//
// Por isso os dois controles de altura ficam em blocos separados, com títulos
// que não se parecem, e o número do exagero fica sempre visível ao lado do
// terreno. Ver o cabeçalho de `src/bloco/cena.ts`.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from "react";
import { X, Minus, RotateCcw, GripVertical, Box } from "lucide-react";
import { BlocoCena } from "../../bloco/cena";
import { caixaEmVolta, recortarCampo, tamanhoKm } from "../../bloco/relevo";
import { amostrar } from "../../malha/campo";
import { useBlocoStore, LADOS } from "../../store/blocoStore";
import { useMalhaStore } from "../../store/malhaStore";
import { useLayerStore } from "../../store/layerStore";
import { useJanelaFlutuante, MOVER, type Caixa } from "../../janelas";

const CHAVE = "obs:bloco:pos:v1";
const MIN_W = 420;
const MIN_H = 340;

function padraoBloco(): Caixa {
  const W = typeof window !== "undefined" ? window.innerWidth : 1280;
  const H = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    x: Math.max(20, Math.round(W * 0.22)),
    y: Math.max(0, Math.min(120, H - 560)),
    w: Math.min(760, Math.max(MIN_W, Math.round(W * 0.52))),
    h: Math.min(560, Math.max(MIN_H, Math.round(H * 0.62))),
  };
}

const num = (v: number | null | undefined, casas = 0) =>
  v == null || !Number.isFinite(v)
    ? "sem dado"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const BlocoPanel: React.FC = () => {
  const {
    aberto, lat, lng, ladoKm, exagero, mostrarCampo, mostrarParedes,
    alturaCampo, opacidadeCampo, relevo, carregando, erro,
    fechar, setLadoKm, setExagero, setMostrarCampo, setMostrarParedes,
    setAlturaCampo, setOpacidadeCampo, carregar,
  } = useBlocoStore();

  const campoGlobal = useMalhaStore((m) => m.campo);
  const escalaCampo = useMalhaStore((m) => m.escala);
  const malhaAtiva = useMalhaStore((m) => m.ativa);
  const setMalhaAtiva = useMalhaStore((m) => m.setAtiva);
  const campoId = useMalhaStore((m) => m.campoId);
  const fields = useLayerStore((l) => l.fields);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cenaRef = useRef<BlocoCena | null>(null);

  // ---------------------------------------------------------------------------
  // A CENA É ESTADO, E NÃO APENAS REFERÊNCIA.
  // ---------------------------------------------------------------------------
  // Era só `useRef`, e isso produzia um defeito com sintoma exato: a PRIMEIRA
  // abertura funcionava e todas as seguintes davam palco preto.
  //
  // O motivo é que os efeitos que EMPURRAM dado para dentro da cena
  // (`definirRelevo`, `definirCampo`, exagero, opacidade) dependiam do DADO, e
  // não da cena. Ao fechar e reabrir, a cena é destruída e refeita, mas o
  // `relevo` no store continua sendo o MESMO objeto e a `chave` continua
  // casando, então `carregar` sai cedo. Dependência inalterada, efeito não
  // roda, cena nova nunca recebe o terreno.
  //
  // Guardar a cena em estado dá a ela uma identidade que muda a cada criação, e
  // é essa identidade que entra nas listas de dependência abaixo.
  const [cena, setCena] = useState<BlocoCena | null>(null);
  const [erroCena, setErroCena] = useState<string | null>(null);

  const jan = useJanelaFlutuante({
    id: "bloco", chave: CHAVE, padrao: padraoBloco, minW: MIN_W, minH: MIN_H,
  });

  // ---- ciclo da cena ------------------------------------------------------
  useEffect(() => {
    // `jan.minimizada` PRECISA estar nas dependências. O canvas só existe
    // dentro do corpo, e o corpo não é renderizado com a janela minimizada —
    // sem essa dependência, minimizar e expandir deixava o palco vazio para
    // sempre, porque o efeito nunca mais rodava para recriar a cena.
    if (!aberto || jan.minimizada) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // -------------------------------------------------------------------------
    // FALHA AQUI DENTRO NÃO PODE APAGAR O PAINEL.
    // -------------------------------------------------------------------------
    // Erro lançado de dentro de um efeito derruba a árvore inteira do React.
    // Sem este `try`, `new BlocoCena` falhando — navegador sem WebGL, contexto
    // recusado pelo driver, ou o teto de contextos simultâneos já atingido —
    // DESMONTAVA o painel inteiro. O clique em "Recorte 3D da região" não
    // produzia janela nenhuma nem mensagem nenhuma: exatamente o sintoma
    // relatado, "nada ocorre".
    //
    // Preso aqui, a mesma falha vira uma frase legível no palco. Vale a regra
    // do projeto: se a coisa não existe, a tela DIZ que não existe.
    // -------------------------------------------------------------------------
    let nova: BlocoCena;
    try {
      nova = new BlocoCena(canvas);
    } catch (e) {
      setCena(null);
      cenaRef.current = null;
      setErroCena(
        "Não foi possível criar a cena 3D nesta aba: " +
        (e instanceof Error ? e.message : String(e)) +
        ". O navegador pode estar sem WebGL, ou com contextos 3D demais abertos.",
      );
      return;
    }

    setErroCena(null);
    setCena(nova);
    const cena = nova;
    cenaRef.current = cena;
    cena.redimensionar();

    // O canvas muda de tamanho ao arrastar a borda da janela, e um
    // `ResizeObserver` é a única forma de saber disso — a janela não dispara
    // `resize` quando é um elemento que muda, só quando é a aba.
    const ro = new ResizeObserver(() => cena.redimensionar());
    ro.observe(canvasRef.current);

    return () => {
      ro.disconnect();
      cena.dispose();
      cenaRef.current = null;
      setCena((c) => (c === cena ? null : c));
    };
  }, [aberto, jan.minimizada]);

  // A JANELA QUE ABRE VAI PARA A FRENTE.
  //
  // Mesma correção já feita no terminal do chat. `activeWindow` começa em
  // "probe", e o painel do ponto tem z-index maior — o recorte abria ATRÁS
  // dele, parcialmente coberto, e parecia não ter aberto.
  useEffect(() => { if (aberto) jan.trazerParaFrente(); }, [aberto]);

  // ---- dado ---------------------------------------------------------------
  useEffect(() => { void carregar(); }, [aberto, lat, lng, ladoKm, carregar]);

  useEffect(() => {
    if (cena && relevo) cena.definirRelevo(relevo);
  }, [cena, relevo]);

  // O CAMPO É RECORTADO NA GRADE DO BLOCO, e não desenhado na grade do GFS.
  //
  // A 0,25° um bloco de 60 km tem duas células e meia de largura: a superfície
  // sairia com três vértices e pareceria uma rampa reta. Reamostrar na grade do
  // terreno dá uma superfície suave — e é interpolação declarada, não dado
  // novo: o `titulo` do campo continua dizendo de onde ele veio.
  useEffect(() => {
    if (!cena || !relevo) return;
    if (!campoGlobal || !escalaCampo || !mostrarCampo) {
      cena.definirCampo(null, null);
      return;
    }
    const cx = caixaEmVolta(lat ?? 0, lng ?? 0, ladoKm);
    const { nx, ny } = relevo.campo;
    // Metade da resolução do terreno: o campo do modelo não tem detalhe para
    // sustentar a grade fina, e gastar vértice nele seria fingir que tem.
    const recorte = recortarCampo(
      campoGlobal, cx, Math.max(8, nx >> 1), Math.max(8, ny >> 1), amostrar,
    );
    cena.definirCampo(recorte, escalaCampo);
  }, [cena, relevo, campoGlobal, escalaCampo, mostrarCampo, lat, lng, ladoKm]);

  // ---- controles ----------------------------------------------------------
  // `cena` entra em TODAS as listas: é o que garante que uma cena recém-criada
  // receba os controles que a pessoa já tinha ajustado antes de reabrir.
  useEffect(() => { cena?.definirExagero(exagero); }, [cena, exagero, relevo]);
  useEffect(() => { cena?.definirMostrarCampo(mostrarCampo); }, [cena, mostrarCampo]);
  useEffect(() => { cena?.definirMostrarParedes(mostrarParedes); }, [cena, mostrarParedes]);
  useEffect(() => { cena?.definirAlturaCampo(alturaCampo); }, [cena, alturaCampo, relevo]);
  useEffect(() => { cena?.definirOpacidadeCampo(opacidadeCampo); }, [cena, opacidadeCampo]);

  if (!aberto || lat == null || lng == null) return null;

  const tam = tamanhoKm(caixaEmVolta(lat, lng, ladoKm));
  const est = cena?.estado;
  const unidade = campoGlobal?.unidade ?? "";
  const titulo = fields.find((f) => f.id === campoId)?.title ?? campoId;
  const amplitude = relevo && relevo.maximo != null && relevo.minimo != null
    ? relevo.maximo - relevo.minimo : null;
  // A razão real entre a vertical e a horizontal do recorte. É ela que diz por
  // que o exagero é necessário: 1:75 num bloco de 60 km com 800 m de morro.
  const razaoReal = amplitude && amplitude > 0
    ? Math.round((tam.largura * 1000) / amplitude) : null;

  return (
    <section
      className={`bloco ${jan.movendo ? "bloco-movendo" : ""} ${jan.focada ? "win-foco" : ""} ${jan.minimizada ? "win-minimizada" : ""}`}
      style={jan.estilo}
      onPointerDownCapture={jan.trazerParaFrente}
      role="dialog"
      aria-label="Recorte 3D da região"
    >
      <header
        className="bloco-head"
        onPointerDown={jan.iniciarArrasto(MOVER)}
        onDoubleClick={jan.alternarMinimizar}
        title="Clique duplo para minimizar/expandir"
      >
        <GripVertical size={14} className="bloco-pega" aria-hidden="true" />
        <div className="bloco-titulos">
          <strong className="bloco-tit">
            <Box size={13} strokeWidth={1.7} aria-hidden="true" /> Recorte 3D
          </strong>
          <span className="bloco-coord">
            {Math.abs(lat).toFixed(3)}°{lat >= 0 ? "N" : "S"}{" "}
            {Math.abs(lng).toFixed(3)}°{lng >= 0 ? "L" : "O"} · {num(tam.largura)}×{num(tam.altura)} km
          </span>
        </div>
        <div className="bloco-botoes-topo">
          <button
            type="button" className="bloco-btn-topo"
            onClick={jan.recolocar}
            title="Resetar posição da janela" aria-label="Resetar posição"
          >
            <RotateCcw size={13} strokeWidth={1.6} />
          </button>
          <button
            type="button" className="bloco-btn-topo"
            onClick={jan.alternarMinimizar}
            title={jan.minimizada ? "Expandir" : "Minimizar"} aria-label="Minimizar"
          >
            <Minus size={13} strokeWidth={1.6} />
          </button>
          <button
            type="button" className="bloco-btn-topo"
            onClick={fechar} title="Fechar" aria-label="Fechar recorte"
          >
            <X size={14} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      {!jan.minimizada && (
        <div className="bloco-corpo">
          <div className="bloco-palco">
            <canvas ref={canvasRef} className="bloco-canvas" />
            {erroCena && <div className="bloco-aviso bloco-aviso-erro">{erroCena}</div>}
            {!erroCena && carregando && <div className="bloco-aviso">montando o terreno…</div>}
            {!erroCena && erro && <div className="bloco-aviso bloco-aviso-erro">{erro}</div>}
            {!erroCena && !carregando && !erro && (
              <div className="bloco-dica">arraste para girar · roda para aproximar</div>
            )}
          </div>

          <div className="bloco-lado">
            {/* ---- o que está na tela ---- */}
            {relevo && (
              <div className="bloco-res">
                <div className="bloco-num">
                  <span className="bloco-num-r">Altitude</span>
                  <span className="bloco-num-v">
                    {num(relevo.minimo)} a {num(relevo.maximo)} m
                    <small>amplitude de {num(amplitude)} m</small>
                  </span>
                </div>
                <div className="bloco-num">
                  <span className="bloco-num-r">Amostra</span>
                  <span className="bloco-num-v">
                    {num(relevo.resolucaoM)} m
                    <small>nível {relevo.nivel} · {relevo.tiles} tiles</small>
                  </span>
                </div>
                {est && (
                  <div className="bloco-num">
                    <span className="bloco-num-r">Estratos</span>
                    <span className="bloco-num-v">
                      {num(est.estratoM)} m
                      <small>cada faixa da parede</small>
                    </span>
                  </div>
                )}
                {relevo.tilesFalhos > 0 && (
                  <p className="bloco-ressalva">
                    {relevo.tilesFalhos} tile(s) de elevação sem cobertura. A malha fica
                    vazada ali — nada foi preenchido.
                  </p>
                )}
              </div>
            )}

            {/* ---- o TERRENO: altitude de verdade ---- */}
            <div className="bloco-grupo">
              <h3 className="bloco-h">Terreno</h3>

              <div className="bloco-lin">
                <span className="bloco-rot">Recorte</span>
                <div className="bloco-seg" role="radiogroup" aria-label="Lado do recorte">
                  {LADOS.map((km) => (
                    <button
                      key={km} role="radio" aria-checked={ladoKm === km}
                      className={`bloco-seg-btn ${ladoKm === km ? "bloco-seg-on" : ""}`}
                      onClick={() => setLadoKm(km)}
                    >
                      {km}
                    </button>
                  ))}
                  <span className="bloco-seg-un">km</span>
                </div>
              </div>

              <label className="bloco-lin" htmlFor="bl-exag">
                <span className="bloco-rot">
                  Exagero vertical
                  {/* O número fica SEMPRE visível: a altura do terreno é a
                      única coisa no bloco que a pessoa poderia confundir com
                      medida direta. */}
                  <output htmlFor="bl-exag">{exagero}×</output>
                </span>
                <input
                  id="bl-exag" type="range" min={1} max={40} step={1}
                  value={exagero}
                  onChange={(e) => setExagero(Number(e.target.value))}
                  aria-label="Exagero vertical do terreno"
                />
              </label>
              {razaoReal && (
                <p className="bloco-nota">
                  Sem exagero, a razão real deste recorte é 1:{num(razaoReal)} — o relevo
                  ocuparia menos de um pixel.
                </p>
              )}

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={mostrarParedes}
                  onChange={(e) => setMostrarParedes(e.target.checked)}
                />
                <span>Paredes do corte (a escala de altitude)</span>
              </label>
            </div>

            {/* ---- o CAMPO: valor, não altitude ---- */}
            <div className="bloco-grupo">
              <h3 className="bloco-h">Camada de análise</h3>

              {!campoGlobal ? (
                <p className="bloco-nota">
                  {malhaAtiva
                    ? "carregando o campo…"
                    : "A malha do campo não está carregada."}
                  {!malhaAtiva && (
                    <button
                      type="button" className="bloco-ligar"
                      onClick={() => setMalhaAtiva(true)}
                    >
                      Ligar a malha 3D
                    </button>
                  )}
                </p>
              ) : (
                <>
                  <p className="bloco-nota">
                    <strong>{titulo}</strong>{unidade ? ` · ${unidade}` : ""}. A altura desta
                    superfície é o <strong>valor</strong> do campo, não altitude — ela flutua
                    acima do terreno de propósito.
                  </p>

                  <label className="bloco-sw">
                    <input
                      type="checkbox" checked={mostrarCampo}
                      onChange={(e) => setMostrarCampo(e.target.checked)}
                    />
                    <span>Mostrar a superfície do campo</span>
                  </label>

                  {mostrarCampo && (
                    <>
                      <label className="bloco-lin" htmlFor="bl-alt">
                        <span className="bloco-rot">
                          Afastar do terreno
                          <output htmlFor="bl-alt">{alturaCampo.toFixed(0)} km</output>
                        </span>
                        <input
                          id="bl-alt" type="range" min={0} max={30} step={1}
                          value={alturaCampo}
                          onChange={(e) => setAlturaCampo(Number(e.target.value))}
                          aria-label="Afastamento da superfície do campo"
                        />
                      </label>

                      <label className="bloco-lin" htmlFor="bl-op">
                        <span className="bloco-rot">
                          Opacidade
                          <output htmlFor="bl-op">{Math.round(opacidadeCampo * 100)}%</output>
                        </span>
                        <input
                          id="bl-op" type="range" min={0.15} max={1} step={0.05}
                          value={opacidadeCampo}
                          onChange={(e) => setOpacidadeCampo(Number(e.target.value))}
                          aria-label="Opacidade da superfície do campo"
                        />
                      </label>
                    </>
                  )}
                </>
              )}
            </div>

            {relevo && (
              <p className="bloco-fonte">
                Relevo e batimetria: Mapzen Terrain Tiles (SRTM, GEBCO e outros) via AWS
                Open Data. A linha azul-clara nas paredes é o nível do mar.
              </p>
            )}
          </div>
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
    </section>
  );
};
