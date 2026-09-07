// test/fronteiras.mjs
// -----------------------------------------------------------------------------
// FRONTEIRAS: SIMPLIFICAR, RECORTAR, EMPACOTAR.
// -----------------------------------------------------------------------------
// A camada anterior tinha dois defeitos, e os dois eram estruturais.
//
// O PRIMEIRO era de geometria. O cliente mandava POLÍGONOS para o three-globe
// com o preenchimento e as laterais pintados de transparente — o motor
// triangulava e extrudava 470 feições, 1.132 anéis e 44.652 vértices, para que
// se visse apenas o contorno delas. Cada triângulo gerado era invisível por
// construção.
//
// O SEGUNDO era de detalhe. A fonte de países era a de 110m (escala
// 1:110.000.000, feita para ver o planeta numa página), e sobre ela ainda se
// aplicava Douglas-Peucker com tolerância FIXA de 0,05° — 5,5 km. Aproximar
// não melhorava nada: a mesma linha grosseira era esticada, e uma península de
// 20 km simplesmente não existia no dado.
//
// A correção é uma pirâmide: fonte e tolerância acompanham o nível, como já
// acontece com a imagem de satélite. E aí aparece um risco novo, que é o que
// mais ocupa este arquivo:
//
//     SIMPLIFICAR DEPOIS DE RECORTAR ABRE FENDA ENTRE TILES VIZINHOS.
//
// Cada tile decidiria sozinho quais vértices manter, e dois tiles adjacentes
// tomariam decisões diferentes para a MESMA linha. O resultado é um risco no
// litoral, na emenda — o tipo de defeito que ninguém associa a um algoritmo de
// simplificação.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  planoDoNivel, simplificar, recortar,
  empacotarFronteiras, desempacotarFronteiras, CABECALHO,
  COSTA, PAIS, ESTADO,
} from "../server/fronteiras.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

console.log("\nnível: fonte e tolerância acompanham o zoom");

ok("a fonte fica mais fina conforme se aproxima", () => {
  assert.equal(planoDoNivel(0).res, "110m", "planeta inteiro");
  assert.equal(planoDoNivel(2).res, "110m");
  assert.equal(planoDoNivel(3).res, "50m");
  assert.equal(planoDoNivel(5).res, "10m");
  assert.equal(planoDoNivel(7).res, "10m", "o mais fino disponível");
});

ok("a tolerância CAI a cada nível, e nunca sobe", () => {
  // Era fixa em 0,05°. É esse número imóvel que fazia o litoral continuar
  // cortado em retas por mais que se aproximasse.
  let anterior = Infinity;
  for (let z = 0; z <= 7; z++) {
    const t = planoDoNivel(z).tol;
    assert.ok(t < anterior, `nível ${z}: tolerância ${t} não caiu de ${anterior}`);
    anterior = t;
  }
  // No nível mais fino a tolerância é de ~150 m — abaixo do que a fonte de 10m
  // realmente resolve, então nada de útil é descartado.
  assert.ok(planoDoNivel(7).tol * 111320 < 200, "tolerância grossa demais no zoom fechado");
});

ok("a tolerância é MEIO PIXEL do tile, e não um número escolhido", () => {
  // Um tile do nível z cobre 360/2^(z+1) graus em 512 px. Vértices mais
  // próximos que meio pixel caem no mesmo pixel: removê-los é de graça, e
  // guardar mais é pagar banda por nada.
  for (const z of [0, 3, 5, 7]) {
    const grausPorPixel = 360 / (2 ** (z + 1) * 512);
    perto(planoDoNivel(z).tol, grausPorPixel * 0.5, 1e-12, `nível ${z}`);
  }
});

ok("estados só entram quando há zoom para justificá-los", () => {
  // Com o planeta na tela, as divisões internas viram uma malha cinza que
  // esconde a costa — que é a feição que orienta.
  assert.equal(planoDoNivel(0).estados, false);
  assert.equal(planoDoNivel(2).estados, false);
  assert.equal(planoDoNivel(3).estados, true);
  assert.equal(planoDoNivel(7).estados, true);
});

ok("nível fora de faixa é preso, não estoura", () => {
  assert.equal(planoDoNivel(-3).res, "110m");
  assert.equal(planoDoNivel(99).res, "10m");
  assert.ok(Number.isFinite(planoDoNivel(NaN).tol));
});

console.log("\nsimplificação de polilinha");

ok("uma reta vira dois pontos", () => {
  const reta = Array.from({ length: 50 }, (_, i) => [i * 0.1, i * 0.2]);
  const s = simplificar(reta, 0.01);
  assert.equal(s.length, 2, `${s.length} pontos numa reta`);
  assert.deepEqual(s[0], reta[0]);
  assert.deepEqual(s[1], reta[reta.length - 1]);
});

ok("OS EXTREMOS SÃO PONTOS REAIS e nunca somem", () => {
  // A versão de anéis de `server/geo.js` pode fundir extremos porque um anel
  // fecha em si mesmo. Uma polilinha aberta não: o começo da costa e o fim
  // dela são lugares.
  const linha = [[0, 0], [1, 5], [2, -5], [3, 0], [4, 8]];
  for (const tol of [0.001, 0.5, 5, 100]) {
    const s = simplificar(linha, tol);
    assert.deepEqual(s[0], [0, 0], `tol ${tol}: perdeu o começo`);
    assert.deepEqual(s[s.length - 1], [4, 8], `tol ${tol}: perdeu o fim`);
  }
});

ok("um desvio MAIOR que a tolerância sobrevive; um menor, não", () => {
  const comDesvio = [[0, 0], [1, 0.5], [2, 0]];
  assert.equal(simplificar(comDesvio, 0.1).length, 3, "o desvio de 0,5 devia sobreviver");
  assert.equal(simplificar(comDesvio, 1.0).length, 2, "o desvio de 0,5 devia ser descartado");
});

ok("tolerância zero preserva tudo", () => {
  const linha = Array.from({ length: 20 }, (_, i) => [i, Math.sin(i)]);
  assert.equal(simplificar(linha, 0).length, 20);
});

ok("litoral fractal NÃO estoura a pilha", () => {
  // A recursão ingênua morre em costa de fiorde: são dezenas de milhares de
  // vértices e a profundidade acompanha. A versão iterativa não tem esse teto.
  const n = 60000;
  const costa = Array.from({ length: n }, (_, i) => [
    i * 0.001,
    Math.sin(i * 0.7) * 0.4 + Math.sin(i * 0.013) * 3,
  ]);
  const s = simplificar(costa, 0.01);
  assert.ok(s.length > 2 && s.length < n, `${s.length} de ${n} pontos`);
});

ok("simplificar mais agressivo devolve menos pontos, monotonicamente", () => {
  const costa = Array.from({ length: 500 }, (_, i) => [i * 0.05, Math.sin(i * 0.2) * 2]);
  let anterior = Infinity;
  for (const tol of [0.001, 0.01, 0.1, 1, 5]) {
    const k = simplificar(costa, tol).length;
    assert.ok(k <= anterior, `tol ${tol} devolveu ${k}, mais que ${anterior}`);
    anterior = k;
  }
});

console.log("\nrecorte por caixa");

const linhaEm = (classe, pontos) => {
  let o = Infinity, l = -Infinity, s = Infinity, n2 = -Infinity;
  for (const [x, y] of pontos) {
    if (x < o) o = x; if (x > l) l = x;
    if (y < s) s = y; if (y > n2) n2 = y;
  }
  return { classe, pontos, bbox: [o, s, l, n2] };
};

ok("linha totalmente fora não entra", () => {
  const linhas = [linhaEm(COSTA, [[100, 40], [110, 45]])];
  assert.equal(recortar(linhas, [-10, -10, 10, 10]).length, 0);
});

ok("linha totalmente dentro entra inteira", () => {
  const p = [[-5, -5], [0, 0], [5, 5]];
  const r = recortar([linhaEm(PAIS, p)], [-10, -10, 10, 10]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].pontos, p, "a linha foi mexida sem necessidade");
  assert.equal(r[0].classe, PAIS, "a classe se perdeu no recorte");
});

ok("O RECORTE NÃO INVENTA VÉRTICE — é a origem clássica da fenda", () => {
  // Calcular a interseção exata com a borda criaria pontos NOVOS, e dois tiles
  // vizinhos criariam pontos diferentes para o mesmo cruzamento. Aqui só se
  // descartam segmentos inteiros, então todo vértice que sai é um vértice que
  // entrou.
  const p = [[-30, 0], [-5, 0], [5, 0], [30, 0]];
  const r = recortar([linhaEm(COSTA, p)], [-10, -10, 10, 10]);
  const originais = new Set(p.map((q) => q.join(",")));
  for (const linha of r) {
    for (const q of linha.pontos) {
      assert.ok(originais.has(q.join(",")), `vértice inventado: ${q}`);
    }
  }
});

ok("uma linha que ENTRA e SAI vira trechos separados, sem ligar as pontas", () => {
  // Sem quebrar em trechos, o primeiro e o último ponto ficariam no mesmo
  // `LineSegments` e a costa ganharia uma reta atravessando o tile.
  const p = [[-30, 0], [-20, 0], [0, 0], [20, 0], [30, 0], [31, 40], [0, 41]];
  const r = recortar([linhaEm(COSTA, p)], [-10, -10, 10, 10]);
  assert.ok(r.length >= 1, "nada sobreviveu");
  for (const linha of r) {
    // Nenhum trecho pode conter um salto maior que o maior salto original.
    for (let i = 1; i < linha.pontos.length; i++) {
      const d = Math.abs(linha.pontos[i][0] - linha.pontos[i - 1][0]);
      assert.ok(d <= 20.001, `trecho com salto de ${d}° — as pontas foram ligadas`);
    }
  }
});

ok("a margem estende a caixa, e mais margem nunca traz menos linha", () => {
  const p = [[10.5, 0], [11.5, 0]];      // logo fora da borda leste
  const semMargem = recortar([linhaEm(PAIS, p)], [-10, -10, 10, 10], 0);
  const comMargem = recortar([linhaEm(PAIS, p)], [-10, -10, 10, 10], 2);
  assert.equal(semMargem.length, 0);
  assert.equal(comMargem.length, 1, "a margem não trouxe a linha vizinha");
});

ok("A COSTURA FECHA: dois tiles vizinhos concordam na borda", () => {
  // O teste que justifica simplificar ANTES de recortar. A mesma linha é
  // recortada por dois tiles adjacentes; a união dos trechos tem que conter
  // TODOS os vértices originais que caem na faixa coberta pelos dois — sem
  // buraco na emenda.
  const p = Array.from({ length: 41 }, (_, i) => [-20 + i, Math.sin(i * 0.4) * 3]);
  const linha = linhaEm(COSTA, p);

  const oeste = recortar([linha], [-20, -10, 0, 10], 0);
  const leste = recortar([linha], [0, -10, 20, 10], 0);

  const vistos = new Set();
  for (const t of [...oeste, ...leste]) for (const q of t.pontos) vistos.add(q.join(","));

  for (const q of p) {
    if (q[0] < -20 || q[0] > 20) continue;
    if (q[1] < -10 || q[1] > 10) continue;
    assert.ok(vistos.has(q.join(",")), `vértice ${q} sumiu na emenda entre os dois tiles`);
  }
});

console.log("\nformato binário");

ok("ida e volta preserva pontos, classes e metadados", () => {
  const linhas = [
    { classe: COSTA, pontos: [[-10, -5], [0, 0], [10, 5]] },
    { classe: ESTADO, pontos: [[20, 20], [21, 21]] },
    { classe: PAIS, pontos: [[-179.5, 60], [179.5, 60]] },
  ];
  const buf = empacotarFronteiras(linhas, { z: 3, resolucao: "50m" });
  const v = desempacotarFronteiras(buf);

  assert.equal(v.linhas.length, 3);
  assert.equal(v.nPontos, 7);
  assert.equal(v.meta.resolucao, "50m");
  assert.deepEqual(v.linhas.map((l) => l.classe), [COSTA, ESTADO, PAIS]);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < linhas[i].pontos.length; k++) {
      perto(v.linhas[i].pontos[k][0], linhas[i].pontos[k][0], 1e-4, "lng");
      perto(v.linhas[i].pontos[k][1], linhas[i].pontos[k][1], 1e-4, "lat");
    }
  }
});

ok("o alinhamento aguenta QUALQUER número de linhas", () => {
  // O bloco de classes é `uint8` e o de coordenadas é `float32`. Sem completar
  // até múltiplo de 4, um número ímpar de linhas desalinharia o início das
  // coordenadas e `new Float32Array(buffer, off)` lançaria RangeError — em
  // ALGUMAS respostas e não em outras, que é o pior tipo de defeito.
  for (let k = 1; k <= 12; k++) {
    const linhas = Array.from({ length: k }, (_, i) => ({
      classe: i % 3, pontos: [[i, i], [i + 1, i + 1]],
    }));
    const v = desempacotarFronteiras(empacotarFronteiras(linhas, { z: k }));
    assert.equal(v.linhas.length, k, `${k} linhas`);
    perto(v.linhas[k - 1].pontos[1][0], k, 1e-4, `${k} linhas: última coordenada`);
  }
});

ok("o alinhamento aguenta QUALQUER tamanho de metadado", () => {
  for (let len = 1; len <= 24; len++) {
    const buf = empacotarFronteiras(
      [{ classe: COSTA, pontos: [[1, 2], [3, 4]] }],
      { nota: "x".repeat(len) },
    );
    assert.equal(buf.readUInt16LE(6) % 4, 0, `metadado de ${len} desalinhado`);
    const v = desempacotarFronteiras(buf);
    assert.equal(v.meta.nota, "x".repeat(len));
    perto(v.linhas[0].pontos[1][0], 3, 1e-4);
  }
});

ok("um tile sem nenhuma linha é válido e minúsculo", () => {
  // Acontece em quase todo tile de oceano aberto — a maior parte do planeta.
  const buf = empacotarFronteiras([], { z: 6 });
  const v = desempacotarFronteiras(buf);
  assert.equal(v.linhas.length, 0);
  assert.equal(v.nPontos, 0);
  assert.ok(buf.length < 200, `${buf.length} bytes para um tile vazio`);
});

ok("assinatura errada e versão futura são recusadas", () => {
  const lixo = Buffer.alloc(64);
  lixo.write("JSON", 0);
  assert.throws(() => desempacotarFronteiras(lixo), /assinatura/);

  const buf = empacotarFronteiras([{ classe: PAIS, pontos: [[0, 0], [1, 1]] }], {});
  buf.writeUInt16LE(77, 4);
  assert.throws(() => desempacotarFronteiras(buf), /versão 77/);
});

ok("polilinha economiza sobre segmento solto — é por isso que o formato é assim", () => {
  // Uma linha de N pontos tem N−1 segmentos. Guardá-los como pares duplicaria
  // cada vértice interno; a expansão para segmentos é feita no cliente, uma
  // vez por tile, e é trabalho de laço em vez de banda.
  const n = 500;
  const pontos = Array.from({ length: n }, (_, i) => [i * 0.01, i * 0.02]);
  const comoLinha = empacotarFronteiras([{ classe: COSTA, pontos }], {}).length;

  const pares = [];
  for (let i = 0; i < n - 1; i++) pares.push({ classe: COSTA, pontos: [pontos[i], pontos[i + 1]] });
  const comoSegmentos = empacotarFronteiras(pares, {}).length;

  assert.ok(comoLinha < comoSegmentos * 0.55,
    `polilinha ${comoLinha} B contra segmentos ${comoSegmentos} B`);
});

ok("o cabeçalho tem o tamanho declarado", () => {
  assert.equal(CABECALHO, 16);
  const buf = empacotarFronteiras([], {});
  assert.ok(buf.length >= CABECALHO);
});

console.log(`\n  ${n} verificações das fronteiras\n`);
