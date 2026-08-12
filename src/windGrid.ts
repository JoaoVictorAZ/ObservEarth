// src/windGrid.ts
// -----------------------------------------------------------------------------
// Conversões de latitude e coordenadas para grades de vento GRIB2 / WebGL.
// -----------------------------------------------------------------------------

/**
 * Latitude da linha `j` da grade GRIB2, com varredura de norte para sul.
 *
 * As linhas extremas ficam SOBRE os polos: com ny = 721 e passo de 0,25°,
 * j = 0 é +90,00 e j = 720 é −90,00. Por isso o divisor é (ny − 1) e não ny.
 */
export function latDaLinha(j: number, ny: number): number {
  if (ny < 2) return 0;
  return 90 - (j * 180) / (ny - 1);
}

/** o inverso: qual linha (fracionária) corresponde a uma latitude */
export function linhaDaLat(lat: number, ny: number): number {
  if (ny < 2) return 0;
  return ((90 - lat) * (ny - 1)) / 180;
}

/**
 * Coordenada v de textura do centro do texel `y`, numa textura de `oy` linhas.
 *
 * Centro, não borda: é onde o filtro linear devolve o valor sem mistura.
 */
export function vDoTexel(y: number, oy: number): number {
  return (y + 0.5) / oy;
}

/**
 * A linha fracionária do campo que `buildTexture` amostra para o texel `y`.
 *
 * Precisa ser idêntica à expressão usada lá dentro. Se as duas divergirem, o
 * teste vira decoração.
 */
export function linhaAmostrada(y: number, S: number): number {
  return (y + 0.5) / S - 0.5;
}

/**
 * A latitude que o SHADER acredita estar lendo em `p.y`.
 *
 * Espelho exato de `lat = (0.5 - p.y) * 180.0` no UPDATE_FRAG. Vale para p.y e
 * para v porque o shader amostra a textura na própria posição da partícula.
 */
export function latDoShader(py: number): number {
  return (0.5 - py) * 180;
}

/**
 * Discordância, em graus, entre a latitude que o shader supõe e a latitude do
 * dado que ele efetivamente amostra, no texel `y`.
 *
 * Positivo ou negativo não importa; o que importa é o módulo ficar na ordem de
 * meia célula. Se passar de alguns graus, alguma etapa da cadeia mudou de
 * convenção sem as outras saberem.
 */
export function desvioDeLatitude(y: number, ny: number, S: number): number {
  const oy = ny * S;
  const v = vDoTexel(y, oy);
  const latDoDado = latDaLinha(linhaAmostrada(y, S), ny);
  return latDoShader(v) - latDoDado;
}
