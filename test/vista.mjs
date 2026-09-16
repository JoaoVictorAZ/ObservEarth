// test/vista.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/vista.mjs
//
// A serialização da vista é pura, e por isso testável sem navegador, sem WebGL
// e sem rede. O que estes testes protegem é o contrato do ENDEREÇO — e um
// endereço, depois de publicado num documento ou mandado a alguém, não pode
// mudar de significado.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  PADRAO, NOMES, paraHash, deHash, enderecoDe,
} from "../src/vista/estado.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

const VISTA = {
  lat: -22.9068, lng: -43.1729, alt: 0.85,
  dia: "2026-09-15", hora: 18,
  modo: "globo",
  camada: { tipo: "field", id: "temp2m" },
  opacidade: 0.78,
  ligadas: ["vento", "estacoes"],
  sonda: { lat: -3.1019, lng: -60.025 },
};

console.log("\nida e volta");

ok("a vista sobrevive ao ciclo completo", () => {
  const v = deHash(paraHash(VISTA));
  assert.equal(v.lat, VISTA.lat);
  assert.equal(v.lng, VISTA.lng);
  assert.equal(v.alt, VISTA.alt);
  assert.equal(v.dia, VISTA.dia);
  assert.equal(v.hora, VISTA.hora);
  assert.deepEqual(v.camada, VISTA.camada);
  assert.deepEqual(v.ligadas, VISTA.ligadas);
  assert.deepEqual(v.sonda, VISTA.sonda);
});

ok("o modo mapa sobrevive", () => {
  assert.equal(deHash(paraHash({ ...VISTA, modo: "mapa" })).modo, "mapa");
});

ok("o endereço começa com # e não tem espaço", () => {
  const e = enderecoDe(VISTA, "https://exemplo/");
  assert.ok(e.includes("#"));
  assert.ok(!/\s/.test(e));
});

console.log("\nprecisão declarada");

// Quatro casas sao ~11 m. As outras onze casas do float sao precisao falsa, e
// num endereco elas so ocupam espaco.
ok("a coordenada é cortada em 4 casas", () => {
  const h = paraHash({ ...VISTA, lat: -22.90684173648291 });
  assert.ok(h.includes("p=-22.9068,"), h);
});

ok("não sai -0 no lugar de 0", () => {
  const h = paraHash({ ...VISTA, lat: -0.00001, lng: 0 });
  assert.ok(!h.includes("-0,"), h);
});

console.log("\nentrada de fora nunca derruba o app");

// Um endereco chega truncado por cliente de e-mail, colado pela metade, ou
// escrito por uma versao futura. Em todos esses casos o certo e' abrir o app.
for (const [nome, entrada] of [
  ["vazio", ""],
  ["só a cerquilha", "#"],
  ["lixo", "%%%&&&==="],
  ["chave sem valor", "p=&t=&l="],
  ["truncado no meio", "p=-22.9068,-43.17"],
  ["chave desconhecida do futuro", "p=1,2&zz=alguma-coisa-nova&l=vento"],
  ["par sem igual", "pl-43&l=vento"],
]) {
  ok(`não lança: ${nome}`, () => {
    const v = deHash(entrada);
    assert.equal(typeof v.lat, "number");
    assert.ok(Number.isFinite(v.lat) && Number.isFinite(v.lng));
    assert.ok(Array.isArray(v.ligadas));
  });
}

console.log("\nvalor impossível cai para o padrão, não entra");

// Latitude 5000 nao e' uma vista excentrica, e' lixo. Aceitar poe a camera num
// lugar que ninguem consegue explicar depois.
for (const [nome, entrada] of [
  ["latitude fora do planeta", "p=5000,0"],
  ["longitude fora do planeta", "p=0,999"],
  ["altitude negativa", "p=0,0,-4"],
  ["hora 47", "t=2026-09-15,47"],
  ["data que não é data", "t=ontem,10"],
]) {
  ok(`recusa: ${nome}`, () => {
    const v = deHash(entrada);
    assert.ok(v.lat >= -90 && v.lat <= 90);
    assert.ok(v.lng >= -180 && v.lng <= 180);
    assert.ok(v.alt > 0);
    assert.ok(v.hora >= 0 && v.hora <= 23);
  });
}

ok("camada com tipo inventado é ignorada", () => {
  assert.equal(deHash("c=magica:algo").camada, null);
});

ok("nome de camada que não existe é descartado, os válidos ficam", () => {
  assert.deepEqual(deHash("l=vento.inventada.estacoes").ligadas, ["vento", "estacoes"]);
});

console.log("\nas camadas vão inteiras, e por quê");

// Escrever so' a DIFERENCA em relacao ao padrao daria um endereco mais curto e
// um link que muda de significado quando o padrao do app mudar. Um instrumento
// de verificacao nao pode depender da versao que o abre.
ok("mesmo as camadas padrão aparecem no endereço", () => {
  const h = paraHash({ ...PADRAO, ligadas: ["vento", "sismos", "ar"] });
  assert.ok(h.includes("l=vento.sismos.ar"), h);
});

ok("`l=` vazio significa TODAS desligadas, e não 'use o padrão'", () => {
  assert.deepEqual(deHash("l=").ligadas, []);
});

ok("sem `l` nenhum, aí sim vale o padrão", () => {
  assert.deepEqual(deHash("p=0,0").ligadas, PADRAO.ligadas);
});

console.log("\no que o endereço NÃO carrega");

// O link diz ONDE olhar, nao O QUE FOI ENCONTRADO. Guardar a temperatura faria
// um endereco de ontem mostrar o tempo de ontem com cara de agora.
ok("a sonda é coordenada, nunca valor medido", () => {
  const h = paraHash({
    ...VISTA,
    sonda: { lat: -3.1019, lng: -60.025, temperatura: 31.4, source: "GFS" },
  });
  assert.ok(h.includes("s=-3.1019,-60.025"), h);
  assert.ok(!h.includes("31.4"), "vazou o valor medido para o endereço");
  assert.ok(!/GFS/.test(h), "vazou a procedência para o endereço");
});

ok("todos os nomes de camada são curtos e sem caractere de escape", () => {
  for (const nome of NOMES) {
    assert.ok(/^[a-z]+$/.test(nome), `${nome} precisaria de escape na URL`);
  }
});

console.log(`\n  ${n} verificacoes\n`);
