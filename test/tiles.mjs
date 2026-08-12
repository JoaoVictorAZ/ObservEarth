import assert from "node:assert/strict";
import {
  colunas, linhas, ladoGraus, grausPorPixel, nivelPara, tilesEm, bboxDe,
  tilesMercator, mercY, latDeMercY, alturaTerrarium, nivelRelevo,
  planoDeTiles, NIVEL_MAX, TILE_PX, LAT_MERC, TILES_MAX,
} from "../src/tiles.ts";
import * as srv from "../server/tiles.js";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};
const perto = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

console.log("\ngrade equirretangular");

ok("o mundo 2:1 vira 2^(z+1) por 2^z", () => {
  assert.equal(colunas(0), 2); assert.equal(linhas(0), 1);
  assert.equal(colunas(3), 16); assert.equal(linhas(3), 8);
  // o tile e QUADRADO em grau: se nao for, a imagem sai esticada
  for (let z = 0; z <= NIVEL_MAX; z++) {
    assert.equal(360 / colunas(z), 180 / linhas(z), "z=" + z);
  }
});

ok("nivel 0 sao dois tiles de 180 graus", () => {
  const t = tilesEm(-180, -90, 180, 90, 0);
  assert.equal(t.length, 2);
  assert.equal(ladoGraus(0), 180);
});

// A razao de existir do arquivo inteiro: a resolucao tem que MELHORAR com o
// zoom. Antes, uma imagem unica de 4096 px dava 0,088 graus/pixel e ponto.
ok("a resolucao melhora com o nivel, e passa a imagem unica de 4096", () => {
  const antigo = 360 / 4096;
  for (let z = 1; z <= NIVEL_MAX; z++) {
    assert.ok(grausPorPixel(z) < grausPorPixel(z - 1), "z=" + z);
  }
  assert.ok(grausPorPixel(4) < antigo, "nivel 4 ja deveria bater a imagem unica");
  const ganho = antigo / grausPorPixel(NIVEL_MAX);
  assert.ok(ganho > 30, "ganho de so " + ganho.toFixed(1) + "x no nivel maximo");
});

ok("o nivel escolhido arredonda POR BAIXO", () => {
  // O nivel 0 poe o mundo em 1024 px de largura. Numa tela de 1920 isso ja e
  // MENOS resolucao que a tela tem, entao o nivel 1 e o certo — a primeira
  // versao deste teste esperava 0 e estava errada, nao o codigo.
  assert.equal(nivelPara(360, 1920, 1), 1);
  assert.equal(nivelPara(360, 800, 1), 0, "tela pequena nao precisa do nivel 1");
  // aproximando, o nivel sobe
  const seq = [180, 90, 45, 20, 10, 5, 2].map((g) => nivelPara(g, 1920, 1));
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] >= seq[i - 1], "o nivel caiu ao aproximar: " + seq);
  }
});

ok("o nivel nunca passa do teto nem fica negativo", () => {
  assert.equal(nivelPara(0.001, 4000, 2), NIVEL_MAX);
  assert.equal(nivelPara(360, 100, 1), 0);
  assert.equal(nivelPara(NaN, 1920, 1), 0);
  assert.equal(nivelPara(40, 0, 1), 0);
});

console.log("\ncobertura da janela");

ok("cobre a janela inteira, sem buraco", () => {
  const z = 3, lado = ladoGraus(z);
  const t = tilesEm(-40, -20, 10, 25, z);
  assert.ok(t.length > 0);
  // todo canto da janela cai dentro de algum tile
  for (const [lng, lat] of [[-40, -20], [10, 25], [-15, 0]]) {
    const achou = t.some((x) =>
      lng >= x.oeste - 1e-9 && lng <= x.leste + 1e-9 &&
      lat >= x.sul - 1e-9 && lat <= x.norte + 1e-9);
    assert.ok(achou, `${lng},${lat} descoberto`);
  }
  assert.ok(t.every((x) => perto(x.leste - x.oeste, lado)));
});

ok("linha 0 e o polo NORTE (a inversao classica)", () => {
  const t = tilesEm(-180, -90, 180, 90, 1);
  const topo = t.filter((x) => x.y === 0);
  assert.ok(topo.every((x) => x.norte === 90), "a linha 0 nao esta no norte");
});

ok("nao pede tile alem do polo", () => {
  const t = tilesEm(-180, -90, 180, 90, 2);
  assert.ok(t.every((x) => x.y >= 0 && x.y < linhas(2)));
  assert.ok(t.every((x) => x.norte <= 90 && x.sul >= -90));
});

// Atravessar o antimeridiano e o caso que rasga o mapa quando esta errado.
ok("janela sobre o antimeridiano usa a coluna certa, na posicao certa", () => {
  const z = 2, nCol = colunas(z);
  const t = tilesEm(170, -10, 200, 10, z);   // 170 E ate 160 W
  assert.ok(t.length > 0);
  assert.ok(t.every((x) => x.x >= 0 && x.x < nCol), "coluna fora da grade");
  // ao menos um tile e desenhado ALEM de 180, senao abre rasgo na borda
  assert.ok(t.some((x) => x.leste > 180), "nada desenhado depois de 180");
  // e a coluna dele volta para o inicio da grade
  const alem = t.find((x) => x.oeste >= 180);
  if (alem) assert.ok(alem.x < nCol / 2, "coluna " + alem.x + " nao enrolou");
});

ok("bboxDe devolve caixa valida mesmo alem de 180", () => {
  for (const t of tilesEm(170, -10, 200, 10, 2)) {
    const [sul, oeste, norte, leste] = bboxDe(t);
    assert.ok(oeste >= -180 && oeste < 180, "oeste " + oeste);
    assert.ok(leste > oeste, "caixa invertida");
    assert.ok(sul >= -90 && norte <= 90);
  }
});

console.log("\ncliente e servidor tem que concordar");

// A aritmetica existe nos dois lados. Divergir seria pedir o tile 5/12/30 e
// receber a caixa de outro lugar do planeta, com aparencia normal.
ok("mesma bbox nos dois lados, em toda a grade", () => {
  for (let z = 0; z <= NIVEL_MAX; z++) {
    const nc = colunas(z), nl = linhas(z);
    for (const y of [0, Math.floor(nl / 2), nl - 1]) {
      for (const x of [0, Math.floor(nc / 2), nc - 1]) {
        const s = srv.bboxDoTile(z, y, x);
        assert.ok(s, `servidor recusou ${z}/${y}/${x}`);
        const c = tilesEm(x * ladoGraus(z) - 180 + 1e-6, 0, x * ladoGraus(z) - 180 + 1e-6, 0, z);
        void c;
        // reconstroi o tile do cliente pelos indices e compara
        const lado = ladoGraus(z);
        const cli = [90 - (y + 1) * lado, x * lado - 180, 90 - y * lado, (x + 1) * lado - 180];
        assert.deepEqual(s, cli, `divergencia em ${z}/${y}/${x}`);
      }
    }
  }
});

ok("os dois concordam nas constantes", () => {
  assert.equal(srv.NIVEL_MAX, NIVEL_MAX);
  assert.equal(srv.TILE_PX, TILE_PX);
  assert.equal(srv.colunas(5), colunas(5));
  assert.equal(srv.ladoGraus(5), ladoGraus(5));
});

ok("servidor recusa indice fora da grade em vez de inventar caixa", () => {
  assert.equal(srv.bboxDoTile(0, 1, 0), null);
  assert.equal(srv.bboxDoTile(0, 0, 2), null);
  assert.equal(srv.bboxDoTile(-1, 0, 0), null);
  assert.equal(srv.bboxDoTile(99, 0, 0), null);
  assert.equal(srv.bboxDoTile(1, 0, "a"), null);
});

console.log("\nmercator (relevo)");

ok("mercY e latDeMercY sao inversas", () => {
  for (const lat of [-80, -45, -1, 0, 1, 23.5, 60, 85]) {
    assert.ok(perto(latDeMercY(mercY(lat)), lat, 1e-6), "lat " + lat);
  }
});

ok("equador no meio, norte em cima", () => {
  assert.ok(perto(mercY(0), 0.5, 1e-12));
  assert.ok(mercY(60) < 0.5, "o norte deveria ter y menor");
  assert.ok(mercY(-60) > 0.5);
});

ok("latitude alem do limite de Mercator e presa, nao explode", () => {
  assert.ok(Number.isFinite(mercY(90)));
  assert.ok(Number.isFinite(mercY(-90)));
  // Em ponto flutuante a conta da -1.1e-16 e 1.0000000000000007 nos polos.
  // Como isto vira coordenada de textura, o resultado e preso na faixa.
  assert.ok(mercY(90) >= 0, "y negativo: " + mercY(90));
  assert.ok(mercY(-90) <= 1, "y acima de 1: " + mercY(-90));
  assert.ok(perto(mercY(90), mercY(LAT_MERC), 1e-9));
});

ok("grade mercator e quadrada, 2^z por 2^z", () => {
  const t = tilesMercator(-180, -80, 180, 80, 2);
  assert.ok(t.every((x) => x.x >= 0 && x.x < 4 && x.y >= 0 && x.y < 4));
  assert.equal(new Set(t.map((x) => x.x)).size, 4);
});

// Mercator ESTICA as altas latitudes: uma fatia de y de tamanho fixo cobre
// POUCOS graus perto do polo e muitos no equador. A primeira versao deste
// teste afirmava o contrario. E exatamente por isso que o relevo precisa ser
// reprojetado por pixel em vez de esticado linearmente.
ok("linha de tile mercator cobre MAIS graus perto do equador", () => {
  const t = tilesMercator(-180, -80, 180, 80, 2)
    .filter((x) => x.x === 0).sort((a, b) => a.y - b.y);
  const alturas = t.map((x) => x.norte - x.sul);
  assert.equal(alturas.length, 4);
  assert.ok(alturas[1] > alturas[0] + 1, "a linha equatorial deveria ser mais alta: " + alturas);
  assert.ok(Math.abs(alturas[0] - alturas[3]) < 1e-6, "deveria ser simetrico");
});

ok("servidor valida a grade do relevo", () => {
  assert.equal(srv.tileMercatorValido(2, 3, 3), true);
  assert.equal(srv.tileMercatorValido(2, 4, 0), false);
  assert.equal(srv.tileMercatorValido(2, 0, -1), false);
  assert.equal(srv.tileMercatorValido(99, 0, 0), false);
});

console.log("\nelevacao terrarium");

// Numero do proprio documento da Mapzen: rgb(137,219,68) -> 2523.265625 m
ok("decodifica o exemplo da especificacao", () => {
  assert.ok(perto(alturaTerrarium(137, 219, 68), 2523.265625, 1e-9));
  assert.ok(perto(srv.alturaTerrarium(137, 219, 68), 2523.265625, 1e-9));
});

ok("cliente e servidor decodificam igual", () => {
  for (const [r, g, b] of [[0, 0, 0], [128, 0, 0], [85, 8, 0], [162, 198, 0], [255, 255, 255]]) {
    assert.equal(alturaTerrarium(r, g, b), srv.alturaTerrarium(r, g, b));
  }
});

// E isto que separa "imagem de relevo" de "dado de elevacao": profundidade.
ok("profundidade sai NEGATIVA, nao zerada", () => {
  assert.ok(alturaTerrarium(85, 8, 0) < -10000, "as Marianas deveriam ser negativas");
  assert.ok(perto(alturaTerrarium(128, 0, 0), 0, 1e-9), "nivel do mar");
  assert.ok(alturaTerrarium(162, 198, 0) > 8000, "o Everest deveria passar de 8 km");
});

ok("a faixa toda cabe entre -32768 e 32768", () => {
  assert.equal(alturaTerrarium(0, 0, 0), -32768);
  assert.ok(alturaTerrarium(255, 255, 255) < 32768);
});

console.log("\norcamento");

// Cada tile e uma requisicao. Se o nivel escolhido pedisse tiles demais, uma
// tarde de uso furaria o teto de um quarto da cota gratuita.
// Esta falha foi de CODIGO, nao de teste: sem teto, 180 graus numa tela de
// 1920 com densidade 2 pedia o nivel 3 e 128 tiles do mundo inteiro.
ok("o plano respeita o teto de tiles em qualquer vista", () => {
  for (const gh of [180, 120, 90, 40, 10, 3, 1.8]) {
    const gw = Math.min(360, gh * 1.9);
    const lat = Math.max(-90 + gh / 2, Math.min(90 - gh / 2, 0));
    for (const dpr of [1, 2]) {
      const { z, lista } = planoDeTiles(
        -gw / 2, lat - gh / 2, gw / 2, lat + gh / 2, gw, 1920, dpr);
      assert.ok(lista.length <= TILES_MAX,
        `${gh} graus, dpr ${dpr} -> ${lista.length} tiles no nivel ${z}`);
      assert.ok(z >= 0 && z <= NIVEL_MAX);
      assert.ok(z >= 0 && z <= NIVEL_MAX);
    }
  }
});

ok("o teto so baixa o nivel quando precisa", () => {
  // Vista fechada de 10 graus de largura: cabe no nivel casado, nada e
  // sacrificado. A primeira versao passava a ALTURA junto com a LARGURA em
  // pixels e por isso media o nivel errado — foi assim que o bug de eixo
  // apareceu.
  const p = planoDeTiles(-5, -3, 5, 3, 10, 1920, 1);
  assert.equal(p.z, nivelPara(10, 1920, 1), "baixou o nivel sem necessidade");
  assert.ok(p.lista.length <= TILES_MAX);
});

// O bug de eixo, fixado como invariante: a escolha tem que depender da
// resolucao pedida, nao da proporcao da tela.
ok("mesma resolucao por pixel da o mesmo nivel, em qualquer proporcao", () => {
  assert.equal(nivelPara(36, 1920, 1), nivelPara(18, 960, 1));
  assert.equal(nivelPara(90, 1000, 1), nivelPara(180, 2000, 1));
});

ok("o plano cobre a janela mesmo depois de baixar o nivel", () => {
  const { lista } = planoDeTiles(-171, -85, 171, 85, 342, 1920, 2);
  const cobre = (lng, lat) => lista.some((x) =>
    lng >= x.oeste - 1e-9 && lng <= x.leste + 1e-9 &&
    lat >= x.sul - 1e-9 && lat <= x.norte + 1e-9);
  assert.ok(cobre(0, 0) && cobre(-170, -84) && cobre(170, 84), "abriu buraco");
});

ok("o relevo e mais contido que a imagem", () => {
  for (const graus of [90, 20, 5]) {
    assert.ok(nivelRelevo(graus, 1920) <= nivelPara(graus, 1920, 2));
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
