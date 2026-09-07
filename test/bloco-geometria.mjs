// test/bloco-geometria.mjs
// -----------------------------------------------------------------------------
// ONDE CADA VÉRTICE DO BLOCO FICA.
// -----------------------------------------------------------------------------
// O bloco 3D existe para mostrar a vertical, e a vertical é a única coisa da
// tela que ninguém consegue conferir de olho: não há referência. Uma montanha
// duas vezes mais alta do que deveria continua parecendo uma montanha.
//
// Os erros que este arquivo tranca são todos silenciosos:
//
//   EXAGERO APLICADO DUAS VEZES — uma na posição do vértice e outra na altura
//   do piso. Aconteceu numa versão intermediária deste código, e o sintoma é
//   uma parede que não bate com o terreno que ela sustenta.
//
//   SINAL DA LATITUDE — o eixo z aponta para o SUL. Trocar espelha o bloco
//   norte-sul, e a única forma de perceber é conhecer o terreno de cor.
//
//   BURACO VIRANDO PLATÔ — cobertura ausente preenchida com o nível do mar é a
//   coisa mais fácil de desenhar e a mais fácil de acreditar.
//
// A cena não pode ser carregada aqui — ela cria um `WebGLRenderer` no
// construtor e não há WebGL no Node. Por isso a conta mora em
// `src/bloco/geometria.ts`, fora do motor, como já acontece com `src/tiles.ts`
// e `src/calota.ts`.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  metricaDa, kmDeMetros, malhaDoTerreno, saiaDoBloco,
  faixaDoCampo, estratoPara, profundidadeKm,
} from "../src/bloco/geometria.ts";
import { caixaEmVolta, tamanhoKm } from "../src/bloco/relevo.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

const CX = caixaEmVolta(-23.55, -46.63, 60);      // 60 km sobre São Paulo

/** grade de altitude com uma função conhecida */
function terreno(nx, ny, f, buracos = []) {
  const valores = new Float32Array(nx * ny);
  const valido = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) valores[j * nx + i] = f(i, j);
  }
  for (const k of buracos) valido[k] = 0;
  return { nx, ny, valores, valido, unidade: "m" };
}

console.log("\nmétrica da caixa");

ok("um bloco de 60 km mede 60 km na cena", () => {
  const m = metricaDa(CX);
  perto(m.larguraKm, 60, 1.5, "largura");
  perto(m.alturaKm, 60, 0.5, "altura");
});

ok("o centro da caixa é a origem da cena", () => {
  const c = terreno(5, 5, () => 0);
  const b = malhaDoTerreno(c, CX, 10, 0);
  const k = 2 * 5 + 2;                       // vértice central de uma grade 5x5
  perto(b.posicao[k * 3], 0, 1e-4, "x do centro");
  perto(b.posicao[k * 3 + 2], 0, 1e-4, "z do centro");
});

console.log("\nsuperfície do terreno");

ok("a altura é altitude vezes exagero, e o exagero entra UMA vez", () => {
  const c = terreno(4, 4, () => 800);
  for (const ex of [1, 5, 14, 40]) {
    const b = malhaDoTerreno(c, CX, ex, 0);
    // 800 m = 0,8 km; com exagero 14 são 11,2 unidades de cena.
    perto(b.posicao[1], (800 / 1000) * ex, 1e-5, `exagero ${ex}`);
  }
  // E a conversão isolada concorda com a malha — se as duas divergissem, a
  // parede deixaria de bater com o terreno.
  perto(kmDeMetros(800, 14), 11.2, 1e-9, "kmDeMetros");
});

ok("O EIXO Z APONTA PARA O SUL", () => {
  // Trocar o sinal espelha o bloco norte-sul, e o único jeito de notar é
  // conhecer o terreno de cor. A vista padrão é de sudeste: com o sinal certo,
  // o norte fica ao fundo, como em todo mapa.
  const c = terreno(3, 3, () => 0);
  const b = malhaDoTerreno(c, CX, 10, 0);
  const zNorte = b.posicao[0 * 3 + 2];              // linha 0 = borda norte
  const zSul = b.posicao[(2 * 3 + 0) * 3 + 2];      // linha 2 = borda sul
  assert.ok(zNorte < 0, `a borda norte devia ter z negativo, veio ${zNorte}`);
  assert.ok(zSul > 0, `a borda sul devia ter z positivo, veio ${zSul}`);
});

ok("o eixo X aponta para o LESTE", () => {
  const c = terreno(3, 3, () => 0);
  const b = malhaDoTerreno(c, CX, 10, 0);
  assert.ok(b.posicao[0] < 0, "a coluna 0 é o oeste e devia ter x negativo");
  assert.ok(b.posicao[2 * 3] > 0, "a última coluna é o leste");
});

ok("batimetria desce abaixo de zero — o bloco costeiro mostra o fundo do mar", () => {
  const c = terreno(4, 4, (i) => (i < 2 ? -1200 : 300));
  const b = malhaDoTerreno(c, CX, 10, -1200);
  perto(b.posicao[1], -12, 1e-5, "fundo do mar a −1.200 m com exagero 10");
  perto(b.posicao[2 * 3 + 1], 3, 1e-5, "terra a +300 m");
});

ok("BURACO CONTINUA BURACO: nenhum triângulo toca célula sem cobertura", () => {
  const nx = 5, ny = 5;
  const semDado = 2 * nx + 2;                       // a célula central
  const c = terreno(nx, ny, () => 500, [semDado]);
  const b = malhaDoTerreno(c, CX, 10, 0);

  for (let t = 0; t < b.indice.length; t++) {
    assert.notEqual(b.indice[t], semDado,
      "um triângulo incluiu o vértice sem cobertura");
  }
  // Os quatro quadriláteros em volta dela somem: 16 quadriláteros no total,
  // 12 sobram, 24 triângulos.
  assert.equal(b.triangulos, 24, `${b.triangulos} triângulos`);
  // E a posição do vértice continua FINITA: um NaN aqui contaminaria a caixa
  // envolvente e o three.js sumiria com a malha inteira.
  assert.ok(Number.isFinite(b.posicao[semDado * 3 + 1]), "o buraco virou NaN");
});

ok("grade completa gera todos os triângulos", () => {
  const b = malhaDoTerreno(terreno(6, 4, () => 100), CX, 10, 0);
  assert.equal(b.vertices, 24);
  assert.equal(b.triangulos, (6 - 1) * (4 - 1) * 2);
});

console.log("\nsaia e piso");

ok("o piso fica ABAIXO do ponto mais baixo do terreno", () => {
  const c = terreno(4, 4, () => 200);
  const b = malhaDoTerreno(c, CX, 12, 200);
  const { largura } = tamanhoKm(CX);
  const s = saiaDoBloco(b, 4, 4, 200, 12, largura);

  const topoMaisBaixo = kmDeMetros(200, 12);
  assert.ok(s.pisoY < topoMaisBaixo, "o piso ficou acima do terreno");
  perto(topoMaisBaixo - s.pisoY, profundidadeKm(largura), 1e-6, "profundidade");
});

ok("A ALTITUDE DO PISO É A INVERSA EXATA DA CONVERSÃO", () => {
  // Se `pisoM` não fosse a inversa de `kmDeMetros`, os estratos da parede
  // sairiam espaçados errado — e o bloco perderia a única escala vertical que
  // ele oferece.
  const c = terreno(4, 4, () => 1000);
  const b = malhaDoTerreno(c, CX, 20, 1000);
  const { largura } = tamanhoKm(CX);
  const s = saiaDoBloco(b, 4, 4, 1000, 20, largura);
  perto(kmDeMetros(s.pisoM, 20), s.pisoY, 1e-6,
    "a altitude do piso não corresponde à altura dele");
});

ok("a saia cobre o perímetro inteiro, e o piso fecha por baixo", () => {
  const nx = 6, ny = 5;
  const b = malhaDoTerreno(terreno(nx, ny, () => 0), CX, 10, 0);
  const { largura } = tamanhoKm(CX);
  const s = saiaDoBloco(b, nx, ny, 0, 10, largura);
  // 2 triângulos por segmento de borda; (nx−1) segmentos ao norte e ao sul,
  // (ny−1) a leste e a oeste; mais 2 do piso.
  const esperado = 2 * (2 * (nx - 1) + 2 * (ny - 1)) + 2;
  assert.equal(s.triangulos, esperado, `${s.triangulos} triângulos na saia`);
});

ok("o exagero NÃO é aplicado duas vezes na parede", () => {
  // O defeito real de uma versão intermediária: o vértice do topo recebia o
  // exagero na malha e o piso o recebia de novo aqui. O sintoma é uma parede
  // que não encosta no terreno que ela sustenta.
  const c = terreno(3, 3, () => 600);
  const ex = 25;
  const b = malhaDoTerreno(c, CX, ex, 600);
  const { largura } = tamanhoKm(CX);
  const s = saiaDoBloco(b, 3, 3, 600, ex, largura);

  // O primeiro vértice de cada parede é um vértice do TOPO, e tem que estar
  // exatamente na altura do terreno.
  perto(s.posicao[1], kmDeMetros(600, ex), 1e-5, "topo da parede");
});

ok("a profundidade acompanha a LARGURA, e não o relevo", () => {
  // Um bloco de planície teria parede de dois pixels se a profundidade
  // dependesse da amplitude do terreno — e a parede é a escala.
  perto(profundidadeKm(60), 6, 1e-9, "bloco de 60 km");
  perto(profundidadeKm(500), 50, 1e-9, "bloco de 500 km");
  assert.ok(profundidadeKm(5) >= 1.5, "bloco minúsculo ainda precisa de parede visível");
});

console.log("\nfaixa do campo e estratos");

ok("a malha do campo NÃO encosta no terreno", () => {
  // O vão é deliberado: encostar faria parecer que uma superfície de pressão é
  // uma nuvem pousada no morro. As duas verticais não são a mesma.
  const { largura } = tamanhoKm(CX);
  const f = faixaDoCampo(2000, 14, largura, 0);
  assert.ok(f.base > kmDeMetros(2000, 14),
    "a base do campo ficou dentro do terreno");
  assert.ok(f.espessura > 0, "a faixa do campo tem que ter espessura");
});

ok("afastar o campo sobe a faixa inteira, sem mudar a espessura", () => {
  const { largura } = tamanhoKm(CX);
  const a = faixaDoCampo(1000, 12, largura, 0);
  const b = faixaDoCampo(1000, 12, largura, 8);
  perto(b.base - a.base, 8, 1e-9, "afastamento");
  perto(b.espessura, a.espessura, 1e-9, "espessura mudou junto");
});

ok("o estrato acompanha a amplitude — a parede sempre tem faixas legíveis", () => {
  assert.equal(estratoPara(6000), 1000, "bloco alpino");
  assert.equal(estratoPara(2000), 500);
  assert.equal(estratoPara(600), 100);
  assert.equal(estratoPara(90), 25, "planície");
  assert.equal(estratoPara(0), 25, "terreno plano ainda precisa de um passo");
  assert.equal(estratoPara(NaN), 25, "amplitude ausente não pode virar divisão por zero");
});

ok("uma planície nunca fica com UMA faixa só na parede", () => {
  // O critério que faz o estrato existir: em qualquer amplitude, a parede
  // precisa mostrar pelo menos algumas divisões.
  for (const amp of [40, 150, 800, 3000, 8000]) {
    const faixas = amp / estratoPara(amp);
    assert.ok(faixas >= 1.5, `amplitude de ${amp} m daria ${faixas.toFixed(1)} faixas`);
  }
});

console.log(`\n  ${n} verificações da geometria do bloco\n`);
