// test/bloco-painel.mjs
// -----------------------------------------------------------------------------
// O PAINEL DO RECORTE 3D MONTA DE VERDADE.
// -----------------------------------------------------------------------------
// Este é o primeiro teste do projeto que MONTA um componente React. Ele existe
// por causa de um defeito que nenhum dos outros 780 conseguia ver, e cujo
// relato foi exatamente este: "ao clicar em recorte da região 3D nada ocorre".
//
// Não havia erro no console do servidor, o build passava, o `tsc` passava, os
// módulos resolviam, a store transicionava para `aberto: true` — e a tela
// continuava igual. Todas as verificações indiretas diziam que estava certo.
//
// A causa era uma regra do React que não aparece em nenhuma delas: ERRO
// LANÇADO DE DENTRO DE UM EFEITO DESMONTA A ÁRVORE. `new BlocoCena` falhava ao
// criar o contexto WebGL, o React arrancava o painel inteiro, e do lado de fora
// isso é indistinguível de um botão que não faz nada.
//
// Aqui o painel é montado num DOM de verdade, com WebGL DELIBERADAMENTE
// indisponível — o pior caso — e o que se afirma é: a janela aparece assim
// mesmo, e ela DIZ o que houve.
//
// O segundo bloco de testes tranca o outro defeito da mesma família: a cena era
// guardada só em `useRef`, então os efeitos que empurram dado para dentro dela
// dependiam do DADO e não da CENA. Ao reabrir o painel, a cena é nova mas o
// `relevo` é o mesmo objeto — dependência inalterada, efeito não roda, terreno
// nunca entregue. A primeira abertura funcionava e todas as seguintes davam
// palco preto.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { JSDOM } from "jsdom";

let n = 0;
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

// -----------------------------------------------------------------------------
// Preparo: um DOM, e um empacotamento sob medida.
// -----------------------------------------------------------------------------
// O `.tsx` não passa pelo `--experimental-strip-types` do Node — JSX não é
// anotação de tipo, é sintaxe nova. Então o esbuild, que já é dependência do
// Vite, monta o pacote na hora.

// O pacote é emitido DENTRO do projeto, e não em `os.tmpdir()`. Ele importa
// `react` e `three` como externos, e a resolução de módulo do Node parte do
// arquivo — de fora da árvore do projeto não haveria `node_modules` acima dele.
const tmp = path.join(process.cwd(), "node_modules", ".cache", "obs-teste-bloco");
await fs.mkdir(tmp, { recursive: true });

/**
 * Empacota o painel.
 *
 * @param cenaFalsa  caminho de um módulo que substitui `src/bloco/cena.ts`, ou
 *                   `null` para usar a cena de verdade (que vai falhar sem
 *                   WebGL — e é justamente esse o caso do primeiro teste).
 */
async function empacotar(nome, cenaFalsa) {
  const saida = path.join(tmp, `${nome}.mjs`);
  const plugins = [];
  if (cenaFalsa) {
    plugins.push({
      name: "cena-falsa",
      setup(build) {
        build.onResolve({ filter: /bloco\/cena$/ }, () => ({ path: cenaFalsa }));
      },
    });
  }
  await esbuild.build({
    stdin: {
      contents:
        'export { BlocoPanel } from "./src/components/bloco/BlocoPanel.tsx";\n' +
        'export { useBlocoStore } from "./src/store/blocoStore.ts";\n',
      resolveDir: process.cwd(),
      sourcefile: "entrada.ts",
      loader: "ts",
    },
    bundle: true, format: "esm", platform: "node", packages: "external",
    outfile: saida, logLevel: "error", plugins,
  });
  return import(pathToFileURL(saida).href);
}

/** DOM limpo por teste — estado de janela vaza em localStorage. */
function montarDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='raiz'></div></body></html>", {
    pretendToBeVisual: true, url: "http://localhost/",
  });
  for (const k of ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle",
                   "requestAnimationFrame", "cancelAnimationFrame", "Image", "CustomEvent",
                   "Event", "MutationObserver", "localStorage"]) {
    try { globalThis[k] = dom.window[k]; } catch { /* somente leitura no Node */ }
  }
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // SEM WEBGL, DE PROPÓSITO. É o pior caso, e é o que o teste quer exercitar.
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

const dom = montarDom();
globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "sem rede no teste" });

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

// Silencia o relatório do React sobre o erro que o teste PROVOCA de propósito.
const erroOriginal = console.error;
const silenciar = (fn) => async (...a) => { console.error = () => {}; try { return await fn(...a); } finally { console.error = erroOriginal; } };

console.log("\npainel do recorte 3D: montagem real em DOM");

const real = await empacotar("real", null);

await okA("fechado, o painel não desenha nada", async () => {
  const raiz = createRoot(document.getElementById("raiz"));
  await act(async () => { raiz.render(React.createElement(real.BlocoPanel)); });
  assert.equal(document.getElementById("raiz").innerHTML, "");
  await act(async () => { raiz.unmount(); });
});

await okA(
  "SEM WEBGL A JANELA AINDA APARECE, e diz o que houve",
  silenciar(async () => {
    // O DEFEITO. Antes desta correção o resultado aqui era zero byte: o React
    // desmontava o painel por causa do erro lançado dentro do efeito, e o
    // clique no botão não produzia janela nenhuma nem mensagem nenhuma.
    const raiz = createRoot(document.getElementById("raiz"));
    await act(async () => { raiz.render(React.createElement(real.BlocoPanel)); });
    await act(async () => { real.useBlocoStore.getState().abrir(-23.55, -46.63); });

    const html = document.getElementById("raiz").innerHTML;
    assert.ok(html.length > 0,
      "o painel sumiu — a falha da cena voltou a derrubar a árvore do React");
    assert.ok(html.includes("Recorte 3D"), "a janela não tem cabeçalho");
    assert.ok(/N.o foi poss.vel criar a cena 3D/.test(html),
      "a janela abriu, mas não explica por que o palco está vazio");
    assert.ok(html.includes("Exagero vertical"),
      "os controles sumiram — só o palco deveria falhar");

    await act(async () => { real.useBlocoStore.getState().fechar(); raiz.unmount(); });
  }),
);

console.log("\nreabrir entrega o terreno à cena NOVA");

// A REDE PASSA A PENDURAR.
//
// Daqui para baixo o teste INJETA o relevo direto no store, e precisa que ele
// fique. Com uma rede que responde, o `carregar()` disparado pela abertura
// termina depois da injeção e sobrescreve tudo com `relevo: null`. Pendurada,
// ele fica esperando para sempre e não atrapalha.
globalThis.fetch = () => new Promise(() => {});

// Uma cena de mentira que registra o que recebeu. Com ela o painel monta sem
// WebGL, e dá para observar a entrega do dado.
const arquivoFalso = path.join(tmp, "cena-falsa.mjs");
// O registro vive em \`globalThis\`, e não numa exportação do módulo. O esbuild
// EMBUTE este arquivo dentro do pacote; importá-lo de novo aqui daria uma
// segunda instância, com um array vazio que nunca veria nada.
globalThis.__cenasFalsas = [];
await fs.writeFile(arquivoFalso, `
export class BlocoCena {
  constructor() { this.relevos = 0; this.estado = { estratoM: 100 }; globalThis.__cenasFalsas.push(this); }
  redimensionar() {}
  definirRelevo() { this.relevos++; }
  definirCampo() {}
  definirExagero() {}
  definirMostrarCampo() {}
  definirMostrarParedes() {}
  definirAlturaCampo() {}
  definirOpacidadeCampo() {}
  dispose() {}
}
`, "utf8");

const falso = await empacotar("falso", arquivoFalso);
const criadas = globalThis.__cenasFalsas;

await okA("FECHAR E REABRIR: a cena nova recebe o relevo que já estava carregado", async () => {
  // O segundo defeito, e o mais traiçoeiro dos dois, porque a PRIMEIRA abertura
  // funcionava: `fechar()` preserva `relevo` e `chave`, então ao reabrir
  // `carregar()` sai cedo e o objeto `relevo` não muda de identidade. Com os
  // efeitos dependendo só do dado, a cena recém-construída nunca era alimentada.
  const raiz = createRoot(document.getElementById("raiz"));
  await act(async () => { raiz.render(React.createElement(falso.BlocoPanel)); });

  const CHAVE_PONTO = `${(-23.55).toFixed(4)}|${(-46.63).toFixed(4)}|60`;
  const relevo = {
    campo: { nx: 32, ny: 32 },
    minimo: 12, maximo: 830, resolucaoM: 90, nivel: 10, tiles: 4, tilesFalhos: 0,
  };

  await act(async () => {
    falso.useBlocoStore.getState().abrir(-23.55, -46.63);
    // A CHAVE E A DO PONTO. `carregar()` compara a chave computada com a
    // guardada e sai cedo quando batem — sem isso ele roda, falha (nao ha
    // canvas 2D aqui) e apaga o relevo que o teste acabou de injetar.
    falso.useBlocoStore.setState({ relevo, chave: CHAVE_PONTO, carregando: false });
  });

  const html1 = document.getElementById("raiz").innerHTML;
  assert.ok(html1.includes("Recorte 3D"), "não abriu nem na primeira vez");
    assert.ok(html1.includes("830"), "a altitude máxima não chegou à tela");

  await act(async () => { falso.useBlocoStore.getState().fechar(); });
  assert.equal(document.getElementById("raiz").innerHTML, "", "fechar não fechou");

  // Reabre. O `relevo` no store é O MESMO OBJETO — nada nele mudou.
  await act(async () => { falso.useBlocoStore.getState().abrir(-23.55, -46.63); });

  const html2 = document.getElementById("raiz").innerHTML;
  assert.ok(html2.includes("830"),
    "reabriu sem o terreno — a cena nova não foi alimentada");

  const ultima = criadas[criadas.length - 1];
  assert.ok(ultima, "nenhuma cena foi construída");
  assert.ok(ultima.relevos > 0,
    "a última cena construída nunca recebeu `definirRelevo`: é o palco preto");

  await act(async () => { falso.useBlocoStore.getState().fechar(); raiz.unmount(); });
});

await okA("MINIMIZAR e expandir reconstrói a cena", async () => {
  // O canvas vive dentro do corpo, e o corpo não é renderizado quando a janela
  // está minimizada. Se o efeito da cena não dependesse de `minimizada`, ele
  // nunca voltaria a rodar e o palco ficaria vazio permanentemente.
  const raiz = createRoot(document.getElementById("raiz"));
  await act(async () => { raiz.render(React.createElement(falso.BlocoPanel)); });
  await act(async () => { falso.useBlocoStore.getState().abrir(10, 20); });

  const antes = criadas.length;
  const botao = [...document.querySelectorAll("button")]
    .find((b) => b.getAttribute("aria-label") === "Minimizar");
  assert.ok(botao, "o botão de minimizar sumiu do cabeçalho");

  await act(async () => { botao.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.ok(!document.querySelector(".bloco-canvas"), "minimizar não escondeu o palco");

  await act(async () => { botao.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.ok(document.querySelector(".bloco-canvas"), "expandir não trouxe o palco de volta");
  assert.ok(criadas.length > antes,
    "o canvas voltou mas nenhuma cena foi construída para ele");

  await act(async () => { falso.useBlocoStore.getState().fechar(); raiz.unmount(); });
});

await fs.rm(tmp, { recursive: true, force: true });
console.log(`\n  ${n} verificações do painel do recorte 3D\n`);
