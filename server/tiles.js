// server/tiles.js
// -----------------------------------------------------------------------------
// GRADE DE TILES DO LADO DO SERVIDOR
// -----------------------------------------------------------------------------
// Esta aritmética existe DUAS VEZES no projeto: aqui e em `src/tiles.ts`. Não
// por descuido — o cliente é TypeScript compilado pelo Vite e o servidor é
// JavaScript puro rodando no Node, e criar uma ponte entre os dois para três
// linhas de conta custaria mais do que vale.
//
// O risco de duplicar é as duas versões divergirem em silêncio: o cliente
// pediria o tile 5/12/30 e receberia a caixa de outro lugar do planeta, com
// aparência perfeitamente normal. `test/tiles.mjs` compara as duas
// implementações lado a lado justamente para que isso não passe.
// -----------------------------------------------------------------------------

/** Nível 0 é o mundo em dois tiles de 180°: a grade 4326 é 2:1. */
export const colunas = (z) => 2 ** (z + 1);
export const linhas = (z) => 2 ** z;
export const ladoGraus = (z) => 360 / colunas(z);

export const NIVEL_MAX = 7;
export const TILE_PX = 512;

/**
 * BBOX de um tile, no formato do WMS 1.3.0 com CRS EPSG:4326: sul, oeste,
 * norte, leste.
 *
 * Devolve null para índice fora da grade. Sem essa checagem, um `y` grande
 * produziria uma caixa com latitude abaixo de -90, e o GIBS responderia com
 * XML de erro que o cliente tentaria decodificar como imagem.
 */
export function bboxDoTile(z, y, x) {
  const nz = Number(z), ny = Number(y), nx = Number(x);
  if (!Number.isInteger(nz) || nz < 0 || nz > NIVEL_MAX) return null;
  if (!Number.isInteger(ny) || !Number.isInteger(nx)) return null;
  if (ny < 0 || ny >= linhas(nz)) return null;
  if (nx < 0 || nx >= colunas(nz)) return null;

  const lado = ladoGraus(nz);
  // y cresce para o SUL: a linha 0 é a do polo norte.
  const norte = 90 - ny * lado;
  const sul = norte - lado;
  const oeste = nx * lado - 180;
  const leste = oeste + lado;
  return [sul, oeste, norte, leste];
}

/** Grade Mercator do relevo: quadrada, 2^z por 2^z. */
export function tileMercatorValido(z, y, x) {
  const nz = Number(z), ny = Number(y), nx = Number(x);
  if (!Number.isInteger(nz) || nz < 0 || nz > 12) return false;
  if (!Number.isInteger(ny) || !Number.isInteger(nx)) return false;
  const n = 2 ** nz;
  return ny >= 0 && ny < n && nx >= 0 && nx < n;
}

/**
 * Decodifica um pixel terrarium em metros.
 *
 *   metros = (R·256 + G + B/256) − 32768
 *
 * O deslocamento de 32.768 é o que permite guardar PROFUNDIDADE: −11.000 m
 * continua sendo um número positivo dentro do PNG.
 */
export function alturaTerrarium(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}
