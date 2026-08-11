// test/isobars.mjs
// -----------------------------------------------------------------------------
// Marching squares para isobaras.
//
// O que se verifica aqui nao e "roda sem erro" — isso e facil e inutil. E:
//
//   - a curva esta ONDE o campo cruza o limiar? (contra solucao analitica)
//   - fecha no antimeridiano, ou deixa cicatriz no Pacifico?
//   - o caso ambiguo da sela liga os lobos certos?
//   - o encadeamento produz curvas continuas, e nao cacos?
//
// Um erro em qualquer um desses gera um mapa plausivel e errado.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  marchingSquares, chain, smooth, downsample, pressureCenters, buildIsobars,
} from "../server/isobars.js";
import { buildGrib } from "./_grib-fixture.mjs";

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nisóbaras");

/** monta uma grade a partir de f(i, j) */
const grade = (nx, ny, f) => {
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(i, j);
  return v;
};

await ok("rampa linear: a isóbara cai exatamente onde a matemática diz", () => {
  // f = i, então o nível t é uma reta vertical em x = t. Solução exata.
  //
  // A célula que liga a coluna nx-1 de volta à 0 é EXCLUÍDA aqui de propósito:
  // uma rampa linear não é periódica em longitude, então essa célula tem um
  // degrau artificial de 39 para 0 e cruza todos os níveis. O comportamento é
  // correto — é o que faz a isóbara fechar a volta do planeta num campo real —
  // e está verificado no teste do antimeridiano, com um campo de fato periódico.
  const nx = 40, ny = 10;
  const v = grade(nx, ny, (i) => i);
  const porNivel = marchingSquares(v, nx, ny, 5);

  let conferidos = 0;
  for (const [nivel, segs] of porNivel) {
    if (nivel < 5 || nivel > 30) continue;
    for (const [x1, , x2] of segs) {
      if (x1 >= nx - 1) continue;                        // célula do envolvimento
      assert.ok(Math.abs(x1 - nivel) < 1e-4, `nível ${nivel}: x=${x1}, esperado ${nivel}`);
      assert.ok(Math.abs(x2 - nivel) < 1e-4);
      conferidos++;
    }
  }
  assert.ok(conferidos > 30, `só ${conferidos} segmentos conferidos`);
});

await ok("interpolação na aresta é linear, não no meio da célula", () => {
  // Dois cantos com 0 e 10; o nível 2,5 tem de sair a 25% da aresta, não a 50%.
  // Errar isto dá um mapa que parece certo — as isóbaras só ficam "quadradas".
  const nx = 4, ny = 3;
  const v = grade(nx, ny, (i) => i * 10);
  const porNivel = marchingSquares(v, nx, ny, 2.5);
  const segs = porNivel.get(2.5);
  assert.ok(segs?.length, "nível 2,5 não foi produzido");
  assert.ok(Math.abs(segs[0][0] - 0.25) < 1e-6, `x=${segs[0][0]}, esperado 0,25`);
});

await ok("FECHA no antimeridiano — sem cicatriz no Pacífico", () => {
  // Campo que só depende da latitude: as isóbaras são paralelos completos.
  // Se a célula que liga a coluna nx-1 à 0 estiver faltando, a volta não fecha
  // e sobra uma fenda exatamente em 180°.
  const nx = 36, ny = 19;
  const v = grade(nx, ny, (_i, j) => j * 2);
  const segs = marchingSquares(v, nx, ny, 10).get(10) ?? [];

  const linhas = chain(segs);
  const maior = linhas.reduce((a, b) => (b.length > a.length ? b : a), []);
  assert.equal(maior.length, nx + 1, `a volta não fechou: ${maior.length} pontos de ${nx + 1}`);

  const [x0] = maior[0];
  const [xf] = maior[maior.length - 1];
  assert.ok(Math.abs(xf - x0) > nx - 2, `início ${x0} e fim ${xf} não dão a volta`);
});

await ok("círculo concêntrico vira curva fechada", () => {
  const nx = 60, ny = 60;
  const cx = 30, cy = 30;
  const v = grade(nx, ny, (i, j) => Math.hypot(i - cx, j - cy));
  const segs = marchingSquares(v, nx, ny, 10).get(10) ?? [];
  assert.ok(segs.length > 20, `poucos segmentos: ${segs.length}`);

  // todo ponto tem de estar sobre o raio 10, dentro do erro da interpolação
  for (const [x1, y1] of segs) {
    const r = Math.hypot(x1 - cx, y1 - cy);
    assert.ok(Math.abs(r - 10) < 0.6, `ponto a raio ${r.toFixed(2)}, esperado 10`);
  }

  const fechada = chain(segs).find((l) => l.length > 20);
  assert.ok(fechada, "não encadeou a curva");
  const d = Math.hypot(
    fechada[0][0] - fechada[fechada.length - 1][0],
    fechada[0][1] - fechada[fechada.length - 1][1]
  );
  assert.ok(d < 1e-6, `curva fechada não fechou: distância ${d}`);
});

await ok("caso ambíguo da sela liga os lobos certos", () => {
  // Sela clássica: cantos opostos altos, os outros dois baixos. O critério do
  // centro decide. Escolher errado produz um "X" no lugar de duas curvas.
  const nx = 2, ny = 2;
  const v = new Float32Array([10, 0, 0, 10]);           // a=10 b=0 / d=0 c=10
  const segs = marchingSquares(v, nx, ny, 5).get(5) ?? [];
  assert.equal(segs.length % 2, 0, "sela deve produzir número par de segmentos");
  assert.ok(segs.length >= 2, "sela deveria gerar dois ramos");
});

await ok("campo constante não produz isóbara nenhuma", () => {
  const nx = 20, ny = 10;
  const v = grade(nx, ny, () => 1013);
  let total = 0;
  for (const segs of marchingSquares(v, nx, ny, 4).values()) total += segs.length;
  assert.equal(total, 0, "campo sem gradiente não tem contorno");
});

await ok("encadeamento não perde nem duplica segmento", () => {
  const nx = 50, ny = 40;
  const v = grade(nx, ny, (i, j) => Math.hypot(i - 25, j - 20));
  const segs = marchingSquares(v, nx, ny, 5).get(5) ?? [];
  const linhas = chain(segs);
  const usados = linhas.reduce((s, l) => s + l.length - 1, 0);
  assert.equal(usados, segs.length, `${usados} arestas encadeadas de ${segs.length}`);
});

await ok("suavização preserva a média e envolve em longitude", () => {
  const nx = 36, ny = 19;
  const v = grade(nx, ny, (i, j) => 1000 + 20 * Math.sin((i / nx) * 2 * Math.PI) + j * 0.1);
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const s = smooth(v, nx, ny, 3);
  assert.ok(Math.abs(media(s) - media(v)) < 0.05, "a média deslocou");

  // Sem envolvimento, a coluna 0 e a nx-1 ficariam distorcidas em relação às
  // vizinhas. Num campo senoidal periódico, o erro aparece na descontinuidade.
  const saltoBorda = Math.abs(s[nx - 1] - s[0]);
  const saltoMeio = Math.abs(s[nx / 2] - s[nx / 2 + 1]);
  assert.ok(saltoBorda < saltoMeio * 3, `descontinuidade na borda: ${saltoBorda.toFixed(3)}`);
});

await ok("reamostragem por média não desloca o campo", () => {
  const nx = 40, ny = 20;
  const v = grade(nx, ny, () => 1013);
  const d = downsample(v, nx, ny, 4, 4);
  assert.equal(d.nx, 10);
  assert.equal(d.ny, 5);
  for (const x of d.values) assert.ok(Math.abs(x - 1013) < 1e-4);
});

await ok("centros de pressão distinguem alta de baixa", () => {
  const nx = 72, ny = 37;
  // uma baixa em (20,18) e uma alta em (50,18), bem separadas
  const v = grade(nx, ny, (i, j) =>
    1013 - 30 * Math.exp(-((i - 20) ** 2 + (j - 18) ** 2) / 40)
         + 25 * Math.exp(-((i - 50) ** 2 + (j - 18) ** 2) / 40));
  const cs = pressureCenters(v, nx, ny, 6, 5);

  const baixa = cs.find((c) => c.kind === "L");
  const alta = cs.find((c) => c.kind === "H");
  assert.ok(baixa, "não achou a baixa");
  assert.ok(alta, "não achou a alta");
  assert.ok(Math.abs(baixa.i - 20) <= 1 && Math.abs(baixa.j - 18) <= 1, "baixa fora do lugar");
  assert.ok(Math.abs(alta.i - 50) <= 1 && Math.abs(alta.j - 18) <= 1, "alta fora do lugar");
  assert.ok(baixa.value < alta.value, "a baixa deveria ter pressão menor");
});

// ---------------------------------------------------------------------------
await ok("caminho completo com NOMADS simulado", async () => {
  const NI = 144, NJ = 73;
  // PRMSL em Pa, empacotado como inteiro: uma baixa no hemisfério sul
  const ints = new Int32Array(NI * NJ);
  for (let j = 0; j < NJ; j++) {
    for (let i = 0; i < NI; i++) {
      const hpa = 1013 - 35 * Math.exp(-(((i - 40) ** 2 + (j - 50) ** 2) / 120));
      ints[j * NI + i] = Math.round(hpa * 100);         // Pa
    }
  }
  const buf = buildGrib(NI, NJ, ints, { bits: 24, category: 3, parameter: 1 });
  const impl = async (url) => {
    assert.match(url, /var_PRMSL=on/);
    assert.match(url, /lev_mean_sea_level=on/);
    return {
      ok: true,
      headers: { get: () => "application/octet-stream" },
      arrayBuffer: async () => buf,
    };
  };

  const r = await buildIsobars(impl, "2026-08-06", 12, new Date(Date.UTC(2026, 7, 6, 14, 7)));

  assert.ok(r.contours.length > 0, "nenhuma isóbara");
  assert.equal(r.unit, "hPa");
  assert.ok(r.min < 1000 && r.max > 1010, `faixa suspeita: ${r.min}–${r.max}`);

  // todo nível é múltiplo do passo, e está numa faixa fisicamente possível
  for (const c of r.contours) {
    assert.equal(c.hPa % r.step, 0, `nível ${c.hPa} fora do passo de ${r.step}`);
    assert.ok(c.hPa > 850 && c.hPa < 1100, `pressão implausível: ${c.hPa} hPa`);
    for (const [lng, lat] of c.points) {
      assert.ok(lat >= -90.01 && lat <= 90.01, `latitude fora do globo: ${lat}`);
      assert.ok(lng >= -180.01 && lng <= 180.01, `longitude fora do globo: ${lng}`);
    }
  }

  const baixa = r.centers.find((c) => c.kind === "L");
  assert.ok(baixa, "a baixa não foi detectada");
  assert.ok(baixa.lat < 0, `a baixa foi posta no hemisfério errado: lat ${baixa.lat}`);
  assert.ok(baixa.hPa < 1000, `pressão da baixa: ${baixa.hPa}`);
});

await ok("GEORREFERÊNCIA: a baixa sai na longitude onde foi posta", async () => {
  // A cadeia tem TRÊS conversões encadeadas e cada uma pode errar meia volta:
  //
  //   1. o GRIB do GFS vem com longitude 0..360 (Lo1 = 0);
  //   2. `reorient` rola meia grade para virar -180..180;
  //   3. `toLngLat` mapeia coluna de volta para grau.
  //
  // Se 2 e 3 discordarem, todo o mapa fica deslocado em 180° — e continua
  // parecendo um mapa meteorológico perfeitamente normal. Só a comparação com
  // uma posição CONHECIDA acusa.
  const NI = 720, NJ = 361;
  const casos = [
    { i: 150, esperadoLng: 75 },     // 150/720*360 =  75°E
    { i: 550, esperadoLng: -85 },    // 550/720*360 = 275°E = 85°W
  ];

  for (const { i: ci, esperadoLng } of casos) {
    const cj = 120;                                       // lat = 90 - 120/360*180 = 30°N
    const ints = new Int32Array(NI * NJ);
    for (let j = 0; j < NJ; j++) {
      for (let i = 0; i < NI; i++) {
        // distância em i respeitando o envolvimento, senão o caso a 85°W
        // ficaria cortado pela borda do array
        let di = Math.abs(i - ci);
        if (di > NI / 2) di = NI - di;
        const p = 1013 - 40 * Math.exp(-((di ** 2 + (j - cj) ** 2) / 400));
        ints[j * NI + i] = Math.round(p * 100);
      }
    }
    const buf = buildGrib(NI, NJ, ints, { bits: 24, category: 3, parameter: 1, lo1: 0 });
    const impl = async () => ({
      ok: true, headers: { get: () => "app/octet" }, arrayBuffer: async () => buf,
    });

    const r = await buildIsobars(impl, "2026-08-06", 12, new Date(Date.UTC(2026, 7, 6, 14, 7)));
    const baixa = r.centers.filter((c) => c.kind === "L").sort((a, b) => a.hPa - b.hPa)[0];

    assert.ok(baixa, `não achou a baixa para i=${ci}`);
    assert.ok(
      Math.abs(baixa.lng - esperadoLng) <= 2,
      `posta em ${esperadoLng}°, saiu em ${baixa.lng}° (erro de ${Math.abs(baixa.lng - esperadoLng)}°)`
    );
    assert.ok(Math.abs(baixa.lat - 30) <= 2, `latitude 30° virou ${baixa.lat}°`);
  }
});

console.log(`\n  ${n} verificações das isóbaras\n`);
export default n;
