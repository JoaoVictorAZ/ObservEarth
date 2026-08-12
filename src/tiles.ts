// src/tiles.ts
// -----------------------------------------------------------------------------
// PIRÂMIDE DE TILES — resolução que acompanha o zoom.
// -----------------------------------------------------------------------------
// O PROBLEMA QUE ISTO RESOLVE
//
// Até aqui o mapa pedia UMA imagem do mundo inteiro com 4096 px de largura.
// São 360° ÷ 4096 ≈ 9,8 km por pixel no equador, e esse número é FIXO. Os
// pixels de tela por grau, ao contrário, crescem sem limite quando se
// aproxima. Nenhum aumento de textura resolve isso — 8192 apenas adia o
// problema em um passo de zoom e dobra o download para quem olha o planeta
// inteiro. Só recorte resolve.
//
// Duas grades convivem aqui, e elas NÃO são a mesma:
//
//   EQUIRRETANGULAR (EPSG:4326) — imagens do GIBS e o nosso mapa. O mundo é
//   2:1, então o nível z tem 2^(z+1) colunas por 2^z linhas de tiles
//   quadrados em grau.
//
//   MERCATOR WEB (EPSG:3857) — os tiles de elevação da Mapzen/AWS, que só
//   existem nessa projeção. Grade quadrada: 2^z por 2^z. A conversão entre as
//   duas é o preço de usar aquele dado, e é paga no shader.
// -----------------------------------------------------------------------------

export interface Tile {
  z: number;
  /** coluna, já normalizada para [0, colunas) */
  x: number;
  y: number;
  /** bbox em graus: oeste, sul, leste, norte. lng pode passar de ±180 por causa
   *  das cópias do mundo — quem desenha precisa disso para posicionar. */
  oeste: number; sul: number; leste: number; norte: number;
  /** identidade estável para cache; ignora a cópia do mundo em que o tile caiu */
  chave: string;
}

// -----------------------------------------------------------------------------
// GRADE EQUIRRETANGULAR
// -----------------------------------------------------------------------------

/** Nível 0 é o mundo em dois tiles de 180°. */
export const colunas = (z: number) => 2 ** (z + 1);
export const linhas = (z: number) => 2 ** z;
/** Lado do tile em graus — quadrado, porque a grade é 2:1 e o mundo também. */
export const ladoGraus = (z: number) => 360 / colunas(z);

/**
 * Teto de nível.
 *
 * Cada tile é pedido com 512 px de lado, então o nível z entrega
 * 360 / (2^(z+1) · 512) graus por pixel. Em z=7 isso dá 0,00275°/px, cerca de
 * 305 m — logo abaixo dos 250 m nativos do melhor produto MODIS do GIBS.
 * Passar disso é ampliar pixel inventado e gastar cota por nada.
 */
export const NIVEL_MAX = 7;
export const TILE_PX = 512;

export function grausPorPixel(z: number): number {
  return ladoGraus(z) / TILE_PX;
}

/**
 * Escolhe o nível cuja resolução se aproxima da tela, POR BAIXO.
 *
 * Arredondar para cima buscaria sempre o nível mais fino disponível e
 * quadruplicaria o número de tiles a cada passo — quatro vezes a cota para uma
 * diferença que o olho não vê. Arredondar por baixo aceita uma leve suavização
 * e é o que praticamente todo visualizador de mapa faz.
 */
export function nivelPara(grausVisiveis: number, larguraPx: number, dpr = 1): number {
  // OS DOIS ARGUMENTOS PRECISAM SER DO MESMO EIXO. Passar graus de ALTURA com
  // pixels de LARGURA subestima a resolução necessária pela proporção da tela
  // — 1,78 numa tela 16:9 — e escolhe um nível fino demais. O efeito não é
  // visual, é de conta: cada nível a mais quadruplica o número de tiles, e a
  // primeira versão disto pedia 128 tiles para ver meio planeta.
  if (!Number.isFinite(grausVisiveis) || grausVisiveis <= 0) return 0;
  if (!Number.isFinite(larguraPx) || larguraPx <= 0) return 0;

  const alvo = grausVisiveis / (larguraPx * Math.max(1, Math.min(2, dpr)));

  // A TOLERÂNCIA NÃO É PREGUIÇA, É ARITMÉTICA DE PIRÂMIDE.
  //
  // Cada nível dobra a resolução, então o nível "certo" quase nunca cai em
  // cima do alvo: ele fica entre 1x e 2x mais fino que o necessário. Sem
  // folga, ficar 5% abaixo do ideal rejeita o nível e sobe um degrau — o que
  // QUADRUPLICA o número de tiles para recuperar 5% de nitidez que ninguém vê.
  //
  // Medido: uma vista de 10° em 1920 px pedia 48 tiles sem tolerância e pede
  // 12 com ela, aceitando uma imagem 6% mais macia.
  const folga = alvo * 1.3;
  for (let z = 0; z <= NIVEL_MAX; z++) {
    if (grausPorPixel(z) <= folga) return z;
  }
  return NIVEL_MAX;
}

/** Traz uma longitude qualquer para [-180, 180). */
const enrola = (lng: number) => ((lng + 540) % 360 + 360) % 360 - 180;

/**
 * Tiles que cobrem a janela visível.
 *
 * `lng0` pode ser menor que -180 e `lng1` maior que 180: é assim que o mapa
 * atravessa o antimeridiano. A coluna é calculada no espaço contínuo e só
 * depois trazida para dentro da grade — o tile ao leste de 179° é o tile de
 * -180°, e ele precisa ser desenhado em 181° para não abrir um rasgo.
 */
export function tilesEm(
  lng0: number, lat0: number, lng1: number, lat1: number, z: number,
): Tile[] {
  const nz = Math.max(0, Math.min(NIVEL_MAX, Math.floor(z)));
  const lado = ladoGraus(nz);
  const nCol = colunas(nz);
  const nLin = linhas(nz);

  const cx0 = Math.floor((lng0 + 180) / lado);
  const cx1 = Math.ceil((lng1 + 180) / lado);
  // y cresce para o SUL: a linha 0 é a do polo norte, como em todo esquema de
  // tiles. É a inversão que sempre aparece de cabeça para baixo quando esquecida.
  const cy0 = Math.floor((90 - lat1) / lado);
  const cy1 = Math.ceil((90 - lat0) / lado);

  const fora: Tile[] = [];
  for (let iy = Math.max(0, cy0); iy < Math.min(nLin, cy1); iy++) {
    for (let ix = cx0; ix < cx1; ix++) {
      const col = ((ix % nCol) + nCol) % nCol;
      fora.push({
        z: nz,
        x: col,
        y: iy,
        oeste: ix * lado - 180,
        leste: (ix + 1) * lado - 180,
        norte: 90 - iy * lado,
        sul: 90 - (iy + 1) * lado,
        chave: `${nz}/${iy}/${col}`,
      });
    }
  }
  return fora;
}

/**
 * Teto de tiles por vista.
 *
 * Não é enfeite de desempenho, é a regra de orçamento do projeto. O nível
 * ideal para uma vista LARGA é surpreendentemente alto — 180° numa tela de
 * 1920 com densidade 2 pede o nível 3, que são 16×8 = 128 tiles do mundo
 * inteiro. Com o teto de um quarto da cota gratuita do GIBS, umas poucas
 * dessas vistas consumiriam o dia.
 *
 * Quarenta é o teto porque uma tela cheia no nível casado dá entre 5x4 e 8x5
 * tiles: a pirâmide dobra de resolução por nível, então o nível escolhido está
 * sempre entre 1x e 2x sobre-amostrado, e a borda cai no caso ruim. Quarenta
 * deixa o caso comum passar inteiro e ainda barra o patológico.
 */
export const TILES_MAX = 40;

/**
 * O plano de tiles de uma vista: qual nível, e quais tiles.
 *
 * Mora aqui, e não no motor, porque é a decisão que gasta cota — e decisão que
 * gasta cota precisa ser testável sem subir uma GPU.
 */
export function planoDeTiles(
  lng0: number, lat0: number, lng1: number, lat1: number,
  larguraGraus: number, larguraPx: number, dpr = 1,
): { z: number; lista: Tile[] } {
  let z = nivelPara(larguraGraus, larguraPx, dpr);
  let lista = tilesEm(lng0, lat0, lng1, lat1, z);
  while (lista.length > TILES_MAX && z > 0) {
    z--;
    lista = tilesEm(lng0, lat0, lng1, lat1, z);
  }
  return { z, lista };
}

/** BBOX no formato que o servidor espera: sul,oeste,norte,leste, sempre em faixa. */
export function bboxDe(t: Tile): [number, number, number, number] {
  const o = enrola(t.oeste);
  // Um tile que termina exatamente em 180 enrola para -180 e inverteria a
  // caixa. O leste é reconstruído a partir do oeste, que não tem essa
  // ambiguidade.
  return [t.sul, o, t.norte, o + (t.leste - t.oeste)];
}

// -----------------------------------------------------------------------------
// GRADE MERCATOR WEB — só para o relevo
// -----------------------------------------------------------------------------

/** Latitude limite do Mercator: além dela y iria para o infinito. */
export const LAT_MERC = 85.0511287798066;

/**
 * Latitude → y normalizado [0,1], 0 no topo.
 *
 * O `clamp` no RESULTADO não é redundante com o da entrada. Em ±85,0511° a
 * conta deveria dar exatamente 0 e 1, e em ponto flutuante dá −1,1e−16 e
 * 1,0000000000000007. Parece inofensivo até virar coordenada de textura: um v
 * negativo com `RepeatWrapping` amostra a outra ponta do atlas, e a linha do
 * polo aparece pintada com o pixel do polo oposto.
 */
export function mercY(lat: number): number {
  const l = Math.max(-LAT_MERC, Math.min(LAT_MERC, lat));
  const rad = (l * Math.PI) / 180;
  const y = 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
  return Math.max(0, Math.min(1, y));
}

/** y normalizado [0,1] → latitude. Inversa exata de mercY. */
export function latDeMercY(y: number): number {
  const n = Math.PI * (1 - 2 * Math.max(0, Math.min(1, y)));
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Decodifica um pixel terrarium em metros.
 *
 * Formato da Mapzen: elevação real com deslocamento de 32.768, dividida em
 * 16 bits inteiros e 8 de fração —
 *
 *   metros = (R·256 + G + B/256) − 32768
 *
 * Componentes em 0..255. O deslocamento é o que permite representar
 * PROFUNDIDADE: a fossa das Marianas fica em −11.000 m e continua sendo um
 * número positivo no PNG. É por isso que este formato serve de batimetria e
 * uma imagem sombreada não serve — ali o fundo do mar é só um azul mais escuro.
 */
export function alturaTerrarium(r: number, g: number, b: number): number {
  return (r * 256 + g + b / 256) - 32768;
}

/** Tiles Mercator que cobrem a janela. Grade quadrada, 2^z por 2^z. */
export function tilesMercator(
  lng0: number, lat0: number, lng1: number, lat1: number, z: number,
): Tile[] {
  const nz = Math.max(0, Math.min(15, Math.floor(z)));
  const n = 2 ** nz;

  const cx0 = Math.floor(((lng0 + 180) / 360) * n);
  const cx1 = Math.ceil(((lng1 + 180) / 360) * n);
  const cy0 = Math.floor(mercY(lat1) * n);
  const cy1 = Math.ceil(mercY(lat0) * n);

  const fora: Tile[] = [];
  for (let iy = Math.max(0, cy0); iy < Math.min(n, cy1); iy++) {
    for (let ix = cx0; ix < cx1; ix++) {
      const col = ((ix % n) + n) % n;
      fora.push({
        z: nz, x: col, y: iy,
        oeste: (ix / n) * 360 - 180,
        leste: ((ix + 1) / n) * 360 - 180,
        norte: latDeMercY(iy / n),
        sul: latDeMercY((iy + 1) / n),
        chave: `t${nz}/${iy}/${col}`,
      });
    }
  }
  return fora;
}

/**
 * Nível de relevo para a janela.
 *
 * Mais contido que o das imagens: o relevo é sombreamento de fundo, não o dado
 * que se está lendo, e cada tile custa uma requisição. Um nível abaixo do
 * ideal é imperceptível sob uma camada de vento.
 */
export function nivelRelevo(grausVisiveis: number, larguraPx: number): number {
  const z = nivelPara(grausVisiveis, larguraPx, 1);
  return Math.max(0, Math.min(10, z));
}
