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
import { caixaEmVolta, montarRelevo, type RelevoPronto } from "../bloco/relevo.ts";

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
  setAlturaCampo: (alturaCampo) => set({ alturaCampo: Math.max(0, alturaCampo) }),
  setOpacidadeCampo: (opacidadeCampo) => set({ opacidadeCampo }),

  carregar: async () => {
    const { lat, lng, ladoKm, chave, aberto } = get();
    if (!aberto || lat == null || lng == null) return;

    // Quatro casas na chave: o bloco não muda de lugar por um centésimo de
    // grau, e uma chave mais fina refaria a busca a cada clique próximo.
    const nova = `${lat.toFixed(4)}|${lng.toFixed(4)}|${ladoKm}`;
    if (nova === chave) return;

    set({ carregando: true, erro: null });
    try {
      const relevo = await montarRelevo(caixaEmVolta(lat, lng, ladoKm));
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
