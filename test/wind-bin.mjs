import assert from "node:assert/strict";
import { empacotar, desempacotar, alinhar4, CABECALHO } from "../server/windBin.js";
import { lerGradeBinaria, ehBinario } from "../src/windBin.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/** ArrayBuffer isolado, como o `fetch` entrega — sem o offset do Buffer do Node. */
const paraArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function grade(nx = 8, ny = 5, extra = {}) {
  const n = nx * ny;
  const u = new Float32Array(n), v = new Float32Array(n), valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = (i % 37) - 18.5;
    v[i] = -((i % 23) - 11.5);
    valid[i] = i % 9 === 0 ? 0 : 1;
  }
  return {
    nx, ny, u, v, valid,
    provider: "NOAA GFS 0.25°",
    dataset: "GFS Operacional · GRIB2 nativo",
    stepDeg: 0.25, measuredPct: 100, builtAt: "2026-08-12T12:00:00Z",
    ...extra,
  };
}

console.log("\nida e volta");

ok("todo valor volta identico, bit a bit", () => {
  const g = grade();
  const lido = desempacotar(empacotar(g));
  for (let i = 0; i < g.nx * g.ny; i++) {
    assert.equal(lido.u[i], g.u[i], "u no indice " + i);
    assert.equal(lido.v[i], g.v[i], "v no indice " + i);
    assert.equal(lido.valid[i], g.valid[i], "valid no indice " + i);
  }
});

// A tela LE a procedencia para nao afirmar uma fonte que nao e a que chegou.
// Perde-la no binario seria voltar ao rotulo cravado que ja causou problema.
ok("a procedencia atravessa o binario", () => {
  const lido = desempacotar(empacotar(grade()));
  assert.equal(lido.provider, "NOAA GFS 0.25°");
  assert.equal(lido.dataset, "GFS Operacional · GRIB2 nativo");
  assert.equal(lido.stepDeg, 0.25);
  assert.equal(lido.measuredPct, 100);
});

ok("nx e ny sobrevivem", () => {
  const lido = desempacotar(empacotar(grade(13, 7)));
  assert.equal(lido.nx, 13);
  assert.equal(lido.ny, 7);
});

ok("grade sem `valid` nao inventa um", () => {
  const g = grade(); delete g.valid;
  const lido = desempacotar(empacotar(g));
  assert.equal(lido.valid, undefined, "criou um valid que nao existia");
});

ok("aceita array comum, nao so TypedArray", () => {
  const g = grade();
  const lido = desempacotar(empacotar({ ...g, u: Array.from(g.u), v: Array.from(g.v) }));
  assert.equal(lido.u[5], g.u[5]);
});

console.log("\nservidor e cliente concordam");

// Sao duas implementacoes do mesmo formato, em linguagens diferentes. Divergir
// significaria vento desenhado errado, com aparencia perfeitamente normal.
ok("o cliente le o que o servidor escreveu", () => {
  const g = grade(16, 9);
  const cli = lerGradeBinaria(paraArrayBuffer(empacotar(g)));
  assert.equal(cli.nx, g.nx);
  assert.equal(cli.ny, g.ny);
  assert.equal(cli.provider, g.provider);
  for (let i = 0; i < g.nx * g.ny; i++) {
    assert.equal(cli.u[i], g.u[i], "u " + i);
    assert.equal(cli.v[i], g.v[i], "v " + i);
  }
  assert.ok(cli.valid && cli.valid[0] === g.valid[0]);
});

ok("o cliente entrega Float32Array, nao array comum", () => {
  const cli = lerGradeBinaria(paraArrayBuffer(empacotar(grade())));
  assert.ok(cli.u instanceof Float32Array, "u nao e Float32Array");
  assert.ok(cli.v instanceof Float32Array, "v nao e Float32Array");
});

console.log("\nalinhamento (o detalhe que quebraria so as vezes)");

// `new Float32Array(buffer, off)` lanca RangeError se `off` nao for multiplo
// de 4, e o tamanho do JSON de metadados varia com o nome do provedor. Sem o
// completo, a decodificacao funcionaria em algumas respostas e quebraria em
// outras — o pior tipo de bug.
ok("qualquer tamanho de metadados produz deslocamento multiplo de 4", () => {
  for (let extra = 0; extra < 24; extra++) {
    const g = grade(4, 3, { enchimento: "x".repeat(extra) });
    const buf = empacotar(g);
    const metaLen = buf.readUInt16LE(6);
    assert.equal((CABECALHO + metaLen) % 4, 0, `desalinhado com ${extra} bytes extras`);
    // e, na pratica: decodificar nao pode lancar
    const lido = lerGradeBinaria(paraArrayBuffer(buf));
    assert.equal(lido.u[0], g.u[0], "valor errado com " + extra + " bytes extras");
  }
});

ok("alinhar4 arredonda para cima, nunca para baixo", () => {
  assert.equal(alinhar4(0), 0);
  assert.equal(alinhar4(1), 4);
  assert.equal(alinhar4(4), 4);
  assert.equal(alinhar4(5), 8);
  assert.equal(alinhar4(37), 40);
});

console.log("\nrecusas");

ok("assinatura errada e recusada, nao decodificada como lixo", () => {
  const buf = empacotar(grade());
  buf.writeUInt32LE(0x12345678, 0);
  assert.throws(() => lerGradeBinaria(paraArrayBuffer(buf)), /assinatura/i);
});

ok("versao futura e recusada com o numero na mensagem", () => {
  const buf = empacotar(grade());
  buf.writeUInt16LE(99, 4);
  assert.throws(() => lerGradeBinaria(paraArrayBuffer(buf)), /99/);
});

ok("buffer truncado e recusado", () => {
  const buf = empacotar(grade(16, 9));
  const cortado = paraArrayBuffer(buf).slice(0, buf.byteLength - 40);
  assert.throws(() => lerGradeBinaria(cortado), /truncad/i);
});

ok("grade invalida nao vira buffer sem sentido", () => {
  assert.throws(() => empacotar({ nx: 0, ny: 5, u: [], v: [] }), /inv[áa]lida/i);
  assert.throws(() => empacotar({ nx: 4, ny: 4, u: [1, 2], v: [1, 2] }), /n[ãa]o cobrem/i);
});

ok("ehBinario reconhece sem tentar decodificar", () => {
  assert.equal(ehBinario(paraArrayBuffer(empacotar(grade()))), true);
  assert.equal(ehBinario(new TextEncoder().encode('{"nx":4}').buffer), false);
  assert.equal(ehBinario(new ArrayBuffer(2)), false);
});

console.log("\ntamanho: a razao de tudo isto");

ok("o binario e MUITO menor que o JSON equivalente", () => {
  // VALORES REALISTAS. A primeira versao deste teste usava numeros curtos como
  // -18.5, e por isso media um ganho de so 22%. Um campo do GFS de verdade tem
  // a precisao inteira do float: "-7.2343754768371582" ocupa 19 caracteres em
  // JSON e 4 bytes em binario. Medir com dado limpo demais subestima o ganho.
  const nx = 64, ny = 33, n = nx * ny;
  const u = new Float32Array(n), v = new Float32Array(n);
  for (let i = 0; i < n; i++) { u[i] = Math.sin(i) * 30; v[i] = Math.cos(i * 1.7) * 30; }
  const g = { ...grade(nx, ny), u, v };

  const json = JSON.stringify({ ...g, u: Array.from(u), v: Array.from(v), valid: Array.from(g.valid) });
  const bin = empacotar(g);
  const razao = bin.byteLength / json.length;
  assert.ok(razao < 0.35, `binario e ${(razao * 100).toFixed(0)}% do JSON, esperado abaixo de 35%`);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
