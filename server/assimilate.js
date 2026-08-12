// server/assimilate.js
// -----------------------------------------------------------------------------
// Análise objetiva de dados (esquema Cressman/Barnes para assimilação pontual).
// -----------------------------------------------------------------------------

/** raio de influência padrão, em km — escala de correlação sinótica do vento */
export const RAIO_KM = 400;

/** limite do controle de qualidade, em m/s, por componente */
export const LIMITE_QC = 25;

/** validade de uma observação, em ms — 3 h é meia janela do ciclo do GFS */
export const VALIDADE_MS = 3 * 3600e3;

const R_TERRA = 6371;

/** distância de grande círculo, em km */
export function distKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Peso de Cressman: (R² − d²) / (R² + d²).
 *
 * Vale 1 no ponto observado, cai suavemente e chega EXATAMENTE a 0 no raio.
 * Chegar a zero importa: um peso que só tende a zero deixa um degrau na borda
 * da influência, e esse degrau aparece no mapa como um círculo — artefato que
 * o olho lê como estrutura meteorológica e não é.
 */
export function pesoCressman(d, R) {
  if (d >= R) return 0;
  const d2 = d * d, R2 = R * R;
  return (R2 - d2) / (R2 + d2);
}

/** velocidade e rumo meteorológico -> componentes u (leste) e v (norte) */
export function uvDe(speed, dirFrom) {
  if (speed == null || dirFrom == null) return null;
  // rumo METEOROLÓGICO é de onde o vento VEM; o vetor aponta para onde vai
  const rad = ((dirFrom + 180) % 360) * (Math.PI / 180);
  return { u: speed * Math.sin(rad), v: speed * Math.cos(rad) };
}

/** amostragem bilinear do campo, com envolvimento em longitude */
function amostra(grid, lat, lng) {
  const { nx, ny, u, v } = grid;
  const L = ((((lng + 180) % 360) + 360) % 360) - 180;
  const fx = ((L + 180) / 360) * nx;
  const fy = ((90 - lat) / 180) * (ny - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const col = (x) => ((x % nx) + nx) % nx;
  const row = (y) => (y < 0 ? 0 : y > ny - 1 ? ny - 1 : y);
  const at = (a, x, y) => a[row(y) * nx + col(x)] ?? 0;
  const bil = (a) =>
    at(a, x0, y0) * (1 - tx) * (1 - ty) + at(a, x0 + 1, y0) * tx * (1 - ty) +
    at(a, x0, y0 + 1) * (1 - tx) * ty + at(a, x0 + 1, y0 + 1) * tx * ty;
  return { u: bil(u), v: bil(v) };
}

/**
 * Controle de qualidade: separa observação utilizável de observação suspeita.
 *
 * Uma sonda que discorda do modelo em 40 m/s não está revelando um fenômeno que
 * o modelo perdeu — está com erro de unidade, de posição ou de horário. Aceitar
 * essa observação espalharia o erro por 400 km de raio.
 *
 * (Este projeto já teve exatamente esse caso: a sonda vinha em km/h rotulada
 * como m/s, discordando do campo por um fator de 3,6 em todo lugar.)
 */
export function controleQualidade(obs, grid, limite = LIMITE_QC, agora = Date.now()) {
  const aceitas = [], rejeitadas = [];
  for (const o of obs) {
    const uv = uvDe(o.speed, o.direction);
    if (!uv) { rejeitadas.push({ ...o, motivo: "sem velocidade ou rumo" }); continue; }
    if (agora - (o.at ?? 0) > VALIDADE_MS) {
      rejeitadas.push({ ...o, motivo: "observação velha demais" }); continue;
    }
    const fg = amostra(grid, o.lat, o.lng);
    const du = uv.u - fg.u, dv = uv.v - fg.v;
    if (Math.abs(du) > limite || Math.abs(dv) > limite) {
      rejeitadas.push({
        ...o,
        motivo: `discorda do modelo em ${Math.hypot(du, dv).toFixed(1)} m/s (limite ${limite})`,
      });
      continue;
    }
    aceitas.push({ ...o, u: uv.u, v: uv.v, du, dv });
  }
  return { aceitas, rejeitadas };
}

/**
 * Correções sucessivas de Cressman.
 *
 * Cada passe recalcula o resíduo contra o campo JÁ corrigido pelo passe
 * anterior e usa um raio menor. Passes com raio decrescente é o que permite
 * ajustar a escala grande primeiro e o detalhe depois, sem que o detalhe
 * contamine o campo distante.
 *
 * @returns {{grid: object, report: object}}
 */
export function analisar(grid, observacoes, opts = {}) {
  const passes = opts.passes ?? 3;
  const raio0 = opts.raioKm ?? RAIO_KM;
  const agora = opts.agora ?? Date.now();

  const { aceitas, rejeitadas } =
    controleQualidade(observacoes, grid, opts.limiteQC ?? LIMITE_QC, agora);

  const { nx, ny } = grid;
  const u = Float32Array.from(grid.u);
  const v = Float32Array.from(grid.v);

  if (!aceitas.length) {
    return {
      grid: { ...grid, u: Array.from(u), v: Array.from(v) },
      report: {
        observacoes: observacoes.length, aceitas: 0,
        rejeitadas: rejeitadas.map((r) => ({ lat: r.lat, lng: r.lng, motivo: r.motivo })),
        passes: 0, maxCorrecao: 0, nosTocados: 0,
        residuoAntes: null, residuoDepois: null,
        nota: "campo inalterado — nenhuma observação passou no controle de qualidade",
      },
    };
  }

  const rms = (arr) => Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length);
  const residuoAntes = rms(aceitas.map((o) => Math.hypot(o.du, o.dv)));

  let maxCorrecao = 0;
  const tocados = new Set();

  for (let p = 0; p < passes; p++) {
    // raio decrescente: escala grande primeiro, detalhe depois
    const R = raio0 * Math.pow(0.6, p);

    // resíduo recalculado contra o campo corrente
    const res = aceitas.map((o) => {
      const fg = amostra({ nx, ny, u, v }, o.lat, o.lng);
      return { ...o, du: o.u - fg.u, dv: o.v - fg.v };
    });

    // Só percorre a janela de nós que o raio alcança, e não a grade inteira.
    // Varrer 1.038.240 nós por observação por passe seria 3 M de operações por
    // clique, com 99,9% delas resultando em peso zero.
    const dLat = (R / R_TERRA) * (180 / Math.PI);
    for (const o of res) {
      const jc = ((90 - o.lat) / 180) * (ny - 1);
      const jMin = Math.max(0, Math.floor(jc - (dLat / 180) * (ny - 1)) - 1);
      const jMax = Math.min(ny - 1, Math.ceil(jc + (dLat / 180) * (ny - 1)) + 1);

      for (let j = jMin; j <= jMax; j++) {
        const lat = 90 - (j / (ny - 1)) * 180;
        // a mesma distância em km cobre mais graus de longitude perto do polo
        const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
        const dLng = (dLat / cos);
        const ic = ((o.lng + 180) / 360) * nx;
        const span = Math.ceil((dLng / 360) * nx) + 1;

        for (let k = -span; k <= span; k++) {
          const i = ((Math.round(ic) + k) % nx + nx) % nx;
          const lng = -180 + (i / nx) * 360;
          const d = distKm(lat, lng, o.lat, o.lng);
          const w = pesoCressman(d, R);
          if (w <= 0) continue;

          const idx = j * nx + i;
          u[idx] += w * o.du;
          v[idx] += w * o.dv;
          const mag = w * Math.hypot(o.du, o.dv);
          if (mag > maxCorrecao) maxCorrecao = mag;
          tocados.add(idx);
        }
      }
    }
  }

  const depois = aceitas.map((o) => {
    const fg = amostra({ nx, ny, u, v }, o.lat, o.lng);
    return Math.hypot(o.u - fg.u, o.v - fg.v);
  });

  return {
    grid: {
      ...grid,
      u: Array.from(u),
      v: Array.from(v),
      // A PROVENIÊNCIA MUDA. Não é mais "GFS puro" — é GFS analisado. Deixar o
      // rótulo antigo seria atribuir ao NOAA um campo que ele não produziu.
      dataset: `${grid.dataset ?? "GFS"} · analisado com ${aceitas.length} obs`,
      analyzed: true,
    },
    report: {
      observacoes: observacoes.length,
      aceitas: aceitas.length,
      rejeitadas: rejeitadas.map((r) => ({ lat: r.lat, lng: r.lng, motivo: r.motivo })),
      passes,
      raioKm: raio0,
      residuoAntes: +residuoAntes.toFixed(2),
      residuoDepois: +rms(depois).toFixed(2),
      maxCorrecao: +maxCorrecao.toFixed(2),
      nosTocados: tocados.size,
      fracaoTocada: +((tocados.size / (nx * ny)) * 100).toFixed(2),
      metodo: "Cressman (1959), correções sucessivas com raio decrescente",
    },
  };
}
