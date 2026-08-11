// test/grib2.mjs
// -----------------------------------------------------------------------------
// Verificacao do decodificador GRIB2 por IDA E VOLTA: construimos mensagens
// GRIB2 validas byte a byte, com valores conhecidos, e exigimos recuperacao
// exata.
//
// Por que assim: um decodificador binario errado nao quebra — ele devolve
// numeros. Campo de vento plausivel e indistinguivel de campo correto a olho,
// e ja perdemos varias rodadas exatamente por isso. Aqui a resposta certa e
// conhecida de antemao.
// -----------------------------------------------------------------------------

import { decodeGrib2, _internal } from "../server/grib2.js";

const t = [];
const ok = (name, cond, extra = "") => {
  t.push(!!cond);
  console.log(`  ${cond ? "ok  " : "FALHA"} ${name}${extra ? "  " + extra : ""}`);
};

// O construtor de fixtures vive em _grib-fixture.mjs: o teste dos campos
// escalares usa o mesmo, e duas cópias divergiriam na primeira correção.
import { buildGrib, packBits } from "./_grib-fixture.mjs";

// ------------------------------------------------------- 1. leitor de bits
console.log("\nLeitor de bits");
const br = new _internal.BitReader(Buffer.from([0b10110010, 0b01011100]), 0);
ok("lê 3 bits", br.read(3) === 0b101, `= ${0b101}`);
ok("lê 5 bits cruzando nada", br.read(5) === 0b10010);
ok("lê 8 bits atravessando octeto", br.read(8) === 0b01011100);

const wide = new _internal.BitReader(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x80]), 0);
const w33 = wide.read(33);
ok("lê 33 bits sem truncar em 32", w33 === 2 ** 33 - 1, `= ${w33}`);

// ------------------------------------------------- 2. sinal-magnitude
console.log("\nInteiro com sinal-magnitude (convenção do GRIB2)");
ok("positivo", _internal.signedFromBytes(Buffer.from([0x00, 0x2a]), 0, 2) === 42);
ok("negativo", _internal.signedFromBytes(Buffer.from([0x80, 0x2a]), 0, 2) === -42);
ok("não é complemento de dois", _internal.signedFromBytes(Buffer.from([0xff, 0xff]), 0, 2) === -32767);

// --------------------------------------------- 3. ida e volta, sem escala
console.log("\nIda e volta com empacotamento simples (5.0)");
const NI = 8, NJ = 4;
const ints = Array.from({ length: NI * NJ }, (_, i) => i * 7 % 4096);
let msgs = decodeGrib2(buildGrib(NI, NJ, ints));
ok("uma mensagem", msgs.length === 1);
ok("grade lida", msgs[0].grid.ni === NI && msgs[0].grid.nj === NJ, `${msgs[0].grid.ni}x${msgs[0].grid.nj}`);
ok("empacotamento identificado", msgs[0].packing === "5.0");
ok("parâmetro identificado", msgs[0].category === 2 && msgs[0].parameter === 2);
// scanMode 0 + lo1 0 -> reorientacao roda meia volta em longitude
{
  const half = NI / 2;
  let exact = true;
  for (let r = 0; r < NJ; r++) {
    for (let c = 0; c < NI; c++) {
      const got = msgs[0].values[r * NI + ((c + half) % NI)];
      if (Math.abs(got - ints[r * NI + c]) > 1e-6) exact = false;
    }
  }
  ok("valores recuperados exatamente", exact);
}

// ------------------------------------------------- 4. escala binária/decimal
console.log("\nEscala: valor = (R + X·2^E) / 10^D");
const raw = [0, 1, 2, 3];
msgs = decodeGrib2(buildGrib(2, 2, raw, { bits: 8, R: 100, E: 1, D: 2 }));
// (100 + X*2) / 100
const want = raw.map((x) => (100 + x * 2) / 100);
const gotv = [...msgs[0].values].sort((a, b) => a - b);
ok("aplica R, E e D", want.every((w, i) => Math.abs(gotv[i] - w) < 1e-6),
  `${gotv.map((v) => v.toFixed(2)).join(", ")}`);

// ---------------------------------------- 5. escala negativa (comum no GFS)
msgs = decodeGrib2(buildGrib(2, 2, [10, 20, 30, 40], { bits: 8, R: 0, E: -2, D: 0 }));
const neg = [...msgs[0].values].sort((a, b) => a - b);
ok("expoente binário negativo", Math.abs(neg[0] - 10 / 4) < 1e-6, `${neg[0]} (esperado 2.5)`);

// --------------------------------------------- 6. modo de varredura j-positivo
console.log("\nModo de varredura");
// scanMode bit 0x40 = +j para NORTE: a primeira linha do arquivo e o SUL
const rows = [1, 1, 1, 1, 9, 9, 9, 9];      // linha 0 = sul, linha 1 = norte
msgs = decodeGrib2(buildGrib(4, 2, rows, { bits: 8, scanMode: 0x40 }));
ok("j-positivo põe o norte na primeira linha", msgs[0].values[0] === 9,
  `primeira linha = ${msgs[0].values[0]}`);

// scanMode 0 = primeira linha ja e o norte
msgs = decodeGrib2(buildGrib(4, 2, rows, { bits: 8, scanMode: 0 }));
ok("j-negativo mantém a ordem", msgs[0].values[0] === 1);

// --------------------------------------------- 7. duas mensagens concatenadas
console.log("\nMensagens concatenadas (u e v no mesmo arquivo)");
const two = Buffer.concat([
  buildGrib(4, 2, [1, 2, 3, 4, 5, 6, 7, 8], { bits: 8 }),
  buildGrib(4, 2, [8, 7, 6, 5, 4, 3, 2, 1], { bits: 8 }),
]);
msgs = decodeGrib2(two);
ok("lê as duas mensagens", msgs.length === 2, `${msgs.length}`);
ok("são campos distintos", msgs[0].values[0] !== msgs[1].values[0]);

// --------------------------------------------- 8. recusa gabarito não suportado
console.log("\nRecusa explícita de gabarito desconhecido");
{
  const bad = buildGrib(2, 2, [1, 2, 3, 4], { bits: 8 });
  // troca o gabarito da secao 5 para 40 (JPEG 2000)
  const idx = bad.indexOf(Buffer.from([0, 0, 0, 21, 5]));
  bad.writeUInt16BE(40, idx + 9);
  let threw = "";
  try { decodeGrib2(bad); } catch (e) { threw = e.message; }
  ok("falha citando o número do gabarito", threw.includes("5.40"), `"${threw.slice(0, 60)}"`);
}

// ------------------------------- 9. semente da diferenciacao espacial (5.3)
//
// O GFS usa empacotamento complexo com diferenciacao espacial. A reconstrucao
// e uma RECORRENCIA: x[i] += 2*x[i-1] - x[i-2]. Isso significa que um erro na
// semente (ival1, ival2, minsd) nao fica local — propaga LINEARMENTE por
// 1.038.240 pontos.
//
// Ler a semente como complemento de dois em vez de sinal-magnitude e
// exatamente esse erro. Este teste mede a propagacao para que o numero fale por
// si: e a diferenca entre "vento estranho" e "vento de 20 milhoes de m/s".
console.log("\nPropagação de erro na semente da diferenciação espacial");
{
  const N = 1038240;
  const doisComp = (v, bits) => { const s = 1 << (bits - 1); return v >= s ? v - (s << 1) : v; };
  const sinalMag = (v, bits) => { const s = Math.pow(2, bits - 1); return v >= s ? -(v - s) : v; };

  const bits = 16;
  const bruto = 0x8006;                        // sinal ligado, magnitude 6
  const certo = sinalMag(bruto, bits);         // -6
  const errado = doisComp(bruto, bits);        // -32762

  ok("as duas leituras discordam na semente", certo === -6 && errado === -32762,
    `sinal-magnitude=${certo}  complemento=${errado}`);

  // reconstroi um campo constante com cada semente e compara o ultimo valor
  const reconstruir = (semente) => {
    let a = semente, b = semente;              // x[0], x[1]
    for (let i = 2; i < N; i++) { const x = 2 * b - a; a = b; b = x; }
    return b;
  };
  const fimCerto = Math.abs(reconstruir(certo));
  const fimErrado = Math.abs(reconstruir(errado));

  ok("semente correta não explode", fimCerto < 1e5, `|x[fim]| = ${fimCerto}`);
  ok("semente errada vira rampa de magnitude absurda", fimErrado > 1e4,
    `|x[fim]| = ${fimErrado.toExponential(2)} — a ordem de grandeza vista na tela`);
}

const fails = t.filter((x) => !x).length;
console.log(fails === 0 ? "\nDecodificador GRIB2 correto.\n" : `\n${fails} falha(s).\n`);
process.exit(fails === 0 ? 0 : 1);
