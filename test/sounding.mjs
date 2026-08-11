// test/sounding.mjs
// -----------------------------------------------------------------------------
// Perfil vertical.
//
// A rota anterior montava a atmosfera inteira com `25 − (1000 − hPa) × 0,08`.
// Uma sondagem é de onde saem CAPE, CIN e índices de instabilidade: um perfil
// inventado não erra o gráfico, erra a previsão de tempestade.
//
// E pedia `temperature_1000hpa` onde a API publica `temperature_1000hPa`. Uma
// letra. Se o parâmetro era rejeitado, todo valor caía no fallback — é
// plausível que a tela nunca tenha mostrado um dado real.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  NIVEIS, CAMPOS, orvalho, gradiente, camada, buscarSondagem,
} from "../server/sounding.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const okA = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nperfil vertical");

// ---------------------------------------------------------------------------
// orvalho — Magnus-Tetens
// ---------------------------------------------------------------------------
ok("saturação: com UR 100% o orvalho é a própria temperatura", () => {
  for (const t of [-20, 0, 15, 30]) {
    assert.ok(Math.abs(orvalho(t, 100) - t) < 0.01, `T=${t} deu Td=${orvalho(t, 100)}`);
  }
});

ok("o orvalho nunca passa da temperatura", () => {
  // Td > T é fisicamente impossível: seria vapor além da saturação.
  for (let t = -30; t <= 45; t += 5) {
    for (const ur of [5, 25, 50, 75, 99]) {
      const td = orvalho(t, ur);
      assert.ok(td <= t + 1e-6, `T=${t} UR=${ur} deu Td=${td}`);
    }
  }
});

ok("ar mais seco tem orvalho mais baixo, sempre", () => {
  let ant = Infinity;
  for (const ur of [95, 80, 60, 40, 20]) {
    const td = orvalho(20, ur);
    assert.ok(td < ant, `UR ${ur}% não baixou o orvalho`);
    ant = td;
  }
});

ok("valor conhecido: 20 °C e 50% dá cerca de 9,3 °C", () => {
  const td = orvalho(20, 50);
  assert.ok(Math.abs(td - 9.3) < 0.15, `deu ${td}`);
});

ok("fora da faixa de validade devolve null, não extrapolação", () => {
  // Alduchov & Eskridge é sobre água líquida, −40 a +50 °C. Acima da isoterma
  // de −40 o vapor está sobre gelo e a fórmula não vale.
  assert.equal(orvalho(-55, 60), null, "extrapolou abaixo de −40 °C");
  assert.equal(orvalho(60, 60), null, "extrapolou acima de +50 °C");
  assert.equal(orvalho(20, 0), null, "UR zero não tem orvalho definido");
  assert.equal(orvalho(20, 140), null, "UR acima de 100 devia ser recusada");
  assert.equal(orvalho(null, 50), null);
  assert.equal(orvalho(20, null), null);
  assert.equal(orvalho(NaN, 50), null);
});

// ---------------------------------------------------------------------------
// gradiente e classificação
// ---------------------------------------------------------------------------
ok("gradiente positivo significa esfriando com a altura", () => {
  // 15 °C a 100 m, 5 °C a 1100 m: 10 °C em 1 km.
  const g = gradiente({ temperatura: 15, altura: 100 }, { temperatura: 5, altura: 1100 });
  assert.equal(g, 10);
});

ok("inversão sai com sinal negativo", () => {
  const g = gradiente({ temperatura: 5, altura: 100 }, { temperatura: 9, altura: 600 });
  assert.ok(g < 0, `inversão deu ${g}`);
  assert.equal(camada(g), "inversão");
});

ok("os limiares de classificação são os físicos", () => {
  assert.equal(camada(11), "superadiabática", "acima de 9,8 °C/km (g/cp) é superadiabático");
  assert.equal(camada(7), "condicionalmente instável");
  assert.equal(camada(4), "estável");
  assert.equal(camada(0.5), "isotérmica");
  assert.equal(camada(-2), "inversão");
  assert.equal(camada(null), null);
});

ok("sem altura não há gradiente — e não se inventa altura tabelada", () => {
  // A própria Open-Meteo avisa que 1000 hPa fica "entre 60 e 160 m". Usar
  // altitude de tabela seria 100 m de incerteza na camada mais baixa.
  assert.equal(gradiente({ temperatura: 15, altura: null }, { temperatura: 5, altura: 1100 }), null);
  assert.equal(gradiente({ temperatura: null, altura: 100 }, { temperatura: 5, altura: 1100 }), null);
  assert.equal(gradiente({ temperatura: 15, altura: 100 }, { temperatura: 5, altura: 100 }), null);
});

// ---------------------------------------------------------------------------
// busca
// ---------------------------------------------------------------------------
function falso({ status = 200, corpo }) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  };
  impl.chamadas = chamadas;
  return impl;
}

function corpoBom({ horas = 24, faltando = [] } = {}) {
  const time = Array.from({ length: horas }, (_, i) =>
    `2026-08-11T${String(i).padStart(2, "0")}:00`);
  const hourly = { time };
  for (const nv of NIVEIS) {
    const cai = (1000 - nv) * 0.0065 * 8;  // qualquer perfil plausível serve
    for (const c of CAMPOS) {
      const chave = `${c}_${nv}hPa`;
      if (faltando.includes(chave)) continue;
      const base = c === "temperature" ? 25 - cai
        : c === "relative_humidity" ? 70
        : c === "wind_speed" ? 5 + (1000 - nv) * 0.02
        : c === "wind_direction" ? 270
        : (1000 - nv) * 11;                 // geopotential_height
      hourly[chave] = time.map(() => +base.toFixed(2));
    }
  }
  return { hourly };
}

await okA("a URL usa hPa com P MAIÚSCULO", async () => {
  // Este é o teste que existe por causa de uma letra. `temperature_1000hpa`
  // não é parâmetro válido; se a API o rejeita, todo valor cai no fallback.
  const f = falso({ corpo: corpoBom() });
  await buscarSondagem(f, { lat: -23, lng: -46 });
  const pedidas = new URL(f.chamadas[0]).searchParams.get("hourly");
  assert.ok(pedidas.includes("temperature_1000hPa"), "não pediu temperature_1000hPa");
  assert.ok(!pedidas.includes("hpa"), "há 'hpa' minúsculo na requisição");
});

await okA("a URL pede todos os níveis e todos os campos, em m/s", async () => {
  const f = falso({ corpo: corpoBom() });
  await buscarSondagem(f, { lat: 0, lng: 0 });
  const u = new URL(f.chamadas[0]);
  const pedidas = u.searchParams.get("hourly").split(",");
  assert.equal(pedidas.length, NIVEIS.length * CAMPOS.length);
  assert.equal(u.searchParams.get("wind_speed_unit"), "ms");
  for (const nv of NIVEIS) assert.ok(pedidas.includes(`geopotential_height_${nv}hPa`));
});

await okA("HTTP ruim vira erro, nunca perfil de reta", async () => {
  await assert.rejects(
    () => buscarSondagem(falso({ status: 500, corpo: {} }), { lat: 0, lng: 0 }),
    (e) => e.code === "NIVEIS_INDISPONIVEIS" && e.status === 502
  );
});

await okA("resposta sem níveis é erro, não perfil vazio com cara de gráfico", async () => {
  await assert.rejects(
    () => buscarSondagem(falso({ corpo: { hourly: { time: [] } } }), { lat: 0, lng: 0 }),
    (e) => e.code === "SEM_NIVEIS"
  );
  // temperatura ausente em TODO nível: eixo vazio com aparência de instrumento
  const semT = corpoBom({ faltando: NIVEIS.map((nv) => `temperature_${nv}hPa`) });
  await assert.rejects(
    () => buscarSondagem(falso({ corpo: semT }), { lat: 0, lng: 0 }),
    (e) => e.code === "PERFIL_VAZIO"
  );
});

await okA("nível sem dado fica NULO — nunca preenchido por lapse rate", async () => {
  const corpo = corpoBom({ faltando: ["temperature_500hPa", "relative_humidity_500hPa"] });
  const s = await buscarSondagem(falso({ corpo }), { lat: 0, lng: 0 });
  const p500 = s.perfil.find((p) => p.pressao === 500);
  assert.equal(p500.temperatura, null, "o buraco de 500 hPa foi preenchido");
  assert.equal(p500.umidade, null);
  assert.equal(p500.orvalho, null, "orvalho derivado de nada");
  assert.ok(p500.altura != null, "a altura, que veio, deveria ter sobrevivido");
  assert.equal(s.ausentes, 1);
  assert.match(s.nota, /não são interpolados/);
});

await okA("as camadas pulam o nível ausente em vez de atravessá-lo", async () => {
  const corpo = corpoBom({ faltando: ["temperature_500hPa"] });
  const s = await buscarSondagem(falso({ corpo }), { lat: 0, lng: 0 });
  assert.ok(!s.camadas.some((c) => c.de === 500 || c.ate === 500),
    "500 hPa entrou numa camada sem ter temperatura");
  const ponte = s.camadas.find((c) => c.de === 600 && c.ate === 400);
  assert.ok(ponte, "faltou a camada 600→400 ligando os níveis que têm dado");
});

await okA("o perfil sai na ordem de baixo para cima, sem nível repetido", async () => {
  const s = await buscarSondagem(falso({ corpo: corpoBom() }), { lat: 0, lng: 0 });
  const ps = s.perfil.map((p) => p.pressao);
  assert.deepEqual(ps, [...ps].sort((a, b) => b - a), "níveis fora de ordem");
  assert.equal(new Set(ps).size, ps.length);
});

await okA("o instante escolhido volta na resposta", async () => {
  // "A sondagem do ponto" sem hora é meia informação: às 00Z e às 12Z a
  // atmosfera é outra.
  const s = await buscarSondagem(falso({ corpo: corpoBom() }),
    { lat: 0, lng: 0, hora: "2026-08-11T06:00:00Z" });
  assert.equal(s.instante, "2026-08-11T06:00Z");
});

await okA("o orvalho vai marcado como derivado, com a fórmula", async () => {
  const s = await buscarSondagem(falso({ corpo: corpoBom() }), { lat: 0, lng: 0 });
  assert.match(s.derivados.orvalho, /Magnus/i);
  assert.match(s.derivados.orvalho, /Alduchov/);
  assert.ok(s.perfil.every((p) => p.orvalho == null || p.orvalho <= p.temperatura + 1e-6));
});

await okA("a fonte é declarada", async () => {
  const s = await buscarSondagem(falso({ corpo: corpoBom() }), { lat: -23, lng: -46 });
  assert.match(s.fonte, /Open-Meteo/);
  assert.match(s.fonte, /pressão/);
  assert.ok(!Number.isNaN(Date.parse(s.obtidoEm)));
});

console.log(`\n  ${n} verificações do perfil vertical\n`);
export default n;
