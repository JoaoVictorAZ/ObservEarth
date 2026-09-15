// src/legenda/ativa.ts
// -----------------------------------------------------------------------------
// QUAL CAMADA MANDA NA RÉGUA
// -----------------------------------------------------------------------------
// A RECLAMAÇÃO: "a régua não aparece para todos os efeitos". Estava certa. Ela
// conhecia DUAS camadas — o campo pintado e o vento — e o app tem mais. Ligar
// correntes oceânicas pintava o planeta inteiro de linhas em movimento sem
// nenhuma escala; ligar a malha 3D levantava um relevo colorido sem dizer o que
// as cores valem. Nos dois casos a tela afirmava uma grandeza e escondia a
// unidade dela.
//
// ---------------------------------------------------------------------------
// POR QUE ISTO É UM MÓDULO, E NÃO UM `if` DENTRO DO COMPONENTE
// ---------------------------------------------------------------------------
// Duas peças precisam da MESMA resposta:
//
//   a régua      para desenhar a escala certa
//   o cursor     para amostrar a grade certa sob o ponteiro
//
// Com a decisão escrita nos dois lugares, elas divergem no primeiro dia em que
// alguém mexer numa só — e o sintoma é cruel: a régua diz "Corrente oceânica"
// enquanto o ponteiro lê a grade do vento, e o número que aparece é plausível.
// Um valor errado que PARECE certo é pior que um erro em vermelho. Por isso a
// mesma chamada devolve a escala e o `chave` que diz de onde vem o número.
//
// ---------------------------------------------------------------------------
// A ORDEM DE PRECEDÊNCIA, e o porquê de cada degrau
// ---------------------------------------------------------------------------
// 1. MALHA 3D    quando levantada, ela é o objeto em primeiro plano e o resto
//                recua (`modoAnalise`). É também a única camada pintada cujos
//                valores estão no cliente — é a única que dá leitura contínua
//                de um campo pintado.
// 2. CAMPO       cobre o planeta e é a razão de a tela estar colorida.
// 3. CORRENTE    campo contínuo, com valores no cliente.
// 4. VENTO       ligado por padrão; é o piso, não o topo.
// 5. nada        sem grandeza contínua não há escala, e a régua some inteira em
//                vez de virar uma barra cinza afirmando que existe uma.
//
// ---------------------------------------------------------------------------
// O QUE DELIBERADAMENTE NÃO ENTRA
// ---------------------------------------------------------------------------
// SISMO, FOCO DE CALOR, ESTAÇÃO, HOSPITAL, AVISO — são ocorrências, não campos.
// Uma rampa de magnitude sob um mapa de pontos sugeriria que a COR DO PLANETA
// significa magnitude, e ela não significa nada disso.
//
// ISÓBARAS — são isolinhas rotuladas: o número já está desenhado em cima da
// linha. Uma rampa de pressão embaixo delas competiria com o próprio rótulo.
//
// IMAGEM DE SATÉLITE (GIBS, MODIS, VIIRS) — é cor real, não grandeza. Não há
// escala porque não há eixo: azul ali é o oceano, não "menos" de coisa nenhuma.
// -----------------------------------------------------------------------------

import type { Parada, Modo } from "./regua.ts";

/** o que a régua precisa saber, e nada além disso */
export interface Escala {
  /** de onde o número sob o cursor tem que sair; ver o comentário do arquivo */
  chave: "malha" | "campo" | "corrente" | "vento";
  titulo: string;
  unidade: string;
  stops: Parada[];
  modo: Modo;
  piso: number | null;
  casas: number;
  /** há número no cliente para o ponteiro ler? */
  amostravel: boolean;
  procedencia: string | null;
  /** chave em `fontesStore`, para o estado da fonte aparecer no rodapé */
  fonteId: string | null;
}

export interface EntradaCampo {
  id: string;
  title: string;
  unit: string;
  stops?: [number, [number, number, number]][];
  render?: Modo;
  floor?: number;
  group?: string;
}

export interface EntradaMalha {
  ativa: boolean;
  /** só existe quando o campo já chegou; sem ele não há o que medir */
  titulo?: string | null;
  unidade?: string | null;
  stops?: Parada[] | null;
  modo?: Modo;
  /** o campo binário chegou? sem ele a malha está ligada mas vazia */
  temValores: boolean;
}

export interface Entrada {
  /** "globo" | "mapa" — a malha 3D não existe no mapa plano */
  modo: string;
  malha: EntradaMalha | null;
  campo: EntradaCampo | null;
  correntes: boolean;
  /** a grade de correntes já chegou ao cliente? */
  correntesNoCliente?: boolean;
  vento: boolean;
  /** a grade de vento já chegou ao cliente? */
  ventoNoCliente?: boolean;
  /** paradas do vento, convertidas para RGB pelo chamador */
  stopsVento: Parada[];
  /** paradas da corrente, convertidas para RGB pelo chamador */
  stopsCorrente: Parada[];
}

/**
 * Quantas casas decimais a grandeza merece.
 *
 * Pressão em décimos de hPa é ruído: a diferença entre 1013,4 e 1013,5 não
 * significa nada num campo de modelo, e um dígito que oscila sozinho treina o
 * olho a ignorar o número inteiro.
 */
export function casasDe(unidade: string): number {
  if (unidade === "hPa") return 0;
  if (unidade === "%") return 0;
  return 1;
}

export function escalaAtiva(e: Entrada): Escala | null {
  // ---- 1. a malha 3D ------------------------------------------------------
  // `temValores` é o que separa "ligada" de "pronta". Entre o interruptor e a
  // chegada dos 326 kB do campo existe uma janela de segundos em que a malha
  // está ativa e vazia; desenhar a escala dela ali seria prometer uma leitura
  // que ainda não existe.
  const m = e.malha;
  if (e.modo !== "mapa" && m?.ativa && m.temValores && m.stops?.length) {
    return {
      chave: "malha",
      titulo: m.titulo || "Malha 3D",
      unidade: m.unidade ?? "",
      stops: m.stops,
      modo: m.modo ?? "rampa",
      piso: null,
      casas: casasDe(m.unidade ?? ""),
      // A ÚNICA CAMADA PINTADA COM LEITURA CONTÍNUA. O campo escalar da malha
      // está no cliente em Float32Array — o mesmo dado que virou geometria
      // responde o valor sob o ponteiro, de graça.
      amostravel: true,
      procedencia: "malha 3D · valores no cliente",
      fonteId: null,
    };
  }

  // ---- 2. o campo pintado --------------------------------------------------
  const c = e.campo;
  if (c?.stops?.length) {
    return {
      chave: "campo",
      titulo: c.title,
      unidade: c.unit,
      stops: c.stops as Parada[],
      modo: c.render ?? "rampa",
      piso: c.floor ?? null,
      casas: casasDe(c.unit),
      // Pintado como textura: os números não estão no cliente. Ler a cor de
      // volta e converter em número inventaria precisão a partir de uma rampa
      // comprimida em 8 bits.
      amostravel: false,
      procedencia: c.group ?? null,
      fonteId: "campo:" + c.id,
    };
  }

  // ---- 3. as correntes -----------------------------------------------------
  if (e.correntes) {
    return {
      chave: "corrente",
      titulo: "Corrente oceânica à superfície",
      unidade: "m/s",
      stops: e.stopsCorrente,
      modo: "rampa",
      piso: null,
      casas: 2,   // 0,05 m/s importa num campo que quase todo cabe abaixo de 0,5
      amostravel: !!e.correntesNoCliente,
      procedencia: null,   // quem sabe a procedência é a resposta; vem de fora
      fonteId: "correntes",
    };
  }

  // ---- 4. o vento ----------------------------------------------------------
  if (e.vento) {
    return {
      chave: "vento",
      titulo: "Vento à superfície",
      unidade: "m/s",
      stops: e.stopsVento,
      modo: "rampa",
      piso: null,
      casas: 1,
      amostravel: !!e.ventoNoCliente,
      procedencia: null,
      fonteId: "vento",
    };
  }

  // ---- 5. nada -------------------------------------------------------------
  return null;
}
