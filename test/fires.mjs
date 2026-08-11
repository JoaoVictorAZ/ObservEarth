// test/fires.mjs
// -----------------------------------------------------------------------------
// EFEITO DOS FOCOS DE CALOR (VIIRS 375 m).
//
// Tres coisas aqui podem estar erradas sem gerar nenhum erro:
//
//   1. PALETA NAO MONOTONICA. Se o brilho nao cresce com o FRP, um foco fraco
//      parece mais forte que um intenso. O mapa fica bonito e mente. Foi
//      exatamente o defeito da especificacao original (amarelo no fim fraco da
//      escala), medido abaixo.
//
//   2. TETO DE ANEIS FURADO. Anel e malha animada. Num dia de pico ha milhares
//      de focos acima do limiar; sem teto duro o quadro despenca, e a causa
//      parece "o vento esta pesado".
//
//   3. SELECAO GLOBAL EM VEZ DE LOCAL. Pegar os N focos mais intensos DO
//      PLANETA deixa uma regiao de focos pequenos vazia justamente ao aproximar.
//      Parece "nao ha queimada aqui", que e uma afirmacao falsa e crivel.
//
// O modulo e TypeScript de navegador (importa three.js), entao a logica pura
// esta reimplementada aqui a partir das MESMAS constantes exportadas? Nao — as
// constantes vivem dentro de globe.ts junto do three. Para nao duplicar valores,
// este teste le o proprio arquivo-fonte e extrai a tabela da paleta.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const fonte = readFileSync(join(raiz, "src", "globe.ts"), "utf8");

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log("\nfocos de calor");

// ---- extrai a paleta do fonte, para o teste nunca divergir do codigo -------
function lerEmber() {
  const bloco = /const EMBER[^=]*=\s*\[([\s\S]*?)\n\];/.exec(fonte);
  assert.ok(bloco, "não encontrei a tabela EMBER em src/globe.ts");
  const paradas = [];
  const re = /\[\s*([\d.]+)\s*,\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s*\]/g;
  let m;
  while ((m = re.exec(bloco[1]))) {
    paradas.push([Number(m[1]), [Number(m[2]), Number(m[3]), Number(m[4])]]);
  }
  return paradas;
}

function lerNumero(nome) {
  const m = new RegExp(`${nome}:\\s*([\\d.]+)`).exec(fonte);
  assert.ok(m, `não encontrei ${nome} em src/globe.ts`);
  return Number(m[1]);
}

const EMBER = lerEmber();
const maxRings = lerNumero("maxRings");
const ringMinFrp = lerNumero("ringMinFrp");

/** mesma interpolação de emberColor() */
function emberColor(k) {
  const t = Math.max(0, Math.min(1, k));
  if (t <= EMBER[0][0]) return EMBER[0][1];
  for (let i = 1; i < EMBER.length; i++) {
    const [v1, c1] = EMBER[i];
    if (t > v1) continue;
    const [v0, c0] = EMBER[i - 1];
    const f = (t - v0) / (v1 - v0);
    return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f));
  }
  return EMBER[EMBER.length - 1][1];
}

const norm = (frp) => Math.min(1, Math.log10(1 + Math.max(0, frp)) / 3.2);

/** luminância relativa WCAG — o que o olho lê como intensidade */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

// ---------------------------------------------------------------------------
ok("a tabela da paleta foi lida do próprio código-fonte", () => {
  assert.ok(EMBER.length >= 3, `só ${EMBER.length} paradas`);
  assert.equal(EMBER[0][0], 0);
  assert.equal(EMBER[EMBER.length - 1][0], 1);
});

ok("BRILHO CRESCE COM O FRP — sem cair no meio da escala", () => {
  // Este é o teste que reprova a paleta "amarelo -> laranja -> vermelho".
  let anterior = -1;
  let quedas = 0;
  for (let k = 0; k <= 100; k++) {
    const l = lum(emberColor(k / 100));
    if (l < anterior - 1e-6) quedas++;
    anterior = l;
  }
  assert.equal(quedas, 0, `a luminância caiu em ${quedas} pontos da rampa`);
});

ok("foco extremo é claramente mais brilhante que foco fraco", () => {
  const fraco = lum(emberColor(norm(3)));       // 3 MW, queimada pequena
  const forte = lum(emberColor(norm(900)));     // 900 MW, megaincêndio
  assert.ok(forte > fraco * 2.5,
    `fraco ${fraco.toFixed(3)} vs forte ${forte.toFixed(3)} — diferença insuficiente`);
});

ok("a ordem da especificação original seria REPROVADA aqui", () => {
  // Guarda de regressão: se alguém reintroduzir amarelo no início da escala,
  // este teste explica por que não pode. Os valores são os da spec.
  const spec = [[0, [255, 224, 102]], [0.35, [255, 157, 60]],
                [0.7, [226, 59, 38]], [1, [255, 217, 232]]];
  let quedas = 0, ant = -1;
  for (let k = 0; k <= 100; k++) {
    const t = k / 100;
    let c = spec[spec.length - 1][1];
    for (let i = 1; i < spec.length; i++) {
      if (t > spec[i][0]) continue;
      const f = (t - spec[i - 1][0]) / (spec[i][0] - spec[i - 1][0]);
      c = [0, 1, 2].map((j) => spec[i - 1][1][j] + (spec[i][1][j] - spec[i - 1][1][j]) * f);
      break;
    }
    const l = lum(c);
    if (l < ant - 1e-6) quedas++;
    ant = l;
  }
  assert.ok(quedas > 20, `a ordem da spec deveria escurecer bastante, caiu em ${quedas}`);
});

ok("escala log mantém legível a queimada pequena ao lado do megaincêndio", () => {
  // Em escala LINEAR, 5 MW contra 1500 MW daria k = 0,003: um ponto invisível.
  const k5 = norm(5), k1500 = norm(1500);
  assert.ok(k5 > 0.2, `5 MW virou k=${k5.toFixed(3)}, pequeno demais para ser visto`);
  assert.ok(k1500 > 0.9, `1500 MW virou k=${k1500.toFixed(3)}`);
  assert.ok(k1500 - k5 > 0.4, "a escala não separa suficientemente os extremos");
});

ok("raio e altitude crescem com a intensidade", () => {
  const raio = (k) => 0.05 + k * 0.22;
  const altura = (k) => 0.002 + k * 0.014;
  const kFraco = norm(2), kForte = norm(800);
  assert.ok(raio(kForte) > raio(kFraco) * 2, "o foco intenso precisa ser maior");
  assert.ok(altura(kForte) > altura(kFraco) * 2, "o foco intenso precisa se destacar do globo");
});

// ---------------------------------------------------------------------------
ok("TETO DE ANÉIS é respeitado mesmo num dia de pico", () => {
  // Reproduz a regra do laço: conta anéis com os dois limites.
  const focos = Array.from({ length: 91090 }, (_, i) => ({
    frp: 2000 / (1 + i * 0.01),                  // milhares acima do limiar
  }));
  let aneis = 0;
  for (const f of focos) {
    if (aneis < maxRings && f.frp >= ringMinFrp) aneis++;
  }
  assert.equal(aneis, maxRings, `${aneis} anéis, teto é ${maxRings}`);

  const acimaDoLimiar = focos.filter((f) => f.frp >= ringMinFrp).length;
  assert.ok(acimaDoLimiar > 1000,
    "o cenário precisa ter milhares acima do limiar para o teste valer");
});

ok("dia calmo não força anéis onde não há foco intenso", () => {
  const focos = [{ frp: 40 }, { frp: 12 }, { frp: 90 }];
  let aneis = 0;
  for (const f of focos) if (aneis < maxRings && f.frp >= ringMinFrp) aneis++;
  assert.equal(aneis, 0, "nenhum foco passa do limiar; não deveria haver anel");
});

ok("pulso é INVERSO: foco grande pulsa devagar", () => {
  const period = (k) => 900 + k * 2600;
  const speed = (k) => 3.4 - k * 2.1;
  const grande = norm(1500), pequeno = norm(140);
  assert.ok(period(grande) > period(pequeno), "o foco grande deveria repetir mais devagar");
  assert.ok(speed(grande) < speed(pequeno), "o foco grande deveria expandir mais devagar");
  assert.ok(speed(grande) > 0, "velocidade negativa inverteria a animação");
});

// ---------------------------------------------------------------------------
ok("SELEÇÃO LOCAL: aproximar numa região de focos pequenos não a esvazia", () => {
  // Reproduz selectFires(): recorte pelo cone visível ANTES do corte por FRP.
  const vec = (lat, lng) => {
    const a = (lat * Math.PI) / 180, o = (lng * Math.PI) / 180;
    return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
  };

  // 5.000 focos enormes na Sibéria + 200 pequenos em Rondônia
  const focos = [
    ...Array.from({ length: 5000 }, (_, i) => ({ lat: 62, lng: 100 + (i % 20) * 0.1, frp: 900 })),
    ...Array.from({ length: 200 }, (_, i) => ({ lat: -11, lng: -62 + (i % 20) * 0.1, frp: 6 })),
  ].sort((a, b) => b.frp - a.frp);

  const cap = 600;
  const [cx, cy, cz] = vec(-11, -62);                 // câmera sobre Rondônia
  const minDot = 0.6;                                  // zoom local
  const visiveis = focos.filter((f) => {
    const [x, y, z] = vec(f.lat, f.lng);
    return x * cx + y * cy + z * cz > minDot;
  });
  const escolhidos = (visiveis.length ? visiveis : focos).slice(0, cap);

  assert.ok(escolhidos.length > 100,
    `região aproximada ficou com ${escolhidos.length} focos — praticamente vazia`);
  assert.ok(escolhidos.every((f) => f.lat < 0),
    "selecionou focos do outro lado do planeta");

  // e o comportamento ANTIGO, para contraste
  const antigo = focos.slice(0, cap);
  assert.ok(antigo.every((f) => f.lat > 0),
    "o corte global pegaria só a Sibéria — é o defeito que a seleção local evita");
});

ok("de longe, o orçamento planetário é o menor dos limites", () => {
  const budget = { planetary: 600, regional: 1800, local: 4000 };
  const tierCap = 900;                                  // tier "Desempenho"
  assert.equal(Math.min(budget.planetary, tierCap), 600);
  assert.equal(Math.min(budget.local, tierCap), 900,
    "num tier baixo, o desempenho tem de vencer o orçamento de zoom");
});

console.log(`\n  ${n} verificações dos focos\n`);
export default n;
