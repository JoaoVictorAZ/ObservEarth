// test/malha-geometria.mjs
// -----------------------------------------------------------------------------
// A CONVERSÃO DE COORDENADAS — o erro de 90° que só o olho pega.
// -----------------------------------------------------------------------------
// Duas coisas novas desenham sobre a esfera do globe.gl: os setores de tile da
// `PiramideGlobo` e a malha de campo escalar. As duas precisam pousar
// exatamente sobre os continentes que o globe.gl já desenhou, e nenhuma delas
// usa a mesma convenção que o `THREE.SphereGeometry`.
//
// O globe.gl coloca o eixo polar em y e a longitude 0 apontando para +z:
//
//     x = r·cos(lat)·sen(lng)   y = r·sen(lat)   z = r·cos(lat)·cos(lng)
//
// O `SphereGeometry` do three.js usa φ medido a partir de outro lugar:
//
//     x = −r·cos(φ)·sen(θ)      y = r·cos(θ)     z = r·sen(φ)·sen(θ)
//
// Igualando as duas sai φ = lng + π/2 e θ = π/2 − lat. Esquecer esse quarto de
// volta gira a imagem 90° em relação ao planeta — e nada reprova: o tipo passa,
// o build passa, a textura carrega, e a África aparece no Índico.
//
// Este arquivo faz a conferência que o olho faria, sem GPU: monta a geometria
// de verdade e pergunta onde os vértices caíram.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { latDaLinha, lngDaColuna } from "../src/malha/campo.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const rad = Math.PI / 180;
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

/**
 * A convenção do globe.gl, copiada de `paraCena` em src/malha/malha3d.ts.
 *
 * Está repetida aqui de propósito: se o teste importasse a função do módulo,
 * ele conferiria que o módulo concorda consigo mesmo. O que precisa ser
 * conferido é que ele concorda com o `SphereGeometry`, e para isso os dois
 * lados têm que ser escritos de forma independente.
 */
function paraCena(lat, lng, r = 1) {
  const la = lat * rad, lo = lng * rad;
  const c = Math.cos(la);
  return new THREE.Vector3(r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo));
}

console.log("\nconvenção de coordenadas do globo");

ok("os pontos cardeais caem onde o globe.gl os coloca", () => {
  // (0°, 0°) — golfo da Guiné, o ponto neutro que o botão "centralizar" usa
  const g = paraCena(0, 0);
  perto(g.x, 0, 1e-12, "x"); perto(g.y, 0, 1e-12, "y"); perto(g.z, 1, 1e-12, "z");

  const polo = paraCena(90, 0);
  perto(polo.y, 1, 1e-12, "o polo norte é +y");

  const leste = paraCena(0, 90);
  perto(leste.x, 1, 1e-12, "90°L é +x");

  const anti = paraCena(0, 180);
  perto(anti.z, -1, 1e-12, "o antimeridiano é −z");
});

ok("a conversão preserva distância angular — é uma esfera, não um elipsoide", () => {
  const a = paraCena(-23.55, -46.63);          // São Paulo
  const b = paraCena(51.51, -0.13);            // Londres
  perto(a.length(), 1, 1e-12, "raio de a");
  perto(b.length(), 1, 1e-12, "raio de b");
  // A distância São Paulo–Londres é 9.480 km; num raio unitário, o ângulo é
  // 9480/6371 = 1,488 rad = 85,3°.
  const ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / rad;
  perto(ang, 85.3, 0.6, "ângulo São Paulo–Londres");
});

console.log("\nsetor de esfera para um tile");

/** o mesmo cálculo de `geometriaDoTile`, em src/piramideGlobo.ts */
function setor(oeste, leste, sul, norte, segs = 8) {
  return new THREE.SphereGeometry(
    1,
    segs, segs,
    (oeste + 90) * rad, (leste - oeste) * rad,
    (90 - norte) * rad, (norte - sul) * rad,
  );
}

/** o vértice do setor mais próximo de um ponto lat/lng */
function maisProximo(geo, alvo) {
  const p = geo.attributes.position;
  let melhor = Infinity, achado = null;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const d = v.distanceTo(alvo);
    if (d < melhor) { melhor = d; achado = v; }
  }
  return { v: achado, d: melhor };
}

ok("os QUATRO cantos do setor caem exatamente nos cantos em lat/lng", () => {
  // Um tile qualquer, longe da origem, para não passar por acaso: se φ
  // estivesse sem o +90°, os cantos cairiam a um quarto de volta daqui.
  const [O, L, S, N] = [-45, -22.5, 0, 22.5];
  const geo = setor(O, L, S, N, 12);

  for (const [lat, lng, nome] of [
    [N, O, "noroeste"], [N, L, "nordeste"], [S, O, "sudoeste"], [S, L, "sudeste"],
  ]) {
    const alvo = paraCena(lat, lng);
    const { d } = maisProximo(geo, alvo);
    // A tolerância é 1e−6 e não 1e−12 porque o `BufferAttribute` guarda a
    // posição em float32: o épsilon dele é 1,2e−7, e num raio unitário isso é
    // o piso do que dá para exigir. Um erro de convenção seria da ordem de 1.
    assert.ok(d < 1e-6, `canto ${nome} do setor está a ${d} do ponto (${lat}, ${lng})`);
  }
});

ok("o CENTRO do setor é o centro em lat/lng — nada de meia célula de deriva", () => {
  const [O, L, S, N] = [100, 122.5, -45, -22.5];    // hemisfério sul, longe da origem
  const geo = setor(O, L, S, N, 16);
  const alvo = paraCena((S + N) / 2, (O + L) / 2);
  const { d } = maisProximo(geo, alvo);
  assert.ok(d < 0.02, `o centro do setor está a ${d} de onde deveria`);
});

ok("SEM o deslocamento de 90° o setor cai no lugar errado — o teste morde", () => {
  // Um teste que passa com a implementação certa e também com a errada não
  // testa nada. Este monta o setor sem o +90° e exige que ele erre.
  const [O, L, S, N] = [-45, -22.5, 0, 22.5];
  const errado = new THREE.SphereGeometry(
    1, 12, 12,
    O * rad, (L - O) * rad,          // sem o +90
    (90 - N) * rad, (N - S) * rad,
  );
  const alvo = paraCena(N, O);
  const { d } = maisProximo(errado, alvo);
  assert.ok(d > 0.5, `a versão errada devia errar muito, errou só ${d}`);
});

ok("o norte do setor fica ACIMA do sul, e não de cabeça para baixo", () => {
  // θ = π/2 − lat inverte o sentido: latitude cresce para o norte, θ cresce
  // para o sul. Trocar isso põe a imagem espelhada em latitude, que é o
  // defeito clássico de todo esquema de tiles.
  const geo = setor(-10, 10, 10, 40, 8);
  const p = geo.attributes.position;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < p.count; i++) { yMin = Math.min(yMin, p.getY(i)); yMax = Math.max(yMax, p.getY(i)); }
  perto(yMax, Math.sin(40 * rad), 1e-6, "borda norte");
  perto(yMin, Math.sin(10 * rad), 1e-6, "borda sul");
});

console.log("\naltura da malha");

ok("o exagero levanta o vértice ao longo da NORMAL, sem mexer em lat/lng", () => {
  // A malha desloca o raio: r(1 + t·exagero). Isso tem que mover o ponto para
  // FORA, na direção do próprio ponto — e não para o lado, o que arrastaria o
  // valor para outra coordenada.
  const base = paraCena(-23.55, -46.63, 1);
  const alto = paraCena(-23.55, -46.63, 1.12);
  const dir = alto.clone().sub(base).normalize();
  perto(dir.dot(base.clone().normalize()), 1, 1e-12, "o deslocamento não é radial");
  perto(alto.length() / base.length(), 1.12, 1e-12, "a razão de raios");
});

ok("exagero zero devolve a malha exatamente sobre a esfera", () => {
  for (const [lat, lng] of [[0, 0], [45, 90], [-80, -170], [90, 0]]) {
    perto(paraCena(lat, lng, 1 * (1 + 0 * 0.12)).length(), 1, 1e-12, `(${lat},${lng})`);
  }
});

// -----------------------------------------------------------------------------
// O ENROLAMENTO DOS TRIANGULOS — o defeito que custou uma versao inteira
// -----------------------------------------------------------------------------
// A malha e' uma superficie levantada sobre a esfera. Enquanto o material foi
// DoubleSide, a ORIENTACAO dos triangulos nao importava: os dois lados
// desenhavam. Ao trocar para FrontSide, as faces do lado de ca' passaram a ser
// descartadas -- porque a normal apontava para DENTRO do planeta -- e sobrou
// so' a metade de tras, visivel apenas no anel em volta do disco.
//
// Na tela: a malha "aparecia de lado" e sumia no meio. Nenhum teste pegou,
// porque nenhum media a orientacao. Este mede, e le a ordem dos indices do
// PROPRIO fonte, para a correcao nao poder ser desfeita em silencio.
// -----------------------------------------------------------------------------

const fonteMalha = readFileSync(fileURLToPath(new URL("../src/malha/malha3d.ts", import.meta.url)), "utf8");

ok("a ordem dos indices no fonte e a que aponta para FORA", () => {
  const m = /idx\.push\(([^)]+)\);/.exec(fonteMalha);
  assert.ok(m, "nao achei o idx.push no fonte da malha");
  const ordem = m[1].split(",").map((s) => s.trim());
  assert.equal(ordem.length, 6, "esperava dois triangulos: " + m[1]);

  const nx = 8, ny = 5;
  const P = (j, i) => {
    const la = (latDaLinha(j, ny) * Math.PI) / 180;
    const lo = (lngDaColuna(i, nx) * Math.PI) / 180;
    const c = Math.cos(la);
    return new THREE.Vector3(100 * c * Math.sin(lo), 100 * Math.sin(la), 100 * c * Math.cos(lo));
  };

  let fora = 0, dentro = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx; i++) {
      const i1 = (i + 1) % nx;
      const V = { a: P(j, i), b: P(j, i1), c: P(j + 1, i1), d: P(j + 1, i) };
      for (const tri of [ordem.slice(0, 3), ordem.slice(3, 6)]) {
        const [X, Y, Z] = tri.map((k) => V[k]);
        const n = new THREE.Vector3().subVectors(Y, X).cross(new THREE.Vector3().subVectors(Z, X));
        (n.dot(X) > 0 ? fora++ : dentro++);
      }
    }
  }
  assert.equal(dentro, 0,
    `${dentro} de ${fora + dentro} triangulos apontam para DENTRO: com FrontSide a malha some do meio do disco`);
});

// Superficie de analise TAPA o que esta atras dela. Translucida, ela somava com
// a textura da Terra e nenhuma das duas ficava legivel.
ok("a malha e opaca por padrao e escreve profundidade", () => {
  assert.match(fonteMalha, /depthWrite:\s*true/, "sem depthWrite a malha nao oclui o planeta");
  assert.match(fonteMalha, /opc\.opacidade \?\? 1\) < 1/, "voltou a nascer translucida");
});

console.log(`\n  ${n} verificações da geometria do globo\n`);
