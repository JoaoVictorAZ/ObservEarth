import assert from "node:assert/strict";
import { explicarFalhaGpu } from "../src/llm/falhas.ts";

let n = 0, mal = 0;
const ok = (nome, fn) => {
  try { fn(); n++; console.log("  ok  " + nome); }
  catch (e) { mal++; console.log("  X   " + nome + " :: " + e.message); }
};

// A mensagem exata que o Chrome entregou.
const REMOVIDO =
  "Failed to execute 'requestDevice' on 'GPUAdapter': D3D12 create command queue " +
  "failed with DXGI_ERROR_DEVICE_REMOVED (0x887A0005) at CheckHRESULTImpl " +
  "(..\\..\\third_party\\dawn\\src\\dawn\\native\\d3d\\D3DError.cpp:119)";

const PERDIDO =
  "Device was lost. This can happen due to insufficient memory or other GPU " +
  "constraints. Detailed error: [object GPUDeviceLostInfo].";

console.log("\nfalhas de GPU traduzidas");

ok("dispositivo REMOVIDO e reconhecido", () => {
  const e = explicarFalhaGpu(REMOVIDO);
  assert.ok(e, "nao reconheceu a mensagem do Chrome");
});

// A distincao que importa: removido acontece ANTES de carregar peso nenhum,
// entao descer na lista de modelos e perder tempo. Foi o que aconteceu aqui.
ok("removido NAO manda trocar de modelo", () => {
  const e = explicarFalhaGpu(REMOVIDO);
  assert.equal(e.trocarModeloAjuda, false, "ia mandar descer a lista de novo");
  assert.ok(/nao tem relacao|não tem relação/i.test(e.causa), "nao desfez a suspeita do modelo");
});

ok("removido manda fechar o navegador, nao recarregar a aba", () => {
  const e = explicarFalhaGpu(REMOVIDO);
  assert.ok(/fech\w+ o navegador/i.test(e.acao), "nao disse a acao que resolve");
  assert.ok(/aba/i.test(e.acao), "nao explicou por que recarregar nao basta");
});

ok("dispositivo PERDIDO manda trocar de modelo — este caso e de tamanho", () => {
  const e = explicarFalhaGpu(PERDIDO);
  assert.ok(e);
  assert.equal(e.trocarModeloAjuda, true);
});

ok("os dois casos NAO dao a mesma resposta", () => {
  assert.notEqual(explicarFalhaGpu(REMOVIDO).acao, explicarFalhaGpu(PERDIDO).acao);
});

ok("falta de memoria e reconhecida", () => {
  const e = explicarFalhaGpu("RuntimeError: out of memory");
  assert.ok(e && e.trocarModeloAjuda);
});

// Melhor mostrar o texto cru do navegador do que uma explicacao inventada.
ok("mensagem desconhecida devolve null, nao um palpite", () => {
  assert.equal(explicarFalhaGpu("erro qualquer sem relacao"), null);
  assert.equal(explicarFalhaGpu(""), null);
  assert.equal(explicarFalhaGpu(undefined), null);
});

ok("toda explicacao tem causa E acao, nunca so uma", () => {
  for (const m of [REMOVIDO, PERDIDO, "out of memory", "WebGPU is not supported"]) {
    const e = explicarFalhaGpu(m);
    assert.ok(e.causa.length > 20, "causa curta demais: " + m);
    assert.ok(e.acao.length > 20, "acao curta demais: " + m);
  }
});

console.log(mal ? `\n  ${mal} FALHA(S)\n` : `\n  ${n} verificacoes\n`);
process.exit(mal ? 1 : 0);
