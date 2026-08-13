// src/pausa.ts
// -----------------------------------------------------------------------------
// QUANDO O GLOBO DORME E QUANDO ACORDA
// -----------------------------------------------------------------------------
// Isto saiu de dentro do `globe.ts` depois de derrubar a aplicação inteira com
// "Maximum call stack size exceeded". São só dois booleanos, e mesmo assim a
// ordem entre eles importa mais do que parece — o que é exatamente o perfil de
// código que merece teste próprio.
//
// A ARMADILHA. `resumeAnimation()` do globe.gl não agenda nada para depois: ele
// roda um ciclo de animação NA HORA, e esse ciclo chama `OrbitControls.update()`,
// que emite o evento "change", que está ligado de volta ao despertar.
//
//   despertar → retomar → tick → controls.update → "change" → despertar → …
//
// Se a bandeira "está pausado" só cair DEPOIS da chamada, a reentrada encontra
// ela ainda em pé, chama retomar outra vez, e a pilha estoura. Baixando antes,
// a segunda entrada sai pelo caminho curto e tudo desenrola.
//
// A segunda armadilha é retomar o que nunca foi pausado: o globe.gl põe um
// SEGUNDO laço de animação a correr junto do primeiro, e a partir daí cada
// quadro é desenhado duas vezes. Por isso toda transição é guardada.
// -----------------------------------------------------------------------------

export interface Motorzinho {
  /** globe.gl: `resumeAnimation`. Pode reentrar — conte com isso. */
  retomar(): void;
  /** globe.gl: `pauseAnimation`. */
  pausar(): void;
}

export class EstadoAnimacao {
  /** o laço de animação está parado */
  private dormindo = false;
  /** pausa PEDIDA de fora, para o LLM ter a GPU */
  private cedendo = false;
  /** quadros seguidos sem nada para animar */
  private ocioso = 0;

  // Campo explícito em vez de propriedade de construtor: o `--experimental-
  // strip-types` do Node, que é como a suíte roda TypeScript sem compilar,
  // recusa `constructor(private m: X)`.
  private readonly m: Motorzinho;

  constructor(m: Motorzinho) { this.m = m; }

  get pausado() { return this.dormindo; }
  get cedendoGpu() { return this.cedendo; }
  get quadrosOciosos() { return this.ocioso; }

  /** Algo aconteceu: mouse, dado novo, camada ligada. */
  despertar(): void {
    if (this.cedendo) return;        // pedido externo vence o despertar
    this.ocioso = 0;
    if (!this.dormindo) return;
    this.dormindo = false;           // ANTES de retomar: `retomar` reentra aqui
    this.m.retomar();
  }

  /** Nada para animar neste quadro. Devolve true quando decide dormir. */
  ocioseou(limite = 90): boolean {
    if (this.cedendo || this.dormindo) return false;
    if (++this.ocioso <= limite) return false;
    this.dormindo = true;
    this.m.pausar();
    return true;
  }

  /** Há algo animando: zera a contagem de ócio. */
  animando(): void {
    this.ocioso = 0;
    this.despertar();
  }

  /** Cede (ou devolve) a GPU ao modelo de linguagem. */
  cederGpu(on: boolean): void {
    if (this.cedendo === on) return;   // o React reexecuta efeitos; isto é barato
    this.cedendo = on;

    if (on) {
      if (!this.dormindo) { this.dormindo = true; this.m.pausar(); }
      return;
    }
    this.ocioso = 0;
    if (this.dormindo) { this.dormindo = false; this.m.retomar(); }
  }
}
