// src/llm/engine.ts
// -----------------------------------------------------------------------------
// Motor de inferência LLM local via WebLLM / WebGPU.
// -----------------------------------------------------------------------------

import type { MLCEngine, InitProgressReport } from "@mlc-ai/web-llm";

export interface ModeloLLM {
  id: string;
  rotulo: string;
  params: string;
  /** VRAM aproximada exigida, em MB — critério da escada */
  vramMB: number;
  downloadGB: number;
  nota: string;
}

/**
 * CATÁLOGO, do maior para o menor.
 *
 * A ordem é a ordem de tentativa. O primeiro que couber no dispositivo é o
 * escolhido — e o rótulo aparece na interface, sempre.
 */
export const MODELOS: ModeloLLM[] = [
  {
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    rotulo: "Llama 3.1 8B",
    params: "8,0 B",
    vramMB: 4900,
    downloadGB: 4.6,
    nota: "melhor qualidade de leitura e comparação; exige GPU dedicada",
  },
  {
    id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    rotulo: "Hermes 3 (Llama 3.1 8B)",
    params: "8,0 B",
    vramMB: 4900,
    downloadGB: 4.7,
    nota: "alternativa 8B, costuma seguir instrução com mais rigor",
  },
  {
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    rotulo: "Qwen 2.5 7B",
    params: "7,6 B",
    vramMB: 4700,
    downloadGB: 4.4,
    nota: "7B com bom português; um degrau abaixo do 8B em VRAM",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    rotulo: "Phi 3.5 mini",
    params: "3,8 B",
    vramMB: 2400,
    downloadGB: 2.2,
    nota: "cabe em GPU de 4 GB; respostas mais curtas",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    rotulo: "Qwen 2.5 1.5B",
    params: "1,5 B",
    vramMB: 1100,
    downloadGB: 1.0,
    nota: "último recurso; suficiente para ler e comparar números",
  },
];

export interface Capacidade {
  webgpu: boolean;
  vramMB: number | null;
  /** modelo recomendado dado o que o dispositivo comporta */
  recomendado: ModeloLLM;
  motivo: string;
}

/**
 * O QUE DÁ PARA SABER ANTES DE BAIXAR GIGABYTES — que é pouco.
 *
 * A versão anterior lia `maxBufferSize` do adaptador e tratava como se fosse
 * VRAM: "não é a VRAM total, mas escala com ela". Isso está errado.
 * `maxBufferSize` é o teto de UM buffer, e a maioria das implementações reporta
 * o mesmo 2 GiB do padrão independentemente da placa. Numa GPU de 4 GB e numa
 * de 24 GB o número sai igual.
 *
 * O resultado prático foi recomendar o 8B — 4,9 GB de pesos — para uma placa
 * que não aguentava, e a geração morrer com "Device was lost", sem exceção
 * nenhuma no nosso código: zero token, bolha vazia, nenhuma pista.
 *
 * WebGPU NÃO expõe VRAM. Então este código para de fingir que mede: recomenda
 * um modelo que cabe na maioria das máquinas, diz que o limite não é
 * observável, e o resto é o usuário poder subir de modelo e VOLTAR se der
 * errado — que é a parte que faltava na interface.
 */
export async function detectarCapacidade(): Promise<Capacidade> {
  const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
  if (!gpu) {
    return {
      webgpu: false,
      vramMB: null,
      recomendado: MODELOS[MODELOS.length - 1],
      motivo: "WebGPU indisponível neste navegador — use Chrome ou Edge recentes",
    };
  }

  try {
    const adapter = await (gpu as GPUAdapterProvider).requestAdapter();
    if (!adapter) {
      return {
        webgpu: false, vramMB: null,
        recomendado: MODELOS[MODELOS.length - 1],
        motivo: "nenhum adaptador WebGPU disponível",
      };
    }
    const lim = adapter.limits;
    const maxMB = Math.floor(Number(lim.maxBufferSize ?? 0) / (1024 * 1024));

    // Recomendação conservadora: o maior modelo cujos pesos cabem com folga em
    // 4 GB de VRAM, que é o piso comum de placa dedicada. Não é medição — é uma
    // aposta declarada como aposta.
    const escolhido = MODELOS.find((m) => m.vramMB <= 2600) ?? MODELOS[MODELOS.length - 1];
    return {
      webgpu: true,
      vramMB: maxMB,
      recomendado: escolhido,
      motivo:
        `WebGPU disponível. A quantidade de VRAM não é exposta ao navegador, ` +
        `então isto é uma sugestão, não uma medida: ${escolhido.rotulo} cabe na ` +
        `maioria das placas. Modelos maiores rendem melhor, e se a GPU não ` +
        `aguentar você volta aqui e desce um degrau.`,
    };
  } catch (e) {
    return {
      webgpu: false, vramMB: null,
      recomendado: MODELOS[MODELOS.length - 1],
      motivo: `falha ao consultar a GPU: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

interface GPUAdapterProvider {
  requestAdapter(): Promise<{ limits: Record<string, number | bigint> } | null>;
}

export type EstadoMotor =
  | { fase: "ocioso" }
  | { fase: "baixando"; pct: number; texto: string }
  | { fase: "pronto"; modelo: ModeloLLM }
  | { fase: "erro"; mensagem: string };

/**
 * Carrega o motor sob demanda.
 *
 * Nunca é chamado na montagem da página: baixar 4,6 GB porque alguém abriu o
 * mapa seria abusivo. Só quando o usuário abre o chat e confirma.
 */
export class MotorLocal {
  private engine: MLCEngine | null = null;
  private carregando: Promise<MLCEngine> | null = null;
  modelo: ModeloLLM | null = null;

  get pronto() { return this.engine != null; }

  async carregar(
    modelo: ModeloLLM,
    onProgresso: (e: EstadoMotor) => void
  ): Promise<MLCEngine> {
    // JÁ CARREGADO: avisa mesmo assim.
    //
    // Antes este ramo devolvia o motor em silêncio. Quem chamasse `carregar`
    // com o modelo já na VRAM não recebia `{ fase: "pronto" }` — então a
    // interface continuava mostrando a tela de instalação, para um modelo que
    // já estava rodando. O atalho de desempenho estava escondendo o sucesso.
    if (this.engine && this.modelo?.id === modelo.id) {
      onProgresso({ fase: "pronto", modelo });
      return this.engine;
    }
    if (this.carregando) return this.carregando;

    this.carregando = (async () => {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      const eng = await CreateMLCEngine(modelo.id, {
        initProgressCallback: (r: InitProgressReport) => {
          onProgresso({
            fase: "baixando",
            pct: Math.round((r.progress ?? 0) * 100),
            texto: r.text ?? "",
          });
        },
      });
      this.engine = eng;
      this.modelo = modelo;
      onProgresso({ fase: "pronto", modelo });
      return eng;
    })();

    try {
      return await this.carregando;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onProgresso({ fase: "erro", mensagem: msg });
      throw e;
    } finally {
      this.carregando = null;
    }
  }

  /**
   * Conversa em fluxo, para o texto aparecer enquanto é gerado.
   *
   * Num 8B rodando local, a primeira palavra pode levar segundos. Sem fluxo, a
   * interface fica parada e parece travada — e o usuário clica de novo, o que
   * enfileira outra geração.
   */
  async *responder(
    mensagens: { role: "system" | "user" | "assistant"; content: string }[],
    sinal?: AbortSignal
  ): AsyncGenerator<string> {
    if (!this.engine) throw new Error("motor não carregado");
    const eng = this.engine;

    // INTERROMPER O LAÇO NÃO INTERROMPE O MODELO.
    //
    // O `break` abaixo sai do `for await`, mas o motor do WebLLM continua
    // gerando em segundo plano — ocupando a GPU e deixando o próprio motor
    // ocupado. A geração SEGUINTE encontra um motor no meio de outra coisa, e o
    // resultado é uma resposta vazia sem erro nenhum. `interruptGenerate` é o
    // que de fato para.
    const parar = () => { void eng.interruptGenerate?.().catch?.(() => {}); };
    sinal?.addEventListener("abort", parar, { once: true });

    try {
      const fluxo = await eng.chat.completions.create({
        messages: mensagens,
        stream: true,
        temperature: 0.2,   // baixo de propósito: a tarefa é ler número, não criar
        max_tokens: 700,
      });
      for await (const parte of fluxo) {
        if (sinal?.aborted) break;
        const escolha = parte.choices?.[0];
        if (escolha?.finish_reason) this.ultimoMotivo = escolha.finish_reason;
        const t = escolha?.delta?.content;
        if (t) yield t;
      }
    } finally {
      sinal?.removeEventListener("abort", parar);
    }
  }

  /** Por que a última geração parou: "stop", "length", "abort"… */
  ultimoMotivo: string | null = null;

  /**
   * A mesma pergunta, sem fluxo.
   *
   * Existe para o caso em que o fluxo termina sem entregar um único token e sem
   * lançar erro — situação em que a única informação disponível era "não veio
   * nada", que não diz a ninguém o que fazer. Uma chamada direta ou funciona,
   * e aí o problema estava no fluxo, ou falha com uma mensagem de verdade.
   */
  async responderDeUmaVez(
    mensagens: { role: "system" | "user" | "assistant"; content: string }[]
  ): Promise<{ texto: string; motivo: string | null }> {
    if (!this.engine) throw new Error("motor não carregado");
    const r = await this.engine.chat.completions.create({
      messages: mensagens,
      stream: false,
      temperature: 0.2,
      max_tokens: 700,
    });
    const escolha = (r as { choices?: { message?: { content?: string }; finish_reason?: string }[] }).choices?.[0];
    return { texto: escolha?.message?.content ?? "", motivo: escolha?.finish_reason ?? null };
  }

  /**
   * A GPU perdeu o dispositivo?
   *
   * "Device was lost" é o fim da linha para o motor: os pesos foram embora da
   * VRAM e nenhuma chamada seguinte vai funcionar. O WebLLM escreve isso no
   * console e mais nada — do nosso lado a geração simplesmente termina sem um
   * token e sem exceção, que era o sintoma sem pista nenhuma.
   */
  static ehDispositivoPerdido(e: unknown): boolean {
    const m = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
    return m.includes("device was lost") || m.includes("device is lost")
        || m.includes("devicelost") || m.includes("gpudevicelostinfo");
  }

  async descarregar() {
    try { await this.engine?.unload(); } catch { /* nada a fazer */ }
    this.engine = null;
    this.modelo = null;
  }
}

export const motor = new MotorLocal();
