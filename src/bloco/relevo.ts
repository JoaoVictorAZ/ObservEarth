// src/bloco/relevo.ts
// -----------------------------------------------------------------------------
// O TERRENO DE UMA REGIÃO, EM METROS, COMO GRADE.
// -----------------------------------------------------------------------------
// O mapa plano já desenha relevo, e o faz de um jeito que NÃO serve aqui: ele
// reprojeta os tiles `terrarium` dentro do shader e a altitude nunca sai da
// GPU. Para desenhar um bloco em três dimensões é preciso o número na CPU —
// cada vértice da malha precisa saber a que altura fica.
//
// O QUE É UM TILE `terrarium`
//
// Um PNG comum em que cada pixel guarda a altitude real:
//
//     metros = (R·256 + G + B/256) − 32768
//
// O deslocamento de 32.768 é o que permite guardar PROFUNDIDADE junto com
// altitude: a fossa das Marianas fica em −11.000 m e continua sendo um número
// positivo dentro do PNG. É por isso que o bloco de uma cidade costeira mostra
// o fundo do mar, e não um recorte plano onde a água começa.
//
// AS DUAS GRADES, DE NOVO
//
// Os tiles de elevação só existem em Mercator Web; o bloco é construído em
// lat/lng. `src/tiles.ts` já carrega as duas conversões e o decodificador de
// pixel — este arquivo é a terceira chamada delas, depois do mapa e do globo.
//
// A DECODIFICAÇÃO É NO NAVEGADOR, e não no servidor, por um motivo simples: o
// navegador já sabe decodificar PNG. Um decodificador no servidor seria
// centena e meia de linhas de inflate e desfiltragem de linha para chegar ao
// mesmo `ImageData` que o `<canvas>` entrega de graça. O servidor continua
// fazendo o que só ele pode: guardar o tile em cache por uma semana.
// -----------------------------------------------------------------------------

import {
  mercY, alturaTerrarium, tilesMercator, TILE_PX, LAT_MERC, type Tile,
} from "../tiles.ts";
import type { CampoEscalar } from "../malha/campo.ts";

/** Caixa da região, em graus: sul, oeste, norte, leste. */
export interface Caixa {
  latSul: number; lngOeste: number; latNorte: number; lngLeste: number;
}

/**
 * Onde uma coordenada cai DENTRO de um tile Mercator, em pixels fracionários.
 *
 * Devolve `null` quando o ponto não pertence ao tile — o chamador tenta o
 * próximo. É melhor que devolver um pixel travado na borda: travar preencheria
 * a região vizinha com a última coluna do tile errado, e o efeito é uma faixa
 * de montanha esticada que parece dado.
 */
export function pixelNoTile(
  lat: number, lng: number, z: number, x: number, y: number, px = TILE_PX,
): { ix: number; iy: number } | null {
  const n = 2 ** z;
  // A longitude é normalizada para [0,1) ANTES de multiplicar: um bloco que
  // atravessa o antimeridiano tem lng > 180 nas bordas, e sem a volta a conta
  // apontaria para uma coluna de tile que não existe.
  const fx = ((((lng + 180) / 360) % 1) + 1) % 1;
  const gx = fx * n;
  const gy = mercY(lat) * n;

  const ix = (gx - x) * px;
  const iy = (gy - y) * px;
  if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null;
  if (ix < 0 || ix >= px || iy < 0 || iy >= px) return null;
  return { ix, iy };
}

/**
 * Nível de tile para um bloco.
 *
 * `larguraGraus` é a extensão em longitude e `alvo` quantas amostras se quer ao
 * longo dela. Cada tile tem 512 px, então o nível z entrega
 * 360/(2^z · 512) graus por pixel — e queremos que a largura do bloco caiba em
 * `alvo` pixels.
 *
 * O TETO DE 14 não é arbitrário: os dados de origem da Mapzen são SRTM a 30 m
 * (z≈13) na maior parte do mundo e GEBCO muito mais grosso no oceano. Passar
 * disso amplia pixel interpolado e gasta requisição para não acrescentar
 * informação — o mesmo raciocínio de `NIVEL_MAX` para a imagem de satélite.
 */
/**
 * OS TRÊS NÍVEIS DE DETALHE.
 *
 * `amostras` é quantos pontos a grade tem no lado maior; `tiles` é o teto de
 * requisições. Os dois andam juntos: pedir mais tiles sem adensar a grade
 * baixa dado que ninguém amostra, e adensar a grade sem mais tiles amplia o
 * mesmo pixel várias vezes.
 *
 * O custo que muda entre eles é de VÉRTICE, não de rede: no modo detalhe a
 * malha tem ~590 mil vértices contra ~37 mil no leve. Uma GPU moderna desenha
 * isso sem esforço; uma integrada de notebook antigo, não — por isso o leve
 * existe, e por isso o padrão é o médio.
 */
export const QUALIDADES = {
  leve:    { amostras: 192, tiles: 16, rotulo: "Leve" },
  medio:   { amostras: 384, tiles: 40, rotulo: "Médio" },
  detalhe: { amostras: 768, tiles: 96, rotulo: "Detalhe" },
} as const;

export type Qualidade = keyof typeof QUALIDADES;

/**
 * A RESOLUÇÃO DA FONTE numa latitude, em metros — o teto do que existe.
 *
 * Esta função é o que separa "mais detalhe" de "mais pixels". Acima de certo
 * nível de tile, o que se recebe não é dado mais fino: é o mesmo dado
 * interpolado, com aparência de precisão que ele não tem.
 *
 * Os números vêm da composição da Mapzen, e são aproximados de propósito —
 * a fonte varia por região e o valor exato de cada célula não é publicado:
 *
 *   ~10 m   3DEP, nos Estados Unidos continentais
 *   ~30 m   SRTM, entre 60°N e 56°S — é o caso do Brasil inteiro
 *   ~90 m   fora da cobertura do SRTM, em latitudes altas
 *   ~450 m  GEBCO, no oceano aberto
 *
 * Devolver 30 para o Brasil é conservador e honesto. Fingir um número por
 * célula seria inventar uma precisão que a fonte não declara — e é justamente
 * o que a tela precisa AVISAR quando a malha passa disso.
 */
export function resolucaoDaFonteM(lat: number, submerso = false): number {
  if (submerso) return 450;
  const a = Math.abs(lat);
  if (a > 60) return 90;
  return 30;
}

export function nivelDoBloco(larguraGraus: number, alvo = 256): number {
  if (!Number.isFinite(larguraGraus) || larguraGraus <= 0) return 0;
  const grausPorPixelDesejado = larguraGraus / Math.max(16, alvo);
  for (let z = 0; z <= 14; z++) {
    if (360 / (2 ** z * TILE_PX) <= grausPorPixelDesejado) return z;
  }
  return 14;
}

/** Um tile já decodificado: pixels prontos para amostrar. */
export interface TileDecodificado {
  tile: Tile;
  dados: Uint8ClampedArray;
  largura: number;
}

/**
 * Altitude num ponto, a partir dos tiles decodificados.
 *
 * A INTERPOLAÇÃO É BILINEAR NO ESPAÇO DE MERCATOR, e não no de latitude. É
 * onde os pixels estão, e é a única forma de não introduzir um deslocamento
 * que cresce com a latitude.
 *
 * MAS O CANAL VERMELHO VALE 256 METROS. Interpolar entre dois texels vizinhos
 * onde o vermelho passa de 137 para 138 inventaria uma rampa de 256 m numa
 * borda que não existe — e é por isso que o mapa plano usa filtro NEAREST no
 * shader. Aqui a saída é outra: decodifica-se PRIMEIRO cada um dos quatro
 * texels para metros, e só então se interpola. A rampa some porque a
 * interpolação passa a acontecer no espaço de METROS, que é contínuo.
 */
export function alturaEm(
  lat: number, lng: number, tiles: TileDecodificado[],
): number | null {
  for (const t of tiles) {
    const p = pixelNoTile(lat, lng, t.tile.z, t.tile.x, t.tile.y, t.largura);
    if (!p) continue;

    const x0 = Math.floor(p.ix - 0.5), y0 = Math.floor(p.iy - 0.5);
    const tx = p.ix - 0.5 - x0, ty = p.iy - 0.5 - y0;

    const em = (xi: number, yi: number): number | null => {
      const cx = Math.max(0, Math.min(t.largura - 1, xi));
      const cy = Math.max(0, Math.min(t.largura - 1, yi));
      const k = (cy * t.largura + cx) * 4;
      const a = t.dados[k + 3];
      // Alfa zero é buraco de cobertura declarado pela Mapzen, não nível do
      // mar. O oceano vem com alfa 255 e altitude negativa.
      if (a === 0) return null;
      return alturaTerrarium(t.dados[k], t.dados[k + 1], t.dados[k + 2]);
    };

    const h00 = em(x0, y0), h10 = em(x0 + 1, y0);
    const h01 = em(x0, y0 + 1), h11 = em(x0 + 1, y0 + 1);
    if (h00 == null || h10 == null || h01 == null || h11 == null) return null;

    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - ty) + b * ty;
  }
  return null;
}

/**
 * A grade equirretangular do bloco.
 *
 * Registrada em PONTO, como a do GFS: a linha 0 fica sobre a borda norte e a
 * última sobre a borda sul, e o número de intervalos é ny−1. Misturar as duas
 * convenções entre a malha do campo e a malha do terreno faria as duas
 * superfícies do bloco ficarem meia célula deslocadas uma da outra — visível
 * como uma montanha que não bate com a nuvem em cima dela.
 */
export function latDaLinhaDoBloco(j: number, ny: number, cx: Caixa): number {
  if (ny < 2) return (cx.latNorte + cx.latSul) / 2;
  return cx.latNorte - (j * (cx.latNorte - cx.latSul)) / (ny - 1);
}

export function lngDaColunaDoBloco(i: number, nx: number, cx: Caixa): number {
  if (nx < 2) return (cx.lngOeste + cx.lngLeste) / 2;
  return cx.lngOeste + (i * (cx.lngLeste - cx.lngOeste)) / (nx - 1);
}

/**
 * Caixa quadrada em QUILÔMETROS em volta de um ponto.
 *
 * A largura em longitude é dividida por cos(lat) porque um grau de longitude
 * encolhe com a latitude. Sem isso, um bloco de "100 km" sobre Reykjavík sairia
 * com 50 km de largura e 100 de altura — e a pessoa leria como terreno o que é
 * distorção de projeção.
 */
export function caixaEmVolta(lat: number, lng: number, ladoKm: number): Caixa {
  const meiaLat = (ladoKm / 2) / 111.32;
  const cos = Math.max(0.08, Math.cos((lat * Math.PI) / 180));
  const meiaLng = meiaLat / cos;

  // O CLAMPE ANTERIOR PODIA INVERTER A CAIXA, e invertia em silêncio.
  //
  // Ele era `latSul: max(-85, lat - meia)` e `latNorte: min(85, lat + meia)`.
  // Medido em 16/09/2026, recorte de 500 km em 88,81°S:
  //
  //     latSul  = max(-85, -91,06) = -85,00
  //     latNorte = min( 85, -86,56) = -86,56
  //
  // O sul ficou ao NORTE do norte. A caixa passou a descrever uma região
  // impossível, `tamanhoKm` devolveu 459×175 km para um pedido de 500×500, e
  // nada em lugar nenhum reclamou — o cabeçalho do painel exibia as dimensões
  // erradas como se fossem o que a pessoa pediu.
  //
  // Agora a caixa DESLIZA para dentro do limite em vez de ser espremida por
  // duas pontas independentes. Fora do alcance do Mercator a altura pedida é
  // preservada; o que muda é onde ela cai — e quem chama precisa saber disso,
  // por isso existe `temCoberturaDeRelevo`.
  let sul = lat - meiaLat;
  let norte = lat + meiaLat;
  if (norte > LAT_MERC) { sul -= norte - LAT_MERC; norte = LAT_MERC; }
  if (sul < -LAT_MERC) { norte = Math.min(LAT_MERC, norte + (-LAT_MERC - sul)); sul = -LAT_MERC; }
  // Recorte mais alto que a própria faixa do Mercator: sobra a faixa inteira.
  if (sul > norte) { sul = -LAT_MERC; norte = LAT_MERC; }

  return { latSul: sul, latNorte: norte, lngOeste: lng - meiaLng, lngLeste: lng + meiaLng };
}

/**
 * Existe tile de elevação nesta latitude?
 *
 * Os tiles `terrarium` são Web Mercator, e o Web Mercator **termina em
 * ±85,0511°** — além disso o `y` da projeção vai para o infinito. Não é falta
 * de dado da Mapzen nem uma lacuna que alguém possa preencher depois: é a
 * projeção não alcançar o polo, por construção.
 *
 * Distinguir isto de "o tile não respondeu" importa. Uma é uma falha de rede,
 * que passa; a outra é um limite permanente, e insistir não adianta. A tela
 * precisa dizer qual das duas é — foi por não dizer que um recorte a 88,8°S
 * parecia defeito de cobertura.
 */
export function temCoberturaDeRelevo(lat: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= LAT_MERC;
}

/** Dimensões físicas do bloco, em quilômetros. */
export function tamanhoKm(cx: Caixa): { largura: number; altura: number } {
  const latMedia = (cx.latNorte + cx.latSul) / 2;
  const cos = Math.cos((latMedia * Math.PI) / 180);
  return {
    largura: (cx.lngLeste - cx.lngOeste) * 111.32 * cos,
    altura: (cx.latNorte - cx.latSul) * 111.32,
  };
}

// -----------------------------------------------------------------------------
// A PARTE QUE TOCA O NAVEGADOR
// -----------------------------------------------------------------------------

async function carregarTile(t: Tile): Promise<TileDecodificado | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `/api/terrain/${t.z}/${t.y}/${t.x}`;
  try {
    await img.decode();
  } catch {
    // 404 é cobertura ausente e acontece de verdade nos polos. Um tile a menos
    // vira buraco na malha, que é o comportamento certo.
    return null;
  }
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth || TILE_PX;
  cv.height = img.naturalHeight || TILE_PX;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  return { tile: t, dados: d.data, largura: cv.width };
}

export interface RelevoPronto {
  campo: CampoEscalar;
  caixa: Caixa;
  nivel: number;
  tiles: number;
  tilesFalhos: number;
  minimo: number | null;
  maximo: number | null;
  /**
   * A faixa em que o terreno de fato vive — ver a nota em `montarRelevo`.
   *
   * Num recorte grande, o mínimo e o máximo são a fossa e o pico: 2% do dado
   * consumindo 80% da escala. `p2`/`p98` são a faixa do outro 96%, e é sobre
   * ela que a cor rende.
   */
  p2: number | null;
  p98: number | null;
  mediana: number | null;
  /** metros por amostra da grade — o que ESTE bloco desenha */
  resolucaoM: number;
  /** metros por célula da FONTE — o teto do que existe ali */
  fonteM: number;
  qualidade: Qualidade;
  /**
   * A região precisava de mais tiles do que o teto permitiu.
   *
   * Importa dizer: quando isto é verdade, parte do recorte fica sem cobertura
   * e a malha sai vazada — e o buraco parece falta de dado da fonte, quando é
   * uma escolha nossa de orçamento.
   */
  tetoDeTiles: boolean;
  /**
   * Quantas células foram recusadas por serem degraus impossíveis.
   *
   * Sai para a tela porque é informação sobre a FONTE, não sobre o desenho:
   * um recorte com muitos picos removidos tem DEM ruim ali, e quem estiver
   * medindo uma encosta precisa saber disso antes de confiar no número.
   */
  picosRemovidos: number;
}

/**
 * Monta a grade de altitude de uma região.
 *
 * `n` é o número de amostras no lado maior. 192 dá 36.864 vértices — uma malha
 * que a GPU desenha sem esforço e que já resolve um vale de 500 m num bloco de
 * 100 km.
 */
export async function montarRelevo(
  cx: Caixa, qualidade: Qualidade = "medio",
): Promise<RelevoPronto> {
  const q = QUALIDADES[qualidade] ?? QUALIDADES.medio;
  const n = q.amostras;
  const larguraGraus = cx.lngLeste - cx.lngOeste;
  const z = nivelDoBloco(larguraGraus, n);

  const lista = tilesMercator(cx.lngOeste, cx.latSul, cx.lngLeste, cx.latNorte, z);
  // TETO DE REQUISIÇÕES, por nível de qualidade.
  //
  // O orçamento suporta mesmo o teto do modo detalhe: o limite do projeto para
  // a Mapzen é de 10.000 tiles por dia (¼ do limite gratuito) e o cache do
  // servidor é de 7 dias, porque relevo não muda. Noventa e seis tiles por
  // bloco dão mais de cem recortes distintos por dia, e recorte repetido não
  // custa nada.
  const usar = lista.slice(0, q.tiles);

  const carregados = await Promise.all(usar.map(carregarTile));
  const tiles = carregados.filter((t): t is TileDecodificado => !!t);
  const falhos = usar.length - tiles.length;

  const { largura, altura } = tamanhoKm(cx);
  const razao = altura / Math.max(1e-6, largura);
  const nx = Math.max(8, Math.round(razao <= 1 ? n : n / razao));
  const ny = Math.max(8, Math.round(razao <= 1 ? n * razao : n));

  const valores = new Float32Array(nx * ny);
  const valido = new Uint8Array(nx * ny);
  let mn: number | null = null, mx: number | null = null;

  for (let j = 0; j < ny; j++) {
    const lat = latDaLinhaDoBloco(j, ny, cx);
    for (let i = 0; i < nx; i++) {
      const lng = lngDaColunaDoBloco(i, nx, cx);
      const h = alturaEm(lat, lng, tiles);
      const k = j * nx + i;
      if (h == null) continue;
      valores[k] = h;
      valido[k] = 1;
      if (mn == null || h < mn) mn = h;
      if (mx == null || h > mx) mx = h;
    }
  }

  // Metros por amostra, na direção mais fina — é o número que diz se o bloco
  // resolve um morro ou só a serra inteira.
  const resolucaoM = (largura * 1000) / Math.max(1, nx);

  // ---------------------------------------------------------------------------
  // DESPIQUE: um valor isolado e impossível não é relevo, é defeito do DEM.
  // ---------------------------------------------------------------------------
  // MEDIDO EM 16/09/2026, recorte de 30 km sobre Copacabana: altitudes de
  // −3.111 a 3.447 m. O ponto mais alto da cidade do Rio é o Pico da Tijuca com
  // 1.021 m, e o fundo a 15 km da praia está perto de −50. Os dois extremos são
  // impossíveis, e vieram de células isoladas.
  //
  // O estrago não é só o pico feio. A amplitude inflada de 6.558 m entra em
  // TUDO que se calcula a partir dela: a escala de cor, o intervalo de curvas,
  // a profundidade da parede, o vão da camada de análise. O Pão de Açúcar, com
  // 396 m reais, vira 6% da vertical e some — **o artefato achata o relevo
  // verdadeiro.** É por isso que despicar vem antes de qualquer estatística.
  //
  // O CRITÉRIO É INCLINAÇÃO, E NÃO RARIDADE. Um pico real é raro e tem encosta:
  // o vizinho acompanha. Um pixel corrompido é um degrau vertical isolado.
  // Filtrar por percentil cortaria o Pão de Açúcar junto; filtrar por
  // declividade contra a mediana dos vizinhos não corta.
  //
  // O limiar sai da resolução: `4 × resolucaoM` é uma inclinação de ~76°, mais
  // íngreme que qualquer encosta que um DEM de 30 m consiga resolver. O piso de
  // 80 m evita cortar falésia em recorte muito fino.
  const limiarPico = Math.max(80, resolucaoM * 4);
  let picosRemovidos = 0;
  const viz: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!valido[k]) continue;
      viz.length = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue;
          const kk = jj * nx + ii;
          if (valido[kk]) viz.push(valores[kk]);
        }
      }
      // Menos de cinco vizinhos: é borda ou região vazada, e a mediana ali seria
      // frágil demais para condenar um ponto.
      if (viz.length < 5) continue;
      viz.sort((a, b) => a - b);
      const mediana = viz[viz.length >> 1];
      if (Math.abs(valores[k] - mediana) > limiarPico) {
        // Vira AUSÊNCIA, e não a mediana. Substituir pelo vizinho inventaria um
        // valor plausível onde o sensor não entregou nada — e a malha vazada
        // diz a verdade: aqui não se sabe.
        valido[k] = 0;
        picosRemovidos++;
      }
    }
  }

  // O mínimo e o máximo precisam ser refeitos: eles foram medidos ANTES do
  // despique e carregam justamente os valores que acabaram de ser recusados.
  if (picosRemovidos > 0) {
    mn = null; mx = null;
    for (let k = 0; k < valores.length; k++) {
      if (!valido[k]) continue;
      const h = valores[k];
      if (mn == null || h < mn) mn = h;
      if (mx == null || h > mx) mx = h;
    }
  }

  // ---------------------------------------------------------------------------
  // OS PERCENTIS, E POR QUE O MÍNIMO E O MÁXIMO NÃO BASTAM
  // ---------------------------------------------------------------------------
  // Um recorte de 500 km sobre o Rio vai de −3.114 a 2.224 m. Mas quase todo o
  // terreno que a pessoa está olhando — a Baixada, a baía, a serra litorânea —
  // vive entre 0 e 800. A fossa e o pico de Itatiaia são 2% do recorte e
  // consomem 80% da faixa.
  //
  // Esticar a cor do mínimo ao máximo entrega a escala inteira aos extremos e
  // achata tudo que está no meio. É o mesmo defeito que já apareceu na rampa
  // absoluta e na escala mundial do campo, pela terceira vez: **o que é raro
  // rouba a faixa do que é frequente.**
  //
  // Os percentis dão à cor a faixa onde o dado de fato está. O que passar
  // deles não some — satura na cor da ponta, que é a leitura certa para um
  // valor extremo: "mais fundo que o resto", "mais alto que o resto".
  const amostras: number[] = [];
  for (let k = 0; k < valores.length; k++) if (valido[k]) amostras.push(valores[k]);
  amostras.sort((a, b) => a - b);
  const pct = (p: number): number | null => {
    if (!amostras.length) return null;
    const i = Math.min(amostras.length - 1, Math.max(0, Math.round(p * (amostras.length - 1))));
    return amostras[i];
  };

  return {
    campo: {
      nx, ny, valores, valido,
      unidade: "m",
      titulo: "Altitude",
      dataset: "Mapzen Terrain Tiles · SRTM/GEBCO via AWS Open Data",
    },
    caixa: cx,
    nivel: z,
    tiles: tiles.length,
    tilesFalhos: falhos,
    minimo: mn,
    maximo: mx,
    p2: pct(0.02),
    p98: pct(0.98),
    mediana: pct(0.5),
    resolucaoM,
    qualidade,
    // O TETO DA FONTE, ao lado da resolução obtida.
    //
    // Os dois juntos respondem a única pergunta que importa ao subir a
    // qualidade: isto é mais dado, ou é o mesmo dado esticado? Sem o segundo
    // número, "amostra de 12 m" parece precisão de 12 m — e num terreno
    // brasileiro, onde a fonte é SRTM de 30 m, isso seria falso.
    fonteM: resolucaoDaFonteM(
      (cx.latNorte + cx.latSul) / 2,
      (mx ?? 0) < 0,
    ),
    tetoDeTiles: usar.length >= q.tiles && lista.length > q.tiles,
    picosRemovidos,
  };
}

/** Recorta um campo global (GFS) para a caixa do bloco, na grade do bloco. */
export function recortarCampo(
  global: CampoEscalar, cx: Caixa, nx: number, ny: number,
  amostrar: (c: CampoEscalar, lat: number, lng: number) => number | null,
): CampoEscalar {
  const valores = new Float32Array(nx * ny);
  const valido = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = latDaLinhaDoBloco(j, ny, cx);
    for (let i = 0; i < nx; i++) {
      const v = amostrar(global, lat, lngDaColunaDoBloco(i, nx, cx));
      const k = j * nx + i;
      if (v == null) continue;
      valores[k] = v;
      valido[k] = 1;
    }
  }
  return {
    nx, ny, valores, valido,
    unidade: global.unidade, titulo: global.titulo, dataset: global.dataset,
  };
}
