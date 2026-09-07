// test/fronteiras-nivel.mjs
// -----------------------------------------------------------------------------
// UM NÍVEL POR VEZ.
// -----------------------------------------------------------------------------
// O DEFEITO, relatado ao dar zoom: a mesma costa aparecia com DOIS traços, um
// grosso e um fino, deslocados vários quilômetros um do outro.
//
// A causa foi uma política copiada do lugar errado. A pirâmide de IMAGEM
// mantém o nível 0 sempre desenhado como piso, e ali está certo: um tile opaco
// de nível fino COBRE o grosso, então nunca se vê os dois. Para LINHA a mesma
// política é errada, porque uma linha não cobre nada — os dois traços
// simplesmente somam.
//
// A regra certa é de SUBSTITUIÇÃO: desenha o nível mais fino cujos tiles da
// vista já chegaram todos, e só ele. Este arquivo tranca as duas metades
// disso:
//
//   NUNCA dois níveis visíveis ao mesmo tempo — nem durante o carregamento,
//   que é quando a tentação de "mostrar o que já chegou" produz a linha dupla
//   passageira.
//
//   SEMPRE algum nível visível depois da primeira carga — trocar cedo demais
//   deixaria o planeta sem contorno enquanto o nível novo chega.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import * as THREE from "three";
import { FronteirasGlobo } from "../src/fronteiras.ts";
import { calotaVisivel } from "../src/calota.ts";
import { empacotarFronteiras, COSTA, PAIS } from "../server/fronteiras.js";

let n = 0;
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nnível visível da camada de fronteiras");

/**
 * Rede de mentira com entrega CONTROLADA.
 *
 * Os tiles não chegam sozinhos: ficam numa fila e só respondem quando o teste
 * mandar. É a única forma de observar o estado INTERMEDIÁRIO — que é
 * justamente onde a linha dupla aparecia.
 */
function redeControlada() {
  const fila = [];
  const estado = { pedidos: [] };

  const corpo = (z) => {
    const buf = empacotarFronteiras(
      [
        { classe: COSTA, pontos: [[-10, -10], [0, 0], [10, 10]] },
        { classe: PAIS, pontos: [[-5, 5], [5, -5]] },
      ],
      { z },
    );
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };

  globalThis.fetch = (url) => {
    const z = Number(String(url).split("/")[3]);
    estado.pedidos.push(String(url));
    return new Promise((resolve) => {
      fila.push(() => resolve({
        ok: true, status: 200,
        arrayBuffer: async () => corpo(z),
      }));
    });
  };

  /** entrega `quantos` pedidos pendentes (todos, se omitido) */
  estado.entregar = async (quantos = Infinity) => {
    let k = 0;
    while (fila.length && k < quantos) { fila.shift()(); k++; }
    // duas voltas de microtarefa: uma para o `await fetch`, outra para o
    // `await r.arrayBuffer()` dentro de `buscarFronteiras`.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    return k;
  };
  estado.pendentes = () => fila.length;
  return estado;
}

/** todos os LineSegments visíveis, agrupados por nível */
function visiveisPorNivel(cena) {
  const grupo = cena.children.find((o) => o.isGroup);
  const porNivel = new Map();
  for (const o of grupo.children) {
    if (!o.visible) continue;
    porNivel.set(o.userData.z, (porNivel.get(o.userData.z) ?? 0) + 1);
  }
  return porNivel;
}

const VISTA_MUNDO = calotaVisivel(0, 0, 2.5, 50, 16 / 9);
const VISTA_PERTO = calotaVisivel(0, 0, 0.05, 50, 16 / 9);

await okA("na vista planetária desenha UM nível, e é o que a câmera pediu", async () => {
  const rede = redeControlada();
  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });

  f.atualizar(VISTA_MUNDO, 1400, 1);
  await rede.entregar();

  const v = visiveisPorNivel(cena);
  assert.equal(v.size, 1, `${v.size} níveis visíveis ao mesmo tempo`);
  assert.equal([...v.keys()][0], f.nivelPedido,
    "o nível na tela não é o que a câmera pediu, mesmo com tudo carregado");
  f.dispose();
});

await okA("NUNCA dois níveis visíveis — nem no meio do carregamento", async () => {
  // Este é o teste do defeito. Ao aproximar, o nível fino chega tile a tile; a
  // tentação é mostrar cada um assim que chega, e é exatamente isso que
  // produzia o traço duplo sobre a costa.
  const rede = redeControlada();
  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });

  f.atualizar(VISTA_MUNDO, 1400, 1);
  await rede.entregar();
  assert.equal(visiveisPorNivel(cena).size, 1, "estado inicial já tinha dois níveis");

  // Aproxima. Os tiles finos começam a chegar UM A UM.
  f.atualizar(VISTA_PERTO, 1400, 1);
  assert.ok(rede.pendentes() > 1, `só ${rede.pendentes()} tile(s) pedidos — o teste não exercita a fase parcial`);

  while (rede.pendentes() > 0) {
    await rede.entregar(1);
    const v = visiveisPorNivel(cena);
    assert.ok(v.size <= 1,
      `${v.size} níveis desenhando ao mesmo tempo (${[...v.keys()].join(", ")}) — é a linha dupla`);
  }

  f.dispose();
});

await okA("terminado o carregamento, o nível FINO substitui o grosso", async () => {
  const rede = redeControlada();
  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });

  f.atualizar(VISTA_MUNDO, 1400, 1);
  await rede.entregar();

  f.atualizar(VISTA_PERTO, 1400, 1);
  await rede.entregar();

  const v = visiveisPorNivel(cena);
  assert.equal(v.size, 1, `${v.size} níveis visíveis`);
  const nivel = [...v.keys()][0];
  assert.ok(nivel > 0, `ainda desenhando o nível ${nivel} depois de aproximar`);
  assert.equal(f.nivel, nivel, "o nível anunciado não é o que está na tela");
  f.dispose();
});

await okA("o nível 0 continua CARREGADO, só não desenha", async () => {
  // Ele é o piso: dois tiles, 44 kB, cobrindo o planeta inteiro. Descartá-lo
  // deixaria a primeira pintura de qualquer vista nova sem contorno nenhum.
  const rede = redeControlada();
  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });

  f.atualizar(VISTA_MUNDO, 1400, 1);
  await rede.entregar();
  f.atualizar(VISTA_PERTO, 1400, 1);
  await rede.entregar();

  const grupo = cena.children.find((o) => o.isGroup);
  const zeroCarregado = grupo.children.filter((o) => o.userData.z === 0);
  assert.ok(zeroCarregado.length > 0, "o piso foi descartado");
  for (const o of zeroCarregado) {
    assert.equal(o.visible, false, "o piso voltou a desenhar por cima do nível fino");
  }
  f.dispose();
});

await okA("VOLTAR o zoom devolve o nível grosso, e um só", async () => {
  const rede = redeControlada();
  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });

  f.atualizar(VISTA_PERTO, 1400, 1);
  await rede.entregar();
  const perto = [...visiveisPorNivel(cena).keys()][0];

  f.atualizar(VISTA_MUNDO, 1400, 1);
  await rede.entregar();

  const v = visiveisPorNivel(cena);
  assert.equal(v.size, 1, `${v.size} níveis visíveis ao afastar`);
  assert.ok([...v.keys()][0] < perto, "afastar não voltou para um nível mais grosso");
  f.dispose();
});

await okA("tile de OCEANO ABERTO conta como carregado, e não trava a troca", async () => {
  // Um tile sem nenhuma linha chega vazio e nunca ganha geometria. Se "pronto"
  // fosse "tem linha", a troca de nível jamais aconteceria sobre o Pacífico —
  // a maior parte do planeta — e o mapa ficaria preso no traço grosso.
  const vazio = empacotarFronteiras([], { z: 5 });
  const ab = vazio.buffer.slice(vazio.byteOffset, vazio.byteOffset + vazio.byteLength);
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => ab.slice(0) });

  const cena = new THREE.Scene();
  const f = new FronteirasGlobo(cena, { raio: 100 });
  f.atualizar(VISTA_PERTO, 1400, 1);
  for (let i = 0; i < 40; i++) await Promise.resolve();

  assert.ok(f.nivel > 0, `o nível ficou em ${f.nivel} — a troca travou num tile vazio`);
  f.dispose();
});

console.log(`\n  ${n} verificações do nível das fronteiras\n`);
