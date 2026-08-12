// server/isobars.js
// -----------------------------------------------------------------------------
// Extração e geração de isóbaras via algoritmo Marching Squares sobre campo PRMSL.
// -----------------------------------------------------------------------------

import { fetchGfsMessages } from "./gfs.js";

/** intervalo sinotico padrao, em hPa */
export const STEP_HPA = 4;

/**
 * Suaviza com um nucleo binomial 1-2-1 separavel, com envolvimento em
 * longitude e travamento nos polos.
 *
 * Separavel: duas passagens 1D em vez de uma 2D. Mesmo resultado, custo O(n)
 * em vez de O(n*k^2).
 */
export function smooth(src, nx, ny, passes = 2) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);

  for (let p = 0; p < passes; p++) {
    // horizontal, com envolvimento
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const l = a[row + (i - 1 + nx) % nx];
        const c = a[row + i];
        const r = a[row + (i + 1) % nx];
        b[row + i] = (l + 2 * c + r) / 4;
      }
    }
    // vertical, travando nos polos (nao ha linha acima do polo norte)
    for (let j = 0; j < ny; j++) {
      const up = j === 0 ? 0 : j - 1;
      const dn = j === ny - 1 ? ny - 1 : j + 1;
      for (let i = 0; i < nx; i++) {
        a[j * nx + i] = (b[up * nx + i] + 2 * b[j * nx + i] + b[dn * nx + i]) / 4;
      }
    }
  }
  return a;
}

/** reamostra por media de blocos: preserva a media, ao contrario de pegar 1 em N */
export function downsample(src, nx, ny, fx, fy) {
  const ox = Math.floor(nx / fx), oy = Math.floor(ny / fy);
  const out = new Float32Array(ox * oy);
  for (let j = 0; j < oy; j++) {
    for (let i = 0; i < ox; i++) {
      let s = 0, k = 0;
      for (let dj = 0; dj < fy; dj++) {
        const sj = Math.min(ny - 1, j * fy + dj);
        for (let di = 0; di < fx; di++) {
          s += src[sj * nx + Math.min(nx - 1, i * fx + di)];
          k++;
        }
      }
      out[j * ox + i] = s / k;
    }
  }
  return { values: out, nx: ox, ny: oy };
}

/**
 * Marching squares.
 *
 * Devolve segmentos soltos, em coordenadas de GRADE (fracionarias). A conversao
 * para lat/lng e feita depois, de uma vez — misturar as duas coisas dentro do
 * laco e o caminho mais curto para um erro de sinal em latitude.
 *
 * @returns {Map<number, Array<[number,number,number,number]>>} nivel -> segmentos
 */
export function marchingSquares(values, nx, ny, step) {
  const bySegLevel = new Map();
  const at = (i, j) => values[j * nx + (i % nx)];

  const push = (lvl, x1, y1, x2, y2) => {
    let arr = bySegLevel.get(lvl);
    if (!arr) bySegLevel.set(lvl, (arr = []));
    arr.push([x1, y1, x2, y2]);
  };

  // interpolacao linear na aresta: onde exatamente o valor cruza o limiar
  const mix = (va, vb, t) => (Math.abs(vb - va) < 1e-9 ? 0.5 : (t - va) / (vb - va));

  for (let j = 0; j < ny - 1; j++) {
    // i vai ATE nx-1 inclusive: a ultima celula liga a coluna nx-1 com a 0,
    // fechando a volta no antimeridiano
    for (let i = 0; i < nx; i++) {
      const i2 = (i + 1) % nx;
      const a = at(i, j),      b = at(i2, j);
      const c = at(i2, j + 1), d = at(i, j + 1);

      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      // Só os níveis que a célula realmente cruza. Varrer todos os níveis para
      // toda célula seria 40x mais trabalho, quase todo ele descartado.
      const k0 = Math.ceil(lo / step);
      const k1 = Math.floor(hi / step);

      for (let k = k0; k <= k1; k++) {
        const t = k * step;
        const idx = (a >= t ? 8 : 0) | (b >= t ? 4 : 0) | (c >= t ? 2 : 0) | (d >= t ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        // pontos nas quatro arestas, em coordenadas locais da celula [0..1]
        const top = [i + mix(a, b, t), j];
        const right = [i + 1, j + mix(b, c, t)];
        const bottom = [i + mix(d, c, t), j + 1];
        const left = [i, j + mix(a, d, t)];

        switch (idx) {
          case 1: case 14: push(t, ...left, ...bottom); break;
          case 2: case 13: push(t, ...bottom, ...right); break;
          case 3: case 12: push(t, ...left, ...right); break;
          case 4: case 11: push(t, ...top, ...right); break;
          case 6: case 9:  push(t, ...top, ...bottom); break;
          case 7: case 8:  push(t, ...left, ...top); break;
          // CASOS AMBIGUOS. Duas selas sao possiveis; escolher errado troca
          // quais lobos ficam ligados e produz um "X" onde deveria haver duas
          // curvas separadas. O centro da celula desempata: e o criterio
          // assintotico usual e nao custa nada aqui.
          case 5: {
            const center = (a + b + c + d) / 4;
            if (center >= t) { push(t, ...left, ...top); push(t, ...bottom, ...right); }
            else { push(t, ...left, ...bottom); push(t, ...top, ...right); }
            break;
          }
          case 10: {
            const center = (a + b + c + d) / 4;
            if (center >= t) { push(t, ...left, ...bottom); push(t, ...top, ...right); }
            else { push(t, ...left, ...top); push(t, ...bottom, ...right); }
            break;
          }
        }
      }
    }
  }
  return bySegLevel;
}

/**
 * Encadeia segmentos soltos em polilinhas.
 *
 * Marching squares nao produz curvas: produz cacos. Desenhar caco a caco
 * funciona, mas dobra a contagem de vertices (cada ponto interno aparece duas
 * vezes) e impede rotular a isobara ao longo dela. Encadear e barato e resolve
 * os dois.
 */
export function chain(segments, snap = 1e-6) {
  const key = (x, y) => `${Math.round(x / snap)},${Math.round(y / snap)}`;

  // Indexa pelas DUAS pontas. A versao anterior indexava so pelo inicio e so
  // estendia para a frente — e marching squares NAO garante orientacao: a
  // ordem dos pontos depende de qual caso do switch emitiu o segmento. Numa
  // curva fechada, comecar por um segmento do meio capturava metade dela e a
  // outra metade virava uma segunda linha. O desenho ficava quase certo, com
  // uma falha do tamanho de um pixel em algum lugar do anel.
  const porPonto = new Map();
  const add = (k, s) => {
    let a = porPonto.get(k);
    if (!a) porPonto.set(k, (a = []));
    a.push(s);
  };
  for (const s of segments) {
    add(key(s[0], s[1]), s);
    add(key(s[2], s[3]), s);
  }

  const usados = new Set();
  const linhas = [];
  const livre = (x, y) => (porPonto.get(key(x, y)) ?? []).find((s) => !usados.has(s));

  /** ponta oposta aquela que casa com (x,y) */
  const outraPonta = (s, x, y) =>
    key(s[0], s[1]) === key(x, y) ? [s[2], s[3]] : [s[0], s[1]];

  for (const semente of segments) {
    if (usados.has(semente)) continue;
    usados.add(semente);

    const frente = [[semente[0], semente[1]], [semente[2], semente[3]]];
    for (let g = 0; g < 1e6; g++) {
      const [x, y] = frente[frente.length - 1];
      const s = livre(x, y);
      if (!s) break;
      usados.add(s);
      frente.push(outraPonta(s, x, y));
    }

    // Para tras num array separado: `unshift` num laco seria O(n^2), e uma
    // isobara global tem milhares de pontos.
    const tras = [];
    for (let g = 0; g < 1e6; g++) {
      const [x, y] = tras.length ? tras[tras.length - 1] : frente[0];
      const s = livre(x, y);
      if (!s) break;
      usados.add(s);
      tras.push(outraPonta(s, x, y));
    }

    linhas.push(tras.length ? [...tras.reverse(), ...frente] : frente);
  }
  return linhas;
}

/**
 * Centros de pressao: minimos e maximos locais.
 *
 * O raio importa. Pequeno demais e cada ondulacao vira um "B"; grande demais e
 * dois ciclones vizinhos viram um so. 6 graus e a ordem de grandeza de um
 * sistema sinotico.
 */
export function pressureCenters(values, nx, ny, radiusDeg = 6, stepDeg = 1, minAmp = 0.5) {
  const r = Math.max(2, Math.round(radiusDeg / stepDeg));
  const out = [];

  for (let j = r; j < ny - r; j++) {
    for (let i = 0; i < nx; i++) {
      const v = values[j * nx + i];
      let ehMin = true, ehMax = true;
      let vizMin = Infinity, vizMax = -Infinity;

      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (!di && !dj) continue;
          const u = values[(j + dj) * nx + ((i + di + nx * 2) % nx)];
          if (u < v) ehMin = false;
          if (u > v) ehMax = false;
          if (u < vizMin) vizMin = u;
          if (u > vizMax) vizMax = u;
        }
      }

      // AMPLITUDE MINIMA, e nao apenas comparacao.
      //
      // Sem isto, uma regiao PLANA marca todo ponto como minimo E maximo ao
      // mesmo tempo — nenhum vizinho e menor, nenhum e maior. O resultado era
      // um "B" em cada no de qualquer area de gradiente fraco, milhares deles,
      // e o primeiro da lista era um ponto qualquer no meio do oceano em vez
      // do ciclone de verdade. O centro so e centro se destoar do entorno.
      if (ehMin && ehMax) continue;                       // planalto: nao e centro
      if (ehMin && vizMax - v >= minAmp) out.push({ i, j, value: v, kind: "L" });
      else if (ehMax && v - vizMin >= minAmp) out.push({ i, j, value: v, kind: "H" });
    }
  }
  return out;
}

// ------------------------------------------------------------------ público --

/** grade -> lat/lng, com uma casa decimal (0,1 grau ~ 11 km, abaixo do traço) */
const toLngLat = (x, y, nx, ny) => [
  +(-180 + (x / nx) * 360).toFixed(2),
  +(90 - (y / (ny - 1)) * 180).toFixed(2),
];

export async function buildIsobars(fetchImpl, dateStr, hour, now = new Date(), opts = {}) {
  const step = opts.step ?? STEP_HPA;

  const { msgs, label, cycle, fhr } = await fetchGfsMessages(
    fetchImpl, dateStr, hour, ["PRMSL"], ["mean_sea_level"], now
  );

  // disciplina 0, categoria 3 (massa), parametro 1 = pressao reduzida ao nivel do mar
  const m = msgs.find((x) => x.discipline === 0 && x.category === 3 && x.parameter === 1);
  if (!m) throw new Error(`GRIB2 sem PRMSL (${msgs.length} mensagem(ns) em ${label})`);

  const { ni, nj } = m.grid;

  // Pa -> hPa. Trabalhar em hPa nao e cosmetico: o intervalo de 4 e definido em
  // hPa, e contornar em Pa daria niveis em 400 com erro de arredondamento visivel.
  const hpa = new Float32Array(ni * nj);
  for (let k = 0; k < hpa.length; k++) hpa[k] = m.values[k] / 100;

  const suave = smooth(hpa, ni, nj, opts.passes ?? 2);
  const grade = downsample(suave, ni, nj, 4, 4);          // 0,25° -> 1°

  const porNivel = marchingSquares(grade.values, grade.nx, grade.ny, step);

  const contours = [];
  let pontos = 0;
  for (const [nivel, segs] of [...porNivel].sort((a, b) => a[0] - b[0])) {
    for (const linha of chain(segs)) {
      if (linha.length < 3) continue;                     // caco solto: descarta
      const pts = linha.map(([x, y]) => toLngLat(x, y, grade.nx, grade.ny));
      pontos += pts.length;
      contours.push({
        hPa: +nivel.toFixed(0),
        /** múltiplos de 20 hPa são os traços grossos da carta sinóptica */
        major: Math.abs(nivel % 20) < 1e-6,
        points: pts,
      });
    }
  }

  // O passo em GRAUS sai da grade, não é constante. Fixá-lo em 1 assumia que a
  // entrada é sempre o GFS 0,25° (1440 -> 360 colunas); com qualquer outra
  // resolução o raio de busca vira o número errado de células, e num campo
  // baixo o raio engolia a faixa inteira e não sobrava linha para varrer.
  const grauPorCelula = 360 / grade.nx;
  const centers = pressureCenters(
    grade.values, grade.nx, grade.ny, 6, grauPorCelula
  ).map((c) => {
    const [lng, lat] = toLngLat(c.i, c.j, grade.nx, grade.ny);
    return { lat, lng, hPa: +c.value.toFixed(1), kind: c.kind };
  });

  let min = Infinity, max = -Infinity;
  for (const v of grade.values) { if (v < min) min = v; if (v > max) max = v; }

  return {
    step,
    contours,
    centers,
    points: pontos,
    stepDeg: +(360 / grade.nx).toFixed(2),
    min: +min.toFixed(1),
    max: +max.toFixed(1),
    unit: "hPa",
    dataset: `NOAA GFS 0.25° · ${label}`,
    cycle: `${cycle.date}${String(cycle.cycle).padStart(2, "0")}`,
    forecastHour: fhr,
    builtAt: new Date().toISOString(),
  };
}
