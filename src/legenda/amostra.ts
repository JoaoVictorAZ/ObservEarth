// src/legenda/amostra.ts
// -----------------------------------------------------------------------------
// O VALOR SOB O CURSOR
// -----------------------------------------------------------------------------
// A leitura contínua — passar o cursor e ler o número, sem clicar — depende de
// uma coisa só: ter os valores no CLIENTE. E a grade de vento já está lá, como
// `Float32Array` apontando para o próprio buffer binário (ver `src/windBin.ts`).
// Amostrar essa grade é aritmética sobre memória local: nenhuma requisição,
// nenhum servidor, nenhuma cota gasta.
//
// A CONVENÇÃO DA GRADE, que o `test/wind-longitude.mjs` já defende:
//   coluna 0  →  longitude −180°   (o servidor desloca a grade do GFS, que
//                                    nasce em 0°, antes de mandar)
//   linha  0  →  latitude  +90°    (norte no topo, como a textura)
//
// AUSÊNCIA NÃO É ZERO, E AQUI ELA CUSTA CARO SE FOR IGNORADA
//
// A grade traz um plano `valid`: 1 onde houve medida, 0 onde não houve. Um
// zero em `u` e `v` é um lugar de calmaria — informação real e comum na zona de
// convergência intertropical. Tratar ausência como zero pintaria calmaria em
// cima de buraco de dado, e a leitura diria "0,0 m/s" com a mesma confiança com
// que diz "18,4". Por isso qualquer um dos quatro vizinhos inválido derruba a
// amostra inteira para `null`.
// -----------------------------------------------------------------------------

export interface Grade {
  nx: number;
  ny: number;
  u: number[] | Float32Array;
  v: number[] | Float32Array;
  valid?: number[] | Uint8Array;
}

const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A grade tem forma utilizável? */
export function gradeUtil(g: Grade | null | undefined): g is Grade {
  if (!g) return false;
  if (!Number.isInteger(g.nx) || !Number.isInteger(g.ny) || g.nx < 2 || g.ny < 2) return false;
  return g.u?.length >= g.nx * g.ny && g.v?.length >= g.nx * g.ny;
}

/**
 * Velocidade do vento em m/s no ponto, por interpolação bilinear.
 *
 * A longitude ENROLA e a latitude NÃO. É a diferença entre uma dimensão
 * cíclica e uma limitada: a coluna à direita da última é a primeira, mas a
 * linha acima do polo não existe e é grampeada. Enrolar a latitude faria o
 * ponto sobre o Ártico ler o vento da Antártida.
 */
export function amostrarVento(g: Grade | null | undefined, lat: number, lng: number): number | null {
  if (!gradeUtil(g)) return null;
  if (!finito(lat) || !finito(lng)) return null;

  const lngN = ((lng + 180) % 360 + 360) % 360;          // 0..360 a partir de −180
  const fx = (lngN / 360) * g.nx;
  const fy = ((90 - Math.max(-90, Math.min(90, lat))) / 180) * (g.ny - 1);

  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;

  const cx = (i: number) => ((i % g.nx) + g.nx) % g.nx;   // enrola
  const cy = (j: number) => Math.max(0, Math.min(g.ny - 1, j)); // grampeia

  const cantos: number[] = [
    cy(y0) * g.nx + cx(x0),
    cy(y0) * g.nx + cx(x0 + 1),
    cy(y0 + 1) * g.nx + cx(x0),
    cy(y0 + 1) * g.nx + cx(x0 + 1),
  ];

  // Um canto sem medida derruba a amostra inteira. Interpolar por cima de
  // buraco produziria um número com a mesma cara dos outros e sem nada por trás.
  if (g.valid) {
    for (const i of cantos) if (!g.valid[i]) return null;
  }
  for (const i of cantos) {
    if (!finito(g.u[i] as number) || !finito(g.v[i] as number)) return null;
  }

  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const u = mix(mix(g.u[cantos[0]] as number, g.u[cantos[1]] as number, tx),
                mix(g.u[cantos[2]] as number, g.u[cantos[3]] as number, tx), ty);
  const v = mix(mix(g.v[cantos[0]] as number, g.v[cantos[1]] as number, tx),
                mix(g.v[cantos[2]] as number, g.v[cantos[3]] as number, tx), ty);

  return Math.hypot(u, v);
}

/**
 * Direção meteorológica: DE ONDE o vento vem, em graus.
 *
 * A convenção meteorológica é a de origem, e não a de destino — vento norte
 * SOPRA do norte. Inverter isso é o erro mais comum com campos de vento, e ele
 * não aparece no número: aparece numa seta apontando exatamente ao contrário.
 */
export function direcaoVento(g: Grade | null | undefined, lat: number, lng: number): number | null {
  if (!gradeUtil(g) || !finito(lat) || !finito(lng)) return null;
  const lngN = ((lng + 180) % 360 + 360) % 360;
  const i = Math.min(g.ny - 1, Math.round(((90 - Math.max(-90, Math.min(90, lat))) / 180) * (g.ny - 1)));
  const j = Math.round((lngN / 360) * g.nx) % g.nx;
  const k = i * g.nx + j;
  if (g.valid && !g.valid[k]) return null;
  const u = g.u[k] as number, v = g.v[k] as number;
  if (!finito(u) || !finito(v)) return null;
  return (270 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
}
