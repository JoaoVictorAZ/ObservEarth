// test/compare.mjs
// -----------------------------------------------------------------------------
// Comparação entre modelos.
//
// A rota anterior chamava UM modelo e derivava os outros: ICON = GFS + 0,4 °C,
// ECMWF = GFS − 0,2 °C. A tela se chamava "GFS vs ECMWF vs ICON".
//
// A dispersão entre modelos é o ÚNICO conteúdo dessa tela — é ela que diz se a
// previsão é confiável. Fixar a diferença em constantes não deixa a tela
// imprecisa: deixa a tela afirmando que os centros meteorológicos do mundo
// concordam a menos de 0,6 °C em todo ponto do planeta, sempre.
//
// Daí os testes centrais aqui serem sobre dispersão: que ela seja MEDIDA, que
// não vire zero quando só um modelo responde, e que nenhuma série saia de
// outra.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { MODELOS, VARIAVEIS, dispersao, compararModelos } from "../server/compare.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const okA = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ncomparação de modelos");

// ---------------------------------------------------------------------------
ok("são três centros distintos, cada um com origem declarada", () => {
  assert.equal(MODELOS.length, 3);
  assert.equal(new Set(MODELOS.map((m) => m.id)).size, 3);
  for (const m of MODELOS) {
    assert.ok(m.sigla && m.centro && m.grade, `${m.id} incompleto`);
  }
});

ok("toda variável comparada tem unidade", () => {
  for (const v of VARIAVEIS) assert.ok(v.unidade && v.rotulo, `${v.id} sem unidade ou rótulo`);
});

// ---------------------------------------------------------------------------
// dispersão
// ---------------------------------------------------------------------------
ok("um único modelo NÃO produz dispersão zero", () => {
  // Zero significaria "concordam perfeitamente" — a conclusão oposta de "só um
  // respondeu". Este é o coração de toda a tela.
  const d = dispersao([21.4, null, null]);
  assert.equal(d.n, 1);
  assert.equal(d.amplitude, null, "um modelo sozinho produziu amplitude " + d.amplitude);
  assert.equal(d.desvio, null);
  assert.equal(d.max, null);
});

ok("nenhum modelo devolve tudo nulo", () => {
  const d = dispersao([null, null, null]);
  assert.equal(d.n, 0);
  for (const k of ["min", "max", "amplitude", "media", "desvio"]) assert.equal(d[k], null);
});

ok("dois modelos já dão amplitude, e ela é a diferença medida", () => {
  const d = dispersao([20, 26, null]);
  assert.equal(d.n, 2);
  assert.equal(d.amplitude, 6);
  assert.equal(d.media, 23);
});

ok("desvio da dispersão é amostral (n−1)", () => {
  const d = dispersao([20, 26]);
  // amostral: sqrt(((−3)² + 3²)/1) = sqrt(18) = 4,24; populacional daria 3
  assert.equal(d.desvio, 4.24, `deu ${d.desvio}`);
});

ok("modelos que concordam dão amplitude zero — e isso É um resultado", () => {
  const d = dispersao([20, 20, 20]);
  assert.equal(d.amplitude, 0);
  assert.equal(d.n, 3, "concordância só vale se os três responderam");
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

/** cada modelo com sua própria série: é isso que a API devolve de verdade */
function corpoBom({ horas = 48, porModelo = null, ausente = [] } = {}) {
  const time = Array.from({ length: horas }, (_, i) =>
    new Date(Date.UTC(2026, 7, 11, i)).toISOString().slice(0, 16));
  const hourly = { time };
  for (const v of VARIAVEIS) {
    for (const m of MODELOS) {
      if (ausente.includes(`${v.id}_${m.id}`)) continue;
      hourly[`${v.id}_${m.id}`] = time.map((_, i) =>
        porModelo ? porModelo(v.id, m.id, i) : 20 + i * 0.1);
    }
  }
  return { hourly };
}

await okA("UMA requisição traz os três modelos", async () => {
  // Restrição do usuário: consumo dentro de um quarto do limite gratuito.
  // Três requisições separadas triplicariam o custo desta tela.
  const f = falso({ corpo: corpoBom() });
  await compararModelos(f, { lat: -23, lng: -46 });
  assert.equal(f.chamadas.length, 1);
  const pedidos = new URL(f.chamadas[0]).searchParams.get("models").split(",");
  assert.deepEqual(pedidos, MODELOS.map((m) => m.id));
});

await okA("cada modelo mantém a SUA série — nenhuma é derivada de outra", async () => {
  // O teste que existe por causa de `icon: baseTemp + 0.4`.
  const valores = { gfs_seamless: 20, icon_seamless: 27.5, ecmwf_ifs025: 23.1 };
  const c = await compararModelos(
    falso({ corpo: corpoBom({ porModelo: (_v, m) => valores[m] }) }),
    { lat: 0, lng: 0 }
  );
  const t = c.serie.temperature_2m;
  assert.equal(t.gfs_seamless[0], 20);
  assert.equal(t.icon_seamless[0], 27.5);
  assert.equal(t.ecmwf_ifs025[0], 23.1);

  const d = c.espalhamento.temperature_2m.porHora[0];
  assert.equal(d.amplitude, 7.5, "a amplitude não é a medida entre os três");
  assert.notEqual(d.amplitude, 0.6, "a amplitude virou a constante da versão antiga");
});

await okA("a dispersão varia com a hora, porque os modelos divergem com a hora", async () => {
  // Divergência crescente com o prazo é o comportamento real de um ensemble;
  // uma constante nunca mostraria isso.
  const c = await compararModelos(
    falso({ corpo: corpoBom({ porModelo: (_v, m, i) => (m === "gfs_seamless" ? 20 : 20 + i * 0.25) }) }),
    { lat: 0, lng: 0 }
  );
  const e = c.espalhamento.temperature_2m;
  assert.equal(e.porHora[0].amplitude, 0);
  assert.ok(e.porHora[40].amplitude > e.porHora[10].amplitude, "a divergência não cresceu");
  assert.ok(e.maiorAmplitude > 0);
  assert.equal(e.quando, c.tempo[c.tempo.length - 1], "o pior desacordo é o do fim do prazo");
});

await okA("modelo que não publica o campo aparece como AUSENTE, não como reta", async () => {
  const c = await compararModelos(
    falso({ corpo: corpoBom({ ausente: ["precipitation_ecmwf_ifs025"] }) }),
    { lat: 0, lng: 0 }
  );
  assert.equal(c.serie.precipitation.ecmwf_ifs025, null, "virou série em vez de ausência");
  assert.deepEqual(c.espalhamento.precipitation.modelos, ["gfs_seamless", "icon_seamless"]);
});

await okA("campo com um só modelo é avisado, não apresentado como consenso", async () => {
  const ausente = MODELOS.slice(1).map((m) => `precipitation_${m.id}`);
  const c = await compararModelos(falso({ corpo: corpoBom({ ausente }) }), { lat: 0, lng: 0 });
  assert.equal(c.espalhamento.precipitation.maiorAmplitude, null);
  assert.equal(c.espalhamento.precipitation.horasComparaveis, 0);
  assert.ok(c.avisos.some((a) => /Precipitação/.test(a) && /só um modelo/.test(a)));
});

await okA("campo que ninguém publica é avisado", async () => {
  const ausente = MODELOS.map((m) => `precipitation_${m.id}`);
  const c = await compararModelos(falso({ corpo: corpoBom({ ausente }) }), { lat: 0, lng: 0 });
  assert.ok(c.avisos.some((a) => /Precipitação/.test(a) && /nenhum modelo/.test(a)));
});

await okA("uma coluna com só nulos conta como ausente", async () => {
  // A API às vezes devolve a chave cheia de null em vez de omiti-la. Uma série
  // toda nula desenharia nada e ainda assim contaria como "modelo presente".
  const corpo = corpoBom();
  corpo.hourly.temperature_2m_icon_seamless = corpo.hourly.time.map(() => null);
  const c = await compararModelos(falso({ corpo }), { lat: 0, lng: 0 });
  assert.equal(c.serie.temperature_2m.icon_seamless, null);
  assert.ok(!c.espalhamento.temperature_2m.modelos.includes("icon_seamless"));
});

await okA("HTTP ruim vira erro", async () => {
  await assert.rejects(
    () => compararModelos(falso({ status: 429, corpo: {} }), { lat: 0, lng: 0 }),
    (e) => e.code === "MODELOS_INDISPONIVEIS" && e.status === 502
  );
  await assert.rejects(
    () => compararModelos(falso({ corpo: { hourly: { time: [] } } }), { lat: 0, lng: 0 }),
    (e) => e.code === "SEM_MODELOS"
  );
});

await okA("o eixo do tempo é marcado como UTC e bate com as séries", async () => {
  const c = await compararModelos(falso({ corpo: corpoBom({ horas: 48 }) }),
    { lat: 0, lng: 0, horas: 24 });
  assert.equal(c.tempo.length, 24, "a janela pedida não foi respeitada");
  assert.ok(c.tempo.every((t) => t.endsWith("Z")), "instante sem fuso declarado");
  for (const v of VARIAVEIS) {
    for (const m of MODELOS) {
      const s = c.serie[v.id][m.id];
      if (s) assert.equal(s.length, c.tempo.length, `${v.id}/${m.id} desalinhado`);
    }
  }
  assert.equal(c.espalhamento.temperature_2m.porHora.length, 24);
});

await okA("a resposta declara fonte e que nada foi derivado", async () => {
  const c = await compararModelos(falso({ corpo: corpoBom() }), { lat: 0, lng: 0 });
  assert.match(c.fonte, /NOAA/);
  assert.match(c.fonte, /DWD/);
  assert.match(c.fonte, /ECMWF/);
  assert.match(c.nota, /Nenhum valor foi derivado de outro/);
});

console.log(`\n  ${n} verificações da comparação de modelos\n`);
export default n;
