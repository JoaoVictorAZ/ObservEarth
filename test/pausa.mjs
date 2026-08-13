import assert from "node:assert/strict";
import { EstadoAnimacao } from "../src/pausa.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

/**
 * Dublê do globe.gl.
 *
 * O detalhe que importa: `retomar` REENTRA. No globe.gl de verdade ele roda um
 * ciclo de animacao na hora, que chama OrbitControls.update(), que emite
 * "change", que esta ligado de volta ao despertar. Sem reproduzir isso aqui, o
 * teste passaria e o navegador continuaria estourando a pilha.
 */
function dubleReentrante() {
  const log = [];
  let estado = null;
  const m = {
    retomar() {
      log.push("retomar");
      // o "change" do OrbitControls, disparado de dentro do proprio retomar
      estado?.despertar();
    },
    pausar() { log.push("pausar"); },
  };
  const e = new EstadoAnimacao(m);
  estado = e;
  return { e, log };
}

console.log("\nreentrancia (o bug que derrubou a aplicacao)");

// Sintoma real: "Maximum call stack size exceeded", com a pilha alternando
// entre wake -> resumeAnimation -> tick -> controls.update -> change -> wake.
// Derrubava o componente React inteiro, nao so o globo.
ok("despertar NAO entra em recursao infinita", () => {
  const { e, log } = dubleReentrante();
  e.cederGpu(true);            // dorme
  e.cederGpu(false);           // acorda: aqui a reentrada acontece
  e.despertar();
  assert.ok(log.length < 10, "chamadas demais: " + log.length);
});

ok("retomar e chamado UMA vez por despertar", () => {
  const { e, log } = dubleReentrante();
  e.ocioseou(0);               // dorme por ocio
  log.length = 0;
  e.despertar();
  assert.deepEqual(log, ["retomar"], "chamou " + log.length + " vezes");
});

ok("a bandeira cai ANTES da chamada", () => {
  const passos = [];
  let e = null;
  e = new EstadoAnimacao({
    retomar() { passos.push(e.pausado); },   // o que a reentrada enxergaria
    pausar() {},
  });
  e.ocioseou(0);
  e.despertar();
  assert.deepEqual(passos, [false], "a reentrada veria a bandeira ainda em pe");
});

console.log("\nnao duplicar o laco de animacao");

// Retomar o que nunca foi pausado poe um SEGUNDO laco a correr junto do
// primeiro, e a partir dai cada quadro e desenhado duas vezes.
ok("despertar acordado nao chama retomar", () => {
  const { e, log } = dubleReentrante();
  e.despertar();
  e.despertar();
  assert.deepEqual(log, [], "retomou sem nunca ter pausado");
});

ok("ceder duas vezes seguidas nao repete a chamada", () => {
  const { e, log } = dubleReentrante();
  e.cederGpu(true);
  e.cederGpu(true);
  e.cederGpu(true);
  assert.deepEqual(log, ["pausar"], "pausou " + log.length + " vezes");
});

ok("devolver a GPU duas vezes nao repete a chamada", () => {
  const { e, log } = dubleReentrante();
  e.cederGpu(true);
  log.length = 0;
  e.cederGpu(false);
  e.cederGpu(false);
  assert.deepEqual(log, ["retomar"], "retomou " + log.length + " vezes");
});

console.log("\nprioridade: o pedido externo vence");

ok("cedendo a GPU, despertar nao acorda", () => {
  const { e, log } = dubleReentrante();
  e.cederGpu(true);
  log.length = 0;
  e.despertar();
  e.animando();
  assert.deepEqual(log, [], "acordou durante a geracao do modelo");
  assert.equal(e.pausado, true);
});

ok("cedendo a GPU, o ocio nao muda nada", () => {
  const { e, log } = dubleReentrante();
  e.cederGpu(true);
  log.length = 0;
  for (let i = 0; i < 200; i++) e.ocioseou();
  assert.deepEqual(log, [], "mexeu no laco enquanto cedia");
});

console.log("\nocio");

ok("dorme so depois do limite, e uma vez so", () => {
  const { e, log } = dubleReentrante();
  for (let i = 0; i < 90; i++) assert.equal(e.ocioseou(90), false, "dormiu cedo no quadro " + i);
  assert.equal(e.ocioseou(90), true, "nao dormiu depois do limite");
  for (let i = 0; i < 10; i++) e.ocioseou(90);
  assert.deepEqual(log, ["pausar"], "pausou " + log.length + " vezes");
});

ok("qualquer atividade zera a contagem", () => {
  const { e } = dubleReentrante();
  for (let i = 0; i < 80; i++) e.ocioseou(90);
  e.animando();
  assert.equal(e.quadrosOciosos, 0);
  for (let i = 0; i < 90; i++) assert.equal(e.ocioseou(90), false);
});

ok("um ciclo completo volta ao estado inicial", () => {
  const { e } = dubleReentrante();
  assert.equal(e.pausado, false);
  e.cederGpu(true);
  assert.equal(e.pausado, true);
  assert.equal(e.cedendoGpu, true);
  e.cederGpu(false);
  assert.equal(e.pausado, false);
  assert.equal(e.cedendoGpu, false);
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
