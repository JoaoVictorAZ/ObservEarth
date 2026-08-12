// test/janela.mjs
// -----------------------------------------------------------------------------
// JANELA DE INTERESSE.
//
// "quando dou zoom a qualidade não melhora"
//
// A causa é aritmética e não tem conserto por parâmetro: a textura global tem
// 4096 px sobre 360°, ou seja 11,4 texels por grau, FIXO. Os pixels de tela por
// grau crescem sem limite conforme se aproxima. Já na vista inicial são 0,72
// texel por pixel — a textura JÁ está sendo ampliada.
//
// A saída é buscar só a região visível. O risco disso é o ORÇAMENTO: se cada
// movimento de câmera virasse requisição, arrastar o globo gastaria dezenas de
// chamadas. Por isso a janela é arredondada numa grade, e é ISSO que a maior
// parte deste arquivo verifica.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { NIVEIS, nivelPara, janelaEm, chaveDe, lerBBox, alturaDe } from "../server/janela.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
console.log("\njanela de interesse");

// ---------------------------------------------------------------------------
ok("vista global continua servindo o mundo inteiro", () => {
  // Sem isto, a vista inicial passaria a fazer requisição de janela sem ganho
  // nenhum — o mundo já cabe na textura.
  const j = janelaEm(-15, -48, 140);
  assert.equal(j.mundo, true);
  assert.deepEqual(j.bbox, [-90, -180, 90, 180]);
});

ok("aproximar reduz a janela e sobe o nível", () => {
  const largo = janelaEm(-15, -48, 100);
  const perto = janelaEm(-15, -48, 10);
  assert.ok(perto.nivel > largo.nivel, "o nível não subiu");
  const area = (j) => (j.bbox[2] - j.bbox[0]) * (j.bbox[3] - j.bbox[1]);
  assert.ok(area(perto) < area(largo) / 4, "a janela não encolheu de verdade");
});

// ---------------------------------------------------------------------------
// o arredondamento — é ele que segura o orçamento
// ---------------------------------------------------------------------------
ok("movimento pequeno cai na MESMA janela", () => {
  // O teste central. Sem o arredondamento, cada quadro de arrasto seria uma
  // requisição nova, e o teto do projeto é um quarto do limite gratuito.
  const base = chaveDe(janelaEm(-23.5, -46.6, 20));
  for (const [dLat, dLng] of [[0.1, 0.1], [-0.2, 0.3], [0.4, -0.5], [0.9, 0.9]]) {
    assert.equal(chaveDe(janelaEm(-23.5 + dLat, -46.6 + dLng, 20)), base,
      `mexer ${dLat}/${dLng} gerou janela nova`);
  }
});

ok("arrastar o globo gasta o MÍNIMO de janelas possível", () => {
  // Simula um arrasto de 40° em 200 quadros — o que se faz em segundos.
  //
  // Minha primeira versão arredondava as quatro BORDAS separadamente, e como
  // elas cruzam a grade em momentos diferentes, este mesmo arrasto dava ONZE
  // janelas. Arredondando o CENTRO, o número passa a ser exatamente o que a
  // geometria exige: distância dividida pelo passo, mais um.
  const nivel = janelaEm(-20, -60, 20);
  const chaves = new Set();
  for (let i = 0; i <= 200; i++) chaves.add(chaveDe(janelaEm(-20, -60 + (i * 40) / 200, 20)));

  const minimo = Math.floor(40 / nivel.passo) + 1;
  assert.ok(chaves.size <= minimo + 1,
    `${chaves.size} janelas para um arrasto de 40° com passo ${nivel.passo}; o mínimo é ${minimo}`);
  assert.ok(chaves.size >= 2, "não arredondou tanto a ponto de nunca atualizar");
});

ok("o tamanho da janela é FIXO por nível — o cache depende disso", () => {
  // Duas visitas ao mesmo lugar têm que pedir exatamente o mesmo retângulo.
  const tam = (j) => [(j.bbox[2] - j.bbox[0]).toFixed(3), (j.bbox[3] - j.bbox[1]).toFixed(3)].join("x");
  const a = janelaEm(-23.5, -46.6, 20), b = janelaEm(-23.4, -46.5, 20);
  assert.equal(tam(a), tam(b), "o retângulo mudou de tamanho ao mexer um pouco");
  assert.equal(chaveDe(a), chaveDe(b));
});

ok("mudança REAL de região gera janela nova", () => {
  // O arredondamento não pode ser tão grosso que o mapa nunca melhore.
  const a = chaveDe(janelaEm(-23.5, -46.6, 20));
  const b = chaveDe(janelaEm(35.7, 139.7, 20));
  assert.notEqual(a, b, "Tóquio e São Paulo caíram na mesma janela");
});

// ---------------------------------------------------------------------------
// geometria
// ---------------------------------------------------------------------------
ok("a longitude é alargada por cos(lat)", () => {
  // Um grau de longitude encolhe com a latitude. Sem a correção, uma janela
  // sobre a Escandinávia cobriria uma faixa estreita demais de terreno.
  const eq = janelaEm(0, 0, 20);
  const norte = janelaEm(60, 0, 20);
  const larg = (j) => j.bbox[3] - j.bbox[1];
  assert.ok(larg(norte) > larg(eq), `60°N deu ${larg(norte)}°, equador deu ${larg(eq)}°`);
});

ok("nenhuma janela sai do planeta", () => {
  for (const lat of [-89, -60, 0, 60, 89]) {
    for (const lng of [-179, -90, 0, 90, 179]) {
      for (const g of [80, 40, 20, 10, 5]) {
        const [a, b, c, d] = janelaEm(lat, lng, g).bbox;
        assert.ok(a >= -90 && c <= 90, `lat fora: ${a}..${c}`);
        assert.ok(b >= -180 && d <= 180, `lng fora: ${b}..${d}`);
        assert.ok(c > a && d > b, `janela degenerada em ${lat},${lng}`);
      }
    }
  }
});

ok("perto do polo a janela não colapsa nem estoura", () => {
  // cos(lat) tende a zero: sem o piso, a largura em longitude iria ao infinito.
  const j = janelaEm(88, 20, 10);
  assert.ok(j.bbox[3] - j.bbox[1] <= 360);
  assert.ok(j.bbox[2] > j.bbox[0]);
});

ok("janela larga demais volta para o mundo — o recorte não valeria", () => {
  const j = janelaEm(0, 0, 110);
  assert.ok(j.mundo || j.bbox[3] - j.bbox[1] < 180);
});

// ---------------------------------------------------------------------------
// a imagem pedida
// ---------------------------------------------------------------------------
ok("a altura mantém o pixel quadrado", () => {
  // Pedir sempre largura/2 esticaria qualquer janela que não fosse 2:1 — e a
  // janela quase nunca é.
  // 20° de altura sobre 40° de largura em 2048 px dá 51,2 px por grau; a
  // altura tem que ser 20 x 51,2 = 1024. Eu tinha escrito 2048 aqui — a conta
  // errada estava no TESTE, e ela teria "aprovado" uma imagem esticada 2x.
  assert.equal(alturaDe([-10, -20, 10, 20], 2048), 1024);      // 20 por 40
  assert.equal(alturaDe([0, 0, 10, 10], 2048), 2048);          // quadrada
  assert.equal(alturaDe([-90, -180, 90, 180], 4096), 2048);    // mundo, 2:1
});

ok("a altura tem teto e piso", () => {
  assert.ok(alturaDe([0, 0, 0.06, 60], 2048) >= 64, "achatou até sumir");
  assert.ok(alturaDe([-80, 0, 80, 1], 4096) <= 4096, "estourou o teto");
});

// ---------------------------------------------------------------------------
// entrada da rede
// ---------------------------------------------------------------------------
ok("bbox malformada vira null, e a rota serve o mundo", () => {
  // Devolver null em vez de lançar: uma bbox torta não pode derrubar a camada
  // de imagem inteira.
  for (const ruim of ["", "1,2,3", "a,b,c,d", "10,20,5,30", "10,20,20,10",
                      "-100,0,0,10", "0,0,0.01,0.01", null, undefined, 42]) {
    assert.equal(lerBBox(ruim), null, `aceitou: ${JSON.stringify(ruim)}`);
  }
});

ok("bbox válida passa intacta", () => {
  assert.deepEqual(lerBBox("-30,-50,-10,-30"), [-30, -50, -10, -30]);
  assert.deepEqual(lerBBox("-90,-180,90,180"), [-90, -180, 90, 180]);
});

ok("todo nível declara passo e largura", () => {
  for (const nv of NIVEIS) {
    assert.ok(nv.passo > 0 && nv.largura >= 1024, `nível ${nv.id} incompleto`);
  }
  // Níveis mais próximos têm grade mais fina, senão o zoom "pula".
  for (let i = 1; i < NIVEIS.length; i++) {
    assert.ok(NIVEIS[i].passo < NIVEIS[i - 1].passo, `nível ${i} não afinou a grade`);
  }
  assert.equal(nivelPara(1e9).id, 0);
  assert.equal(nivelPara(NaN).id, 0);
});

console.log(`\n  ${n} verificações da janela de interesse\n`);
export default n;
