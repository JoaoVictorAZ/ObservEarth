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
 * Descobre o que o dispositivo comporta ANTES de baixar gigabytes.
 *
 * `maxBufferSize` do WebGPU é o limite mais confiável exposto ao navegador —
 * não é a VRAM total, mas escala com ela e é o que de fato limita um modelo
 * grande. Chutar alto e falhar depois de 4,6 GB baixados seria cruel.
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
    // O maior buffer alocável é o teto prático para os pesos do modelo.
    const maxMB = Math.floor(Number(lim.maxBufferSize ?? 0) / (1024 * 1024));
    // Margem: o globo já está usando GPU. Reservar ~20% evita competir com as
    // texturas de vento e os alvos de rastro, que também vivem lá.
    const util = Math.floor(maxMB * 0.8);

    const escolhido = MODELOS.find((m) => m.vramMB <= util) ?? MODELOS[MODELOS.length - 1];
    return {
      webgpu: true,
      vramMB: maxMB,
      recomendado: escolhido,
      motivo:
        escolhido === MODELOS[0]
          ? `dispositivo comporta o 8B (${maxMB} MB de buffer máximo)`
          : `8B não cabe em ${maxMB} MB; recuando para ${escolhido.rotulo}`,
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
    const fluxo = await this.engine.chat.completions.create({
      messages: mensagens,
      stream: true,
      temperature: 0.2,   // baixo de propósito: a tarefa é ler número, não criar
      max_tokens: 700,
    });
    for await (const parte of fluxo) {
      if (sinal?.aborted) break;
      const t = parte.choices?.[0]?.delta?.content;
      if (t) yield t;
    }
  }

  async descarregar() {
    try { await this.engine?.unload(); } catch { /* nada a fazer */ }
    this.engine = null;
    this.modelo = null;
  }
}

export const motor = new MotorLocal();
