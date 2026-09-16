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
      // ORDEM a,c,b E a,d,c — a normal tem que apontar para CIMA.
      //
      // Com a,b,c a normal sai (b−a)×(c−a) = (0,−1,0): para baixo. Enquanto o
      // material era FrontSide isso passou despercebido, porque o three não se
      // importa com qual lado está virado para onde quando desenha os dois.
      //
      // Passou a importar no dia em que o terreno virou DoubleSide com um ramo
      // `gl_FrontFacing` para pintar o interior de rocha: a superfície de cima
      // passou a ser a face de TRÁS, todo pixel do topo caiu no ramo da rocha,
      // e a rampa hipsométrica, as curvas de nível e as faixas de altitude
      // deixaram de executar. O bloco ficou marrom uniforme.
      //
      // `malha3d.ts` já tinha batido exatamente nisto, e o comentário de lá diz
      // que custou uma versão inteira. Aqui custou um dia.
      idx.push(a, c, b, a, d, c);
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
export function profundidadeKm(larguraKm: number, extensaoKm = 0): number {
  // A LARGURA SOZINHA DAVA UMA PAREDE QUE ENGOLIA A CENA.
  //
  // `larguraKm * 0.10` num bloco de 500 km são 50 km de parede. Quando o
  // terreno é raso isso é aceitável — a parede existe justamente para dar
  // volume onde o relevo não dá. Quando o terreno já ocupa 100 km na vertical,
  // somar mais 50 de rocha abaixo dele é metade da tela gasta em nada.
  //
  // Medido em 16/09/2026, recorte oceânico de 500 km: parede escura ocupando a
  // maior parte do quadro, com o relevo espremido no alto.
  //
  // O teto pela extensão resolve os dois casos com uma regra só: num bloco
  // plano `extensao` é pequena e vale o piso de 1,5 km; num bloco profundo a
  // parede fica proporcional ao que ela está sustentando.
  const porExtensao = extensaoKm > 0 ? extensaoKm * 0.28 : Infinity;
  return Math.max(1.5, Math.min(larguraKm * 0.10, porExtensao));
}

export interface Agua {
  posicao: Float32Array;
  /** profundidade da coluna d'água NAQUELE vértice, em metros (≥ 0) */
  profundidade: Float32Array;
  /** 1 = é a superfície no zero, 0 = é a seção na parede do corte */
  superficie: Float32Array;
  triangulos: number;
}

/**
 * O CORPO D'ÁGUA DO RECORTE, e por que ele não é um plano.
 *
 * -----------------------------------------------------------------------------
 * A DIFERENÇA ENTRE PINTAR DE AZUL E MOSTRAR ÁGUA
 * -----------------------------------------------------------------------------
 * Um plano translúcido no zero diz "o mar está nesta altura". Não diz **quanta
 * água há**, nem onde ela acaba. Visto de lado ele é um risco; visto de cima
 * cobre o continente inteiro com a mesma tinta que cobre a fossa.
 *
 * O que um diagrama de bloco mostra há um século e meio é a água **em seção**:
 * a parede do corte revela a coluna entre o fundo e a superfície, e a espessura
 * dessa coluna é a profundidade. É a mesma razão pela qual o bloco existe —
 * quando a vertical importa, corta-se e olha-se de lado.
 *
 * Então a água aqui tem duas partes:
 *
 *   SUPERFÍCIE  o topo, no zero, **apenas sobre as células submersas**. Onde o
 *               terreno emerge, não há tampa: a costa aparece como o recorte
 *               da própria superfície, e não como um traço desenhado por cima.
 *
 *   SEÇÃO       nas quatro bordas do bloco, a lâmina entre o fundo e o zero.
 *               É ela que dá VOLUME ao corpo d'água e permite medir a coluna a
 *               olho, contra os estratos da parede que estão ali do lado.
 *
 * -----------------------------------------------------------------------------
 * A PROFUNDIDADE VIAJA COM O VÉRTICE
 * -----------------------------------------------------------------------------
 * Cada vértice carrega a espessura da coluna acima dele. Com isso o sombreado
 * pode seguir a lei de absorção — água rasa quase limpa, funda quase opaca — em
 * vez de usar opacidade única, que faria um banco de areia e um canal de 40 m
 * terem exatamente a mesma cara.
 */
export function aguaDoBloco(
  malha: MalhaBruta, nx: number, ny: number, exagero: number,
  /**
   * Abaixo de quantos metros uma célula conta como mar.
   *
   * NÃO É UM AJUSTE ESTÉTICO: é o piso de ruído do instrumento. A acurácia
   * vertical documentada do SRTM é de ~16 m (LE90) em absoluto e ~6 m em
   * relativo. Uma célula que lê −1 m é indistinguível de uma que lê +1 m, e
   * pintá-la de oceano afirma uma distinção que o dado não faz.
   *
   * O efeito de usar zero cru aparece em toda restinga, baixada e areal: o DEM
   * oscila em torno do nível do mar e a cidade vira Veneza. Medido em
   * 16/09/2026, recorte de 30 km na região de Araruama.
   */
  limiarM = 0,
  /** máscara de "este ponto foi medido"; sem ela, tudo conta como medido */
  valido?: Uint8Array,
): Agua {
  const y0 = kmDeMetros(0, exagero);
  const p = malha.posicao, a = malha.altitude;
  const n = nx * ny;

  // ---------------------------------------------------------------------------
  // QUEM É MAR: abaixo do limiar, MEDIDO, e LIGADO À BORDA.
  // ---------------------------------------------------------------------------
  // O terceiro critério é o que separa mar de depressão. Um ponto abaixo do
  // nível do mar que não se comunica com o oceano não é oceano — é o Mar Morto,
  // o Vale da Morte, o Qattara. Encher essas bacias de água seria inventar
  // geografia, e é o mesmo erro que pintar uma restinga de azul.
  //
  // A propagação parte das bordas do recorte porque é por elas que o mar entra:
  // o bloco é um pedaço recortado, e o que está submerso e toca a borda vem do
  // corpo d'água maior lá fora. Uma bacia fechada no meio do recorte não toca
  // nenhuma borda e fica de fora.
  const marcado = new Uint8Array(n);
  const ehBaixo = (k: number) =>
    a[k] < -limiarM && (!valido || valido[k] === 1);

  const fila: number[] = [];
  const semear = (k: number) => {
    if (marcado[k] || !ehBaixo(k)) return;
    marcado[k] = 1;
    fila.push(k);
  };
  for (let i = 0; i < nx; i++) { semear(i); semear((ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { semear(j * nx); semear(j * nx + nx - 1); }

  while (fila.length) {
    const k = fila.pop() as number;
    const i = k % nx, j = (k - i) / nx;
    if (i > 0) semear(k - 1);
    if (i < nx - 1) semear(k + 1);
    if (j > 0) semear(k - nx);
    if (j < ny - 1) semear(k + nx);
  }

  const pos: number[] = [];
  const prof: number[] = [];
  const sup: number[] = [];

  const vTopo = (k: number) => {
    pos.push(p[k * 3], y0, p[k * 3 + 2]);
    prof.push(Math.max(0, -a[k]));
    sup.push(1);
  };

  // ---- a superfície, só sobre o que está submerso --------------------------
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const A = j * nx + i, B = j * nx + i + 1;
      const C = (j + 1) * nx + i + 1, D = (j + 1) * nx + i;
      // Os QUATRO cantos de mar. Com três, a célula é de costa e a tampa
      // avançaria sobre terra seca — é melhor a superfície recuar meia célula
      // do que cobrir praia com mar.
      if (!(marcado[A] && marcado[B] && marcado[C] && marcado[D])) continue;
      vTopo(A); vTopo(C); vTopo(B);
      vTopo(A); vTopo(D); vTopo(C);
    }
  }

  // ---- a seção nas bordas do corte ----------------------------------------
  /** um segmento de borda vira a lâmina entre o fundo e o zero */
  const secao = (k: number, kb: number) => {
    if (!marcado[k] && !marcado[kb]) return;
    const ya = Math.min(p[k * 3 + 1], y0);
    const yb = Math.min(p[kb * 3 + 1], y0);
    // Ambos emersos: não há água neste trecho da borda.
    if (ya >= y0 && yb >= y0) return;
    const ax = p[k * 3], az = p[k * 3 + 2];
    const bx = p[kb * 3], bz = p[kb * 3 + 2];
    const pa = Math.max(0, -a[k]), pb = Math.max(0, -a[kb]);

    pos.push(ax, ya, az, bx, yb, bz, ax, y0, az);
    prof.push(pa, pb, pa); sup.push(0, 0, 0);
    pos.push(bx, yb, bz, bx, y0, bz, ax, y0, az);
    prof.push(pb, pb, pa); sup.push(0, 0, 0);
  };

  for (let i = 0; i < nx - 1; i++) {
    secao(i, i + 1);
    secao((ny - 1) * nx + i + 1, (ny - 1) * nx + i);
  }
  for (let j = 0; j < ny - 1; j++) {
    secao((j + 1) * nx, j * nx);
    secao(j * nx + nx - 1, (j + 1) * nx + nx - 1);
  }

  return {
    posicao: new Float32Array(pos),
    profundidade: new Float32Array(prof),
    superficie: new Float32Array(sup),
    triangulos: pos.length / 9,
  };
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
  minimoM: number, exagero: number, larguraKm: number, maximoM = minimoM,
): Saia {
  const fundo = profundidadeKm(larguraKm, Math.abs(kmDeMetros(maximoM - minimoM, exagero)));
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
  minimoM = 0,
): { base: number; espessura: number } {
  // O VÃO ACOMPANHA O TERRENO, E NÃO A LARGURA DO BLOCO.
  //
  // A versão anterior usava `larguraKm * 0.08`. Num bloco de 500 km isso dá 40
  // km de vão — medidos a partir do PICO. E num recorte oceânico o pico é uma
  // ilhota a 165 m enquanto o fundo está a −4.695 m: o terreno inteiro mora
  // 112 km abaixo, e a superfície do campo flutuava sozinha no alto da caixa,
  // sem relação legível com coisa nenhuma.
  //
  // Medido em 16/09/2026, bloco de 500 km em 13,6°S / 175,7°L: vão de 40 km
  // sobre uma extensão vertical de 117 km. A superfície parecia outro objeto,
  // e não a leitura daquele lugar.
  //
  // Agora o vão é fração da EXTENSÃO VERTICAL do relevo desenhado: encolhe num
  // bloco raso, cresce num profundo, e mantém a mesma proporção visual — perto
  // o bastante para se lerem juntos, longe o bastante para não parecerem a
  // mesma grandeza.
  const extensao = Math.abs(kmDeMetros(maximoM - minimoM, exagero));
  const vao = Math.max(larguraKm * 0.015, extensao * 0.10, 0.6);
  return {
    base: kmDeMetros(maximoM, exagero) + vao + afastamentoKm,
    // A espessura também deixa de vir só da largura: uma faixa de 55 km num
    // bloco de 500 competiria com o relevo em vez de acompanhá-lo.
    espessura: Math.max(0.5, Math.min(larguraKm * 0.11, Math.max(extensao * 0.22, larguraKm * 0.02))),
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
