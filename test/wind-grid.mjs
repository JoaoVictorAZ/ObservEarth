// test/wind-grid.mjs
// -----------------------------------------------------------------------------
// AS TRÊS CONVENÇÕES DE LATITUDE, MEDIDAS.
//
// Por que este teste existe: o vento já esteve "completely wrong" neste
// projeto, e a razão é que a latitude atravessa três sistemas de coordenadas
// escritos em três arquivos diferentes — a grade GRIB2, a textura WebGL e o
// shader — sem nenhum lugar onde eles se conferem.
//
// Um espelhamento de hemisfério não quebra nada. O globo continua bonito, as
// partículas continuam correndo, e o vento da Patagônia é o da Sibéria. Só
// aparece se alguém olhar a tela e reconhecer um padrão que não deveria estar
// ali. É o erro mais caro deste projeto porque é o único que se disfarça de
// funcionamento normal.
//
// O comentário no topo de `windGPU.ts` afirmava que `getWindVector` invertia o
// eixo Y com `1.0 - p.y`. Não inverte — não há inversão nenhuma no
// amostrador. O sentido está certo por outro caminho (a textura guarda a linha
// 0 do campo em v = 0, e o shader também trata v = 0 como norte), mas o
// comentário descrevia um código que não existe. Comentário não é prova.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  latDaLinha, linhaDaLat, vDoTexel, linhaAmostrada, latDoShader, desvioDeLatitude,
} from "../src/windGrid.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nconvenções de latitude do vento");

/** as grades que o projeto realmente serve */
const GRADES = [
  { nome: "GFS 0,25°", ny: 721, S: 2 },
  { nome: "GFS 0,25° sem realce", ny: 721, S: 1 },
  { nome: "1,0°", ny: 181, S: 8 },
  { nome: "2,5° (recuo)", ny: 73, S: 8 },
];

// ---------------------------------------------------------------------------
// a grade
// ---------------------------------------------------------------------------
ok("as linhas extremas caem SOBRE os polos, não meia célula antes", () => {
  // Divisor (ny − 1), não ny. Com 721 linhas de 0,25°, de +90 a −90 há
  // exatamente 720 passos. Usar ny daria 89,875 no topo.
  for (const { ny } of GRADES) {
    assert.equal(latDaLinha(0, ny), 90);
    assert.equal(latDaLinha(ny - 1, ny), -90);
  }
});

ok("a grade desce de norte para sul, como o GFS varre", () => {
  // Se algum dia isto inverter, o hemisfério troca — e é exatamente o defeito
  // que já aconteceu.
  for (const { ny } of GRADES) {
    for (let j = 1; j < ny; j++) {
      assert.ok(latDaLinha(j, ny) < latDaLinha(j - 1, ny), `linha ${j} subiu`);
    }
  }
});

ok("linha e latitude são inversas exatas uma da outra", () => {
  for (const { ny } of GRADES) {
    for (const j of [0, 1, 7, Math.floor(ny / 2), ny - 2, ny - 1]) {
      assert.ok(Math.abs(linhaDaLat(latDaLinha(j, ny), ny) - j) < 1e-9, `linha ${j}`);
    }
  }
});

// ---------------------------------------------------------------------------
// o sentido — o teste que pega espelhamento
// ---------------------------------------------------------------------------
ok("v = 0 é NORTE nos dois lados da cadeia", () => {
  // A textura guarda a linha 0 do campo (90°N) na linha 0, que em WebGL é
  // v = 0. O shader lê lat = (0.5 − p.y)·180, que em p.y = 0 dá +90.
  // Se um dos dois virar, os hemisférios trocam em silêncio.
  assert.equal(latDoShader(0), 90);
  assert.equal(latDoShader(1), -90);
  assert.equal(latDaLinha(0, 721), 90);
});

ok("nenhum ponto da cadeia erra o hemisfério", () => {
  // Um espelhamento apareceria como erro de até 180°. Este limite de 3° o pega
  // em qualquer grade, com folga enorme.
  for (const { nome, ny, S } of GRADES) {
    for (let y = 0; y < ny * S; y++) {
      const d = Math.abs(desvioDeLatitude(y, ny, S));
      assert.ok(d < 3, `${nome}: desvio de ${d.toFixed(3)}° na linha ${y} — cheira a espelhamento`);
    }
  }
});

ok("o sinal da latitude é coerente fora do equador", () => {
  // Um ponto no terço norte tem que ser norte nos dois sistemas.
  for (const { nome, ny, S } of GRADES) {
    const oy = ny * S;
    for (const frac of [0.1, 0.3, 0.7, 0.9]) {
      const y = Math.round(frac * (oy - 1));
      const latShader = latDoShader(vDoTexel(y, oy));
      const latDado = latDaLinha(linhaAmostrada(y, S), ny);
      if (Math.abs(latShader) > 5) {
        assert.equal(Math.sign(latShader), Math.sign(latDado),
          `${nome}: shader diz ${latShader.toFixed(1)}°, dado é ${latDado.toFixed(1)}°`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// o alinhamento — a discordância conhecida, medida e limitada
// ---------------------------------------------------------------------------
ok("a discordância é de MEIA CÉLULA, e nunca mais que isso", () => {
  // Ela existe porque a grade põe as linhas SOBRE os polos e o shader trata a
  // textura como células cujas bordas tocam os polos. Não é bug: é uma
  // convenção que os dois lados assumem de formas diferentes.
  //
  // Fixar o limite aqui é o que impede que ela cresça sem ninguém notar.
  for (const { nome, ny, S } of GRADES) {
    const celula = 180 / (ny - 1);
    let pior = 0;
    for (let y = 0; y < ny * S; y++) pior = Math.max(pior, Math.abs(desvioDeLatitude(y, ny, S)));
    assert.ok(pior <= celula * 0.5 + 1e-6,
      `${nome}: pior desvio ${pior.toFixed(4)}° passa de meia célula (${(celula / 2).toFixed(4)}°)`);
  }
});

ok("na grade que o projeto usa, a discordância é menor que 0,13°", () => {
  // GFS 0,25°: 0,125° é cerca de 14 km na superfície. Abaixo do tamanho de um
  // pixel do globo na maior parte dos zooms — e agora é um número conhecido,
  // não uma suspeita.
  let pior = 0;
  for (let y = 0; y < 721 * 2; y++) pior = Math.max(pior, Math.abs(desvioDeLatitude(y, 721, 2)));
  assert.ok(pior < 0.13, `${pior.toFixed(4)}°`);
});

ok("o realce não introduz desvio próprio", () => {
  // Mudar o fator de realce S não pode mexer no alinhamento: ele só adensa a
  // amostragem, não move a grade.
  const p = (S) => {
    let m = 0;
    for (let y = 0; y < 721 * S; y++) m = Math.max(m, Math.abs(desvioDeLatitude(y, 721, S)));
    return m;
  };
  const [a, b, c] = [p(1), p(2), p(4)];
  assert.ok(Math.abs(a - b) < 0.001 && Math.abs(b - c) < 0.001,
    `S muda o desvio: ${a.toFixed(4)} / ${b.toFixed(4)} / ${c.toFixed(4)}`);
});

ok("o centro do texel, e não a borda, é o que se amostra", () => {
  // Amostrar na borda pega a média de duas linhas do campo e borra o gradiente
  // de latitude inteiro — meio grau de suavização que ninguém pediu.
  assert.equal(vDoTexel(0, 100), 0.005);
  assert.equal(vDoTexel(99, 100), 0.995);
  assert.ok(vDoTexel(0, 100) > 0, "o primeiro texel caiu na borda");
});

ok("com S = 1 o texel é a linha do campo, sem deslocamento", () => {
  for (const y of [0, 1, 50, 720]) assert.equal(linhaAmostrada(y, 1), y);
});

// ---------------------------------------------------------------------------
console.log("\n  grade          célula    pior desvio   fração da célula");
for (const { nome, ny, S } of GRADES) {
  const celula = 180 / (ny - 1);
  let pior = 0;
  for (let y = 0; y < ny * S; y++) pior = Math.max(pior, Math.abs(desvioDeLatitude(y, ny, S)));
  console.log(`  ${nome.padEnd(22)} ${celula.toFixed(3)}°   ${pior.toFixed(4)}°      ${(pior / celula).toFixed(2)}`);
}

console.log(`\n  ${n} verificações das convenções de latitude\n`);
export default n;
