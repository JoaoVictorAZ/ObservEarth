// test/calota.mjs
// -----------------------------------------------------------------------------
// QUANTO DO PLANETA A CÂMERA ENXERGA — e por que 90° é a resposta errada.
// -----------------------------------------------------------------------------
// Esta conta decide quantos tiles são pedidos, e cada tile é uma transação da
// cota do GIBS. Superestimar a vista pede tiles de uma faixa que a curvatura
// esconde; subestimar abre buraco na borda da tela. As duas falhas são caras e
// nenhuma delas grita.
//
// O TESTE QUE MAIS IMPORTA É O DO HORIZONTE. De uma altitude de 1,7 raios —
// que é a vista inicial do aplicativo — enxerga-se uma calota de 68,26°, e NÃO
// um hemisfério. A tangente que sai da câmera toca a esfera em
// acos(R/d) = acos(1/2,7), e tudo além disso está do outro lado da curvatura.
// Supor 90° pediria quase o dobro da área em tiles, todos jogados fora.
//
// Os valores esperados saem de geometria fechada, não de rodar o código.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { calotaVisivel } from "../src/calota.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

const graus = (r) => (r * 180) / Math.PI;

console.log("\ncalota visível");

ok("na vista inicial o limite é o HORIZONTE, e ele vale 68,26° — não 90°", () => {
  // d = 1 + 1,7 = 2,7 raios. acos(1/2,7) = 1,19139 rad = 68,26°.
  const esperado = graus(Math.acos(1 / 2.7));
  perto(esperado, 68.26, 0.01, "a conta de referência mudou");

  const v = calotaVisivel(0, 0, 1.7, 50, 16 / 9);
  perto(v.latNorte, esperado, 0.01, "borda norte");
  perto(v.latSul, -esperado, 0.01, "borda sul");
  assert.ok(v.latNorte < 89, "a calota engoliu o polo, o que a curvatura proíbe");
});

ok("de perto, a vista é o CONE DA LENTE e é bem estreita", () => {
  // d = 1,1; θ = 25°.  α = asen(1,1·sen25°) − 25° = 27,70° − 25° = 2,70°
  const s = 1.1 * Math.sin((25 * Math.PI) / 180);
  const esperado = graus(Math.asin(s)) - 25;
  perto(esperado, 2.70, 0.02, "a conta de referência mudou");

  const v = calotaVisivel(0, 0, 0.1, 50, 1);
  perto(v.latNorte, esperado, 0.02, "borda norte");
  // E o horizonte, que aqui vale 24,6°, NÃO é o limite: quem manda é a lente.
  assert.ok(v.latNorte < graus(Math.acos(1 / 1.1)), "o horizonte venceu a lente indevidamente");
});

ok("a janela cresce monotonicamente com a altitude, e satura no horizonte", () => {
  let anterior = 0;
  for (const alt of [0.02, 0.05, 0.1, 0.3, 0.7, 1.2, 1.7, 3, 8]) {
    const v = calotaVisivel(0, 0, alt, 50, 16 / 9);
    assert.ok(v.larguraGraus >= anterior - 1e-9,
      `largura encolheu ao subir: alt=${alt} deu ${v.larguraGraus} depois de ${anterior}`);
    anterior = v.larguraGraus;
    // O horizonte é o teto absoluto, sempre.
    assert.ok(v.latNorte <= graus(Math.acos(1 / (1 + alt))) + 1e-6, `alt=${alt} passou do horizonte`);
  }
  assert.ok(anterior < 360, "de altitude nenhuma se vê o planeta inteiro");
});

ok("a tela larga enxerga mais em longitude que em latitude", () => {
  // O FOV do three.js é VERTICAL. Numa tela 16:9 a abertura horizontal é
  // maior, e ignorar a relação de aspecto pediria uma faixa estreita demais —
  // buraco nas bordas laterais, que é onde o olho mais repara.
  const largo = calotaVisivel(0, 0, 0.2, 50, 16 / 9);
  const quadrado = calotaVisivel(0, 0, 0.2, 50, 1);
  assert.ok(largo.larguraGraus > quadrado.larguraGraus,
    `16:9 (${largo.larguraGraus}) devia ser mais largo que 1:1 (${quadrado.larguraGraus})`);
  // A altura não muda com o aspecto: o FOV vertical é o mesmo.
  perto(largo.latNorte, quadrado.latNorte, 1e-9, "a altura mudou com o aspecto");
});

console.log("\nlongitude e polos");

ok("os meridianos convergem: a mesma calota cobre MAIS graus em latitude alta", () => {
  const eq = calotaVisivel(0, 0, 0.3, 50, 1);
  const alto = calotaVisivel(60, 0, 0.3, 50, 1);
  assert.ok(alto.larguraGraus > eq.larguraGraus * 1.5,
    `a 60° a faixa devia dobrar: ${alto.larguraGraus} contra ${eq.larguraGraus}`);
  // A 60°, 1/cos = 2. A meia-largura em longitude aproximadamente dobra.
  perto(alto.larguraGraus / eq.larguraGraus, 2, 0.35, "razão de convergência");
});

ok("quando a calota engole o polo, a longitude perde limite — e vira 360°", () => {
  // Não é caso de borda teórico: basta apontar para o Ártico. Sem este
  // tratamento, a faixa de longitude sairia de um arco-seno fora de domínio e
  // o mapa abriria um leque vazio em volta do polo.
  const v = calotaVisivel(88, 30, 0.6, 50, 16 / 9);
  assert.equal(v.larguraGraus, 360, "a faixa devia ser a volta inteira");
  assert.equal(v.lngOeste, 30 - 180);
  assert.equal(v.lngLeste, 30 + 180);
  assert.equal(v.latNorte, 90, "a latitude devia travar no polo");
});

ok("a latitude NUNCA passa de ±90", () => {
  for (const lat of [-90, -85, -60, 0, 60, 85, 90]) {
    for (const alt of [0.05, 0.5, 2, 6]) {
      const v = calotaVisivel(lat, 0, alt, 50, 16 / 9);
      assert.ok(v.latNorte <= 90 && v.latSul >= -90, `estourou em lat=${lat} alt=${alt}`);
      assert.ok(v.latNorte >= v.latSul, `caixa invertida em lat=${lat} alt=${alt}`);
    }
  }
});

ok("a caixa é centrada na longitude pedida, inclusive perto do antimeridiano", () => {
  // A caixa pode sair de faixa de propósito: `tilesEm` trabalha em longitude
  // contínua e traz a coluna para dentro da grade depois. Recortar aqui
  // abriria uma fenda exatamente na linha de data.
  const v = calotaVisivel(0, 178, 0.3, 50, 16 / 9);
  perto((v.lngOeste + v.lngLeste) / 2, 178, 1e-9, "centro");
  assert.ok(v.lngLeste > 180, "a caixa devia atravessar o antimeridiano, e não parar nele");
});

ok("entrada absurda não devolve NaN", () => {
  for (const args of [[0, 0, 0, 50, 16 / 9], [0, 0, -5, 50, 1], [0, 0, 1, 0.001, 0]]) {
    const v = calotaVisivel(...args);
    for (const [k, x] of Object.entries(v)) {
      assert.ok(Number.isFinite(x), `${k} virou ${x} com ${JSON.stringify(args)}`);
    }
  }
});

console.log(`\n  ${n} verificações da calota visível\n`);
