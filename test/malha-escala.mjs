// test/malha-escala.mjs
// -----------------------------------------------------------------------------
// A ESCALA NÃO PODE FICAR PRESA ATRÁS DO CONTROLE DE REPETIÇÃO DA REDE.
// -----------------------------------------------------------------------------
// O defeito: a malha 3D não aparecia no globo, e nada dizia por quê.
//
// As paradas da rampa de cor vêm de `/api/fields`, que o painel de camadas
// busca em paralelo com tudo o mais. Se a malha carregasse o campo ANTES de o
// catálogo chegar, `paradas` vinha nulo — e `MalhaEscalar` se recusa a
// desenhar sem escala, porque sem as paradas ela pintaria numa cor que não é a
// do PNG do mesmo campo. Até aí, correto.
//
// O erro era o que vinha depois. Quando o catálogo chegava, o efeito rodava de
// novo, `carregar` via que a chave não tinha mudado — ela é
// campo|dia|hora|passo, e nada disso mudou — e voltava na primeira linha. A
// escala continuava nula PARA SEMPRE.
//
// O sintoma era cruel de diagnosticar: o painel mostrava média, extremos e a
// característica de Euler funcionando perfeitamente. Só o relevo no globo
// nunca aparecia. Tudo indicava defeito de renderização, e o defeito estava
// numa condição de corrida entre duas requisições.
//
// Aplicar a escala é uma atribuição, não uma requisição. Este arquivo trava a
// separação.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { empacotarCampo } from "../server/campoBin.js";
import { FIELDS } from "../server/fields.js";
import { useMalhaStore } from "../src/store/malhaStore.ts";

let n = 0;
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\nescala da malha");

const PARADAS = FIELDS.temp2m.stops;

/** rede de mentira: devolve sempre o mesmo campo binário, e conta as idas */
function redeFalsa() {
  const estado = { chamadas: 0 };
  const nx = 12, ny = 7, nn = nx * ny;
  const t = new Float32Array(nn);
  for (let k = 0; k < nn; k++) t[k] = -20 + (k % 40);
  const buf = empacotarCampo({
    nx, ny,
    planos: { temp2m: t },
    valido: new Uint8Array(nn).fill(1),
    unidades: { temp2m: "°C" },
    titulos: { temp2m: "Temperatura" },
    dataset: "teste",
  });
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  globalThis.fetch = async () => {
    estado.chamadas++;
    return {
      ok: true,
      status: 200,
      headers: new Map([["content-type", "application/octet-stream"]]),
      arrayBuffer: async () => ab.slice(0),
    };
  };
  return estado;
}

function zerar() {
  useMalhaStore.getState().limpar();
  useMalhaStore.setState({ campoId: "temp2m", passo: 4 });
}

await okA("o catálogo atrasado NÃO deixa a malha sem escala para sempre", () => {
  // Nada aqui é hipotético: é a ordem real quando o catálogo demora mais que a
  // grade. O efeito roda uma vez sem paradas e outra com elas.
  const rede = redeFalsa();
  zerar();

  return (async () => {
    const s = useMalhaStore.getState();

    await s.carregar("2026-08-21", 12, null, "rampa");
    assert.ok(useMalhaStore.getState().campo, "a grade não chegou");
    assert.equal(useMalhaStore.getState().escala, null,
      "sem paradas não pode haver escala — pintar seria inventar uma cor");

    // O catálogo chega. MESMO dia, MESMA hora, MESMO campo: a chave não muda.
    await useMalhaStore.getState().carregar("2026-08-21", 12, PARADAS, "rampa");

    const escala = useMalhaStore.getState().escala;
    assert.ok(escala, "a escala continuou nula — a malha nunca apareceria");
    assert.equal(escala.lo, PARADAS[0][0]);
    assert.equal(escala.hi, PARADAS[PARADAS.length - 1][0]);
    assert.equal(rede.chamadas, 1, `a rede foi chamada ${rede.chamadas}x para aplicar uma escala`);
  })();
});

await okA("aplicar a escala NÃO custa rede", async () => {
  const rede = redeFalsa();
  zerar();
  await useMalhaStore.getState().carregar("2026-08-21", 12, PARADAS, "rampa");
  const antes = rede.chamadas;
  useMalhaStore.getState().aplicarEscala(FIELDS.prmsl.stops, "rampa");
  assert.equal(rede.chamadas, antes, "aplicar escala disparou requisição");
  assert.equal(useMalhaStore.getState().escala.lo, FIELDS.prmsl.stops[0][0]);
});

await okA("a escala sobrevive a uma falha de rede", async () => {
  // A escala pertence ao CAMPO ESCOLHIDO, não aos dados daquele instante.
  // Perdê-la numa falha faria a malha sumir na hora seguinte mesmo depois de o
  // dado voltar.
  redeFalsa();
  zerar();
  await useMalhaStore.getState().carregar("2026-08-21", 12, PARADAS, "rampa");
  assert.ok(useMalhaStore.getState().escala);

  globalThis.fetch = async () => ({
    ok: false, status: 502,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => ({ error: "fonte fora do ar" }),
  });
  await useMalhaStore.getState().carregar("2026-08-21", 15, PARADAS, "rampa");

  assert.equal(useMalhaStore.getState().campo, null, "o campo devia ter sido descartado");
  assert.match(useMalhaStore.getState().erro ?? "", /fora do ar/);
  assert.ok(useMalhaStore.getState().escala, "a escala foi perdida numa falha de rede");
});

await okA("trocar de campo troca a escala junto", async () => {
  redeFalsa();
  zerar();
  await useMalhaStore.getState().carregar("2026-08-21", 12, FIELDS.temp2m.stops, "rampa");
  assert.equal(useMalhaStore.getState().escala.hi, 50, "temperatura vai até 50 °C");

  useMalhaStore.getState().setCampoId("prmsl");
  await useMalhaStore.getState().carregar("2026-08-21", 12, FIELDS.prmsl.stops, "rampa");
  assert.equal(useMalhaStore.getState().escala.lo, 920, "pressão começa em 920 hPa");
});

await okA("o modo de pintura (rampa ou faixas) viaja com a escala", async () => {
  // Chuva e WBGT são lidos contra limiares de decisão. Se o modo não chegasse
  // à malha, ela suavizaria a fronteira dos 28 °C WBGT — que é a linha entre
  // "cautela" e "alerta".
  redeFalsa();
  zerar();
  await useMalhaStore.getState().carregar("2026-08-21", 12, FIELDS.wbgt.stops, "faixas");
  assert.equal(useMalhaStore.getState().escala.modo, "faixas");
});

console.log(`\n  ${n} verificações da escala da malha\n`);
