// src/store/blocoStore.ts
// -----------------------------------------------------------------------------
// O ESTADO DO RECORTE 3D.
// -----------------------------------------------------------------------------
// Mesma separação de `malhaStore`, e pelo mesmo motivo: CONFIGURAÇÃO (o que se
// escolheu ver), DADO (o que a rede trouxe) e RESULTADO ficam em campos
// distintos, e o resultado nunca sobrevive à troca do dado.
//
// A diferença é que aqui o dado tem custo de REQUISIÇÃO, não de cota: os tiles
// de elevação são gratuitos e ficam uma semana em cache no servidor, mas cada
// bloco novo são até 24 deles. Por isso a chave de identidade inclui o lado do
// recorte — mudar de 60 para 120 km é outro bloco, e mudar o exagero não é.
// -----------------------------------------------------------------------------

import { create } from "zustand";
import {
  caixaEmVolta, montarRelevo, temCoberturaDeRelevo,
  type RelevoPronto, type Qualidade,
} from "../bloco/relevo.ts";

/** Tamanhos oferecidos, em quilômetros de lado. */
export const LADOS = [30, 60, 120, 250, 500] as const;

interface BlocoState {
  // ---- configuração ----
  aberto: boolean;
  lat: number | null;
  lng: number | null;
  ladoKm: number;
  /**
   * Exagero vertical do TERRENO. Um bloco de 60 km com um morro de 800 m tem
   * uma razão real de 1:75 — sem exagero o relevo é uma ondulação de meio
   * pixel. Todo diagrama de bloco desde o século XIX declara este número, e a
   * interface declara também.
   */
  exagero: number;
  mostrarCampo: boolean;
  mostrarParedes: boolean;
  /** curvas de nível sobre o terreno, no passo dos estratos da parede */
  curvas: boolean;
  /**
   * Rampa de cor esticada para a faixa do recorte.
   *
   * Ligada por padrão porque o bloco é um instrumento LOCAL — ele responde
   * "como é aqui", e a rampa absoluta desperdiça a paleta num recorte estreito.
   * Quem estiver comparando dois lugares desliga e recupera a comparabilidade.
   */
  rampaAdaptativa: boolean;
  /** cor do terreno em faixas discretas de altitude, como num atlas */
  faixas: boolean;
  /**
   * A cor cobre p2–p98 em vez de mínimo–máximo.
   *
   * Ligado por padrão porque num recorte grande os extremos são raros e comem a
   * escala: 2% do dado consumindo 80% da faixa deixa o resto plano.
   */
  percentis: boolean;
  /**
   * Quanto detalhe buscar e desenhar — ver `QUALIDADES` em bloco/relevo.ts.
   *
   * O padrão é `medio`. `detalhe` quadruplica os vértices e é onde se lê uma
   * encosta; `leve` existe para máquina modesta e para recorte grande, em que
   * o detalhe fino não cabe na tela de qualquer forma.
   */
  qualidade: Qualidade;
  /**
   * Multiplicador da equidistância automática.
   *
   * 1 é o valor calculado do recorte; 0,5 dobra o número de curvas, 2 corta
   * pela metade. É a mesma escolha que uma carta topográfica faz ao declarar
   * "equidistância 20 m" — depende da escala e do que se quer ler.
   */
  multiploCurvas: number;
  /** a lâmina d'água no zero — só tem efeito onde há profundidade */
  agua: boolean;
  /**
   * Piso de profundidade para uma célula contar como mar, em metros.
   *
   * Dois por padrão, e o motivo é o instrumento: a acurácia vertical do SRTM é
   * da ordem de metros, então −1 m e +1 m são o mesmo valor para ele. Com zero
   * cru, toda restinga e toda baixada costeira aparecem alagadas.
   */
  limiarMar: number;
  /** a régua vertical na aresta, com traços nos mesmos estratos da parede */
  regua: boolean;
  /**
   * Campo normalizado pela faixa do RECORTE.
   *
   * Ligado por padrão pelo mesmo motivo da rampa: a escala mundial de pressão
   * cobre ~100 hPa e um recorte de 60 km varia meio — normalizada pela global,
   * a superfície é uma laje. A troca é a mesma: ganha estrutura, perde
   * comparabilidade entre blocos, e o painel declara.
   */
  campoLocal: boolean;
  /** vão extra entre o terreno e a malha do campo, em km de cena */
  alturaCampo: number;
  opacidadeCampo: number;

  // ---- dado ----
  relevo: RelevoPronto | null;
  carregando: boolean;
  erro: string | null;
  /** identidade do que está carregado: lat|lng|lado */
  chave: string;

  abrir: (lat: number, lng: number) => void;
  fechar: () => void;
  setLadoKm: (km: number) => void;
  setExagero: (x: number) => void;
  setMostrarCampo: (v: boolean) => void;
  setMostrarParedes: (v: boolean) => void;
  setCurvas: (v: boolean) => void;
  setRampaAdaptativa: (v: boolean) => void;
  setFaixas: (v: boolean) => void;
  setPercentis: (v: boolean) => void;
  setQualidade: (q: Qualidade) => void;
  setMultiploCurvas: (m: number) => void;
  setAgua: (v: boolean) => void;
  setLimiarMar: (m: number) => void;
  setRegua: (v: boolean) => void;
  setCampoLocal: (v: boolean) => void;
  setAlturaCampo: (km: number) => void;
  setOpacidadeCampo: (o: number) => void;
  carregar: () => Promise<void>;
}

export const useBlocoStore = create<BlocoState>((set, get) => ({
  aberto: false,
  lat: null,
  lng: null,
  ladoKm: 60,
  exagero: 14,
  mostrarCampo: true,
  mostrarParedes: true,
  curvas: true,
  rampaAdaptativa: true,
  faixas: true,
  percentis: true,
  qualidade: "medio",
  multiploCurvas: 1,
  agua: true,
  limiarMar: 2,
  regua: true,
  campoLocal: true,
  alturaCampo: 0,
  opacidadeCampo: 0.78,

  relevo: null,
  carregando: false,
  erro: null,
  chave: "",

  abrir: (lat, lng) => set({ aberto: true, lat, lng }),
  fechar: () => set({ aberto: false }),

  // Mudar o LADO é outro recorte: o dado precisa vir de novo, e a chave zera
  // para forçar isso. Mudar o exagero não toca o dado — é só geometria.
  setLadoKm: (km) => set({ ladoKm: Math.max(5, Math.min(2000, km)), chave: "" }),
  setExagero: (exagero) => set({ exagero: Math.max(1, Math.min(60, exagero)) }),
  setMostrarCampo: (mostrarCampo) => set({ mostrarCampo }),
  setMostrarParedes: (mostrarParedes) => set({ mostrarParedes }),
  setCurvas: (curvas) => set({ curvas }),
  setRampaAdaptativa: (rampaAdaptativa) => set({ rampaAdaptativa }),
  setFaixas: (faixas) => set({ faixas }),
  setPercentis: (percentis) => set({ percentis }),
  // `chave: ""` força a rebusca: a qualidade muda a grade E o nível de tile,
  // então o relevo em mãos já não serve. Sem isto, trocar de modo não faria
  // nada — o mesmo defeito que `setLadoKm` já tinha resolvido.
  setQualidade: (qualidade) => set({ qualidade, chave: "" }),
  // NÃO zera a chave: a equidistância é desenho, e não dado. Rebuscar os tiles
  // por causa dela gastaria orçamento para receber exatamente o mesmo relevo.
  setMultiploCurvas: (multiploCurvas) =>
    set({ multiploCurvas: Math.max(0.125, Math.min(8, multiploCurvas)) }),
  setAgua: (agua) => set({ agua }),
  setLimiarMar: (limiarMar) => set({ limiarMar: Math.max(0, Math.min(30, limiarMar)) }),
  setRegua: (regua) => set({ regua }),
  setCampoLocal: (campoLocal) => set({ campoLocal }),
  setAlturaCampo: (alturaCampo) => set({ alturaCampo: Math.max(0, alturaCampo) }),
  setOpacidadeCampo: (opacidadeCampo) => set({ opacidadeCampo }),

  carregar: async () => {
    const { lat, lng, ladoKm, chave, aberto, qualidade } = get();
    if (!aberto || lat == null || lng == null) return;

    // Quatro casas na chave: o bloco não muda de lugar por um centésimo de
    // grau, e uma chave mais fina refaria a busca a cada clique próximo.
    // A qualidade entra na chave: dois pedidos no mesmo ponto e com o mesmo
    // lado, mas em qualidades diferentes, são recortes DIFERENTES.
    const nova = `${lat.toFixed(4)}|${lng.toFixed(4)}|${ladoKm}|${qualidade}`;
    if (nova === chave) return;

    set({ carregando: true, erro: null });
    try {
      // LIMITE PERMANENTE vem ANTES da tentativa. Além de ±85,05° não há tile
      // e não vai haver: o Web Mercator não alcança o polo. Buscar mesmo assim
      // gastaria requisição para receber 404 e produzir a mensagem errada —
      // "nenhum tile respondeu" descreve uma falha passageira, e esta não é.
      if (!temCoberturaDeRelevo(lat)) {
        throw new Error(
          `${Math.abs(lat).toFixed(1)}° está além do limite do Web Mercator ` +
          "(±85,05°), e os tiles de elevação são Mercator. Não é falta de " +
          "cobertura da fonte: é a projeção não chegar ao polo. " +
          "O recorte 3D não alcança as calotas.",
        );
      }
      const relevo = await montarRelevo(caixaEmVolta(lat, lng, ladoKm), qualidade);
      if (relevo.tiles === 0) {
        throw new Error(
          "nenhum tile de elevação respondeu para esta região — " +
          "há cobertura de terreno faltando aqui.",
        );
      }
      set({ relevo, carregando: false, chave: nova });
    } catch (e) {
      // Sem terreno inventado. Um bloco plano no nível do mar seria a coisa
      // mais fácil de desenhar e a mais fácil de acreditar.
      set({
        carregando: false,
        erro: e instanceof Error ? e.message : String(e),
        relevo: null, chave: "",
      });
    }
  },
}));
