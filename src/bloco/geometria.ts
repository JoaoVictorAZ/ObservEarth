// src/bloco/geometria.ts
// -----------------------------------------------------------------------------
// A GEOMETRIA DO BLOCO — fora do motor, para poder ser conferida sem GPU.
// -----------------------------------------------------------------------------
// `src/bloco/cena.ts` cria um `WebGLRenderer` no construtor, e isso o torna
// impossível de carregar num teste: não há contexto WebGL no Node. Mas o que
// pode dar errado ali quase nunca é o desenho — é a CONTA que decide onde cada
// vértice fica.
//
// Um erro de sinal em latitude espelha o bloco norte-sul; um exagero aplicado
// duas vezes dobra o relevo; uma saia construída na ordem errada gera
// triângulos virados para dentro e o bloco fica com paredes invisíveis. Nada
// disso lança exceção, e tudo isso é aritmética que se confere numa linha.
//
// Este arquivo é a mesma escolha que `src/tiles.ts`, `src/arrasto.ts` e
// `src/calota.ts` já fizeram: a decisão sai do motor e vai para onde o teste
// alcança.
// -----------------------------------------------------------------------------

import { type CampoEscalar, medido } from "../malha/campo.ts";
import {
  type Caixa, latDaLinhaDoBloco, lngDaColunaDoBloco, tamanhoKm,
} from "./relevo.ts";

/** Escala de cena: quilômetros por grau, e o centro da caixa. */
export interface Metrica {
  larguraKm: number;
  alturaKm: number;
  kmPorLng: number;
  kmPorLat: number;
  lngC: number;
  latC: number;
}

export function metricaDa(cx: Caixa): Metrica {
  const { largura, altura } = tamanhoKm(cx);
  return {
    larguraKm: largura,
    alturaKm: altura,
    kmPorLng: largura / Math.max(1e-9, cx.lngLeste - cx.lngOeste),
    kmPorLat: altura / Math.max(1e-9, cx.latNorte - cx.latSul),
    lngC: (cx.lngOeste + cx.lngLeste) / 2,
    latC: (cx.latSul + cx.latNorte) / 2,
  };
}

/**
 * Metros de altitude → quilômetros de cena.
 *
 * O exagero entra AQUI e em nenhum outro lugar. Ele já foi aplicado duas vezes
 * numa versão intermediária deste código — uma na posição do vértice e outra
 * na altura do piso — e o resultado é um bloco cuja parede não bate com o
 * terreno que ela sustenta.
 */
export const kmDeMetros = (m: number, exagero: number) => (m / 1000) * exagero;

export interface MalhaBruta {
  posicao: Float32Array;
  /** altitude em METROS por vértice, para os estratos da parede */
  altitude: Float32Array;
  indice: Uint32Array;
  vertices: number;
  triangulos: number;
}

/**
 * A SUPERFÍCIE DO TERRENO.
 *
 * Eixos da cena: x para LESTE, z para o SUL, y para cima. O z para o sul e não
 * para o norte é o que faz a vista padrão — de sudeste e de cima — mostrar o
 * bloco com o norte ao fundo, que é a convenção de todo mapa.
 *
 * Buraco de cobertura continua buraco: o vértice recebe posição finita (um NaN
 * contaminaria a caixa envolvente e o three.js sumiria com a malha inteira),
 * mas nenhum triângulo o inclui. O bloco fica vazado ali em vez de ganhar um
 * platô no nível do mar que ninguém mediu.
 */
export function malhaDoTerreno(
  campo: CampoEscalar, cx: Caixa, exagero: number, piso: number,
): MalhaBruta {
  const { nx, ny } = campo;
  const m = metricaDa(cx);
  const n = nx * ny;

  const posicao = new Float32Array(n * 3);
  const altitude = new Float32Array(n);

  for (let j = 0; j < ny; j++) {
    const lat = latDaLinhaDoBloco(j, ny, cx);
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lng = lngDaColunaDoBloco(i, nx, cx);
      const tem = medido(campo, k);
      const h = tem ? campo.valores[k] : piso;
      posicao[k * 3] = (lng - m.lngC) * m.kmPorLng;
      posicao[k * 3 + 1] = kmDeMetros(h, exagero);
      posicao[k * 3 + 2] = (m.latC - lat) * m.kmPorLat;
      altitude[k] = h;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = j * nx + i + 1;
      const c = (j + 1) * nx + i + 1, d = (j + 1) * nx + i;
      if (!medido(campo, a) || !medido(campo, b)
        || !medido(campo, c) || !medido(campo, d)) continue;
      idx.push(a, b, c, a, c, d);
    }
  }

  return {
    posicao, altitude,
    indice: new Uint32Array(idx),
    vertices: n,
    triangulos: idx.length / 3,
  };
}

/**
 * Profundidade do bloco abaixo do ponto mais baixo do terreno, em km de cena.
 *
 * É uma fração da LARGURA, e não da amplitude do relevo. Um bloco de planície
 * teria parede de dois pixels se a profundidade dependesse do relevo — e a
 * parede é justamente onde a escala vertical pode ser lida.
 */
export function profundidadeKm(larguraKm: number): number {
  return Math.max(1.5, larguraKm * 0.10);
}

export interface Saia {
  posicao: Float32Array;
  altitude: Float32Array;
  triangulos: number;
  /** o y do piso, em km de cena */
  pisoY: number;
  /** a altitude equivalente do piso, em metros — para os estratos da parede */
  pisoM: number;
}

/**
 * A SAIA E O PISO: o que transforma uma casca em bloco.
 *
 * Cada segmento da borda vira dois triângulos descendo até o piso, e o piso
 * fecha por baixo. Sem isso o recorte é um tapete flutuando; com isso ele tem
 * volume — e ganha a superfície em que os estratos de altitude são desenhados.
 *
 * A saia não usa índice: são poucos triângulos e cada vértice pertence a uma
 * face só, então indexar economizaria memória que não está faltando e custaria
 * um mapa de vizinhança que erraria em silêncio.
 */
export function saiaDoBloco(
  malha: MalhaBruta, nx: number, ny: number,
  minimoM: number, exagero: number, larguraKm: number,
): Saia {
  const fundo = profundidadeKm(larguraKm);
  const pisoY = kmDeMetros(minimoM, exagero) - fundo;
  // A altitude equivalente do piso: a inversa exata de `kmDeMetros`, para os
  // estratos continuarem espaçados corretamente na parede.
  const pisoM = minimoM - (fundo / exagero) * 1000;

  const pos: number[] = [];
  const alt: number[] = [];
  const p = malha.posicao, a = malha.altitude;

  /** um segmento de borda: (k → kb) no topo, descendo ao piso */
  const parede = (k: number, kb: number) => {
    const ax = p[k * 3], ay = p[k * 3 + 1], az = p[k * 3 + 2];
    const bx = p[kb * 3], by = p[kb * 3 + 1], bz = p[kb * 3 + 2];
    pos.push(ax, ay, az, bx, by, bz, ax, pisoY, az);
    alt.push(a[k], a[kb], pisoM);
    pos.push(bx, by, bz, bx, pisoY, bz, ax, pisoY, az);
    alt.push(a[kb], pisoM, pisoM);
  };

  for (let i = 0; i < nx - 1; i++) {
    parede(i, i + 1);                                       // borda norte
    parede((ny - 1) * nx + i + 1, (ny - 1) * nx + i);       // borda sul
  }
  for (let j = 0; j < ny - 1; j++) {
    parede((j + 1) * nx, j * nx);                           // borda oeste
    parede(j * nx + nx - 1, (j + 1) * nx + nx - 1);         // borda leste
  }

  // O piso, para o bloco ser sólido visto de baixo do horizonte.
  const x0 = p[0], z0 = p[2];
  const x1 = p[(nx - 1) * 3], z1 = p[(ny - 1) * nx * 3 + 2];
  pos.push(x0, pisoY, z0, x1, pisoY, z0, x1, pisoY, z1);
  alt.push(pisoM, pisoM, pisoM);
  pos.push(x0, pisoY, z0, x1, pisoY, z1, x0, pisoY, z1);
  alt.push(pisoM, pisoM, pisoM);

  return {
    posicao: new Float32Array(pos),
    altitude: new Float32Array(alt),
    triangulos: pos.length / 9,
    pisoY, pisoM,
  };
}

/**
 * A FAIXA em que a malha do campo flutua.
 *
 * Ela começa acima do pico mais alto do recorte, com um vão visível, e tem
 * espessura própria. As duas coisas são deliberadas: encostar a superfície do
 * campo no terreno faria parecer que uma superfície de pressão é uma nuvem
 * pousada no morro, e a altura dela é VALOR, não altitude.
 */
export function faixaDoCampo(
  maximoM: number, exagero: number, larguraKm: number, afastamentoKm = 0,
): { base: number; espessura: number } {
  return {
    base: kmDeMetros(maximoM, exagero) + Math.max(1.2, larguraKm * 0.08) + afastamentoKm,
    espessura: Math.max(1.0, larguraKm * 0.11),
  };
}

/**
 * Intervalo entre estratos da parede, em metros.
 *
 * Acompanha a amplitude do recorte: 500 m num bloco alpino é legível, e num
 * bloco de planície seria uma faixa só — a parede deixaria de ser escala.
 */
export function estratoPara(amplitudeM: number): number {
  if (!Number.isFinite(amplitudeM) || amplitudeM <= 0) return 25;
  if (amplitudeM > 4000) return 1000;
  if (amplitudeM > 1200) return 500;
  if (amplitudeM > 300) return 100;
  return 25;
}
