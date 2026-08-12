// test/vorticidade.mjs
// -----------------------------------------------------------------------------
// DETECÇÃO DE CIRCULAÇÃO.
//
// "o vento do Rio foi devido a um ciclone na costa e NÃO É POSSÍVEL IDENTIFICAR
//  ELE através dos dados de vento que estão no app"
//
// O erro de fundo que este módulo corrige é meu: eu vinha tratando "ver o
// ciclone" como um problema de RENDERIZAÇÃO — brilho, rampa, contraste. Não é.
// Um jato de altos níveis tem 60 m/s e não é ciclone; o ciclone subtropical da
// costa do Sudeste tem 20-25 m/s e é. O que os separa é a ROTAÇÃO, e rotação
// se mede, não se pinta.
//
// O TESTE QUE MAIS IMPORTA É O DO SINAL.
// No hemisfério SUL o ciclone gira em sentido HORÁRIO, o que dá vorticidade
// NEGATIVA. Inverter esse sinal faria o detector marcar ANTICICLONES como
// ciclones — e anticiclone é céu limpo. Num aplicativo de monitoramento,
// apontar tempo bom onde há tempestade é o pior erro que existe.
//
// Por isso o caso de referência é o próprio evento do relato: uma circulação
// horária ao largo do Rio de Janeiro, a 23°S.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  coriolis, vorticidade, ehCiclonico, acharCentros, classificar,
} from "../server/vorticidade.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ndetecção de circulação");

/**
 * Monta um campo com um vórtice em corpo rígido no centro dado.
 *
 * `sentido` = +1 gira anti-horário (ciclônico no NORTE),
 *             −1 gira horário      (ciclônico no SUL).
 */
function campoComVortice({
  nx = 360, ny = 181, latC, lngC, raioDeg = 6, vMax = 25, sentido = -1, fundo = 0,
} = {}) {
  const u = new Float32Array(nx * ny);
  const v = new Float32Array(nx * ny);
  const dLat = 180 / (ny - 1), dLng = 360 / nx;
  for (let j = 0; j < ny; j++) {
    const lat = 90 - j * dLat;
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    for (let i = 0; i < nx; i++) {
      const lng = ((i * dLng + 180) % 360) - 180;
      const k = j * nx + i;
      u[k] = fundo;
      // distância em graus, com a longitude encolhida pelo cosseno
      let dx = (lng - lngC);
      if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
      dx *= cosLat;
      const dy = lat - latC;
      const r = Math.hypot(dx, dy);
      if (r > raioDeg * 1.6 || r < 1e-9) continue;
      // corpo rígido até o raio, depois cai
      const mag = r <= raioDeg ? vMax * (r / raioDeg) : vMax * (raioDeg / r);
      // tangencial: (−dy, dx) é anti-horário
      u[k] += sentido * (-dy / r) * mag;
      v[k] += sentido * (dx / r) * mag;
    }
  }
  return { nx, ny, u, v };
}

/**
 * Índice da célula mais próxima de (lat, lng).
 *
 * Escrever isto errado foi o primeiro erro deste arquivo: eu usei
 * `round((lng+180)/dLng)`, que supõe i=0 em −180°. A convenção do GFS — e a
 * que `acharCentros` usa — é i=0 em 0°E, com o antimeridiano no meio do
 * arranjo. O teste apontava para +138° enquanto o vórtice estava em −42°, e
 * relatou ζ = 0 num campo perfeitamente correto.
 */
function idxDe(lat, lng, nx, ny) {
  const dLat = 180 / (ny - 1), dLng = 360 / nx;
  const j = Math.round((90 - lat) / dLat);
  const i = Math.round((((lng % 360) + 360) % 360) / dLng) % nx;
  return { i, j, k: j * nx + i };
}

// ---------------------------------------------------------------------------
// coriolis e sinal
// ---------------------------------------------------------------------------
ok("Coriolis troca de sinal no equador e zera nele", () => {
  assert.ok(coriolis(45) > 0);
  assert.ok(coriolis(-45) < 0);
  assert.ok(Math.abs(coriolis(0)) < 1e-12);
  assert.ok(Math.abs(coriolis(90)) > Math.abs(coriolis(30)));
});

ok("ciclônico é MESMO sinal da latitude — norte anti-horário, sul horário", () => {
  // Inverter isto marcaria anticiclone (céu limpo) como ciclone.
  assert.equal(ehCiclonico(+1e-4, 40), true, "norte: ζ>0 é ciclônico");
  assert.equal(ehCiclonico(-1e-4, 40), false, "norte: ζ<0 é ANTIciclônico");
  assert.equal(ehCiclonico(-1e-4, -23), true, "sul: ζ<0 é ciclônico");
  assert.equal(ehCiclonico(+1e-4, -23), false, "sul: ζ>0 é ANTIciclônico");
});

ok("perto do equador nada é considerado circulação organizada", () => {
  // Sem Coriolis não há ciclone. Aceitar ali encheria a ZCIT de falsos.
  assert.equal(ehCiclonico(1e-3, 2), false);
  assert.equal(ehCiclonico(-1e-3, -3), false);
});

// ---------------------------------------------------------------------------
// o campo de vorticidade
// ---------------------------------------------------------------------------
ok("um giro horário no hemisfério sul dá vorticidade NEGATIVA", () => {
  const g = campoComVortice({ latC: -23, lngC: -42, sentido: -1 });
  const z = vorticidade(g);
  const { k } = idxDe(-23, -42, g.nx, g.ny);
  assert.ok(z[k] < 0, `ζ = ${z[k]}`);
});

ok("um giro anti-horário no hemisfério norte dá vorticidade POSITIVA", () => {
  const g = campoComVortice({ latC: 25, lngC: -70, sentido: +1 });
  const z = vorticidade(g);
  const { k } = idxDe(25, -70, g.nx, g.ny);
  assert.ok(z[k] > 0, `ζ = ${z[k]}`);
});

ok("escoamento uniforme tem vorticidade praticamente nula", () => {
  // Vento de oeste constante não gira. Se der vorticidade, o termo de cos φ
  // está errado e o detector vai achar ciclone em vento reto.
  const nx = 360, ny = 181;
  const g = { nx, ny, u: new Float32Array(nx * ny).fill(12), v: new Float32Array(nx * ny) };
  const z = vorticidade(g);
  for (let j = 30; j < ny - 30; j++) {
    const lat = 90 - j * (180 / (ny - 1));
    if (Math.abs(lat) > 60) continue;
    for (let i = 0; i < nx; i += 37) {
      // O resíduo é a vorticidade planetária do próprio escoamento zonal, que
      // é real e pequena: 12 m/s a 45° dá ~2e-6. Bem abaixo do limiar de 4e-5.
      assert.ok(Math.abs(z[j * nx + i]) < 5e-6,
        `lat ${lat.toFixed(0)}°: ζ = ${z[j * nx + i].toExponential(2)}`);
    }
  }
});

ok("o antimeridiano não vira uma parede de vorticidade falsa", () => {
  // Sem o módulo na longitude, a coluna 0 e a última viram uma descontinuidade
  // de polo a polo — uma linha reta de "ciclones" em 180°.
  const g = campoComVortice({ latC: -30, lngC: 179, sentido: -1 });
  const z = vorticidade(g);
  const ny = g.ny, nx = g.nx;
  const { j } = idxDe(10, 0, nx, ny);   // longe do vórtice
  assert.ok(Math.abs(z[j * nx + 0]) < 5e-6, "coluna 0 com vorticidade espúria");
  assert.ok(Math.abs(z[j * nx + (nx - 1)]) < 5e-6, "última coluna espúria");
});

// ---------------------------------------------------------------------------
// o caso do relato
// ---------------------------------------------------------------------------
ok("ACHA o ciclone ao largo do Rio de Janeiro", () => {
  // Circulação horária a 23°S, 42°O — a geometria do evento de 29/07.
  const g = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 5, vMax: 24, sentido: -1 });
  const c = acharCentros(g);
  assert.ok(c.length > 0, "não achou nenhuma circulação");
  const perto = c.find((x) => Math.hypot(x.lat + 23.5, x.lng + 41.5) < 3);
  assert.ok(perto, `nenhum centro perto do ponto; achou ${JSON.stringify(c.slice(0, 2))}`);
  assert.equal(perto.giro, "horário", "sentido de giro errado no hemisfério sul");
  assert.ok(perto.zeta < 0, "vorticidade devia ser negativa no sul");
});

ok("o vento reportado é o do ANEL, não o do olho", () => {
  // O centro de um ciclone é calmo. Medir ali daria o valor mais baixo do
  // sistema inteiro e faria um furacão parecer calmaria.
  const g = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 5, vMax: 24, sentido: -1 });
  const c = acharCentros(g).find((x) => Math.hypot(x.lat + 23.5, x.lng + 41.5) < 3);
  assert.ok(c.ventoMaxMs > 10, `vento do anel ${c.ventoMaxMs} m/s — pegou o olho`);
  assert.ok(c.raioDoMaxDeg > 0);
});

ok("um ANTICICLONE no mesmo lugar NÃO é reportado", () => {
  // Giro anti-horário no hemisfério sul é anticiclone: céu limpo. Marcá-lo
  // como ciclone é o pior erro possível num app de monitoramento.
  const g = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 5, vMax: 24, sentido: +1 });
  const c = acharCentros(g);
  const perto = c.find((x) => Math.hypot(x.lat + 23.5, x.lng + 41.5) < 3);
  assert.ok(!perto, "anticiclone foi reportado como ciclone");
});

ok("uma circulação devolve UM centro, não uma mancha", () => {
  const g = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 5, vMax: 24, sentido: -1 });
  const perto = acharCentros(g).filter((x) => Math.hypot(x.lat + 23.5, x.lng + 41.5) < 4);
  assert.ok(perto.length <= 2, `${perto.length} centros para uma só circulação`);
});

ok("campo sem rotação não produz centro nenhum", () => {
  const nx = 360, ny = 181;
  const g = { nx, ny, u: new Float32Array(nx * ny).fill(15), v: new Float32Array(nx * ny).fill(3) };
  assert.equal(acharCentros(g).length, 0, "achou ciclone em vento reto");
});

ok("dois sistemas distantes são achados separadamente", () => {
  const a = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 5, vMax: 24, sentido: -1 });
  const b = campoComVortice({ latC: 28, lngC: 135, raioDeg: 5, vMax: 40, sentido: +1 });
  for (let k = 0; k < a.u.length; k++) { a.u[k] += b.u[k]; a.v[k] += b.v[k]; }
  const c = acharCentros(a);
  assert.ok(c.some((x) => Math.hypot(x.lat + 23.5, x.lng + 41.5) < 3), "perdeu o do Rio");
  assert.ok(c.some((x) => Math.hypot(x.lat - 28, x.lng - 135) < 3), "perdeu o do Pacífico");
  assert.equal(c.find((x) => x.lat > 0).giro, "anti-horário");
});

ok("o mais intenso vem primeiro", () => {
  const a = campoComVortice({ latC: -23.5, lngC: -41.5, raioDeg: 6, vMax: 18, sentido: -1 });
  const b = campoComVortice({ latC: -35, lngC: 150, raioDeg: 3, vMax: 45, sentido: -1 });
  for (let k = 0; k < a.u.length; k++) { a.u[k] += b.u[k]; a.v[k] += b.v[k]; }
  const c = acharCentros(a);
  assert.ok(Math.abs(c[0].zeta) >= Math.abs(c[c.length - 1].zeta));
});

// ---------------------------------------------------------------------------
// classificação
// ---------------------------------------------------------------------------
ok("a classificação é conservadora e não promete o que não sabe", () => {
  assert.equal(classificar(24).nivel, 0);          // tempestade tropical
  assert.equal(classificar(35).nivel, 1);
  assert.equal(classificar(75).nivel, 5);
  assert.equal(classificar(12).nivel, -1);
  assert.match(classificar(12).nome, /circulação fechada/);
  // Diz "vento de categoria", não "furacão categoria": um modelo global não
  // distingue tropical de subtropical de baixa frontal só pelo vento.
  assert.match(classificar(60).nome, /vento de categoria/);
  assert.equal(classificar(null), null);
});

console.log(`\n  ${n} verificações da detecção de circulação\n`);
export default n;
