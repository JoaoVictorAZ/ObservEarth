// src/malha/campo.ts
// -----------------------------------------------------------------------------
// A GRADE COMO OBJETO GEOMÉTRICO — e não como vetor de números.
// -----------------------------------------------------------------------------
// Tudo que este diretório calcula acontece sobre uma esfera, não sobre uma
// folha de papel. A distinção não é preciosismo: uma célula de 0,25° × 0,25°
// tem 773 km² no equador e 27 km² a 88° de latitude — vinte e oito vezes
// menos. Somar valores de célula sem pesar por área é o erro clássico da
// análise de dado em grade, e ele desloca a média global de vários graus.
//
// A CONVENÇÃO DA GRADE é a do GFS e a do resto do projeto:
//
//   linha 0     = +90° (polo norte)         · varredura de norte para sul
//   linha ny−1  = −90° (polo sul)           · por isso o divisor é (ny−1)
//   coluna 0    = −180°                     · e a coluna nx−1 é vizinha dela
//
// A longitude ENROLA e a latitude NÃO. Esquecer o primeiro cria uma linha
// falsa de polo a polo no antimeridiano; esquecer o segundo faz o vizinho do
// polo norte ser o polo sul.
// -----------------------------------------------------------------------------

import { latDaLinha, linhaDaLat } from "../windGrid.ts";

export { latDaLinha, linhaDaLat };

/** Raio médio da Terra, em metros. O mesmo de `server/vorticidade.js`. */
export const RAIO_TERRA = 6371000;

export interface CampoEscalar {
  nx: number;
  ny: number;
  valores: Float32Array | number[];
  /** 1 = medido, 0 = ausente. Ausência NÃO é zero. */
  valido?: Uint8Array;
  unidade?: string;
  titulo?: string;
  /** procedência declarada pela fonte — a tela LÊ isto, não supõe */
  dataset?: string;
  /** instante a que o campo se refere, em ms desde a época */
  instante?: number;
}

/** Longitude da coluna `i`. A coluna 0 é −180°; a grade não repete o meridiano. */
export function lngDaColuna(i: number, nx: number): number {
  if (nx < 1) return 0;
  return -180 + (i * 360) / nx;
}

/** O inverso: coluna (fracionária) de uma longitude qualquer, já enrolada. */
export function colunaDaLng(lng: number, nx: number): number {
  const l = ((((lng + 180) % 360) + 360) % 360);   // [0, 360)
  return (l * nx) / 360;
}

/** Índice linear com longitude enrolada e latitude presa nos polos. */
export function indice(i: number, j: number, nx: number, ny: number): number {
  const ii = ((i % nx) + nx) % nx;
  const jj = j < 0 ? 0 : j > ny - 1 ? ny - 1 : j;
  return jj * nx + ii;
}

/** Um ponto vale? Sem máscara, tudo que é finito vale. */
export function medido(c: CampoEscalar, k: number): boolean {
  if (c.valido && !c.valido[k]) return false;
  return Number.isFinite(c.valores[k]);
}

/**
 * PESO DE ÁREA DA LINHA `j`, exato.
 *
 * Não é cos φ. Cos φ é a densidade de área — o valor do integrando no CENTRO
 * da célula — e usá-lo direto é a regra do ponto médio, que erra justamente
 * onde o cosseno é mais curvo: nas linhas polares. O peso exato é a INTEGRAL
 * do elemento de área sobre a faixa de latitude da célula:
 *
 *     ∫ cos φ dφ  de φₛ a φₙ  =  sen φₙ − sen φₛ
 *
 * As linhas 0 e ny−1 ficam SOBRE os polos, então suas células são MEIAS —
 * vão do polo até meio passo abaixo. Tratá-las como células inteiras dá a
 * cada polo o dobro do peso que ele tem, e o polo é onde o clima é mais
 * extremo: é lá que o erro mais aparece.
 *
 * Soma de todas as linhas = 2 = sen(90°) − sen(−90°). O teste confere isso.
 */
export function pesoDaLinha(j: number, ny: number): number {
  if (ny < 2) return 2;
  const meioPasso = 90 / (ny - 1);            // metade de 180/(ny−1)
  const c = latDaLinha(j, ny);
  const norte = Math.min(90, c + meioPasso);
  const sul = Math.max(-90, c - meioPasso);
  const rad = Math.PI / 180;
  return Math.sin(norte * rad) - Math.sin(sul * rad);
}

/** Todos os pesos de uma vez — vale a pena porque o laço de estatística os usa nx vezes. */
export function pesosDeArea(ny: number): Float64Array {
  const w = new Float64Array(ny);
  for (let j = 0; j < ny; j++) w[j] = pesoDaLinha(j, ny);
  return w;
}

/**
 * Área de UMA célula, em metros quadrados.
 *
 * Útil para converter uma soma em quantidade física: precipitação em mm sobre
 * uma região vira volume de água quando multiplicada por isto.
 */
export function areaDaCelula(j: number, nx: number, ny: number): number {
  return (RAIO_TERRA * RAIO_TERRA) * pesoDaLinha(j, ny) * ((2 * Math.PI) / nx);
}

/**
 * Amostragem bilinear em lat/lng.
 *
 * Devolve `null` — nunca zero — quando algum dos quatro vizinhos não foi
 * medido. Interpolar por cima de um buraco inventa o buraco preenchido, e é
 * exatamente o tipo de estimativa silenciosa que este projeto recusa.
 *
 * A longitude enrola entre a última coluna e a primeira. A latitude não: nos
 * polos a interpolação degenera para o valor da linha polar, que é o correto —
 * não existe "meia célula acima do polo norte".
 */
export function amostrar(c: CampoEscalar, lat: number, lng: number): number | null {
  const { nx, ny } = c;
  if (nx < 1 || ny < 1) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const fx = colunaDaLng(lng, nx);
  const fy = Math.max(0, Math.min(ny - 1, linhaDaLat(lat, ny)));

  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const tx = fx - i0, ty = fy - j0;

  const k00 = indice(i0, j0, nx, ny);
  const k10 = indice(i0 + 1, j0, nx, ny);
  const k01 = indice(i0, j0 + 1, nx, ny);
  const k11 = indice(i0 + 1, j0 + 1, nx, ny);

  if (!medido(c, k00) || !medido(c, k10) || !medido(c, k01) || !medido(c, k11)) return null;

  const a = c.valores[k00] * (1 - tx) + c.valores[k10] * tx;
  const b = c.valores[k01] * (1 - tx) + c.valores[k11] * tx;
  return a * (1 - ty) + b * ty;
}

/** A janela retangular em graus que a análise vai percorrer. */
export interface Janela {
  latSul: number; latNorte: number;
  lngOeste: number; lngLeste: number;
}

export const MUNDO: Janela = { latSul: -90, latNorte: 90, lngOeste: -180, lngLeste: 180 };

/**
 * Percorre as células de uma janela, chamando `fn(k, i, j, peso)`.
 *
 * A janela pode ATRAVESSAR o antimeridiano: `lngOeste = 170` com
 * `lngLeste = -170` é uma faixa de 20° em cima da linha de data, e não os 340°
 * do resto do mundo. Quem escreve a faixa desse jeito quis a faixa curta.
 */
export function percorrer(
  c: CampoEscalar, jan: Janela,
  fn: (k: number, i: number, j: number, peso: number) => void,
): void {
  const { nx, ny } = c;
  const w = pesosDeArea(ny);

  const j0 = Math.max(0, Math.floor(linhaDaLat(Math.min(90, jan.latNorte), ny)));
  const j1 = Math.min(ny - 1, Math.ceil(linhaDaLat(Math.max(-90, jan.latSul), ny)));

  const c0 = colunaDaLng(jan.lngOeste, nx);
  let c1 = colunaDaLng(jan.lngLeste, nx);
  // Faixa que cruza a linha de data: o leste "menor" que o oeste vira leste
  // maior somando uma volta. Sem isto, a faixa de 20° viraria uma de 340°.
  if (c1 <= c0) c1 += nx;
  const i0 = Math.floor(c0), i1 = Math.ceil(c1);

  for (let j = j0; j <= j1; j++) {
    const pj = w[j];
    for (let i = i0; i < i1; i++) {
      const ii = ((i % nx) + nx) % nx;
      fn(j * nx + ii, ii, j, pj);
    }
  }
}
