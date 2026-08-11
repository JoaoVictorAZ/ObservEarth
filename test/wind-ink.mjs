// test/wind-ink.mjs
// -----------------------------------------------------------------------------
// "há trechos que têm vento calmo mas, como ficam esticados, parece que tem um
//  furacão de outro mundo acontecendo ali"
//
// Este teste é essa frase escrita como aritmética.
//
// O rastro acumula: cada quadro a textura é multiplicada por `fade` e as
// partículas pintam por cima. Uma partícula parada repinta o MESMO texel todo
// quadro e satura; uma rápida deixa uma passada em cada texel e segue. Com
// opacidade constante, o brilho fica INVERSAMENTE proporcional à velocidade —
// e o mapa passa a gritar exatamente onde não venta.
//
// O que se verifica aqui é a inversão. Não a beleza, que eu não tenho como
// medir daqui, mas a ORDEM: mais vento nunca pode render menos tinta.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  TINTA_PISO, TINTA_GANHO, FADE_PADRAO, tintaPorQuadro, brilhoDeRegime, texelsPorQuadro,
} from "../src/windInk.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nmodelo de tinta do rastro");

const FADE = FADE_PADRAO;
const SPEED_MAX = 40;
/** velocidade normalizada LINEAR — a que a tinta usa */
const lin = (ms) => Math.min(1, ms / SPEED_MAX);

/** o que havia antes: piso alto e decaimento longo */
const brilhoAntigo = (ms) => {
  const perceptual = Math.pow(lin(ms), 0.6);
  const a = 0.24 + perceptual * 0.50;
  const n2 = Math.max(1, 1 / Math.max(1e-9, texelsPorQuadro(ms)));
  return Math.min(1, (a * (1 - Math.pow(0.985, n2))) / (1 - 0.985));
};
const quadrosAteApagar = (b, fade) => (b <= 0 ? 0 : Math.log(0.02 / b) / Math.log(fade));

// ---------------------------------------------------------------------------
// o defeito, demonstrado numericamente
// ---------------------------------------------------------------------------
ok("ANTES: calmaria e vendaval eram a MESMA marca", () => {
  // Este é o número que fecha o caso. Não "parecidos": iguais, saturados em
  // 1,000 os dois, durando 259 quadros os dois.
  const calmo = brilhoAntigo(2), forte = brilhoAntigo(25);
  assert.ok(calmo >= 0.999, `2 m/s dava ${calmo.toFixed(3)}`);
  assert.ok(forte >= 0.999, `25 m/s dava ${forte.toFixed(3)}`);
  const qc = quadrosAteApagar(calmo, 0.985);
  assert.ok(qc > 250, `e o rastro durava ${qc.toFixed(0)} quadros`);
});

ok("AGORA nada satura, em nenhuma velocidade", () => {
  // Saturar é o que estica: um texel no teto leva 259 quadros para apagar,
  // contra ~140 de um que não saturou. O risco sólido e comprido vinha daí.
  for (let ms = 0; ms <= 40; ms += 0.25) {
    const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), FADE);
    assert.ok(b < 0.999, `${ms} m/s satura em ${b.toFixed(4)}`);
  }
});

ok("a densidade do traço é UNIFORME — é isso que faz parecer escoamento", () => {
  // Com tinta proporcional à distância, brilho e velocidade se cancelam. Não é
  // limitação: é a física do corante numa água corrente. Quem carrega
  // velocidade é a cor e o comprimento.
  const bs = [];
  for (let ms = 1; ms <= 40; ms += 0.25) bs.push(brilhoDeRegime(lin(ms), texelsPorQuadro(ms), FADE));
  const mn = Math.min(...bs), mx = Math.max(...bs);
  assert.ok(mx / mn < 1.35, `variação de ${(mx / mn).toFixed(2)}x no brilho do traço`);
  assert.ok(mn > 0.25 && mx < 0.85, `faixa [${mn.toFixed(3)}, ${mx.toFixed(3)}] fora do visível confortável`);
});

ok("a calmaria fica MAIS FRACA que o resto, nunca mais forte", () => {
  // A inversão era o defeito. Basta que a ordem nunca se inverta na ponta.
  const calmo = brilhoDeRegime(lin(1), texelsPorQuadro(1), FADE);
  for (const ms of [5, 10, 20, 30, 40]) {
    const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), FADE);
    assert.ok(b >= calmo - 1e-9, `1 m/s (${calmo.toFixed(3)}) supera ${ms} m/s (${b.toFixed(3)})`);
  }
});

ok("o COMPRIMENTO do traço é o que cresce com o vento", () => {
  // distância = velocidade x tempo de decaimento. Se isto não crescer, a
  // velocidade não está codificada em lugar nenhum do desenho.
  const grau = (ms) => {
    const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), FADE);
    return ms * 0.12 * (quadrosAteApagar(b, FADE) / 60);
  };
  let ant = -1;
  for (const ms of [1, 2, 5, 10, 20, 30, 40]) {
    const g = grau(ms);
    assert.ok(g > ant, `${ms} m/s traça ${g.toFixed(2)}° e o anterior traçou ${ant.toFixed(2)}°`);
    ant = g;
  }
  assert.ok(grau(25) / grau(2) > 8, "vendaval e brisa traçam comprimentos parecidos demais");
});

ok("o rastro encurtou: menos de 2,6 s contra 4,3 s", () => {
  // Quatro segundos de história acumulada é o que vira cabelo comprido. O
  // traço precisa seguir a curvatura do escoamento, não somar minutos.
  const b = brilhoDeRegime(lin(10), texelsPorQuadro(10), FADE);
  const seg = quadrosAteApagar(b, FADE) / 60;
  assert.ok(seg < 2.6, `${seg.toFixed(2)}s`);
  assert.ok(seg > 1.2, `${seg.toFixed(2)}s — curto demais, o traço vira ponto`);
});

// ---------------------------------------------------------------------------
// robustez
// ---------------------------------------------------------------------------
ok("nada satura em nenhum decaimento que a interface permite", () => {
  // `fade` é ajustável por setWindTrail. A correção não pode valer só no
  // default em que ela foi calibrada.
  for (const f of [0.95, 0.96, 0.975, 0.985]) {
    for (let ms = 0; ms <= 40; ms += 0.5) {
      const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), f);
      assert.ok(b < 0.999, `fade ${f}: ${ms} m/s satura`);
    }
  }
});

ok("nada satura no degrau de desempenho (decaimento a cada 2 quadros)", () => {
  // fadeEvery = 2 equivale a um decaimento efetivo de raiz de fade: dura o
  // dobro e acumula o dobro. Era onde o borrão era pior.
  for (let ms = 0; ms <= 40; ms += 0.5) {
    const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), Math.sqrt(FADE));
    assert.ok(b < 0.999, `fadeEvery=2: ${ms} m/s satura em ${b.toFixed(4)}`);
  }
});

ok("nada satura em latitude alta, onde o cosseno amplia o passo", () => {
  for (const lat of [0, 45, 70, 85]) {
    for (let ms = 0; ms <= 40; ms += 1) {
      const b = brilhoDeRegime(lin(ms), texelsPorQuadro(ms, { lat }), FADE);
      assert.ok(b < 0.999, `lat ${lat}°: ${ms} m/s satura`);
    }
  }
});

ok("a tinta por quadro é monotônica e limitada", () => {
  assert.equal(tintaPorQuadro(0), TINTA_PISO);
  assert.ok(Math.abs(tintaPorQuadro(1) - (TINTA_PISO + TINTA_GANHO)) < 1e-9);
  assert.equal(tintaPorQuadro(-3), TINTA_PISO, "negativo devia ser preso no piso");
  assert.equal(tintaPorQuadro(9), TINTA_PISO + TINTA_GANHO, "passou do teto");
});

ok("o piso é pequeno o bastante para não encorpar, e não é zero", () => {
  // Zero apagaria a calmaria por completo, e região de convergência é
  // informação. O 0,24 anterior era 24x maior e saturava em três quadros.
  assert.ok(TINTA_PISO > 0);
  assert.ok(TINTA_PISO * (1 / (1 - FADE)) < 0.6,
    `o piso sozinho acumula até ${(TINTA_PISO / (1 - FADE)).toFixed(2)}`);
  assert.ok(TINTA_PISO < 0.24 / 10, `piso de ${TINTA_PISO} ainda é da ordem do que borrava`);
});

// ---------------------------------------------------------------------------
console.log("\n  m/s    ANTES: brilho / duração      AGORA: brilho / duração / traço");
for (const ms of [1, 2, 5, 10, 20, 25, 40]) {
  const a = brilhoAntigo(ms), qa = quadrosAteApagar(a, 0.985) / 60;
  const d = brilhoDeRegime(lin(ms), texelsPorQuadro(ms), FADE), qd = quadrosAteApagar(d, FADE) / 60;
  console.log(
    `  ${String(ms).padStart(3)}    ${a.toFixed(3)}  ${qa.toFixed(2)}s   ` +
    `${"█".repeat(Math.round(a * 12)).padEnd(12)}   ` +
    `${d.toFixed(3)}  ${qd.toFixed(2)}s  ${(ms * 0.12 * qd).toFixed(1)}°  ` +
    `${"█".repeat(Math.round(d * 12))}`
  );
}

console.log(`\n  ${n} verificações do modelo de tinta\n`);
export default n;
