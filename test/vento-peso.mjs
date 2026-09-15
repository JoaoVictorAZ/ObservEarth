import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  pesoPorVelocidade, quadrosDeRastro, fadeParaQuadros, PESO_MINIMO, LIMIAR_VISIVEL,
} from "../src/globo/vento.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

console.log("\npeso por velocidade");

ok("vento forte pesa mais que vento fraco", () => {
  assert.ok(pesoPorVelocidade(0.9) > pesoPorVelocidade(0.1));
  assert.equal(pesoPorVelocidade(1), 1);
});

// Calmaria e informacao: a zona de convergencia intertropical, o olho de um
// ciclone e a sombra de vento de uma serra sao todos ausencia de vento.
ok("calmaria continua desenhada, so que discreta", () => {
  assert.equal(pesoPorVelocidade(0), PESO_MINIMO);
  assert.ok(PESO_MINIMO > 0.2, "piso " + PESO_MINIMO + " apagaria as regioes calmas");
  assert.ok(PESO_MINIMO < 0.6, "piso " + PESO_MINIMO + " nao destaca nada");
});

ok("nunca sai de 0..1, nem com entrada absurda", () => {
  for (const v of [-9, -1, 0, 0.5, 1, 7]) {
    const p = pesoPorVelocidade(v);
    assert.ok(p >= 0 && p <= 1, `v=${v} deu ${p}`);
  }
});

ok("a curva nao anda para tras", () => {
  let ant = -1;
  for (let v = 0; v <= 1.0001; v += 0.01) {
    const p = pesoPorVelocidade(v);
    assert.ok(p >= ant - 1e-12, "caiu em v=" + v.toFixed(2));
    ant = p;
  }
});

console.log("\ncomprimento do rastro");

// A intuicao erra nessa faixa: sete milesimos quase dobram o rastro.
ok("a conta bate com o decaimento por quadro", () => {
  assert.ok(Math.abs(quadrosDeRastro(0.986) - 327) < 3, "deu " + quadrosDeRastro(0.986).toFixed(1));
  assert.ok(Math.abs(quadrosDeRastro(0.992) - 573) < 3);
  assert.ok(Math.abs(quadrosDeRastro(0.985) - 305) < 3);
});

ok("mais fade e rastro MAIS longo", () => {
  assert.ok(quadrosDeRastro(0.992) > quadrosDeRastro(0.985));
});

// O TETO EXISTE PORQUE EU JA PASSEI DELE. Com rastro de ~573 quadros e 40 mil
// particulas as trilhas se fecham num tapete continuo e o planeta some debaixo
// do proprio campo de vento. A conta responde "quanto"; so a tela responde
// "quanto e demais" -- e este teto guarda a resposta da tela.
ok("o rastro em uso nao fecha o planeta num tapete", () => {
  assert.ok(quadrosDeRastro(0.986) < 400,
    "rastro de " + quadrosDeRastro(0.986).toFixed(0) + " quadros fecha a superficie");
});

ok("as duas contas sao inversas uma da outra", () => {
  for (const q of [60, 300, 573, 1200]) {
    const f = fadeParaQuadros(q);
    assert.ok(Math.abs(quadrosDeRastro(f) - q) < 1e-6, `${q} -> ${f} -> ${quadrosDeRastro(f)}`);
  }
});

ok("fade 1 nunca apaga, e isso e dito e nao dividido por zero", () => {
  assert.equal(quadrosDeRastro(1), Infinity);
  assert.equal(quadrosDeRastro(1.5), Infinity);
  assert.equal(quadrosDeRastro(0), Infinity);
  assert.equal(fadeParaQuadros(0), 0);
});

ok("o limiar declarado e o do visivel, nao zero absoluto", () => {
  assert.ok(LIMIAR_VISIVEL > 0 && LIMIAR_VISIVEL < 0.1, "limiar " + LIMIAR_VISIVEL);
});

console.log("\no GLSL e a copia em JavaScript falam do mesmo numero");

const wind = readFileSync(fileURLToPath(new URL("../src/windGPU.ts", import.meta.url)), "utf8");

ok("o peso do shader tem o mesmo piso e os mesmos limiares", () => {
  assert.match(wind, /float peso = 0\.35 \+ 0\.65 \* smoothstep\(0\.05, 0\.55, vSpeed\)/,
    "a curva do shader divergiu de pesoPorVelocidade");
});

ok("o peso realmente multiplica a opacidade final", () => {
  assert.match(wind, /gl_FragColor = vec4\(col, a \* fade \* peso/,
    "o peso foi calculado e jogado fora");
});

// Aditivo satura contra a textura clara do lado diurno e o rastro sumiria
// justamente onde o fundo e mais claro.
ok("o vento NAO usa blending aditivo", () => {
  const globe = readFileSync(fileURLToPath(new URL("../src/globe.ts", import.meta.url)), "utf8");
  const bloco = globe.slice(globe.indexOf("this.windMat = new THREE.ShaderMaterial"), globe.indexOf("this.windMesh = new THREE.Mesh"));
  assert.ok(!/AdditiveBlending/.test(bloco), "o rastro vai sumir sobre o lado diurno");
});

ok("o decaimento em uso e o documentado", () => {
  assert.match(wind, /fade = 0\.986;/, "o fade mudou sem a conta ser refeita");
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
