// test/fields.mjs
// -----------------------------------------------------------------------------
// Campos escalares do GFS desenhados como PNG.
//
// Os dois erros que este tipo de codigo comete calado:
//
//   1. ORIENTACAO. Espelhar em latitude produz um mapa perfeitamente plausivel
//      — nuvem, chuva, tudo no lugar certo em relacao a si mesmo — so que o
//      hemisferio errado. Ninguem percebe olhando o oceano. So se percebe
//      quando a chuva do Brasil aparece na China.
//
//   2. PALETA NAO MONOTONA. Se a cor nao cresce com o valor, o mapa fica bonito
//      e ilegivel: duas intensidades diferentes podem sair com a mesma cor, e a
//      legenda deixa de corresponder ao que esta na tela.
//
// Nenhum dos dois gera excecao. Por isso sao verificados numericamente.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { FIELDS, renderFieldPNG, fieldCatalog, legendOf, _internal } from "../server/fields.js";
import { decodePNG } from "../server/png.js";

const { rampColor } = _internal;

let n = 0;
// `await fn()` e nao `fn()`: um teste assincrono cujo retorno nao e aguardado
// vira rejeicao nao tratada e o conjunto passa VERDE com o caso quebrado. Por
// isso toda chamada abaixo usa `await ok(...)`.
const ok = async (name, fn) => { await fn(); n++; console.log(`  ok  ${name}`); };

console.log("\ncampos do GFS");

const NI = 144, NJ = 73;                    // mesma proporção 2:1 do GFS
const latOf = (j) => 90 - j * (180 / (NJ - 1));
const lngOf = (i) => -180 + i * (360 / NI);
const alphaAt = (rgba, j, i) => rgba[(j * NI + i) * 4 + 3];

// Os IDs do catálogo mudam conforme camadas entram e saem (`clouds` virou
// `cloud`, por exemplo). O teste DESCOBRE os campos em vez de fixar nomes:
// caçar renomeação em teste é trabalho perdido, e um teste que quebra por
// renome ensina a ignorá-lo.
const idNuvem = ["cloud", "clouds", "tcdc"].find((k) => FIELDS[k]);
const idChuva = ["precip", "precipitation", "apcp"].find((k) => FIELDS[k]);
assert.ok(idNuvem, `nenhum campo de nuvem em: ${Object.keys(FIELDS).join(", ")}`);
assert.ok(idChuva, `nenhum campo de chuva em: ${Object.keys(FIELDS).join(", ")}`);
const specNuvem = FIELDS[idNuvem];
const specChuva = FIELDS[idChuva];


await ok("catálogo declara unidade e legenda para cada campo", () => {
  const cat = fieldCatalog();
  assert.ok(cat.length >= 2, "esperava nuvem e chuva");
  for (const f of cat) {
    assert.ok(f.unit, `${f.id} sem unidade`);
    assert.ok(f.legend?.length, `${f.id} sem legenda`);
    for (const [cor] of f.legend) assert.match(cor, /^#[0-9a-f]{6}$/i, `cor inválida em ${f.id}`);
  }
});

await ok("cada cor da legenda é a cor que o PNG realmente pinta", () => {
  // Não basta a legenda existir: ela tem de ser a MESMA função que colore o
  // pixel. Aqui pintamos um campo com o valor exato de cada rótulo e conferimos
  // o pixel resultante contra a cor anunciada.
  for (const [id, spec] of Object.entries(FIELDS)) {
    const legenda = legendOf(spec);
    spec.legendAt.forEach(([valor], k) => {
      const vals = new Float32Array(NI * NJ).fill(valor);
      const { rgba } = decodePNG(renderFieldPNG(spec, vals, NI, NJ).png);
      const pintado = "#" + [rgba[0], rgba[1], rgba[2]]
        .map((x) => x.toString(16).padStart(2, "0")).join("");
      assert.equal(pintado, legenda[k][0],
        `${id}: legenda diz ${legenda[k][0]} em ${valor}, o mapa pinta ${pintado}`);
      assert.ok(rgba[3] > 0, `${id}: valor de legenda ${valor} sai invisível`);
    });
  }
});

await ok("a rampa passa exatamente pelas paradas declaradas", () => {
  // A legenda mostra as cores das paradas. Se a interpolação não devolver a
  // cor exata nesses valores, a legenda deixa de corresponder à imagem — e a
  // divergência é pequena o bastante para ninguém notar a olho.
  for (const [id, spec] of Object.entries(FIELDS)) {
    for (const [v, cor] of spec.stops) {
      assert.deepEqual(rampColor(spec.stops, v), cor, `${id}: parada em ${v} não bate`);
    }
    // fora da faixa a rampa satura, nunca extrapola para cor inventada
    assert.deepEqual(rampColor(spec.stops, -999), spec.stops[0][1]);
    assert.deepEqual(rampColor(spec.stops, 1e9), spec.stops[spec.stops.length - 1][1]);
  }
});

await ok("alfa é coerente com a NATUREZA do campo", () => {
  // DUAS FAMÍLIAS DE CAMPO, e a regra é diferente para cada uma.
  //
  // INTENSIDADE (nuvem, chuva): existe "nenhum" e existe "muito". O alfa
  // carrega essa magnitude — é ele que diz "aqui tem mais fenômeno" para quem
  // não consulta a legenda. Precisa crescer sempre.
  //
  // ESCALAR COM SINAL (temperatura): −50 °C é tão real quanto +50 °C. Não há
  // "pouca temperatura". Alfa constante é o correto; fazê-lo crescer com o
  // valor apagaria o frio e sugeriria que lá não há dado.
  //
  // A versão anterior deste teste exigia monotonia de TODOS os campos — foi
  // escrita quando só existiam nuvem e chuva, e reprovou a temperatura por
  // uma regra que não se aplica a ela.
  for (const [id, spec] of Object.entries(FIELDS)) {
    const lo = spec.stops[0][0], hi = spec.stops[spec.stops.length - 1][0];
    const amostras = [];
    for (let k = 0; k <= 60; k++) amostras.push(spec.alpha(lo + ((hi - lo) * k) / 60));

    for (const a of amostras) assert.ok(a >= 0 && a <= 1, `${id}: alfa ${a} fora de [0,1]`);

    const constante = amostras.every((a) => Math.abs(a - amostras[0]) < 1e-9);
    if (constante) {
      assert.ok(amostras[0] > 0.05, `${id}: alfa constante porém invisível (${amostras[0]})`);
      continue;                                  // campo escalar: regra cumprida
    }

    let anterior = -Infinity;
    for (const a of amostras) {
      assert.ok(a >= anterior - 1e-9, `${id}: alfa recuou (${anterior} -> ${a})`);
      anterior = a;
    }
    assert.ok(spec.alpha(hi) > spec.alpha(lo), `${id}: alfa varia mas não distingue fraco de forte`);
  }
});

await ok("cores distintas para valores distintos na faixa útil", () => {
  for (const [id, spec] of Object.entries(FIELDS)) {
    const vistas = new Set();
    const lo = spec.stops[0][0], hi = spec.stops[spec.stops.length - 1][0];
    for (let k = 0; k <= 30; k++) {
      vistas.add(rampColor(spec.stops, lo + ((hi - lo) * k) / 30).join(","));
    }
    assert.ok(vistas.size > 20, `${id}: só ${vistas.size} cores distintas em 31 amostras`);
  }
});

await ok("abaixo do piso o pixel é transparente, não preto", () => {
  // Céu limpo não pode cobrir o globo de cinza, nem "sem chuva" virar mancha.
  const spec = specNuvem;
  const vals = new Float32Array(NI * NJ).fill(0);
  const { rgba } = decodePNG(renderFieldPNG(spec, vals, NI, NJ).png);
  for (let i = 3; i < rgba.length; i += 4) {
    assert.equal(rgba[i], 0, "pixel abaixo do piso deveria ser invisível");
  }
});

await ok("ORIENTAÇÃO: o que está no norte sai no topo", () => {
  // Campo com sinal SÓ no hemisfério norte. Se houver espelhamento, ele
  // aparece embaixo — e nada mais no sistema acusaria isso.
  const spec = specNuvem;
  const vals = new Float32Array(NI * NJ);
  for (let j = 0; j < NJ; j++) {
    for (let i = 0; i < NI; i++) vals[j * NI + i] = latOf(j) > 30 ? 100 : 0;
  }
  const { rgba } = decodePNG(renderFieldPNG(spec, vals, NI, NJ).png);

  assert.ok(alphaAt(rgba, 1, NI >> 1) > 200, "topo da imagem deveria ser o norte, com dado");
  assert.equal(alphaAt(rgba, NJ - 2, NI >> 1), 0, "base da imagem é o sul, deveria estar vazia");
});

await ok("ORIENTAÇÃO: a coluna 0 é o antimeridiano oeste (−180°)", () => {
  const spec = specNuvem;
  const vals = new Float32Array(NI * NJ);
  for (let j = 0; j < NJ; j++) {
    for (let i = 0; i < NI; i++) vals[j * NI + i] = lngOf(i) < -90 ? 100 : 0;
  }
  const { rgba } = decodePNG(renderFieldPNG(spec, vals, NI, NJ).png);
  assert.ok(alphaAt(rgba, NJ >> 1, 1) > 200, "coluna 0 deveria cobrir −180°");
  assert.equal(alphaAt(rgba, NJ >> 1, NI - 2), 0, "última coluna é +180°, sem dado aqui");
});

await ok("valores ausentes (NaN) viram transparente, não zero pintado", () => {
  const spec = specChuva;
  const vals = new Float32Array(NI * NJ).fill(NaN);
  vals[0] = 50;
  const r = renderFieldPNG(spec, vals, NI, NJ);
  const { rgba } = decodePNG(r.png);
  assert.ok(rgba[3] > 0, "o único valor válido deveria aparecer");
  assert.equal(alphaAt(rgba, 10, 10), 0, "NaN não pode virar pixel pintado");
  assert.ok(r.coveredPct < 1, `cobertura deveria ser mínima, veio ${r.coveredPct}%`);
});

await ok("estatísticas descrevem o campo real, não a paleta", () => {
  const spec = specChuva;
  const vals = new Float32Array(NI * NJ);
  for (let k = 0; k < vals.length; k++) vals[k] = k < 100 ? 7.5 : 0;
  const r = renderFieldPNG(spec, vals, NI, NJ);
  assert.equal(r.min, 7.5);
  assert.equal(r.max, 7.5);
  assert.ok(r.coveredPct > 0 && r.coveredPct < 2, `cobertura ${r.coveredPct}%`);
});

await ok("proveniência viaja dentro do PNG", () => {
  const r = renderFieldPNG(specNuvem, new Float32Array(NI * NJ).fill(50), NI, NJ, {
    Source: "NOAA GFS 0.25 · 20260806 18z +006h",
  });
  assert.match(decodePNG(r.png).text.Source, /GFS 0\.25/);
});

await ok("PNG na resolução nativa cabe em banda razoável", () => {
  // 1440x721 RGBA são 4 MB crus. Se o PNG não comprimir, o ganho sobre JSON
  // desaparece e a decisão de servir raster deixa de se justificar.
  const ni = 1440, nj = 721;
  const vals = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    const lat = 90 - j * (180 / (nj - 1));
    for (let i = 0; i < ni; i++) {
      const lng = -180 + i * (360 / ni);
      vals[j * ni + i] = Math.max(0, Math.min(100,
        Math.exp(-(((lat - 4) / 8) ** 2)) * 95 + 8 * Math.sin(lng / 9 + lat / 6)));
    }
  }
  const r = renderFieldPNG(specNuvem, vals, ni, nj);
  const kb = r.png.length / 1024;
  assert.ok(kb < 1200, `PNG grande demais: ${kb.toFixed(0)} kB`);
  console.log(`      (${(ni * nj * 4 / 1048576).toFixed(1)} MB RGBA -> ${kb.toFixed(0)} kB PNG)`);
});

// ---------------------------------------------------------------------------
// INTEGRACAO: caminho completo com o NOMADS simulado.
//
// Os testes acima exercitam a pintura isoladamente. Este cobre o que de fato
// acontece num pedido: escolher o ciclo, montar a URL, receber bytes, decodificar
// GRIB2, achar a mensagem CERTA entre varias, e devolver PNG mais metadados.
// E onde aparecem os erros de ligacao entre modulos, que teste de unidade nao ve.
// ---------------------------------------------------------------------------
const { buildField } = await import("../server/fields.js");
const { buildGrib } = await import("./_grib-fixture.mjs");

const NOW = new Date(Date.UTC(2026, 7, 6, 14, 7));

/** NOMADS falso: devolve um GRIB2 com as mensagens pedidas */
function fakeNomads(mensagens) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(url);
    const partes = mensagens.map(({ category, parameter, valor }) => {
      const vals = new Int32Array(NI * NJ).fill(valor);
      return buildGrib(NI, NJ, vals, { bits: 12, category, parameter });
    });
    return {
      ok: true,
      headers: { get: () => "application/octet-stream" },
      arrayBuffer: async () => Buffer.concat(partes),
    };
  };
  impl.chamadas = chamadas;
  return impl;
}

await ok("caminho completo: NOMADS -> GRIB2 -> PNG + metadados", async () => {
  const impl = fakeNomads([{ category: 6, parameter: 1, valor: 75 }]);
  const { png, meta } = await buildField(impl, idNuvem, "2026-08-06", 12, NOW);

  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(meta.nx, NI);
  assert.equal(meta.unit, "%");
  assert.equal(meta.min, 75, "o valor decodificado não bateu com o que foi empacotado");
  assert.equal(meta.max, 75);
  assert.equal(meta.coveredPct, 100);
  assert.match(meta.dataset, /GFS 0\.25/);
  assert.ok(meta.legend?.length, "metadados sem legenda");

  // a URL tem de pedir a variável e o nível certos
  assert.match(impl.chamadas[0], /var_TCDC=on/);
  assert.match(impl.chamadas[0], /lev_entire_atmosphere=on/);
  assert.match(impl.chamadas[0], /pgrb2\.0p25/);
});

await ok("escolhe a mensagem certa quando vêm várias", () => {
  // O erro clássico: pegar msgs[0]. Aqui a nuvem é a SEGUNDA mensagem, e a
  // primeira é vento — se a seleção for por ordem, o mapa sai com o campo errado
  // e nada acusa, porque um campo de vento também pinta bonito.
  const impl = fakeNomads([
    { category: 2, parameter: 2, valor: 30 },   // vento
    { category: 6, parameter: 1, valor: 90 },   // nuvem
  ]);
  return buildField(impl, idNuvem, "2026-08-06", 12, NOW).then(({ meta }) => {
    assert.equal(meta.min, 90, "pegou a mensagem errada (provavelmente msgs[0])");
  });
});

await ok("parâmetro ausente falha com mensagem útil, não com campo vazio", () => {
  const impl = fakeNomads([{ category: 2, parameter: 2, valor: 10 }]);
  return buildField(impl, idNuvem, "2026-08-06", 12, NOW).then(
    () => { throw new Error("deveria ter falhado"); },
    (e) => {
      assert.match(e.message, /TCDC/);
      assert.match(e.message, /mensage/);
    }
  );
});

await ok("campo desconhecido é recusado antes de tocar a rede", () => {
  const impl = fakeNomads([]);
  return buildField(impl, "inexistente", "2026-08-06", 12, NOW).then(
    () => { throw new Error("deveria ter falhado"); },
    (e) => {
      assert.match(e.message, /campo desconhecido/);
      assert.equal(impl.chamadas.length, 0, "não deveria ter feito requisição");
    }
  );
});

console.log(`\n  ${n} verificações dos campos\n`);
export default n;
