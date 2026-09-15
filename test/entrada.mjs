import assert from "node:assert/strict";
import {
  suavizar, quadroEm, deveAnimar, criarVoo, fadeDoVento,
  PARTIDA, CHEGADA, DURACAO_MS,
} from "../src/globo/entrada.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\na curva");

ok("comeca em 0 e termina em 1, exatamente", () => {
  assert.equal(suavizar(0), 0);
  assert.equal(suavizar(1), 1);
});

ok("nunca anda para tras", () => {
  let ant = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const v = suavizar(t);
    assert.ok(v >= ant - 1e-12, "caiu em t=" + t.toFixed(2));
    ant = v;
  }
});

// A simetrica sai devagar, e o primeiro meio segundo -- quando a pessoa decide
// se aquilo travou -- nao mostra movimento nenhum.
ok("FREIA no fim, nao no comeco", () => {
  assert.ok(suavizar(0.25) > 0.5, "primeiro quarto so andou " + suavizar(0.25).toFixed(2));
  assert.ok(suavizar(0.75) > 0.98, "ultimo quarto ainda tem " + (1 - suavizar(0.75)).toFixed(3) + " para andar");
});

ok("tempo fora de 0..1 nao extrapola a camera para fora do sistema solar", () => {
  assert.equal(suavizar(-5), 0);
  assert.equal(suavizar(9), 1);
});

console.log("\no quadro");

ok("parte de longe e chega na altitude de trabalho", () => {
  const a = quadroEm(0), b = quadroEm(1);
  assert.equal(a.altitude, PARTIDA.altitude);
  assert.ok(Math.abs(b.altitude - CHEGADA.altitude) < 1e-9, "chegou em " + b.altitude);
  assert.ok(Math.abs(b.lat - CHEGADA.lat) < 1e-9);
});

ok("a partida mostra o planeta INTEIRO", () => {
  // altitude e em raios acima da superficie; abaixo de ~1 o disco ja transborda
  assert.ok(PARTIDA.altitude > 2.5, "partida em " + PARTIDA.altitude);
  assert.ok(PARTIDA.altitude > CHEGADA.altitude, "a camera estaria se AFASTANDO");
});

// Em escala linear o disco cresce devagar no comeco e explode no fim, porque o
// tamanho aparente e inverso da distancia.
ok("a altitude interpola em LOGARITMO, nao em linha reta", () => {
  const meio = quadroEm(0.5).altitude;
  const linear = PARTIDA.altitude + (CHEGADA.altitude - PARTIDA.altitude) * suavizar(0.5);
  const geometrico = Math.sqrt(PARTIDA.altitude * CHEGADA.altitude);
  assert.notEqual(meio, linear);
  // no meio EXATO da curva suavizada nao da a media geometrica, mas o valor
  // tem que estar do lado geometrico e nunca acima da reta
  assert.ok(meio < linear, `log ${meio.toFixed(3)} deveria ficar abaixo do linear ${linear.toFixed(3)}`);
  assert.ok(geometrico > 0);
});

ok("a altitude nunca fica negativa nem zero", () => {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    assert.ok(quadroEm(t).altitude > 0, "t=" + t.toFixed(2));
  }
});

console.log("\nquando NAO animar");

// Movimento de camera desencadeia enjoo vestibular em quem tem sensibilidade,
// e um voo de aproximacao e o caso classico.
ok("prefers-reduced-motion desliga, sem excecao", () => {
  assert.equal(deveAnimar({ reduzido: true, jaViu: false }), false);
  assert.equal(deveAnimar({ reduzido: true, jaViu: true }), false);
});

ok("uma vez por sessao: a abertura nao vira pedagio", () => {
  assert.equal(deveAnimar({ reduzido: false, jaViu: true }), false);
  assert.equal(deveAnimar({ reduzido: false, jaViu: false }), true);
});

console.log("\no voo");

ok("percorre do inicio ao fim conforme o relogio", () => {
  const v = criarVoo(1000);
  assert.equal(v.passo(1000).altitude, PARTIDA.altitude);
  const meio = v.passo(1000 + DURACAO_MS / 2);
  assert.ok(meio.altitude < PARTIDA.altitude && meio.altitude > CHEGADA.altitude);
  const fim = v.passo(1000 + DURACAO_MS);
  assert.ok(Math.abs(fim.altitude - CHEGADA.altitude) < 1e-9);
  assert.equal(v.ativo, false, "continuou ativo depois de chegar");
});

// Uma animacao que ignora a pessoa por dois segundos e uma tela travada, e ela
// vai clicar de novo achando que nao funcionou.
ok("cancelar para NA HORA e nao devolve mais quadro", () => {
  const v = criarVoo(0);
  v.passo(500);
  v.cancelar();
  assert.equal(v.passo(600), null, "continuou movendo a camera depois do cancelamento");
  assert.equal(v.ativo, false);
});

ok("relogio parado nao divide por zero", () => {
  const v = criarVoo(0, 0);
  const q = v.passo(0);
  assert.ok(Number.isFinite(q.altitude), "altitude " + q.altitude);
  assert.equal(q.altitude, CHEGADA.altitude, "duracao zero deveria entregar o destino");
});

ok("relogio que anda para tras nao devolve progresso negativo", () => {
  const v = criarVoo(1000);
  v.passo(500);
  assert.ok(v.progresso >= 0, "progresso " + v.progresso);
});

console.log("\nentrada do vento");

// O vento so e legivel quando o disco ja ocupa a tela; uma malha de linhas
// sobre um planeta pequeno e ruido.
ok("o vento entra na segunda metade", () => {
  assert.equal(fadeDoVento(0), 0);
  assert.equal(fadeDoVento(0.4), 0, "vento aceso com a camera ainda longe");
  assert.ok(fadeDoVento(0.8) > 0.3);
  assert.equal(fadeDoVento(1), 1);
});

ok("o fade tambem nao anda para tras", () => {
  let ant = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const v = fadeDoVento(t);
    assert.ok(v >= ant - 1e-12, "caiu em " + t.toFixed(2));
    ant = v;
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
