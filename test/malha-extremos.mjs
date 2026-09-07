// test/malha-extremos.mjs
// -----------------------------------------------------------------------------
// PONTOS CRÍTICOS — e um invariante que não depende de meteorologia nenhuma.
// -----------------------------------------------------------------------------
// O TESTE DE FUNDO É TOPOLÓGICO, e ele é forte de um jeito raro.
//
// Pela teoria de Morse, um campo escalar sobre uma esfera satisfaz
//
//     Σ índices = #máximos − #selas − 2·#selas de macaco + #mínimos = χ(S²) = 2
//
// SEMPRE. Não é propriedade do GFS, nem da nossa grade, nem do nosso código: é
// a característica de Euler da esfera. Um detector que devolve 2 está completo
// e consistente; um que devolve 312 está inventando pontos críticos, e não
// adianta olhar para os que ele achou — a lista inteira está sob suspeita.
//
// Este número já reprovou uma implementação inteira deste arquivo. A versão que
// classificava pelo sinal do determinante da Hessiana devolveu 312 contra o
// campo de pressão real do GFS, e a reescrita para o critério combinatório de
// Banchoff devolveu 2. A história está no cabeçalho de `src/malha/extremos.ts`.
//
// Por isso os testes daqui são de duas naturezas:
//
//   OS DE CAMPO CONHECIDO conferem que o detector acha o que se pôs lá.
//   OS DE INVARIANTE conferem que ele não acha o que não está lá — inclusive
//   em campos que ninguém desenhou, como ruído puro, onde a única coisa que se
//   pode afirmar de antemão é justamente o invariante.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { latDaLinha, lngDaColuna } from "../src/malha/campo.ts";
import {
  pontosCriticos, filtrarPorProeminencia, eulerPoincare,
  proeminenciaLocal, distanciaKm,
} from "../src/malha/extremos.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const rad = Math.PI / 180;
const perto = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""}: ${a} vs ${b} (tol ${tol})`);

function campoDe(nx, ny, f, extra = {}) {
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = f(latDaLinha(j, ny), lngDaColuna(i, nx));
  }
  return { nx, ny, valores: v, unidade: "u", titulo: "teste", ...extra };
}

/** ruído reprodutível: congruência linear, sem depender de Math.random */
function ruido(nx, ny, semente = 12345) {
  let s = semente;
  return campoDe(nx, ny, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  });
}

const NX = 360, NY = 181;
const TUDO = { incluirSelas: true };

console.log("\ncaracterística de Euler — o invariante");

ok("f = cos φ cos λ: um máximo, um mínimo, nenhuma sela, χ = 2", () => {
  // f é a coordenada x de um ponto da esfera unitária. Uma função linear do
  // espaço ambiente restrita à esfera tem exatamente DOIS pontos críticos —
  // os polos do eixo — e nenhuma sela. 1 − 0 + 1 = 2.
  const c = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  const ps = pontosCriticos(c, undefined, TUDO);
  const e = eulerPoincare(ps);
  assert.equal(e.maximos, 1, `máximos: ${e.maximos}`);
  assert.equal(e.minimos, 1, `mínimos: ${e.minimos}`);
  assert.equal(e.selas, 0, `selas: ${e.selas}`);
  assert.equal(e.caracteristica, 2, e.explicacao);
  assert.equal(e.consistente, true, e.explicacao);
});

ok("f = sen φ: os extremos estão NOS POLOS, e são achados lá", () => {
  // Este é o teste dos polos, e ele é o que a primeira versão não passava. A
  // linha 0 da grade tem nx cópias do mesmo ponto do espaço; tratá-las como nx
  // vértices distintos faz a soma dar 0 em vez de 2 — errado por exatamente os
  // dois polos que ficaram de fora.
  const c = campoDe(NX, NY, (lat) => Math.sin(lat * rad));
  const ps = pontosCriticos(c, undefined, TUDO);
  const e = eulerPoincare(ps);
  assert.equal(e.caracteristica, 2, e.explicacao);
  assert.equal(e.maximos, 1, `máximos: ${e.maximos}`);
  assert.equal(e.minimos, 1, `mínimos: ${e.minimos}`);
  assert.equal(e.selas, 0, `selas: ${e.selas}`);

  const mx = ps.find((p) => p.tipo === "maximo");
  const mn = ps.find((p) => p.tipo === "minimo");
  perto(mx.lat, 90, 1e-9, "o máximo devia estar no polo norte");
  perto(mn.lat, -90, 1e-9, "o mínimo devia estar no polo sul");
  // A Hessiana não existe no polo, e isso é DECLARADO em vez de escondido:
  // 1/cos φ explode ali. O tipo continua válido porque veio da contagem.
  assert.equal(mx.hessianaDegenerada, true, "curvatura no polo devia ser indecidível");
});

ok("f = cos²φ cos 2λ: dois máximos, dois mínimos, dois polos-sela, χ = 2", () => {
  const c = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) ** 2 * Math.cos(2 * lng * rad));
  const e = eulerPoincare(pontosCriticos(c, undefined, TUDO));
  assert.equal(e.maximos, 2, `máximos: ${e.maximos}`);
  assert.equal(e.minimos, 2, `mínimos: ${e.minimos}`);
  assert.equal(e.selas, 2, `selas: ${e.selas}`);
  assert.equal(e.caracteristica, 2, e.explicacao);
});

ok("RUÍDO PURO também fecha em 2 — e é aí que o invariante mostra o valor", () => {
  // Num campo aleatório não há gabarito: ninguém sabe quantos máximos deveriam
  // aparecer. A ÚNICA coisa afirmável de antemão é a topologia, e ela vale
  // igual. Um detector que só acerta em campo bonito não serve para dado real.
  for (const semente of [1, 7, 12345, 999983]) {
    const c = ruido(120, 61, semente);
    const ps = pontosCriticos(c, undefined, TUDO);
    const e = eulerPoincare(ps);
    assert.equal(e.caracteristica, 2, `semente ${semente}: ${e.explicacao}`);
    assert.ok(e.maximos > 50, `semente ${semente}: ruído devia ter muitos máximos`);
  }
});

ok("EMPATE não quebra a conta — o desempate simbólico é o que garante isso", () => {
  // Campo quantizado a 1 unidade: platôs por toda parte. Sem a perturbação
  // simbólica, "acima" e "abaixo" deixam de particionar o elo e o índice deixa
  // de existir — a soma sai qualquer coisa.
  const bruto = ruido(120, 61, 555);
  const c = campoDe(120, 61, () => 0);
  for (let k = 0; k < 120 * 61; k++) c.valores[k] = Math.round(bruto.valores[k] * 6);
  const e = eulerPoincare(pontosCriticos(c, undefined, TUDO));
  assert.equal(e.caracteristica, 2, `campo quantizado: ${e.explicacao}`);
});

ok("um campo CONSTANTE também fecha em 2, e não vira 65 mil máximos", () => {
  // Todo vizinho empata com todo centro. Com o desempate por índice, o campo
  // vira uma rampa infinitesimal e a topologia dela é a de qualquer rampa:
  // um máximo, um mínimo, e nada mais.
  const c = campoDe(120, 61, () => 1013.25);
  const ps = pontosCriticos(c, undefined, TUDO);
  const e = eulerPoincare(ps);
  assert.equal(e.caracteristica, 2, e.explicacao);
  assert.ok(ps.length < 10, `${ps.length} pontos críticos num campo plano`);
});

ok("a soma PARCIAL é declarada como parcial, e não vendida como consistente", () => {
  // Sem selas, ou numa janela recortada, χ = 2 não vale. O diagnóstico tem que
  // dizer isso em vez de reprovar um resultado correto para outra pergunta.
  const c = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  const semSelas = eulerPoincare(pontosCriticos(c), { comSelas: false });
  assert.equal(semSelas.consistente, false);
  assert.match(semSelas.explicacao, /parcial/);

  const filtrado = eulerPoincare(
    filtrarPorProeminencia(pontosCriticos(c, undefined, TUDO), 0.5),
    { filtrado: true },
  );
  assert.match(filtrado.explicacao, /parcial/);
});

console.log("\nlocalização e classificação");

ok("o máximo está em (0°, 0°) e o mínimo em (0°, 180°)", () => {
  const c = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  const ps = pontosCriticos(c);
  const mx = ps.find((p) => p.tipo === "maximo");
  const mn = ps.find((p) => p.tipo === "minimo");
  perto(mx.lat, 0, 1e-6, "lat do máximo");
  perto(mx.lng, 0, 1e-6, "lng do máximo");
  perto(mx.valor, 1, 1e-6, "valor do máximo");
  perto(mn.lat, 0, 1e-6, "lat do mínimo");
  perto(Math.abs(mn.lng), 180, 1e-6, "lng do mínimo");
  assert.equal(mx.indice, 1, "índice de Morse de um máximo é +1");
  assert.equal(mn.indice, 1, "índice de Morse de um mínimo também é +1");
});

ok("uma sela tem índice −1, e uma sela de macaco tem −2", () => {
  const c = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) ** 2 * Math.cos(2 * lng * rad));
  const selas = pontosCriticos(c, undefined, TUDO).filter((p) => p.tipo === "sela");
  assert.ok(selas.length > 0, "nenhuma sela encontrada");
  for (const s of selas) assert.ok(s.indice <= -1, `sela com índice ${s.indice}`);
});

ok("uma cúpula tem anisotropia 1; uma crista, muito maior", () => {
  const cupula = campoDe(NX, NY, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  const p1 = pontosCriticos(cupula).find((p) => p.tipo === "maximo");
  perto(p1.anisotropia, 1, 0.01, "anisotropia da cúpula");
  assert.equal(p1.hessianaDegenerada, false, "a curvatura de uma cúpula é decidível");

  const crista = campoDe(NX, NY, (lat, lng) =>
    Math.exp(-((lat / 2) ** 2)) * Math.exp(-((lng / 40) ** 2)));
  const p2 = pontosCriticos(crista).find((p) => p.tipo === "maximo");
  assert.ok(p2.anisotropia > 10, `crista com anisotropia ${p2.anisotropia}`);
  // Alongada leste-oeste: a curvatura FORTE é a meridional, então o autovetor
  // dominante aponta para o norte.
  assert.ok(p2.direcaoGraus < 5 || p2.direcaoGraus > 175, `direção ${p2.direcaoGraus}`);
});

ok("selas NÃO entram na lista sem serem pedidas", () => {
  const c = campoDe(NX, NY, (lat, lng) =>
    Math.cos(2 * lng * rad) - Math.cos(2 * lat * rad));
  assert.equal(pontosCriticos(c).filter((p) => p.tipo === "sela").length, 0);
  assert.ok(pontosCriticos(c, undefined, TUDO).some((p) => p.tipo === "sela"));
});

console.log("\nrefino sub-célula");

ok("o passo de Newton chega mais perto do que o vértice da grade", () => {
  const LAT0 = 10.3, LNG0 = -45.4, SIGMA = 3;
  const c = campoDe(NX, NY, (lat, lng) => {
    const dx = (lng - LNG0) * Math.cos(LAT0 * rad);
    const dy = lat - LAT0;
    return Math.exp(-((dx * dx + dy * dy) / (SIGMA * SIGMA)));
  });

  const p = pontosCriticos(c, { latSul: 0, latNorte: 20, lngOeste: -60, lngLeste: -30 })
    .find((q) => q.tipo === "maximo");
  assert.ok(p, "não achou o máximo");

  const cos = Math.cos(LAT0 * rad);
  const vertice = Math.hypot(latDaLinha(p.j, NY) - LAT0, (lngDaColuna(p.i, NX) - LNG0) * cos);
  const refinado = Math.hypot(p.lat - LAT0, (p.lng - LNG0) * cos);

  assert.ok(vertice > 0.2, `o vértice já estava em cima do centro (${vertice}°)`);
  assert.ok(refinado < vertice / 3,
    `refino não melhorou: vértice a ${vertice.toFixed(3)}°, refinado a ${refinado.toFixed(3)}°`);
  assert.ok(p.valor >= c.valores[p.j * NX + p.i], "valor refinado abaixo do vértice");
  assert.ok(p.valor <= 1 + 1e-6, "valor refinado acima do topo verdadeiro");
});

ok("o refino NUNCA sai da célula — nem em ruído puro", () => {
  const c = ruido(180, 91, 4242);
  const passoLat = 180 / 90, passoLng = 360 / 180;
  for (const p of pontosCriticos(c, undefined, TUDO)) {
    assert.ok(Math.abs(p.lat - latDaLinha(p.j, 91)) <= passoLat, `saltou em latitude`);
    assert.ok(Math.abs(p.lng - lngDaColuna(p.i, 180)) <= passoLng + 1e-9, `saltou em longitude`);
  }
});

console.log("\nproeminência e seleção");

ok("a proeminência mede a queda até o anel, e o raio é parte da pergunta", () => {
  // Cone de profundidade 10 com raio de 5°, centrado em (0°, 0°).
  const c = campoDe(NX, NY, (lat, lng) => {
    const d = Math.hypot(lat, lng);
    return d < 5 ? -10 * (1 - d / 5) : 0;
  });
  const fora = proeminenciaLocal(c, 0, 0, "minimo", 800);    // 800 km ≈ 7,2°
  perto(fora, 10, 0.5, "raio além do poço");
  const dentro = proeminenciaLocal(c, 0, 0, "minimo", 220);  // ≈ 2°
  assert.ok(dentro < fora, `anel interno (${dentro}) devia medir menos que o externo (${fora})`);
  assert.ok(dentro > 0, "o anel interno ainda devia enxergar a encosta");
});

ok("O ANEL É UM CÍRCULO EM QUILÔMETROS, e não uma elipse em células", () => {
  // O defeito que encheu a lista de extremos com a Antártida inteira.
  //
  // Num campo que só depende da LATITUDE, a proeminência tem que ser a mesma
  // em toda latitude onde o gradiente meridional é o mesmo — a longitude não
  // participa. Com o anel medido em CÉLULAS isso deixava de valer: a 85°,
  // quatro células valem 444 km em latitude e 39 km em longitude, então o anel
  // virava uma fatia fina que capturava o degrau meridional inteiro sem
  // nenhuma média com os vizinhos de leste e oeste.
  //
  // Aqui o campo é uma rampa pura em latitude: 1 unidade por grau.
  const c = campoDe(NX, NY, (lat) => lat);
  const raio = 300;   // km
  const noEquador = proeminenciaLocal(c, 0, 0, "maximo", raio);
  const em85 = proeminenciaLocal(c, 85, 0, "maximo", raio);
  const em85outraLng = proeminenciaLocal(c, 85, 150, "maximo", raio);

  // Mesma distância física, mesma queda — em qualquer latitude e longitude.
  perto(em85, noEquador, 0.2, "a 85° a proeminência divergiu do equador");
  perto(em85outraLng, em85, 1e-9, "a proeminência dependeu da longitude");
  // E o valor tem sentido físico: 300 km são 2,7° de latitude.
  perto(noEquador, 300 / 111.19, 0.2, "a queda não bate com a distância");
});

ok("no POLO o anel continua sendo um anel", () => {
  // A 89°, um raio de 450 km passa POR CIMA do polo. A fórmula geodésica
  // atravessa sem caso especial; uma varredura em células teria de dar a volta
  // na grade inteira para fazer o mesmo.
  const c = campoDe(NX, NY, (lat) => 90 - Math.abs(lat));
  const p = proeminenciaLocal(c, 89, 0, "minimo", 450);
  assert.ok(Number.isFinite(p), `proeminência no polo veio ${p}`);
  assert.ok(p > 0, "o polo é o mínimo deste campo e devia ter proeminência");
});

ok("o filtro descarta a marola, mantém o poço, e ordena pelo que importa", () => {
  const c = campoDe(NX, NY, (lat, lng) => {
    const poco = -20 * Math.exp(-(((lat - 30) ** 2 + (lng - 40) ** 2) / 25));
    const marola = -0.3 * Math.exp(-(((lat + 30) ** 2 + (lng + 40) ** 2) / 4));
    return poco + marola;
  });
  const todos = pontosCriticos(c, undefined, { raioKm: 500 });
  const filtrado = filtrarPorProeminencia(todos, 1);

  assert.ok(todos.length >= 2, `sem filtro deviam vir os dois: ${todos.length}`);
  assert.equal(filtrado.length, 1, `com filtro devia sobrar 1: ${filtrado.length}`);
  perto(filtrado[0].lat, 30, 0.5, "sobrou o poço errado");
});

ok("SEPARAÇÃO MÍNIMA: um fenômeno, uma linha", () => {
  // O outro lado do defeito da Antártida. Um degrau que corre ao longo de um
  // paralelo satisfaz o teste de extremo local em dezenas de colunas, e a lista
  // voltava com quinze recortes do MESMO fenômeno, com valores quase idênticos,
  // ocupando todas as vagas.
  // Uma crista ao longo do paralelo de 80°N, com uma ondulacao de periodo 4°
  // em longitude. Naquela latitude 4° sao 77 km, entao sao ~90 maximos locais
  // a menos de 100 km uns dos outros — todos o mesmo fenomeno.
  const c = campoDe(NX, NY, (lat, lng) =>
    -Math.abs(lat - 80) + 0.05 * Math.cos(lng * 90 * rad));
  const todos = pontosCriticos(c, undefined, { raioKm: 450 });

  const semSeparacao = filtrarPorProeminencia(todos, 0, 200, 0);
  const comSeparacao = filtrarPorProeminencia(todos, 0, 200, 600);

  assert.ok(semSeparacao.length > comSeparacao.length,
    `a separação não descartou nada: ${semSeparacao.length} contra ${comSeparacao.length}`);
  // Nenhum par aceito do mesmo tipo pode estar mais perto que a separação.
  for (let a = 0; a < comSeparacao.length; a++) {
    for (let b = a + 1; b < comSeparacao.length; b++) {
      const p = comSeparacao[a], q = comSeparacao[b];
      if (p.tipo !== q.tipo) continue;
      const d = distanciaKm(p.lat, p.lng, q.lat, q.lng);
      assert.ok(d >= 600, `dois "${p.tipo}" a ${d.toFixed(0)} km um do outro`);
    }
  }
});

ok("a separação NÃO apaga um máximo vizinho de um mínimo", () => {
  // Um gradiente forte é um par máximo/mínimo próximo, e os dois são
  // informação. Só duplicata do MESMO tipo é suprimida.
  const c = campoDe(NX, NY, (lat, lng) =>
    5 * Math.exp(-(((lat - 10) ** 2 + (lng - 10) ** 2) / 4))
    - 5 * Math.exp(-(((lat - 10) ** 2 + (lng - 16) ** 2) / 4)));
  const lista = filtrarPorProeminencia(
    pontosCriticos(c, undefined, { raioKm: 300 }), 0.5, 20, 900);
  assert.ok(lista.some((p) => p.tipo === "maximo"), "o máximo sumiu");
  assert.ok(lista.some((p) => p.tipo === "minimo"), "o mínimo sumiu");
});

ok("o teto devolve os MAIS proeminentes, não os primeiros da varredura", () => {
  const c = campoDe(NX, NY, (lat, lng) =>
    Math.sin(lat * 4 * rad) * Math.sin(lng * 4 * rad) * (1 + lat / 90));
  const todos = pontosCriticos(c);
  const cinco = filtrarPorProeminencia(todos, 0, 5, 0);
  assert.equal(cinco.length, 5);
  const maiores = filtrarPorProeminencia(todos, 0, 1e9, 0).slice(0, 5).map((p) => p.proeminencia);
  assert.deepEqual(cinco.map((p) => p.proeminencia), maiores);
});

ok("a distância de grande círculo bate com referências conhecidas", () => {
  perto(distanciaKm(-23.55, -46.63, 51.51, -0.13), 9480, 80, "São Paulo–Londres");
  perto(distanciaKm(0, 0, 0, 180), 20015, 20, "meio equador");
  assert.equal(distanciaKm(10, 20, 10, 20), 0, "distância de um ponto a ele mesmo");
});

console.log("\nrecusas honestas");

ok("buraco de dado não vira extremo: sem elo completo, não há índice", () => {
  const c = campoDe(180, 91, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  c.valido = new Uint8Array(180 * 91).fill(1);
  for (let j = 40; j < 46; j++) for (let i = 60; i < 66; i++) c.valido[j * 180 + i] = 0;
  for (const p of pontosCriticos(c, undefined, TUDO)) {
    const dentro = p.j >= 39 && p.j <= 46 && p.i >= 59 && p.i <= 66;
    assert.ok(!dentro, `extremo achado na borda do buraco em (${p.i},${p.j})`);
  }
});

ok("com buraco, a soma DEIXA de fechar — e o diagnóstico é quem avisa", () => {
  // Consequência direta do teste anterior, e vale registrar: vértices sem elo
  // completo saem da conta, então χ deixa de valer 2. Isso é correto e é
  // exatamente o que um diagnóstico deve tornar visível.
  const c = campoDe(120, 61, (lat, lng) => Math.cos(lat * rad) * Math.cos(lng * rad));
  c.valido = new Uint8Array(120 * 61).fill(1);
  for (let j = 20; j < 40; j++) for (let i = 20; i < 60; i++) c.valido[j * 120 + i] = 0;
  const e = eulerPoincare(pontosCriticos(c, undefined, TUDO));
  assert.notEqual(e.caracteristica, 2, "um campo com buraco não podia fechar em 2");
  assert.equal(e.consistente, false);
  assert.match(e.explicacao, /buracos|incompleta/);
});

console.log(`\n  ${n} verificações dos pontos críticos\n`);
