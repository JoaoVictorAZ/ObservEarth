// test/arquivo.mjs
// -----------------------------------------------------------------------------
// ESCOLHA DE ARQUIVO, RAJADA E CLASSIFICAÇÃO.
//
// O relato: "o Rio teve no dia 29/07 ventos de 100 km/h e o modal mostra
// 14 km/h. Se pessoas confiassem em nós, estaríamos colocando a vida delas em
// perigo com dados falsos."
//
// A aritmética do caso, que é o que este arquivo trava:
//
//   14 km/h = 3,9 m/s   -> vento SUSTENTADO, média horária, célula ERA5 25 km
//   100 km/h            -> RAJADA, medida numa estação
//
// Sobre terra o fator de rajada é 1,5 a 2,0. Então 100 km/h de rajada equivale
// a uns 50-65 km/h sustentados NA ESTAÇÃO — e uma célula de 25 km que promedia
// baía, Serra do Mar e cidade não tem como conter isso.
//
// Três defeitos distintos, e só o primeiro é "valor errado":
//   1. a sonda nunca pediu rajada
//   2. data passada ia para o ERA5, que a própria fonte declara ser para
//      tendência climática e não para fidelidade a evento
//   3. o rótulo não dizia que o número era média de modelo numa célula grande
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  escolherFonte, caminhoDe, VARIAVEIS, beaufort, avisoDeVento, INICIO_ALTA_RES,
} from "../server/arquivo.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nescolha de arquivo e leitura de vento");

const HOJE = new Date("2026-08-12T12:00:00Z");

// ---------------------------------------------------------------------------
// a rajada — o defeito central
// ---------------------------------------------------------------------------
ok("a sonda PEDE rajada", () => {
  // Sem `wind_gusts_10m`, comparar a tela com o noticiário dá sempre um fator
  // de 1,5 a 2 de diferença, e parece erro de unidade quando não é.
  assert.ok(VARIAVEIS.includes("wind_gusts_10m"), "rajada não está sendo pedida");
  assert.ok(VARIAVEIS.includes("wind_speed_10m"), "vento sustentado sumiu");
});

// ---------------------------------------------------------------------------
// a fonte — o erro de escolha
// ---------------------------------------------------------------------------
ok("29/07/2026 vai para o arquivo de PREVISÃO, não para o ERA5", () => {
  // Este é o caso do relato. O ERA5 é a ferramenta de tendência climática; usar
  // ele para responder sobre uma frente que passou é a fonte errada.
  const f = escolherFonte("2026-07-29", HOJE);
  assert.equal(f.host, "historical-forecast-api.open-meteo.com", `foi para ${f.host}`);
  assert.equal(f.modo, "arquivo-previsao");
  assert.equal(caminhoDe(f), "/v1/forecast");
});

ok("o arquivo de previsão é 4x mais fino em área que o ERA5", () => {
  const evento = escolherFonte("2026-07-29", HOJE);
  const clima = escolherFonte("2015-07-29", HOJE);
  assert.equal(evento.resolucaoKm, 11);
  assert.equal(clima.resolucaoKm, 25);
  const razaoArea = (clima.resolucaoKm / evento.resolucaoKm) ** 2;
  assert.ok(razaoArea > 4, `só ${razaoArea.toFixed(1)}x`);
});

ok("hoje e futuro usam previsão operacional", () => {
  for (const d of ["2026-08-12", "2026-08-15"]) {
    const f = escolherFonte(d, HOJE);
    assert.equal(f.host, "api.open-meteo.com");
    assert.equal(f.modo, "previsao");
  }
});

ok("antes de 2021 só existe reanálise — e ela AVISA que é reanálise", () => {
  const f = escolherFonte("1998-03-10", HOJE);
  assert.equal(f.modo, "reanalise");
  assert.equal(caminhoDe(f), "/v1/archive");
  assert.match(f.nota, /consistência de longo prazo/);
  assert.match(f.nota, /suavizad/);
});

ok("a borda de cobertura não cai no vazio", () => {
  const antes = escolherFonte(new Date(INICIO_ALTA_RES - 2 * 86400e3).toISOString().slice(0, 10), HOJE);
  const depois = escolherFonte(new Date(INICIO_ALTA_RES + 2 * 86400e3).toISOString().slice(0, 10), HOJE);
  assert.equal(antes.modo, "reanalise");
  assert.equal(depois.modo, "arquivo-previsao");
});

ok("toda fonte se identifica com rótulo e resolução", () => {
  for (const d of ["2026-08-12", "2026-07-29", "2015-01-01"]) {
    const f = escolherFonte(d, HOJE);
    assert.ok(f.rotulo && f.nota, `${d} sem rótulo ou nota`);
    assert.ok(Number.isFinite(f.resolucaoKm), `${d} sem resolução declarada`);
  }
});

ok("data inválida não quebra a rota", () => {
  const f = escolherFonte("nao-e-data", HOJE);
  assert.ok(f.host && f.modo);
});

// ---------------------------------------------------------------------------
// classificação — dar significado ao número
// ---------------------------------------------------------------------------
ok("14 km/h é classificado como brisa, não como evento", () => {
  // 14 km/h = 3,9 m/s. Se a tela tivesse dito "brisa fraca" ao lado do número,
  // a distância entre ele e uma notícia de 100 km/h teria ficado evidente.
  const b = beaufort(14 / 3.6);
  assert.equal(b.grau, 3);
  assert.equal(b.nome, "brisa fraca");
});

ok("100 km/h cai na faixa de tempestade", () => {
  const b = beaufort(100 / 3.6);   // 27,8 m/s
  assert.ok(b.grau >= 10, `grau ${b.grau} para 100 km/h`);
});

ok("a escala é monotônica e cobre até furacão", () => {
  let ant = -1;
  for (let ms = 0; ms <= 60; ms += 0.5) {
    const b = beaufort(ms);
    assert.ok(b.grau >= ant, `caiu de ${ant} para ${b.grau} em ${ms} m/s`);
    ant = b.grau;
  }
  assert.equal(beaufort(40).grau, 12);
  assert.equal(beaufort(40).nome, "furacão");
});

ok("os limiares são os da escala Beaufort", () => {
  assert.equal(beaufort(0.1).grau, 0);      // calmaria
  assert.equal(beaufort(2).grau, 2);        // brisa leve
  assert.equal(beaufort(14).grau, 7);       // vento forte
  assert.equal(beaufort(25).grau, 10);      // tempestade
});

ok("ausência não vira calmaria", () => {
  // "0 Bft, calmaria" para um dado faltando seria uma afirmação de que não
  // venta — exatamente o tipo de coisa perigosa neste aplicativo.
  assert.equal(beaufort(null), null);
  assert.equal(beaufort(NaN), null);
  assert.equal(beaufort(-1), null);
});

// ---------------------------------------------------------------------------
// o aviso — o defeito que sobrevive às duas correções
// ---------------------------------------------------------------------------
ok("todo valor de vento vem com o aviso do que ele NÃO representa", () => {
  // Nem trocar a fonte nem adicionar a rajada resolve isto: nenhum modelo
  // global resolve microexplosão, canalização urbana ou efeito de relevo.
  for (const d of ["2026-08-12", "2026-07-29", "2010-01-01"]) {
    const aviso = avisoDeVento(escolherFonte(d, HOJE));
    assert.match(aviso, /MODELO, não de estação/);
    assert.match(aviso, /km/);
    assert.match(aviso, /microexplos/i);
    assert.match(aviso, /serviço nacional|estação meteorológica/);
  }
});

ok("o aviso diz a resolução real daquela fonte", () => {
  assert.match(avisoDeVento(escolherFonte("2026-07-29", HOJE)), /~11 km/);
  assert.match(avisoDeVento(escolherFonte("2010-01-01", HOJE)), /~25 km/);
});

console.log(`\n  ${n} verificações da escolha de arquivo\n`);
export default n;
