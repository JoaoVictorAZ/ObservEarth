// src/malha/rampa.ts
// -----------------------------------------------------------------------------
// A MESMA COR NOS DOIS LUGARES.
// -----------------------------------------------------------------------------
// O servidor pinta o campo num PNG (`server/fields.js`). A malha 3D pinta o
// MESMO campo a partir dos valores binários. Se as duas usassem escalas
// próprias, o mesmo dado apareceria com duas cores conforme fosse desenhado
// como textura ou como relevo — e quem olhasse não teria como saber qual das
// duas acreditar.
//
// Por isso o catálogo `/api/fields` passou a devolver as PARADAS da rampa, e
// não só a legenda de seis amostras, e por isso este arquivo é uma tradução
// linha a linha de `rampColor` e `stepColor`. `test/malha-rampa.mjs` compara as
// duas implementações valor a valor: uma divergência de um tom já reprova.
//
// A DISTINÇÃO ENTRE RAMPA E FAIXA não é estética. Chuva e WBGT são pintados em
// faixas porque são lidos contra limiares de decisão — 27,9 e 28,1 °C WBGT não
// são "quase iguais", são lados opostos de uma conduta. Interpolar entre eles
// apaga exatamente a fronteira que importa.
// -----------------------------------------------------------------------------

export type Parada = [number, [number, number, number]];
export type ModoRampa = "rampa" | "faixas";

/** Interpolação linear entre paradas, saturando nas pontas sem extrapolar. */
export function corDaRampa(stops: Parada[], v: number): [number, number, number] {
  if (!stops.length) return [128, 128, 128];
  if (v <= stops[0][0]) return stops[0][1];
  const ultima = stops[stops.length - 1];
  if (v >= ultima[0]) return ultima[1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v > v1) continue;
    const [v0, c0] = stops[i - 1];
    const t = (v - v0) / (v1 - v0);
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ];
  }
  return ultima[1];
}

/** Cor por classe discreta: o valor herda a cor da última parada que atingiu. */
export function corDaFaixa(stops: Parada[], v: number): [number, number, number] {
  if (!stops.length) return [128, 128, 128];
  let cor = stops[0][1];
  for (const [limite, c] of stops) {
    if (v >= limite) cor = c;
    else break;
  }
  return cor;
}

export function corDoValor(
  stops: Parada[], v: number, modo: ModoRampa = "rampa",
): [number, number, number] {
  return modo === "faixas" ? corDaFaixa(stops, v) : corDaRampa(stops, v);
}

/**
 * Componente sRGB (0..255) → linear (0..1).
 *
 * As paradas foram escolhidas olhando para uma tela, então elas estão em sRGB.
 * O three.js trabalha em espaço LINEAR e converte na saída; entregar o valor
 * sRGB direto a um `BufferAttribute` de cor faz o material clarear tudo uma
 * segunda vez, e a rampa aparece lavada em relação ao PNG do mesmo campo.
 *
 * É a mesma armadilha que faz textura de cor precisar de `SRGBColorSpace` e
 * máscara de dado precisar de `NoColorSpace` — o projeto já paga esse cuidado
 * em `applyOcean` e no relevo.
 */
export function sRGBparaLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
