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
  mercY, alturaTerrarium, tilesMercator, TILE_PX, type Tile,
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
  return {
    latSul: Math.max(-85, lat - meiaLat),
    latNorte: Math.min(85, lat + meiaLat),
    lngOeste: lng - meiaLng,
    lngLeste: lng + meiaLng,
  };
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
  /** resolução aproximada do dado de origem, em metros por amostra */
  resolucaoM: number;
}

/**
 * Monta a grade de altitude de uma região.
 *
 * `n` é o número de amostras no lado maior. 192 dá 36.864 vértices — uma malha
 * que a GPU desenha sem esforço e que já resolve um vale de 500 m num bloco de
 * 100 km.
 */
export async function montarRelevo(cx: Caixa, n = 192): Promise<RelevoPronto> {
  const larguraGraus = cx.lngLeste - cx.lngOeste;
  const z = nivelDoBloco(larguraGraus, n);

  const lista = tilesMercator(cx.lngOeste, cx.latSul, cx.lngLeste, cx.latNorte, z);
  // TETO DE REQUISIÇÕES. Um bloco não pode custar mais que uma vista do mapa.
  const usar = lista.slice(0, 24);

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
    resolucaoM,
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
