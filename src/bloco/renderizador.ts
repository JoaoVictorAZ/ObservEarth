// src/bloco/renderizador.ts
// -----------------------------------------------------------------------------
// UM CONTEXTO WEBGL PARA O BLOCO, PARA SEMPRE.
// -----------------------------------------------------------------------------
// O sintoma:
//
//     Cannot read properties of null (reading 'precision')
//
// É o three lendo as capacidades de um contexto que não existe. `getContext`
// devolveu `null` e ninguém conferiu antes de usar.
//
// A causa não é o three: é o NAVEGADOR recusando criar mais um. O teto de
// contextos WebGL simultâneos fica em torno de dezesseis na maioria deles, e
// quando estoura o mais antigo é derrubado ou o novo é negado.
//
// -----------------------------------------------------------------------------
// POR QUE O BLOCO ESTOURAVA ESSE TETO
// -----------------------------------------------------------------------------
// `BlocoCena` criava um renderer no construtor, e o painel criava uma cena nova
// a cada abertura, a cada expansão de janela minimizada, e — em desenvolvimento
// — duas vezes por montagem, porque o modo estrito do React monta, desmonta e
// monta de novo.
//
// `dispose()` chamava `forceContextLoss()`, que é o certo. Mas a devolução do
// contexto ao navegador não é síncrona: ela depende do coletor de lixo chegar
// no canvas. Abrir e fechar o painel meia dúzia de vezes seguidas cria
// contextos mais rápido do que o navegador os recolhe, e o sétimo é negado.
//
// -----------------------------------------------------------------------------
// A SAÍDA NÃO É RECICLAR MELHOR
// -----------------------------------------------------------------------------
// É **não criar mais de um**. O renderer passa a ser único e permanente: nasce
// na primeira abertura e vive enquanto a aba viver. O painel toma emprestado o
// canvas dele, põe na sua caixa, e ao fechar apenas o retira do DOM.
//
// Uma cena, uma câmera e uma geometria são baratas de criar e destruir. Um
// contexto WebGL não é — é recurso do sistema, contado, e o navegador não
// promete devolver quando alguém pede. A assimetria entre os dois é o que
// justifica tratá-los de formas diferentes.
// -----------------------------------------------------------------------------

import * as THREE from "three";

let renderer: THREE.WebGLRenderer | null = null;
let motivoDaFalha: string | null = null;
let dono: object | null = null;

/**
 * Por que não deu, em português e sem pilha.
 *
 * Distingue as duas causas, porque o conserto é diferente: sem WebGL a pessoa
 * precisa de outro navegador ou de ligar a aceleração; com contextos demais
 * basta fechar abas.
 */
function diagnosticar(e: unknown): string {
  const t = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (typeof WebGLRenderingContext === "undefined") {
    return "este navegador não expõe WebGL.";
  }
  if (t.includes("precision") || t.includes("null")) {
    return "o navegador recusou criar o contexto 3D — provavelmente há contextos "
         + "demais abertos. Feche outras abas com mapas ou jogos e tente de novo.";
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * O renderer do bloco. Lança com mensagem legível se não houver como criar.
 *
 * `dono` existe para pegar um erro de programação, não do usuário: se duas
 * cenas tomarem o mesmo renderer emprestado ao mesmo tempo, as duas desenham
 * no mesmo canvas e a segunda apaga a primeira a cada quadro. Melhor falhar
 * alto aqui do que investigar cintilação depois.
 */
export function tomarRenderizador(quem: object): THREE.WebGLRenderer {
  if (dono && dono !== quem) {
    throw new Error("o renderizador do bloco já está emprestado a outra cena");
  }
  if (motivoDaFalha) throw new Error(motivoDaFalha);

  if (!renderer) {
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      // A conferência que faltava. O three não reclama de um contexto nulo no
      // construtor; ele quebra mais adiante, ao ler `capabilities.precision`,
      // e a mensagem já não menciona WebGL.
      if (!r.getContext()) throw new Error("contexto nulo");
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

      // PERDER O CONTEXTO É NORMAL e acontece sem defeito nenhum: o sistema
      // operacional troca de GPU, o driver reinicia, a máquina acorda do sono.
      // Sem este ouvinte o canvas fica preto para sempre e parece defeito do
      // app. `preventDefault` é o que permite ao navegador restaurá-lo.
      r.domElement.addEventListener("webglcontextlost", (ev) => {
        ev.preventDefault();
        console.warn("[bloco] contexto WebGL perdido; aguardando restauração");
      });
      r.domElement.addEventListener("webglcontextrestored", () => {
        console.warn("[bloco] contexto WebGL restaurado");
      });

      renderer = r;
    } catch (e) {
      motivoDaFalha = diagnosticar(e);
      throw new Error(motivoDaFalha);
    }
  }

  dono = quem;
  return renderer;
}

/**
 * Devolve o empréstimo. **Não descarta o renderer** — é justamente isso que
 * impede o teto de contextos de ser atingido.
 */
export function devolverRenderizador(quem: object): void {
  if (dono === quem) dono = null;
  // O canvas sai do DOM, o contexto continua vivo. Deixá-lo pendurado num
  // contêiner que o React vai remover faria o canvas ser coletado junto — e
  // com ele o contexto que estamos tentando preservar.
  const el = renderer?.domElement;
  if (el?.parentNode) el.parentNode.removeChild(el);
}
