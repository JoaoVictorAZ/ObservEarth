// test/gibs-time.mjs
// -----------------------------------------------------------------------------
// AS STRINGS AQUI SAO REAIS.
//
// Foram lidas do GetCapabilities do GIBS em 06/08/2026. Nao sao inventadas para
// o teste passar — sao exatamente o que quebrou as camadas MERRA-2, incluindo
// os buracos no meio da serie, que um exemplo fabricado nao teria.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  parseDuration, parseTimeDimension, snapTime, coverageOf, parseCapabilities,
} from "../server/gibsTime.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ndimensão temporal do GIBS");

// --- capturado da rede, verbatim -------------------------------------------
const MERRA_TEMP = "1980-01-01/2023-11-01/P1M,2024-02-01/2024-04-01/P1M,2024-06-01/2026-03-01/P1M";
const MERRA_TEMP_DEF = "2026-03-01";
const MODIS_NDVI = "2013-05-09/2018-06-03/P1D,2018-06-12/2018-06-19/P1D,2023-06-04/2025-01-08/P1D,2026-05-11/2026-06-04/P1D";
const SIMPLES = "2000-01-01/2026-01-01/P1M";

ok("duração ISO 8601 separa meses de milissegundos", () => {
  assert.deepEqual(parseDuration("P1M"), { months: 1, ms: 0 });
  assert.deepEqual(parseDuration("P1D"), { months: 0, ms: 86400e3 });
  assert.deepEqual(parseDuration("P8D"), { months: 0, ms: 8 * 86400e3 });
  assert.deepEqual(parseDuration("P1Y"), { months: 12, ms: 0 });
  assert.deepEqual(parseDuration("PT3H"), { months: 0, ms: 3 * 3600e3 });
  assert.equal(parseDuration("lixo"), null);
});

ok("lê as três faixas da MERRA-2, com os buracos", () => {
  const d = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  assert.equal(d.ranges.length, 3);
  assert.equal(d.first.toISOString().slice(0, 10), "1980-01-01");
  assert.equal(d.last.toISOString().slice(0, 10), "2026-03-01");
  assert.equal(d.clock, false);
});

// --- O CASO QUE QUEBROU ----------------------------------------------------
ok("HOJE (06/08/2026) devolve 2026-03-01, não uma data inválida", () => {
  const d = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  const r = snapTime(d, "2026-08-06");
  assert.equal(r.time, "2026-03-01", "deveria cair no instante mais recente que existe");
  assert.equal(r.exact, false, "a interface precisa saber que não é a data pedida");
  assert.equal(r.reason, "after");

  // o comportamento antigo, para registro: ontem, sem checar nada
  const antigo = "2026-08-05";
  assert.notEqual(antigo, r.time, "era exatamente isto que o GIBS recusava");
});

ok("nunca devolve dia diferente do 1º numa série mensal", () => {
  const d = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  for (const pedido of [
    "2020-03-17", "2021-12-31", "2022-01-01", "2010-06-15", "2026-02-28", "2025-07-09",
  ]) {
    const r = snapTime(d, pedido);
    assert.equal(r.time.slice(8), "01", `${pedido} -> ${r.time} não é 1º do mês`);
    assert.ok(r.time <= pedido, `${pedido} -> ${r.time} avançou no tempo`);
  }
});

ok("recua para o passado, nunca para o futuro", () => {
  const d = parseTimeDimension(SIMPLES);
  for (const pedido of ["2015-03-20", "2020-11-30", "2001-01-02"]) {
    const r = snapTime(d, pedido);
    assert.ok(r.time <= pedido, `${pedido} -> ${r.time} mostraria dado posterior ao pedido`);
  }
});

ok("buraco na série recua para o fim da faixa anterior", () => {
  const d = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  // nada entre 2023-11-01 e 2024-02-01
  const r = snapTime(d, "2023-12-20");
  assert.equal(r.time, "2023-11-01");
  assert.equal(r.reason, "gap");
  assert.equal(r.exact, false);
});

ok("data anterior a toda a série cai no primeiro instante", () => {
  const d = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  const r = snapTime(d, "1975-06-01");
  assert.equal(r.time, "1980-01-01");
  assert.equal(r.reason, "before");
});

ok("acerto exato é sinalizado como exato", () => {
  const d = parseTimeDimension(SIMPLES);
  const r = snapTime(d, "2015-04-01");
  assert.equal(r.time, "2015-04-01");
  assert.equal(r.exact, true);
});

ok("série diária com buracos (NDVI) cai em dia válido", () => {
  const d = parseTimeDimension(MODIS_NDVI);
  const r1 = snapTime(d, "2024-03-15");
  assert.equal(r1.time, "2024-03-15", "dentro de faixa diária, o próprio dia serve");

  const r2 = snapTime(d, "2018-06-08");     // buraco entre 06-03 e 06-12
  assert.equal(r2.time, "2018-06-03");
  assert.equal(r2.reason, "gap");

  const r3 = snapTime(d, "2026-08-06");     // hoje, depois do fim
  assert.equal(r3.time, "2026-06-04");
});

ok("aritmética de mês não escorrega em fim de mês", () => {
  // 31/01 + 1 mês tem de dar 28/02 ou 29/02, nunca 02/03 ou 03/03
  const d = parseTimeDimension("2020-01-31/2020-12-31/P1M");
  const r = snapTime(d, "2020-04-15");
  assert.ok(r.time.startsWith("2020-03-31") || r.time.startsWith("2020-04-"),
    `escorregou: ${r.time}`);
  // e ao longo de 45 anos a série mensal não pode derivar
  const longa = parseTimeDimension("1980-01-01/2026-03-01/P1M");
  assert.equal(snapTime(longa, "2025-06-15").time, "2025-06-01");
});

ok("resumo de cobertura é legível sem interpretar ISO", () => {
  const c = coverageOf(parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF));
  assert.equal(c.first, "1980-01-01");
  assert.equal(c.last, "2026-03-01");
  assert.equal(c.cadence, "mensal");
  assert.equal(c.gaps, 2);
  assert.equal(coverageOf(parseTimeDimension(MODIS_NDVI)).cadence, "diário");
  assert.equal(coverageOf(parseTimeDimension("2000-01-01/2020-01-01/P8D")).cadence, "8 dias");
});

ok("parser de capabilities não confunde grupo com camada", () => {
  // estrutura real: <Layer> de grupo, sem Dimension, envolvendo a de dado
  const xml = `
    <Layer>
      <Name>Temperature</Name>
      <Title>Temperature</Title>
      <Layer queryable="0" opaque="0" cascaded="0">
        <Name>MERRA2_2m_Air_Temperature_Monthly</Name>
        <Title>MERRA2_2m_Air_Temperature_Monthly</Title>
        <CRS>EPSG:4326</CRS>
        <Dimension name="time" units="ISO8601" default="2026-03-01" nearestValue="0">${MERRA_TEMP}</Dimension>
      </Layer>
    </Layer>`;
  const cat = parseCapabilities(xml);
  assert.ok(!cat.has("Temperature"), "grupo não tem dado próprio e não deve entrar");
  const e = cat.get("MERRA2_2m_Air_Temperature_Monthly");
  assert.ok(e, "camada de dado não foi encontrada");
  assert.equal(e.dim.ranges.length, 3);
  assert.equal(snapTime(e.dim, "2026-08-06").time, "2026-03-01");
});

// ---------------------------------------------------------------------------
// VERIFICACAO INDEPENDENTE.
//
// Os testes acima conferem casos escolhidos a mao, e casos escolhidos a mao
// tendem a confirmar o raciocinio de quem escreveu o codigo. Aqui o conjunto de
// instantes validos e ENUMERADO por outro caminho — laco ingenuo, sem usar a
// funcao de passo — e checamos que a saida pertence a ele. Se `stepDown` tiver
// um erro de logica, esta checagem discorda dela.
// ---------------------------------------------------------------------------
function enumerar(raw, limite = 5000) {
  const dim = parseTimeDimension(raw);
  const set = new Set();
  for (const r of dim.ranges) {
    let at = new Date(r.start.getTime());
    let guard = 0;
    while (at <= r.end && guard++ < limite) {
      set.add(at.toISOString().slice(0, 10));
      if (!r.period) break;
      if (r.period.months) {
        const d = new Date(at.getTime());
        const dia = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + r.period.months);
        const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(dia, ultimo));
        at = d;
      } else {
        at = new Date(at.getTime() + r.period.ms);
      }
    }
  }
  return set;
}

ok("a saída pertence ao conjunto enumerado independentemente", () => {
  for (const raw of [MERRA_TEMP, SIMPLES, MODIS_NDVI, "2000-01-01/2020-01-01/P8D"]) {
    const dim = parseTimeDimension(raw);
    const validos = enumerar(raw);
    assert.ok(validos.size > 0, "enumeração vazia");

    // varre 4 anos de pedidos, um a cada 11 dias (número primo: evita cair
    // sempre no mesmo dia da semana ou do mês e mascarar um erro de fase)
    let checados = 0;
    for (let t = Date.UTC(2022, 0, 1); t < Date.UTC(2026, 7, 6); t += 11 * 86400e3) {
      const pedido = new Date(t).toISOString().slice(0, 10);
      const r = snapTime(dim, pedido);
      if (!r) continue;
      assert.ok(
        validos.has(r.time),
        `${raw.slice(0, 30)}… : pedido ${pedido} -> ${r.time}, que NÃO está na série`
      );
      assert.ok(r.time <= pedido, `${pedido} -> ${r.time} avançou no tempo`);
      checados++;
    }
    assert.ok(checados > 100, `só ${checados} pedidos checados`);
  }
});

ok("nenhuma data do último ano produz pedido inválido para a MERRA-2", () => {
  // A regressão específica: qualquer dia de 2025-2026 tem de sair como um
  // instante que existe. Antes, TODOS saíam como "ontem" e nenhum existia.
  const dim = parseTimeDimension(MERRA_TEMP, MERRA_TEMP_DEF);
  const validos = enumerar(MERRA_TEMP);
  let n = 0;
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2026, 7, 6); t += 86400e3) {
    const pedido = new Date(t).toISOString().slice(0, 10);
    const r = snapTime(dim, pedido);
    assert.ok(validos.has(r.time), `${pedido} -> ${r.time} inválido`);
    n++;
  }
  assert.ok(n > 500, `varredura curta demais: ${n} dias`);
});

console.log(`\n  ${n} verificações da dimensão temporal\n`);
export default n;
