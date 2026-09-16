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
import {
  caixaEmVolta, recortarCampo, tamanhoKm, QUALIDADES, type Qualidade,
} from "../../bloco/relevo";
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
    curvas, rampaAdaptativa, faixas, campoLocal, agua, regua, percentis, qualidade, multiploCurvas, limiarMar,
    alturaCampo, opacidadeCampo, relevo, carregando, erro,
    fechar, setLadoKm, setExagero, setMostrarCampo, setMostrarParedes,
    setCurvas, setRampaAdaptativa, setFaixas, setCampoLocal, setAgua, setRegua,
    setPercentis, setQualidade, setMultiploCurvas, setLimiarMar,
    setAlturaCampo, setOpacidadeCampo, carregar,
  } = useBlocoStore();

  const campoGlobal = useMalhaStore((m) => m.campo);
  const escalaCampo = useMalhaStore((m) => m.escala);
  const malhaAtiva = useMalhaStore((m) => m.ativa);
  const setMalhaAtiva = useMalhaStore((m) => m.setAtiva);
  const campoId = useMalhaStore((m) => m.campoId);
  const fields = useLayerStore((l) => l.fields);

  // Uma CAIXA, e não o canvas. O canvas agora é compartilhado e permanente
  // (ver src/bloco/renderizador.ts); a cena o pendura aqui dentro ao montar e
  // o retira ao sair. O React nunca toca nele, o que também elimina a briga
  // entre o React e o motor pelo mesmo nó — a mesma separação que `.stage` e
  // `.stage-tela` fazem no globo.
  const caixaRef = useRef<HTMLDivElement>(null);
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
    const caixa = caixaRef.current;
    if (!caixa) return;

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
      nova = new BlocoCena(caixa);
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
    ro.observe(caixa);

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
  useEffect(() => { void carregar(); }, [aberto, lat, lng, ladoKm, qualidade, carregar]);

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
  useEffect(() => { cena?.definirCurvas(curvas); }, [cena, curvas]);
  // `relevo` na lista: a rampa adaptativa depende da faixa do recorte, então
  // trocar de lugar precisa reconstruí-la mesmo com o interruptor parado.
  useEffect(() => { cena?.definirRampaAdaptativa(rampaAdaptativa); }, [cena, rampaAdaptativa, relevo]);
  useEffect(() => { cena?.definirFaixas(faixas); }, [cena, faixas, relevo]);
  useEffect(() => { cena?.definirAgua(agua); }, [cena, agua, relevo]);
  useEffect(() => { cena?.definirRegua(regua); }, [cena, regua, relevo]);
  useEffect(() => { cena?.definirPercentis(percentis); }, [cena, percentis, relevo]);
  useEffect(() => { cena?.definirMultiploCurvas(multiploCurvas); }, [cena, multiploCurvas, relevo]);
  useEffect(() => { cena?.definirLimiarMar(limiarMar); }, [cena, limiarMar, relevo]);
  useEffect(() => { cena?.definirCampoLocal(campoLocal); }, [cena, campoLocal, campoGlobal]);
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
            {/* Caixa vazia: quem põe o canvas aqui dentro é a cena, e quem o
                tira é ela também. O React não gerencia esse nó — é a mesma
                separação de `.stage` / `.stage-tela` no globo, e pelo mesmo
                motivo: dois donos do mesmo nó do DOM brigam, e a briga aparece
                como `removeChild` em nó que já não é filho de ninguém. */}
            <div ref={caixaRef} className="bloco-tela" />
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
                {/* QUANTO DO RECORTE ESTÁ SUBMERSO.
                    É a leitura que um bloco costeiro existe para dar, e ela sai
                    de graça do mínimo e do máximo — mas só se alguém a
                    escrever. Sem isto a pessoa estima olhando, que é
                    exatamente o que o bloco deveria dispensar. */}
                {est?.temAgua && relevo.minimo != null && relevo.maximo != null && (
                  <div className="bloco-num">
                    <span className="bloco-num-r">Nível do mar</span>
                    <span className="bloco-num-v">
                      {relevo.maximo > 0
                        ? <>−{num(-relevo.minimo)} a +{num(relevo.maximo)} m</>
                        : <>tudo submerso</>}
                      <small>
                        {relevo.maximo > 0
                          ? `${Math.round(100 * -relevo.minimo / (relevo.maximo - relevo.minimo))}% da amplitude abaixo de zero`
                          : "nenhuma terra emersa no recorte"}
                      </small>
                    </span>
                  </div>
                )}
                {relevo.tilesFalhos > 0 && (
                  <p className="bloco-ressalva">
                    {relevo.tilesFalhos} tile(s) de elevação sem cobertura. A malha fica
                    vazada ali — nada foi preenchido.
                  </p>
                )}
                {/* PICOS REMOVIDOS é informação sobre a FONTE, e por isso sai
                    para a tela. Um recorte com muitos diz que o DEM daquela
                    região é ruim — e quem está medindo uma encosta precisa
                    saber disso antes de confiar no número que leu. */}
                {relevo.picosRemovidos > 0 && (
                  <p className="bloco-ressalva">
                    {relevo.picosRemovidos} célula(s) recusada(s) por serem degraus
                    impossíveis — defeito do DEM, não relevo. Viraram vazio, não
                    foram substituídas por estimativa.
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

              <div className="bloco-lin">
                <span className="bloco-rot">Detalhe</span>
                <div className="bloco-seg" role="radiogroup" aria-label="Nível de detalhe">
                  {(Object.keys(QUALIDADES) as Qualidade[]).map((q) => (
                    <button
                      key={q} role="radio" aria-checked={qualidade === q}
                      className={`bloco-seg-btn ${qualidade === q ? "bloco-seg-on" : ""}`}
                      onClick={() => setQualidade(q)}
                    >
                      {QUALIDADES[q].rotulo}
                    </button>
                  ))}
                </div>
              </div>

              {/* A PERGUNTA QUE O NÚMERO SOZINHO NÃO RESPONDE.
                  "Amostra de 12 m" parece precisão de 12 m. Num terreno
                  brasileiro, onde a fonte é SRTM de 30 m, seria falso — e a
                  malha mais fina não acrescenta dado nenhum, só interpola.
                  Dizer isso é o que separa mais detalhe de mais pixels. */}
              {relevo && (
                <p className="bloco-nota">
                  {relevo.resolucaoM > relevo.fonteM * 1.2 ? (
                    <>
                      Amostra de <strong>{num(relevo.resolucaoM)} m</strong>, contra
                      ~{num(relevo.fonteM)} m da fonte: ainda há detalhe a ganhar
                      subindo o nível ou reduzindo o recorte.
                    </>
                  ) : relevo.resolucaoM < relevo.fonteM * 0.8 ? (
                    <>
                      Amostra de <strong>{num(relevo.resolucaoM)} m</strong>, abaixo dos
                      ~{num(relevo.fonteM)} m da fonte. <strong>A malha está
                      interpolando</strong>, não acrescentando dado — a forma fica mais
                      lisa, e não mais verdadeira.
                    </>
                  ) : (
                    <>
                      Amostra de <strong>{num(relevo.resolucaoM)} m</strong>, no limite
                      dos ~{num(relevo.fonteM)} m da fonte. É todo o detalhe que existe
                      publicado para esta região.
                    </>
                  )}
                </p>
              )}
              {relevo?.tetoDeTiles && (
                <p className="bloco-ressalva">
                  O recorte pedia mais tiles do que o teto deste nível permite. A malha
                  fica vazada nas bordas — é escolha nossa de orçamento, não falta de
                  dado. Reduza o recorte ou baixe o detalhe.
                </p>
              )}

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
                <span>Paredes do corte</span>
              </label>

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={regua}
                  onChange={(e) => setRegua(e.target.checked)}
                />
                <span>Régua vertical na aresta</span>
              </label>
              {/* AS TRÊS LEITURAS SÃO A MESMA MEDIDA, e dizer isso é o que as
                  transforma de três enfeites em um instrumento. */}
              {est && (
                <p className="bloco-nota">
                  A régua, os estratos da parede e as curvas do terreno caem nas
                  <strong> mesmas altitudes</strong> — de {num(est.estratoM)} em{" "}
                  {num(est.estratoM)} m, com o traço longo a cada{" "}
                  {num(est.estratoM * 5)}. Não é preciso contar: basta ver onde o
                  morro cruza o traço comprido.
                </p>
              )}

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={curvas}
                  onChange={(e) => setCurvas(e.target.checked)}
                />
                <span>
                  Curvas de nível {est && <>a cada {num(est.estratoM)} m</>}
                  {est && <small> · mestra a cada {num(est.estratoM * 5)} m</small>}
                </span>
              </label>

              {curvas && (
                <div className="bloco-lin">
                  <span className="bloco-rot">Equidistância</span>
                  <div className="bloco-seg" role="radiogroup" aria-label="Equidistância das curvas">
                    {[0.25, 0.5, 1, 2, 4].map((m) => (
                      <button
                        key={m} role="radio" aria-checked={multiploCurvas === m}
                        className={`bloco-seg-btn ${multiploCurvas === m ? "bloco-seg-on" : ""}`}
                        onClick={() => setMultiploCurvas(m)}
                        title={est ? `${num((est.estratoM / multiploCurvas) * m)} m` : ""}
                      >
                        {m === 1 ? "auto" : m < 1 ? `÷${1 / m}` : `×${m}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* O controle da água só aparece onde HÁ água. Oferecer "lâmina
                  do mar" num planalto a 800 m sugeriria que existe mar ali —
                  e a única coisa que o bloco não pode fazer é inventar
                  geografia. `temAgua` é sobre o recorte, não sobre gosto. */}
              {est?.temAgua && (
                <label className="bloco-sw">
                  <input
                    type="checkbox" checked={agua}
                    onChange={(e) => setAgua(e.target.checked)}
                  />
                  <span>Lâmina d'água no nível do mar</span>
                </label>
              )}
              {est?.temAgua && agua && (
                <>
                  <label className="bloco-lin" htmlFor="bl-mar">
                    <span className="bloco-rot">
                      Mar a partir de
                      <output htmlFor="bl-mar">−{num(limiarMar)} m</output>
                    </span>
                    <input
                      id="bl-mar" type="range" min={0} max={20} step={1}
                      value={limiarMar}
                      onChange={(e) => setLimiarMar(Number(e.target.value))}
                      aria-label="Profundidade mínima para contar como mar"
                    />
                  </label>
                  {/* O LIMIAR NÃO É GOSTO, É O INSTRUMENTO.
                      Sem isto, quem baixar o controle a zero vai achar que
                      descobriu que a cidade está alagada — quando só desligou
                      a margem de erro do SRTM. */}
                  <p className="bloco-nota">
                    {limiarMar === 0 ? (
                      <>
                        <strong>Zero é o valor cru, e ele mente em costa baixa.</strong> A
                        acurácia vertical do SRTM é de metros: −1 m e +1 m são o mesmo
                        valor para ele. Restinga, baixada e areal aparecem alagados.
                      </>
                    ) : (
                      <>
                        Só conta como mar o que está abaixo de −{num(limiarMar)} m
                        <strong> e se comunica com a borda do recorte</strong>. O piso é a
                        margem de erro do SRTM; a conexão é o que separa mar de
                        depressão fechada.
                      </>
                    )}
                  </p>
                </>
              )}

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={faixas}
                  onChange={(e) => setFaixas(e.target.checked)}
                />
                <span>
                  Cor em faixas de altitude
                  {est && est.faixas && est.passoFaixaM > 0 && (
                    <> a cada {num(est.passoFaixaM)} m
                      {est.niveis > 0 && <small> · {est.niveis} faixas</small>}
                    </>
                  )}
                </span>
              </label>

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={rampaAdaptativa}
                  onChange={(e) => setRampaAdaptativa(e.target.checked)}
                />
                <span>Cor esticada para este recorte</span>
              </label>

              <label className="bloco-sw">
                <input
                  type="checkbox" checked={percentis}
                  onChange={(e) => setPercentis(e.target.checked)}
                />
                <span>Ignorar os 4% extremos</span>
              </label>
              {/* A EXPLICAÇÃO IMPORTA MAIS QUE O CONTROLE.
                  Num recorte grande, o mínimo é uma fossa e o máximo é um pico
                  isolado — 2% do dado consumindo 80% da escala. Quem não sabe
                  disso conclui, olhando, que "o relevo é plano". */}
              {percentis && relevo?.p2 != null && relevo.p98 != null && (
                <p className="bloco-nota">
                  A cor rende sobre <strong>{num(relevo.p2)} a {num(relevo.p98)} m</strong>,
                  onde 96% do recorte vive — e não sobre {num(relevo.minimo)} a{" "}
                  {num(relevo.maximo)}, que são a fossa e o pico. O que passa disso
                  satura na cor da ponta, que é a leitura certa para um extremo.
                  {relevo.mediana != null && <> A mediana é {num(relevo.mediana)} m.</>}
                </p>
              )}
              {/* A RESSALVA É OBRIGATÓRIA, e é o preço da rampa adaptativa.
                  Com ela a cor deixa de ser comparável entre blocos — o mesmo
                  azul vale −4.600 m aqui e −80 m num recorte costeiro. Isso
                  não pode ficar implícito na tela. */}
              <p className="bloco-nota">
                {rampaAdaptativa && est?.rampaDe != null && est.rampaAte != null ? (
                  <>
                    A rampa cobre {num(est.rampaDe)} a {num(est.rampaAte)} m — a faixa
                    deste recorte. Ganha contraste e <strong>deixa de ser comparável
                    com outro bloco</strong>. As paredes e as curvas continuam em
                    metros absolutos.
                    {est.temAgua && (
                      <> A metade submarina e a emersa são esticadas
                      <strong> separadamente</strong>, para o zero continuar no zero.</>
                    )}
                  </>
                ) : (
                  <>
                    Rampa hipsométrica absoluta (−8.000 a 6.000 m): a mesma cor
                    significa a mesma altitude em qualquer bloco. Num recorte
                    estreito, quase toda a paleta fica sem uso.
                  </>
                )}
              </p>
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
                      <label className="bloco-sw">
                        <input
                          type="checkbox" checked={campoLocal}
                          onChange={(e) => setCampoLocal(e.target.checked)}
                        />
                        <span>Escala do recorte</span>
                      </label>
                      {/* A RESSALVA, de novo, e pelo mesmo motivo da rampa.
                          Sem ela a pessoa compararia a altura da superfície
                          entre dois blocos achando que mede a mesma coisa. */}
                      <p className="bloco-nota">
                        {campoLocal && est?.campoDe != null && est.campoAte != null ? (
                          <>
                            A superfície cobre {num(est.campoDe, 2)} a {num(est.campoAte, 2)}
                            {unidade ? ` ${unidade}` : ""} — a variação DENTRO deste recorte.
                            É o que a tira de plana: na escala mundial, meia unidade sobre
                            60 km ocupa menos de 1% da faixa. <strong>A altura deixa de ser
                            comparável com outro bloco.</strong>
                          </>
                        ) : (
                          <>
                            Escala mundial do campo: a altura é comparável entre blocos, e
                            na maior parte dos recortes a superfície sai plana — porque a
                            variação local é uma fração ínfima da faixa global.
                          </>
                        )}
                      </p>

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
