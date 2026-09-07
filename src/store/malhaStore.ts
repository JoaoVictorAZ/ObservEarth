// src/store/malhaStore.ts
// -----------------------------------------------------------------------------
// O ESTADO DA CAMADA DE ANÁLISE.
// -----------------------------------------------------------------------------
// Esta store guarda três coisas que costumam ser confundidas e não são a mesma:
//
//   A CONFIGURAÇÃO — qual campo, qual detalhe, quanto exagero. É escolha de
//   quem olha, e sobrevive à troca de hora.
//
//   O DADO — a grade de valores que veio do servidor. É medida, e muda quando
//   a linha do tempo anda.
//
//   O RESULTADO — momentos, pontos críticos, característica de Euler. É conta,
//   e é derivado inteiramente do dado mais a configuração.
//
// O resultado NUNCA é preservado quando o dado muda. Guardar a lista de
// extremos das 12h enquanto a grade das 15h carrega mostraria pinos no lugar
// errado por alguns segundos, com aparência perfeitamente normal — que é o
// tipo de erro que ninguém reporta porque ninguém percebe.
// -----------------------------------------------------------------------------

import { create } from "zustand";
import { buscarCampo } from "../campoBin.ts";
import type { CampoEscalar } from "../malha/campo.ts";
import { momentos, type Momentos } from "../malha/estatistica.ts";
import {
  pontosCriticos, filtrarPorProeminencia, eulerPoincare,
  type PontoCritico, type Diagnostico,
} from "../malha/extremos.ts";
import type { Parada, ModoRampa } from "../malha/rampa.ts";

export interface EscalaCampo {
  lo: number;
  hi: number;
  stops: Parada[];
  modo: ModoRampa;
}

interface MalhaState {
  // ---- configuração ----
  ativa: boolean;
  campoId: string;
  /** 1, 2, 4 ou 8. Acima de 1 a grade é suavizada — ver server/campo.js */
  passo: number;
  exagero: number;
  arame: boolean;
  opacidade: number;
  mostrarExtremos: boolean;
  incluirSelas: boolean;
  /** limiar de proeminência EM DESVIOS PADRÃO do campo — ver o comentário */
  proeminenciaSigma: number;

  // ---- dado e resultado ----
  campo: CampoEscalar | null;
  escala: EscalaCampo | null;
  resumo: Momentos | null;
  criticos: PontoCritico[];
  /**
   * A detecção COMPLETA, sem filtro. Fica guardada porque mexer no limiar de
   * proeminência não pode custar os ~80 ms da varredura: o dado é o mesmo, e
   * só a pergunta mudou. Sem isto, arrastar o controle deslizante refazia a
   * detecção inteira a cada quadro.
   */
  criticosBrutos: PontoCritico[];
  euler: Diagnostico | null;
  /** metadados declarados pelo servidor: rodada, hora, cobertura */
  proveniencia: string | null;
  notaPasso: string | null;

  carregando: boolean;
  erro: string | null;
  /** identidade do que está carregado; evita refazer o mesmo pedido */
  chave: string;

  setAtiva: (v: boolean) => void;
  setCampoId: (id: string) => void;
  setPasso: (p: number) => void;
  setExagero: (x: number) => void;
  setArame: (v: boolean) => void;
  setOpacidade: (o: number) => void;
  setMostrarExtremos: (v: boolean) => void;
  setIncluirSelas: (v: boolean) => void;
  setProeminenciaSigma: (s: number) => void;

  carregar: (dia: string, hora: number, paradas: Parada[] | null, modo: ModoRampa) => Promise<void>;
  /** aplica só a escala de cor e altura; não toca a rede */
  aplicarEscala: (paradas: Parada[] | null, modo: ModoRampa) => void;
  /** varre o campo inteiro; caro. Só depois de carregar um campo novo. */
  detectar: () => void;
  /** só reordena e corta a lista já detectada; barato. */
  recalcular: () => void;
  limpar: () => void;
}

/**
 * O LIMIAR EM DESVIOS PADRÃO, e não na unidade do campo.
 *
 * "Descartar mínimos com menos de 2 hPa de proeminência" é uma frase razoável
 * para pressão e sem sentido para umidade relativa, onde 2% é ruído, ou para
 * precipitação, onde 2 mm é uma tempestade. Um controle em unidade física
 * precisaria de um valor calibrado por campo, e cada campo novo entraria com
 * um número chutado.
 *
 * Em desvios padrão do próprio campo, o mesmo 0,25 significa "um quarto da
 * variação típica desta grandeza neste instante" em todos eles. O painel mostra
 * a tradução para a unidade ao lado, porque é ela que a pessoa reconhece.
 */
const SIGMA_PADRAO = 0.25;

export const useMalhaStore = create<MalhaState>((set, get) => ({
  ativa: false,
  campoId: "prmsl",     // pressão: o campo em que centro de alta e de baixa
                        // SÃO literalmente máximo e mínimo locais
  passo: 4,
  exagero: 0.11,
  arame: false,
  opacidade: 0.93,
  mostrarExtremos: true,
  incluirSelas: false,
  proeminenciaSigma: SIGMA_PADRAO,

  campo: null,
  escala: null,
  resumo: null,
  criticos: [],
  criticosBrutos: [],
  euler: null,
  proveniencia: null,
  notaPasso: null,
  carregando: false,
  erro: null,
  chave: "",

  setAtiva: (ativa) => set({ ativa }),
  setCampoId: (campoId) => set({ campoId, chave: "" }),
  setPasso: (passo) => set({ passo: Math.max(1, Math.min(8, passo)), chave: "" }),
  setExagero: (exagero) => set({ exagero }),
  setArame: (arame) => set({ arame }),
  setOpacidade: (opacidade) => set({ opacidade }),
  setMostrarExtremos: (mostrarExtremos) => set({ mostrarExtremos }),
  setIncluirSelas: (incluirSelas) => { set({ incluirSelas }); get().recalcular(); },
  setProeminenciaSigma: (proeminenciaSigma) => { set({ proeminenciaSigma }); get().recalcular(); },

  limpar: () => set({
    campo: null, escala: null, resumo: null,
    criticos: [], criticosBrutos: [], euler: null,
    proveniencia: null, notaPasso: null, erro: null, chave: "",
  }),

  /**
   * A DETECÇÃO — sempre completa: esfera inteira, selas incluídas, sem filtro.
   *
   * É a única forma em que a soma dos índices de Morse pode fechar em
   * χ(S²) = 2, e sem essa conta o diagnóstico não diagnostica nada. Custa ~80
   * ms numa grade de 1°, e é o preço de ter uma verificação de verdade.
   */
  detectar: () => {
    const { campo } = get();
    if (!campo) return;
    const criticosBrutos = pontosCriticos(campo, undefined, {
      // Em QUILÔMETROS, e não em células. O raio é a escala do fenômeno que se
      // quer separar do ruído — 450 km é o tamanho de um centro de pressão de
      // latitude média — e ele não pode depender da resolução da grade nem da
      // latitude. Ver `proeminenciaLocal` em src/malha/extremos.ts.
      raioKm: 450,
      incluirSelas: true,
    });
    set({
      criticosBrutos,
      euler: eulerPoincare(criticosBrutos, { global: true, comSelas: true, filtrado: false }),
    });
    get().recalcular();
  },

  /**
   * A SELEÇÃO — o que vale mostrar, sobre a detecção que já existe.
   *
   * Um campo de pressão a 1° tem centenas de mínimos locais, e isso não é
   * defeito: é o que uma grade discreta de um campo com ruído tem. Uns dez são
   * centros sinóticos. Filtrar aqui, e não na detecção, tem a consequência de
   * que esta lista NÃO satisfaz mais a conta de Euler — e não deveria.
   */
  recalcular: () => {
    const { criticosBrutos, resumo, incluirSelas, proeminenciaSigma } = get();
    if (!criticosBrutos.length || !resumo) { set({ criticos: [] }); return; }
    set({
      // A separação mínima é o que impede a lista de encher com quinze
      // recortes do MESMO fenômeno. Ver `filtrarPorProeminencia`.
      criticos: filtrarPorProeminencia(
        incluirSelas ? criticosBrutos : criticosBrutos.filter((p) => p.tipo !== "sela"),
        proeminenciaSigma * resumo.desvio,
        40,
        600,
      ),
    });
  },

  /**
   * A ESCALA É SEPARADA DA REDE, e essa separação é a correção de um defeito
   * que deixava a malha INVISÍVEL sem nenhuma mensagem.
   *
   * As paradas da rampa vêm de `/api/fields`, que o painel de camadas busca em
   * paralelo. Se a malha carregasse o campo ANTES de o catálogo chegar,
   * `paradas` vinha nulo e a escala ficava nula com ele — e `MalhaEscalar`
   * recusa desenhar sem escala, porque sem as paradas ela pintaria numa cor
   * que não é a do PNG do mesmo campo.
   *
   * Até aí, correto. O defeito era o que vinha depois: quando o catálogo
   * chegava, o efeito rodava de novo, `carregar` via que a chave não tinha
   * mudado — ela é campo|dia|hora|passo, e nada disso mudou — e voltava na
   * primeira linha. A escala continuava nula PARA SEMPRE. O painel mostrava
   * média, extremos e a conta de Euler normalmente; só o relevo nunca aparecia,
   * e nada na tela dizia por quê.
   *
   * Aplicar a escala é uma atribuição, não uma requisição. Ela não tem por que
   * estar atrás do controle de repetição da rede.
   */
  aplicarEscala: (paradas, modo) => {
    const atual = get().escala;
    if (!paradas?.length) {
      if (atual) set({ escala: null });
      return;
    }
    const lo = paradas[0][0];
    const hi = paradas[paradas.length - 1][0];
    if (atual && atual.lo === lo && atual.hi === hi && atual.modo === modo) return;
    // A ESCALA DE COR E DE ALTURA É A MESMA, e é a do catálogo — as mesmas
    // paradas que o PNG usa. Normalizar pelos extremos do instante daria uma
    // malha sempre igualmente alta e sempre com as mesmas cores nas pontas, o
    // que apagaria justamente a informação de que hoje está mais extremo que
    // ontem. Com escala fixa, a animação da linha do tempo mostra o relevo
    // crescer e encolher — que é o que se quer ver.
    set({ escala: { lo, hi, stops: paradas, modo } });
  },

  carregar: async (dia, hora, paradas, modo) => {
    get().aplicarEscala(paradas, modo);

    const { campoId, passo, chave } = get();
    const nova = `${campoId}|${dia}|${hora}|${passo}`;
    if (nova === chave) return;

    set({ carregando: true, erro: null });
    try {
      const bruto = await buscarCampo(
        `/api/campo/${campoId}?date=${dia}&hour=${hora}&passo=${passo}`,
      );
      const valores = bruto.planos[campoId];
      if (!valores) throw new Error(`o servidor não devolveu o plano "${campoId}"`);

      const unidades = (bruto.unidades ?? {}) as Record<string, string>;
      const titulos = (bruto.titulos ?? {}) as Record<string, string>;

      const campo: CampoEscalar = {
        nx: bruto.nx, ny: bruto.ny,
        valores,
        valido: bruto.valido,
        unidade: unidades[campoId],
        titulo: titulos[campoId],
        dataset: bruto.dataset as string | undefined,
      };

      const resumo = momentos(campo);

      set({
        campo, resumo,
        criticos: [], criticosBrutos: [], euler: null,
        proveniencia: [
          bruto.dataset,
          bruto.cycle ? `rodada ${bruto.cycle}` : null,
          typeof bruto.forecastHour === "number" ? `+${bruto.forecastHour}h` : null,
          typeof bruto.coberturaPct === "number" ? `${bruto.coberturaPct}% medido` : null,
          `${bruto.nx}×${bruto.ny}`,
        ].filter(Boolean).join(" · "),
        notaPasso: (bruto.notaPasso as string | null) ?? null,
        carregando: false, chave: nova,
      });
      get().detectar();
    } catch (e) {
      // Sem plano B inventado. Um campo que não veio não vira uma malha plana:
      // vira uma mensagem dizendo o que faltou.
      set({
        carregando: false,
        erro: e instanceof Error ? e.message : String(e),
        campo: null, resumo: null,
        criticos: [], criticosBrutos: [], euler: null,
        chave: "",
      });
    }
  },
}));
