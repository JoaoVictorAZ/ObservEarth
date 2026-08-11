// src/windGrid.ts
// -----------------------------------------------------------------------------
// AS TRÊS CONVENÇÕES DE LATITUDE QUE PRECISAM CONCORDAR.
//
// O desalinhamento de vento não lança exceção. O globo continua bonito, as
// partículas continuam correndo, e o vento do hemisfério sul mostra o campo do
// norte. Já aconteceu neste projeto, e custou uma sessão inteira ("let's roll
// back to two versions before, now the wind is completely wrong").
//
// O problema é que há TRÊS sistemas de coordenadas em série, cada um escrito
// num lugar diferente do código, e nenhum lugar onde eles se encontram:
//
//   1. A GRADE GRIB2. Linha 0 é 90°N quando o bit de varredura j é negativo
//      (o caso do GFS). A linha é um PARALELO, e as linhas extremas caem
//      exatamente sobre os polos.
//
//   2. A TEXTURA. `buildTexture` escreve a linha 0 do campo na linha 0 da
//      textura. Em WebGL, v = 0 é a BASE da imagem. Então v = 0 guarda 90°N.
//
//   3. O SHADER. Lê `lat = (0.5 - p.y) * 180`, tratando a textura como se ela
//      cobrisse de +90 a −90 de borda a borda.
//
// (2) e (3) concordam no SENTIDO — v = 0 é norte nos dois. É por isso que o
// vento não está invertido hoje. Mas discordam no ALINHAMENTO: a convenção (1)
// põe as linhas SOBRE os polos, e a (3) supõe células cujas bordas tocam os
// polos. A diferença é meia célula.
//
// Este módulo escreve as três fórmulas num lugar só, para que o teste possa
// medir a discordância em vez de acreditar nos comentários. O limite que o
// teste exige é APERTADO por um motivo: um espelhamento de hemisfério aparece
// como erro de 180°, e qualquer limite abaixo disso o pega imediatamente.
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
