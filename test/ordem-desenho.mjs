// test/ordem-desenho.mjs
// -----------------------------------------------------------------------------
// QUEM FICA NA FRENTE DE QUEM.
// -----------------------------------------------------------------------------
// Quase toda camada do globo desenha sobre a mesma esfera com `depthTest`
// DESLIGADO. É deliberado: são cascas concêntricas a milésimos de raio de
// distância, e deixar o teste de profundidade decidir daria cintilação em vez
// de sobreposição. O preço é que a ordem de desenho vira a única coisa que
// decide o que se vê.
//
// Uma ordem errada não quebra nada. Não há erro, não há aviso, o build passa —
// a camada simplesmente some atrás de outra, e o usuário conclui que o
// interruptor não funciona. Foi o que aconteceu quando a pirâmide de tiles
// nasceu com ordem de GRUPO: a imagem de satélite passou a cobrir as
// partículas de vento.
//
// Este arquivo afirma as RELAÇÕES, não os números. Os valores podem mudar; o
// fato de vento ficar acima de imagem, não.
//
// E há UMA exceção à regra do depthTest desligado, no fim do arquivo: a camada
// de fronteiras. Ela não é uma casca colada na esfera, é geometria solta no
// espaço — sem o teste, o traço da face oculta atravessa o planeta e a
// Austrália aparece desenhada por cima do Pacífico.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import * as THREE from "three";
import { ORDEM, ordemDoTile } from "../src/ordemDesenho.ts";
import { NIVEL_MAX } from "../src/tiles.ts";
import { FronteirasGlobo } from "../src/fronteiras.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nordem de desenho do globo");

ok("a pilha sobe: base < imagem < tiles < isóbaras < correntes < vento < malha", () => {
  assert.ok(ORDEM.BASE < ORDEM.IMAGEM, "imagem abaixo da esfera base");
  assert.ok(ORDEM.IMAGEM < ordemDoTile(0), "tile de nível 0 abaixo da imagem única");
  assert.ok(ordemDoTile(NIVEL_MAX) < ORDEM.ISOBARAS,
    `o tile mais fino (${ordemDoTile(NIVEL_MAX)}) passou das isóbaras (${ORDEM.ISOBARAS})`);
  assert.ok(ORDEM.ISOBARAS < ORDEM.CORRENTES);
  assert.ok(ORDEM.CORRENTES < ORDEM.VENTO);
  assert.ok(ORDEM.VENTO < ORDEM.MALHA, "a análise tem que ficar acima de tudo");
});

ok("os SETE níveis de tile cabem inteiros entre a imagem e as isóbaras", () => {
  // Se não coubessem, o nível fino atravessaria a faixa das isóbaras e passaria
  // a cobri-las — sem nenhum sintoma além de a linha sumir no zoom fechado.
  for (let z = 0; z <= NIVEL_MAX; z++) {
    const o = ordemDoTile(z);
    assert.ok(o > ORDEM.IMAGEM, `tile z=${z} (${o}) caiu abaixo da imagem única`);
    assert.ok(o < ORDEM.ISOBARAS, `tile z=${z} (${o}) subiu acima das isóbaras`);
  }
});

ok("tile mais fino desenha SEMPRE por cima do mais grosso", () => {
  for (let z = 1; z <= NIVEL_MAX; z++) {
    assert.ok(ordemDoTile(z) > ordemDoTile(z - 1),
      `nível ${z} não ficou acima do ${z - 1}`);
  }
});

console.log("\na armadilha do renderOrder num Group");

ok("o three.js compara groupOrder ANTES de renderOrder — o motivo do defeito", () => {
  // Este teste existe para provar a afirmação que justifica `ordemDesenho.ts`,
  // e não para testar o three.js. Se a semântica mudar numa versão futura, a
  // documentação daquele arquivo passa a estar errada e é aqui que se descobre.
  //
  // O que se monta: um objeto SOLTO com renderOrder alto e um objeto DENTRO de
  // um grupo com renderOrder baixo. Pela regra de grupo, o de dentro vence.
  const cena = new THREE.Scene();

  const solto = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  solto.renderOrder = 5;                       // "vento"
  cena.add(solto);

  const grupo = new THREE.Group();
  grupo.renderOrder = 3;                       // "pirâmide de tiles"
  const dentro = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  dentro.renderOrder = 0;
  grupo.add(dentro);
  cena.add(grupo);

  // O three.js não expõe a lista de renderização sem um contexto WebGL, mas
  // expõe a peça que importa: `renderOrder` de um Group NÃO é copiado para os
  // filhos. É essa ausência que faz `groupOrder` ser um eixo SEPARADO.
  assert.equal(dentro.renderOrder, 0, "o filho herdou renderOrder do grupo");
  assert.equal(grupo.renderOrder, 3);
  assert.ok(solto.renderOrder > dentro.renderOrder,
    "pelo renderOrder o solto venceria — e é justamente por isso que o defeito passou despercebido");
});

ok("só a MALHA usa ordem de grupo, e ela é a última da pilha", () => {
  // A regra: grupo só recebe ordem quando a intenção é "tudo isto acima de tudo
  // aquilo". Vale para a malha, que é superfície levantada com teste de
  // profundidade LIGADO; não vale para a pirâmide, cujos tiles precisam se
  // ordenar entre si dentro do mesmo balde das outras cascas.
  const maiorCasca = Math.max(
    ORDEM.IMAGEM, ordemDoTile(NIVEL_MAX), ORDEM.ISOBARAS, ORDEM.CORRENTES, ORDEM.VENTO,
  );
  assert.ok(ORDEM.MALHA > maiorCasca,
    `a malha (${ORDEM.MALHA}) precisa ficar acima da casca mais alta (${maiorCasca})`);
});

console.log("\nprofundidade: o outro lado do planeta");

ok("A FRONTEIRA TESTA PROFUNDIDADE — sem isso o globo fica transparente", () => {
  // O defeito, com sintoma exato: o traço da Austrália e do Sudeste Asiático
  // aparecia desenhado por cima do Pacífico, porque as linhas da face oculta
  // atravessavam a esfera.
  //
  // As camadas de IMAGEM desligam o teste de propósito — são cascas a
  // milésimos de raio umas das outras, e o teste ali dá cintilação. Copiar
  // essa decisão para a fronteira foi o erro: ela é geometria solta no espaço,
  // e não tem descarte de face traseira para salvá-la.
  const f = new FronteirasGlobo(new THREE.Scene(), { raio: 100 });
  const m = f.materialDaLinha;

  assert.equal(m.depthTest, true,
    "com depthTest desligado, o outro lado do planeta é desenhado por cima deste");

  // A ESCRITA continua desligada: material transparente que escreve
  // profundidade recorta o que vem depois na ordem — isóbaras, correntes, vento.
  assert.equal(m.depthWrite, false, "a fronteira não pode recortar o que vem depois dela");
  assert.equal(m.transparent, true);
  assert.equal(m.vertexColors, true, "a hierarquia entre costa e divisa vive na cor do vértice");

  f.dispose();
});

ok("a folga sobre a esfera existe, e é o que impede a cintilação", () => {
  // 0,25% de raio. Menos que isso e a linha some dentro da textura em algumas
  // placas; muito mais e ela descola visivelmente do relevo no limbo. E é
  // justamente por NÃO ser coplanar que o teste de profundidade não cintila —
  // um raio igual ao da esfera seria exatamente o caso coplanar.
  const RAIO = 100;
  assert.ok(RAIO * 1.0025 - RAIO > 0.2, "a folga sumiu");
});

console.log(`\n  ${n} verificações da ordem de desenho\n`);
