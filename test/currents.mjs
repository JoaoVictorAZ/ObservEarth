// test/currents.mjs
// -----------------------------------------------------------------------------
// Correntes marítimas.
//
// A rota anterior gerava o oceano inteiro por fórmula. O que a substitui tem um
// risco específico e sério, e a maior parte deste arquivo é sobre ele:
//
//   VENTO e CORRENTE usam convenções OPOSTAS, e as duas se chamam "direção".
//
//     vento    (meteorológica)  270° = vem DE oeste, sopra PARA leste
//     corrente (oceanográfica)  270° = vai PARA oeste
//
// Copiar a conversão do vento — que soma 180° — poria toda corrente do planeta
// ao contrário. E não quebraria nada: a Corrente do Golfo desceria a costa
// americana em vez de subir, com aparência perfeitamente normal para quem não
// conhece a circulação de cor.
//
// Por isso os casos de referência aqui são correntes REAIS, com sentido que se
// pode conferir num atlas.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  PASSO, LOTE, TETO_MS, uvDaCorrente, montarPontos, buscarCorrentes,
} from "../server/currents.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ncorrentes marítimas");

// ---------------------------------------------------------------------------
// a convenção — o coração do arquivo
// ---------------------------------------------------------------------------
ok("direção 0° é água indo PARA O NORTE", () => {
  const { u, v } = uvDaCorrente(1, 0);
  assert.ok(Math.abs(u) < 1e-9, `u = ${u}`);
  assert.ok(Math.abs(v - 1) < 1e-9, `v = ${v}, esperava +1 (norte)`);
});

ok("direção 90° é água indo PARA O LESTE", () => {
  const { u, v } = uvDaCorrente(1, 90);
  assert.ok(Math.abs(u - 1) < 1e-9, `u = ${u}, esperava +1 (leste)`);
  assert.ok(Math.abs(v) < 1e-9, `v = ${v}`);
});

ok("NÃO é a convenção do vento — nada de somar 180°", () => {
  // Este é o teste que existe para impedir o copiar-e-colar. Com a fórmula do
  // vento, 90° daria u = −1: a corrente inteira do planeta invertida.
  const { u } = uvDaCorrente(1, 90);
  assert.ok(u > 0, "a conversão do vento foi copiada — todo oceano está ao contrário");
  const rad = ((90 + 180) * Math.PI) / 180;
  assert.notEqual(+u.toFixed(6), +(1 * Math.sin(rad)).toFixed(6));
});

ok("Corrente do Golfo: sentido nordeste sobe pela costa americana", () => {
  // Ao largo da Flórida ela corre para NNE, ~40°. Se o sinal estivesse
  // invertido, ela desceria — e pareceria normal para olho destreinado.
  const { u, v } = uvDaCorrente(1.8, 40);
  assert.ok(u > 0, "Golfo indo para oeste, contra o continente");
  assert.ok(v > 0, "Golfo descendo em vez de subir");
  assert.ok(v > u, "em 40° a componente norte tem que dominar");
});

ok("Circumpolar Antártica: para LESTE, dando a volta no continente", () => {
  // A maior corrente do planeta corre de oeste para leste. Direção ~90°.
  const { u, v } = uvDaCorrente(0.5, 90);
  assert.ok(u > 0, "a Circumpolar está indo para oeste");
  assert.ok(Math.abs(v) < 1e-9);
});

ok("Corrente das Canárias: para o SUL na costa africana", () => {
  const { u, v } = uvDaCorrente(0.3, 180);
  assert.ok(v < 0, "as Canárias estão subindo em vez de descer");
  assert.ok(Math.abs(u) < 1e-9);
});

ok("o módulo é preservado em qualquer direção", () => {
  for (let d = 0; d < 360; d += 15) {
    const { u, v } = uvDaCorrente(2.4, d);
    assert.ok(Math.abs(Math.hypot(u, v) - 2.4) < 1e-9, `direção ${d}° alterou o módulo`);
  }
});

ok("360° e 0° dão o mesmo vetor", () => {
  const a = uvDaCorrente(1, 0), b = uvDaCorrente(1, 360);
  assert.ok(Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9);
});

ok("ausência não vira vetor nulo", () => {
  // Terra volta null da API. Um (0,0) seria "água parada", que é uma
  // afirmação — e faria a partícula morrer em cima do continente em vez de
  // nunca nascer ali.
  assert.equal(uvDaCorrente(null, 90), null);
  assert.equal(uvDaCorrente(1, null), null);
  assert.equal(uvDaCorrente(NaN, 90), null);
  assert.equal(uvDaCorrente(1, NaN), null);
});

// ---------------------------------------------------------------------------
// a grade
// ---------------------------------------------------------------------------
ok("a grade cobre o globo sem furo nem repetição", () => {
  const { lats, lngs, nx, ny } = montarPontos(1.5);
  assert.equal(nx, 240); assert.equal(ny, 120);
  assert.ok(lats[0] < 90 && lats[0] > 88, `primeira latitude ${lats[0]}`);
  assert.ok(lats[ny - 1] > -90 && lats[ny - 1] < -88);
  assert.ok(lngs[0] > -180 && lngs[0] < -178);
  assert.ok(lngs[nx - 1] < 180 && lngs[nx - 1] > 178);
  assert.equal(new Set(lngs).size, nx, "longitude repetida");
});

ok("as células são centradas, não encostadas na borda", () => {
  // Ponto exatamente em ±180 seria amostrado duas vezes na emenda.
  const { lngs } = montarPontos(1.5);
  assert.ok(!lngs.includes(180) && !lngs.includes(-180));
});

ok("o custo em requisições cabe no orçamento", () => {
  // Teto do projeto: um quarto do limite gratuito. 28.800 pontos em lotes de
  // 200 são 144 requisições, cacheadas por 6 h.
  const { nx, ny } = montarPontos(PASSO);
  const reqs = Math.ceil((nx * ny) / LOTE);
  assert.ok(reqs <= 200, `${reqs} requisições por campo`);
});

// ---------------------------------------------------------------------------
// a busca
// ---------------------------------------------------------------------------
function servidor({ status = 200, velocidade = 0.8, direcao = 90, terra = () => false } = {}) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(String(url));
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const p = new URL(String(url)).searchParams;
    const lats = p.get("latitude").split(",").map(Number);
    const lngs = p.get("longitude").split(",").map(Number);
    const time = Array.from({ length: 24 }, (_, i) => `2026-08-12T${String(i).padStart(2, "0")}:00`);
    return {
      ok: true, status: 200,
      json: async () => lats.map((la, i) => ({
        hourly: {
          time,
          ocean_current_velocity: time.map(() => (terra(la, lngs[i]) ? null : velocidade)),
          ocean_current_direction: time.map(() => (terra(la, lngs[i]) ? null : direcao)),
        },
      })),
    };
  };
  impl.chamadas = chamadas;
  return impl;
}

await okA("a URL pede m/s e célula de MAR", async () => {
  // Sem `velocity_unit=ms` a API devolve km/h — fator 3,6. Sem
  // `cell_selection=sea` ela procura célula em terra e devolve nulo na costa.
  const f = servidor();
  await buscarCorrentes(f, { passo: 30, lote: 200 });
  const u = new URL(f.chamadas[0]);
  assert.equal(u.searchParams.get("velocity_unit"), "ms");
  assert.equal(u.searchParams.get("cell_selection"), "sea");
  assert.ok(u.hostname.includes("marine-api"), `bateu em ${u.hostname}`);
  assert.equal(u.searchParams.get("hourly"),
    "ocean_current_velocity,ocean_current_direction");
});

await okA("terra fica com valid = 0 e vetor zerado, não medido", async () => {
  const ehTerra = (la, ln) => la > 0 && ln > 0;
  const c = await buscarCorrentes(servidor({ terra: ehTerra }), { passo: 30, lote: 500 });
  let terraMarcada = 0;
  const { lats, lngs, nx } = montarPontos(30);
  for (let y = 0; y < lats.length; y++) {
    for (let x = 0; x < nx; x++) {
      if (ehTerra(lats[y], lngs[x])) {
        assert.equal(c.valid[y * nx + x], 0, "terra marcada como medida");
        terraMarcada++;
      }
    }
  }
  assert.ok(terraMarcada > 0, "o cenário não tinha terra");
  assert.ok(c.measuredPct < 100);
});

await okA("cobertura parcial é o resultado CERTO, e vem explicada", async () => {
  // 71% do planeta é oceano. Um campo de correntes com 100% medido seria o
  // sinal de que algo está preenchendo continente.
  const c = await buscarCorrentes(servidor({ terra: (la) => la > 30 }), { passo: 30, lote: 500 });
  assert.equal(c.marEsperadoPct, 71);
  assert.ok(c.measuredPct < 100);
  assert.match(c.convencao, /para onde a água VAI/);
});

await okA("valor absurdo é descartado, não clampado", async () => {
  // Clampar transformaria lixo num campo constante e convincente — foi assim
  // que o vento já mostrou listras diagonais perfeitas vindas de 2e7 m/s.
  const c = await buscarCorrentes(servidor({ velocidade: 50 }), { passo: 45, lote: 500 })
    .catch((e) => e);
  assert.ok(c instanceof Error, "50 m/s de corrente foi aceito");
  assert.equal(c.code, "SEM_CORRENTES");
});

await okA("corrente forte porém plausível passa", async () => {
  // A Corrente do Golfo passa de 2,5 m/s em pontos raros. O teto tem que
  // aceitar isso e recusar o absurdo.
  const c = await buscarCorrentes(servidor({ velocidade: 2.6 }), { passo: 45, lote: 500 });
  assert.ok(c.measuredPct > 0);
  assert.ok(TETO_MS > 2.6 && TETO_MS < 20);
});

await okA("fonte fora do ar é erro com código, nunca campo inventado", async () => {
  await assert.rejects(
    () => buscarCorrentes(servidor({ status: 503 }), { passo: 45, lote: 500 }),
    (e) => e.code === "SEM_CORRENTES" && e.status === 502
  );
});

await okA("a procedência declara a origem real, não a rota", async () => {
  const c = await buscarCorrentes(servidor(), { passo: 45, lote: 500 });
  assert.match(c.provider, /Copernicus/);
  assert.match(c.dataset, /GLOBAL_ANALYSISFORECAST_PHY_001_024/);
  assert.ok(!/HYCOM/i.test(c.provider), "voltou a dizer HYCOM sem ser HYCOM");
  assert.equal(c.stepDeg, 45);
});

await okA("o campo resultante aponta para leste onde a direção é 90°", async () => {
  // Fecha o laço: da resposta da API até o vetor que o shader recebe.
  const c = await buscarCorrentes(servidor({ direcao: 90, velocidade: 1.2 }), { passo: 45, lote: 500 });
  const i = c.valid.findIndex((x) => x === 1);
  assert.ok(i >= 0);
  assert.ok(c.u[i] > 1.19, `u = ${c.u[i]}, esperava ~+1,2 (leste)`);
  assert.ok(Math.abs(c.v[i]) < 1e-6);
});

console.log(`\n  ${n} verificações das correntes\n`);
export default n;
