// test/wind-escala.mjs
// -----------------------------------------------------------------------------
// TETO DE ARMAZENAMENTO x REFERÊNCIA DE COR.
//
// Uma constante fazia os dois trabalhos: `SPEED_MAX = 40` era ao mesmo tempo o
// clamp da textura e o denominador da rampa.
//
// A consequência foi medida no campo real do GFS de 29/07/2026, cujo máximo é
// 67,8 m/s — um ciclone tropical de categoria 4 ou 5. Com o teto em 40, o
// NÚCLEO DELE ERA CORTADO na entrada: 67,8 virava 40, o gradiente da parede do
// olho sumia, e sobrava um platô chapado. Exatamente o fenômeno que alguém abre
// este mapa para ver, aplainado antes de chegar à tela.
//
// Separar as duas é o conserto. O que este teste fixa é que elas continuem
// separadas, e que o teto seja de PLAUSIBILIDADE FÍSICA — não de estética.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nescala de velocidade do vento");

const fonte = readFileSync(new URL("../src/windGPU.ts", import.meta.url), "utf8");
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = (-?[\\d.]+);`, "m").exec(fonte);
  assert.ok(m, `constante ${nome} não encontrada`);
  return Number(m[1]);
};
const TETO_FISICO = constante("TETO_FISICO");
const REF_COR = constante("REF_COR");

/** meia-precisão IEEE 754, que é como a textura guarda cada componente */
function meiaPrecisao(v) {
  const f = new Float32Array([v]);
  const i = new Uint32Array(f.buffer)[0];
  const s = (i >> 16) & 0x8000;
  const e = ((i >> 23) & 0xff) - 112;
  const m = i & 0x7fffff;
  const bits = e <= 0 ? s : e >= 31 ? s | 0x7c00 : s | (e << 10) | (m >> 13);
  const sg = bits & 0x8000 ? -1 : 1, ex = (bits >> 10) & 0x1f, ma = bits & 0x3ff;
  return ex === 0 ? sg * Math.pow(2, -14) * (ma / 1024) : sg * Math.pow(2, ex - 15) * (1 + ma / 1024);
}

// ---------------------------------------------------------------------------
ok("armazenamento e cor são constantes SEPARADAS", () => {
  assert.notEqual(TETO_FISICO, REF_COR,
    "voltaram a ser o mesmo número — o teto de cor decepa o dado de novo");
  assert.ok(TETO_FISICO > REF_COR, "o teto de armazenamento tem que ser o maior dos dois");
});

ok("nenhuma referência a SPEED_MAX sobrou no código", () => {
  const codigo = fonte.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  assert.ok(!codigo.some((l) => /\bSPEED_MAX\b/.test(l)),
    "SPEED_MAX ainda é usado fora de comentário");
});

ok("um ciclone categoria 5 cabe no armazenamento sem ser cortado", () => {
  // 67,8 m/s é o máximo real do campo do GFS de 29/07/2026. 70 m/s é o piso da
  // categoria 5 na escala Saffir-Simpson (vento sustentado).
  for (const ms of [67.8, 70, 80, 95]) {
    assert.ok(ms < TETO_FISICO, `${ms} m/s seria cortado num teto de ${TETO_FISICO}`);
  }
});

ok("o teto é de plausibilidade física, não de gosto", () => {
  // Vento de 10 m acima de ~120 m/s não existe na Terra. O teto tem que ficar
  // acima do máximo observável e abaixo do absurdo, para continuar servindo de
  // alarme de desempacotamento quebrado.
  assert.ok(TETO_FISICO >= 100, `teto de ${TETO_FISICO} corta ciclone extremo`);
  assert.ok(TETO_FISICO <= 200, `teto de ${TETO_FISICO} não detecta mais nada`);
});

ok("lixo de desempacotamento continua sendo pego pelo teto", () => {
  // O incidente real: 21.933.153 m/s. O clamp transformava isso num campo
  // constante, que a tela mostrava como listras diagonais convincentes.
  for (const lixo of [1e5, 21933153, Number.MAX_SAFE_INTEGER]) {
    assert.ok(lixo > TETO_FISICO, "o teto deixaria passar lixo");
  }
});

ok("a referência de cor é força de tempestade, não vento de furacão", () => {
  // A referência estava em 40 m/s, e isso escondia exatamente o que o mapa
  // existe para mostrar: um ciclone subtropical na costa do Sudeste tem 20 a
  // 25 m/s e caía em (25/40)^0,6 = 0,76 — verde-claro, indistinguível do vento
  // comum de 12 m/s, que dá 0,64.
  //
  // Em 26 m/s (10 Bft, força de tempestade) a separação aparece:
  //   12 m/s -> 0,66   vento comum
  //   25 m/s -> 0,98   quase branco
  const t = (ms) => Math.pow(Math.min(1, ms / REF_COR), 0.6);
  assert.ok(REF_COR >= 20 && REF_COR <= 30, `referência de ${REF_COR} m/s`);
  assert.ok(t(25) > 0.95, `25 m/s cai em ${t(25).toFixed(2)} — ciclone não se destaca`);
  assert.ok(t(25) - t(12) > 0.28, `separação de só ${(t(25) - t(12)).toFixed(2)} entre 12 e 25 m/s`);
  assert.ok(t(REF_COR) === 1, "a rampa não fecha na referência");
  assert.ok(t(TETO_FISICO) === 1, "acima da referência tem que continuar branco, sem estourar");
});

ok("a meia-precisão guarda o pico do ciclone sem perda que importe", () => {
  // A textura é HalfFloat: 10 bits de mantissa. Perto de 68 m/s a resolução é
  // de 0,05 m/s — irrelevante para vento, mas vale medir em vez de supor.
  for (const ms of [6.15, 25, 40, 67.8, 119.9]) {
    const erro = Math.abs(meiaPrecisao(ms) - ms);
    assert.ok(erro < 0.1, `${ms} m/s guarda com erro de ${erro.toFixed(3)}`);
  }
});

ok("o pico bruto é registrado antes de qualquer corte", () => {
  // É o número que distingue "ciclone categoria 5" (68 m/s) de "GRIB quebrado"
  // (2 x 10^7 m/s). Dentro do clamp, os dois viravam o mesmo valor.
  assert.match(fonte, /lastPeakMs/, "o pico bruto não é guardado");
  assert.match(fonte, /picoBruto\s*=\s*0/, "o acumulador do pico sumiu");
});

console.log(`\n  teto de armazenamento: ±${TETO_FISICO} m/s   referência de cor: ${REF_COR} m/s`);
console.log(`  ${n} verificações da escala de velocidade\n`);
export default n;
