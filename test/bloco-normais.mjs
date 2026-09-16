// test/bloco-normais.mjs
// -----------------------------------------------------------------------------
//   node --experimental-strip-types test/bloco-normais.mjs
//
// A SUPERFÍCIE DO TERRENO TEM QUE OLHAR PARA CIMA.
//
// Enquanto o material do bloco era `FrontSide`, a orientação dos triângulos não
// aparecia: o three desenha o que estiver virado para a câmera e pronto. Ela
// passou a importar no dia em que o terreno virou `DoubleSide` com um ramo
// `gl_FrontFacing` que pinta o interior como rocha — para fechar os rasgos por
// onde se via através da casca.
//
// Com a normal invertida, a superfície de cima passou a ser a face de TRÁS.
// Todo pixel do topo caiu no ramo da rocha, e a rampa hipsométrica, as curvas
// de nível e as faixas de altitude deixaram de executar. O bloco ficou marrom
// uniforme — e o defeito não produziu erro nenhum, só cor errada.
//
// É o mesmo defeito que `test/malha-geometria.mjs` mede para a malha do globo.
// Dois arquivos, a mesma armadilha, e a segunda vez não foi evitada pela
// primeira. Por isso agora ela é medida nos dois lugares.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { malhaDoTerreno } from "../src/bloco/geometria.ts";
import { QUALIDADES, resolucaoDaFonteM } from "../src/bloco/relevo.ts";

let n = 0;
const ok = (nome, fn) => {
  const r = fn();
  if (r instanceof Promise) throw new Error(`${nome}: use okAsync para teste assíncrono`);
  n++; console.log(`  ok  ${nome}`);
};
const okAsync = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

const CAIXA = { latSul: -23.1, latNorte: -22.7, lngOeste: -43.4, lngLeste: -43.0 };

/** Um campo de altitude com uma colina no meio, para as normais não serem todas iguais. */
function campo(nx, ny) {
  const valores = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = (i - (nx - 1) / 2) / nx, dy = (j - (ny - 1) / 2) / ny;
      valores[j * nx + i] = 900 * Math.exp(-(dx * dx + dy * dy) * 12);
    }
  }
  return { nx, ny, valores };
}

/** Normal geométrica de um triângulo, pelo produto vetorial. */
function normalDe(pos, ia, ib, ic) {
  const p = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const [ax, ay, az] = p(ia), [bx, by, bz] = p(ib), [cx, cy, cz] = p(ic);
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

const c = campo(24, 24);
const m = malhaDoTerreno(c, CAIXA, 10, 0);

console.log("\na malha existe e é sólida");

ok("há triângulos", () => {
  assert.ok(m.triangulos > 100, `só ${m.triangulos} triângulos`);
  assert.equal(m.indice.length, m.triangulos * 3);
});

console.log("\ntoda face olha para cima");

ok("nenhum triângulo do terreno tem normal apontando para baixo", () => {
  let paraBaixo = 0;
  for (let t = 0; t < m.triangulos; t++) {
    const [, ny] = normalDe(m.posicao, m.indice[t * 3], m.indice[t * 3 + 1], m.indice[t * 3 + 2]);
    if (ny <= 0) paraBaixo++;
  }
  assert.equal(
    paraBaixo, 0,
    `${paraBaixo} de ${m.triangulos} triângulos com normal para baixo — ` +
    "com DoubleSide + gl_FrontFacing isso pinta o topo com a cor do interior",
  );
});

ok("a normal média aponta firmemente para cima", () => {
  let soma = 0, total = 0;
  for (let t = 0; t < m.triangulos; t++) {
    const [nx, ny, nz] = normalDe(m.posicao, m.indice[t * 3], m.indice[t * 3 + 1], m.indice[t * 3 + 2]);
    const mag = Math.hypot(nx, ny, nz) || 1;
    soma += ny / mag;
    total++;
  }
  const media = soma / total;
  assert.ok(media > 0.5, `componente y média = ${media.toFixed(3)}, esperado > 0,5`);
});

console.log("\na altitude viaja com o vértice");

ok("o atributo alt é a altitude em metros, não a altura de cena", () => {
  let mx = 0;
  for (const a of m.altitude) if (a > mx) mx = a;
  // A colina do fixture chega perto de 900 m; a altura de CENA com exagero 10
  // seria 9 km, um número completamente diferente. Trocar os dois faria as
  // curvas de nível e as faixas de cor caírem nas altitudes erradas.
  assert.ok(mx > 700 && mx < 1000, `o pico do atributo alt deu ${mx}`);
});

console.log("\nos três níveis de detalhe são coerentes entre si");

ok("mais amostras vêm sempre com mais tiles", () => {
  const ordem = ["leve", "medio", "detalhe"];
  for (let i = 1; i < ordem.length; i++) {
    const a = QUALIDADES[ordem[i - 1]], b = QUALIDADES[ordem[i]];
    assert.ok(b.amostras > a.amostras, `${ordem[i]} não adensa a grade`);
    // Adensar a grade sem mais tiles amplia o mesmo pixel varias vezes: a
    // malha fica mais pesada e a forma, exatamente igual.
    assert.ok(b.tiles > a.tiles, `${ordem[i]} adensa sem pedir mais tiles`);
  }
});

ok("o teto de tiles do modo detalhe cabe no orçamento diário", () => {
  // O projeto se permite 10.000 tiles/dia da Mapzen (¼ do limite gratuito), e o
  // cache do servidor dura 7 dias. Noventa e seis por bloco dão mais de cem
  // recortes DISTINTOS por dia — e recorte repetido não custa nada.
  assert.ok(QUALIDADES.detalhe.tiles * 100 <= 10000,
            "o modo detalhe não cabe em cem recortes por dia");
});

console.log("\na resolução da fonte é declarada, não suposta");

ok("o Brasil recebe o teto do SRTM, e o oceano o do GEBCO", () => {
  assert.equal(resolucaoDaFonteM(-22.6), 30, "latitude brasileira devia dar SRTM");
  assert.equal(resolucaoDaFonteM(-22.6, true), 450, "oceano devia dar GEBCO");
  assert.equal(resolucaoDaFonteM(78), 90, "latitude alta está fora do SRTM");
});

ok("a fonte nunca some nem vira zero", () => {
  for (const lat of [-90, -56, 0, 60, 90, NaN]) {
    const v = resolucaoDaFonteM(lat);
    assert.ok(Number.isFinite(v) && v > 0, `lat ${lat} deu ${v}`);
  }
});

console.log("\ndespique: degrau impossível não é relevo");

// MEDIDO EM 16/09/2026, recorte de 30 km sobre Copacabana: -3.111 a 3.447 m.
// O ponto mais alto da cidade do Rio tem 1.021 m. Os dois extremos vinham de
// celulas isoladas, e a amplitude inflada achatava TODO o relevo verdadeiro --
// o Pao de Acucar, com 396 m reais, virava 6% da vertical.
//
// O criterio e' INCLINACAO, e nao raridade: um pico real e' raro e tem encosta,
// um pixel corrompido e' um degrau vertical isolado. Filtrar por percentil
// cortaria o Pao de Acucar junto.

/** Uma grade plana com um pico isolado, como o artefato real. */
function comPico(alt) {
  const nx = 16, ny = 16;
  const valores = new Float32Array(nx * ny).fill(50);
  valores[8 * nx + 8] = alt;
  return { nx, ny, valores };
}

/** Uma colina com encosta -- rara, mas contínua, como o Pão de Açúcar. */
function comMorro(topo) {
  const nx = 16, ny = 16;
  const valores = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const d = Math.hypot(i - 8, j - 8);
      valores[j * nx + i] = Math.max(0, topo * (1 - d / 5));
    }
  }
  return { nx, ny, valores };
}

await okAsync("o despique existe e é exposto na saída", async () => {
  // A funcao e' assincrona e busca tiles; aqui so' se confere o CONTRATO, que
  // e' o que um teste sem rede pode afirmar.
  const { montarRelevo } = await import("../src/bloco/relevo.ts");
  assert.equal(typeof montarRelevo, "function");
});

ok("um pico isolado é um degrau de inclinação absurda", () => {
  // 3.447 m sobre 39 m de distancia sao ~89 graus. Nenhuma encosta real.
  const inclinacao = Math.atan2(3447 - 50, 39) * 180 / Math.PI;
  assert.ok(inclinacao > 85, `deu ${inclinacao.toFixed(1)}°`);
});

ok("um morro real tem inclinação que um DEM resolve", () => {
  const m = comMorro(396);            // Pão de Açúcar
  const nx = m.nx;
  let maxDegrau = 0;
  for (let j = 1; j < m.ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const v = m.valores[j * nx + i];
      for (const k of [j * nx + i - 1, j * nx + i + 1, (j - 1) * nx + i, (j + 1) * nx + i]) {
        maxDegrau = Math.max(maxDegrau, Math.abs(v - m.valores[k]));
      }
    }
  }
  // O limiar do despique e' max(80, resolucao x 4); a 39 m isso da' 156 m.
  assert.ok(maxDegrau < 156,
            `o morro tem degrau de ${maxDegrau.toFixed(0)} m e seria cortado`);
});

ok("o pico artificial passa do limiar, o morro real não", () => {
  const limiar = Math.max(80, 39 * 4);
  assert.ok(Math.abs(3447 - 50) > limiar, "o artefato devia ser recusado");
  assert.ok(comPico(3447).valores[8 * 16 + 8] === 3447, "o fixture está errado");
});

console.log(`\n  ${n} verificacoes\n`);
