import type { WindGrid } from "./globe";

export interface Frame {
  date: string;
  hour: number;
  at: number;
  offsetH: number;
  leadH: number | null;
  kind: string | null;
  cycle: string | null;
  available: boolean;
  cached: boolean;
}

export interface Timeline {
  step: number;
  spanH: number;
  frames: Frame[];
  truncated: boolean;
  ready: number;
}

export type WindMeta = WindGrid & {
  measuredPct?: number;
  validPct?: number;
  stepDeg?: number;
  dataset?: string;
};

export const frameKey = (f: { date: string; hour: number }) => `${f.date}:${f.hour}`;

/** rotulo de deslocamento no formato dos centros de previsao: +018h */
export function offsetLabel(h: number) {
  const sign = h < 0 ? "−" : "+";
  return `${sign}${String(Math.abs(Math.round(h))).padStart(3, "0")}h`;
}

/**
 * Converte os vetores para Float32Array assim que o campo chega.
 *
 * JSON.parse entrega `number[]`, e todo numero em JS e float64 com o overhead
 * de um array generico: o campo do GFS 0,25° (1.038.240 nos) ocupa ~16 MB. Em
 * Float32Array sao ~8 MB — metade — e a precisao de 32 bits e mais que
 * suficiente para vento em m/s, cujo proprio erro de modelo esta na casa de
 * decimos.
 *
 * O ganho nao e so memoria: a reamostragem bicubica percorre esses vetores
 * milhoes de vezes por campo, e um array tipado e lido diretamente, sem passar
 * pela representacao generica de valores do motor.
 */
/**
 * Valida que um objeto é realmente um campo de vento completo.
 * Rejeita objetos de erro, respostas vazias ou campos malformados.
 */
function isValidWindMeta(g: unknown): g is WindMeta {
  if (!g || typeof g !== "object") return false;
  const w = g as Record<string, unknown>;
  return (
    typeof w.nx === "number" && w.nx > 0 &&
    typeof w.ny === "number" && w.ny > 0 &&
    Array.isArray(w.u) && w.u.length >= (w.nx as number) * (w.ny as number) &&
    Array.isArray(w.v) && w.v.length >= (w.nx as number) * (w.ny as number)
  );
}

function compact(g: WindMeta): WindMeta {
  const f = (a: unknown) =>
    a instanceof Float32Array ? a : Float32Array.from(a as ArrayLike<number>);
  return {
    ...g,
    u: f(g.u),
    v: f(g.v),
    valid: g.valid ? Uint8Array.from(g.valid as ArrayLike<number>) : undefined,
  };
}

/**
 * Cache de campos com teto.
 *
 * Cada campo do GFS 0,25° tem 1.038.240 nos: ~8 MB ja compactado. Guardar as 25
 * fatias da janela inteira seriam ~200 MB no heap do navegador, o suficiente
 * para a aba ser encerrada em maquinas modestas. O teto mantem uma vizinhanca
 * do cursor — ~47 MB — que e tudo que a reproducao precisa.
 */
export class FieldCache {
  private map = new Map<string, WindMeta>();
  private inflight = new Map<string, Promise<WindMeta | null>>();
  private max: number;

  // Campo explícito em vez de propriedade de parâmetro: `constructor(private
  // max)` é sintaxe que EMITE código, não só tipo, então os testes não podem
  // rodar o arquivo direto com a remoção de tipos do Node.
  constructor(max = 6) { this.max = max; }

  get(key: string) {
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); }  // LRU
    return hit ?? null;
  }

  has(key: string) { return this.map.has(key); }
  get size() { return this.map.size; }
  loading(key: string) { return this.inflight.has(key); }

  /**
   * Busca um quadro, deduplicando requisicoes em voo.
   *
   * A deduplicacao nao e detalhe: o laco de pre-carga roda a cada quadro de
   * animacao. Sem ela, um campo lento seria pedido dezenas de vezes enquanto a
   * primeira resposta ainda estivesse a caminho — e o guarda de orcamento do
   * servidor recusaria o excedente, o que apareceria como falha de rede.
   */
  fetch(f: { date: string; hour: number }, signal?: AbortSignal): Promise<WindMeta | null> {
    const key = frameKey(f);
    const hit = this.get(key);
    if (hit) return Promise.resolve(hit);

    const busy = this.inflight.get(key);
    if (busy) return busy;

    const p = fetch(`/api/wind?date=${f.date}&hour=${f.hour}`, { signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as WindMeta;
      })
      .then((grid) => {
        if (!isValidWindMeta(grid)) {
          throw new Error(`campo de vento malformado para ${key}: nx=${(grid as any)?.nx}, ny=${(grid as any)?.ny}`);
        }
        this.map.set(key, compact(grid));
        while (this.map.size > this.max) {
          const oldest = this.map.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.map.delete(oldest);
        }
        return grid;
      })
      .catch(() => null)
      .finally(() => { this.inflight.delete(key); });

    this.inflight.set(key, p);
    return p;
  }

  clear() { this.map.clear(); this.inflight.clear(); }
}

/**
 * Estado da reproducao, sem React — para poder ser testado no Node.
 *
 * O cursor e um numero REAL sobre os indices dos quadros: 3,4 significa "entre
 * o quadro 3 e o 4, quatro decimos do caminho". A parte inteira escolhe o par
 * de campos; a fracionaria vira o `uMix` do shader.
 */
export class PlayerState {
  cursor = 0;
  frames: Frame[] = [];

  setFrames(frames: Frame[]) {
    this.frames = frames;
    this.cursor = Math.min(this.cursor, Math.max(0, frames.length - 1));
  }

  get indexA() { return Math.floor(this.cursor); }
  get indexB() { return Math.min(this.indexA + 1, this.frames.length - 1); }
  get mix() { return this.cursor - this.indexA; }
  get frameA(): Frame | null { return this.frames[this.indexA] ?? null; }
  get frameB(): Frame | null {
    const b = this.frames[this.indexB];
    return b && b !== this.frameA ? b : null;
  }

  /**
   * Avanca o cursor, respeitando o que ja foi baixado.
   *
   * Devolve `false` quando teve de segurar porque o proximo quadro nao chegou —
   * a interface usa isso para mostrar "carregando" em vez de fingir que a
   * animacao esta rodando.
   */
  advance(dt: number, framesPerSec: number, isReady: (f: Frame) => boolean): boolean {
    const last = this.frames.length - 1;
    if (last < 1) return false;

    const want = this.cursor + dt * framesPerSec;

    // Fim da janela: volta ao inicio. Um laco fechado e o comportamento certo
    // para uma animacao curta — parar no fim exigiria um clique para rever, e a
    // leitura de uma evolucao meteorologica quase sempre precisa de repeticao.
    if (want >= last) { this.cursor = 0; return true; }

    // ATE ONDE A SERIE ESTA CONTIGUA a partir do quadro atual.
    //
    // Olhar so um quadro a frente nao basta: com dt grande (uma aba que voltou
    // do segundo plano, um quadro perdido) o cursor pularia por cima de varios
    // quadros de uma vez e aterrissaria depois de um buraco. O par (A,B) sairia
    // com um dos lados vazio, todas as particulas morreriam no mesmo instante e
    // o globo apagaria por um segundo — que se parece com falha de renderizacao
    // e seria caçado no lugar errado.
    let ready = this.indexA;
    while (ready < last && isReady(this.frames[ready + 1])) ready++;

    // O par exige A e A+1 carregados, entao o cursor pode chegar a qualquer
    // valor ESTRITAMENTE menor que `ready`.
    const cap = ready - 1e-4;

    if (want > cap) {
      this.cursor = Math.max(this.cursor, Math.min(want, cap));
      return false;                        // segurou: falta rede
    }

    this.cursor = want;
    return true;
  }

  /**
   * O par a publicar na GPU, ja resolvido contra o que esta carregado.
   *
   * Existe para que o chamador nao precise LEMBRAR de checar `frameB`. O caso
   * limite e real: no primeiro quadro, ou logo depois de um salto, A ja chegou
   * e B ainda nao. Publicar B ausente misturaria o campo com uma textura vazia
   * e as particulas morreriam todas de uma vez.
   *
   * Aqui isso e impossivel por construcao: sem B carregado, `b` sai nulo E a
   * fracao sai zerada — o resultado e o campo A parado, que e exatamente o
   * comportamento correto enquanto se espera a rede.
   */
  pair(isReady: (f: Frame) => boolean): { a: Frame | null; b: Frame | null; mix: number } {
    const a = this.frameA;
    if (!a || !isReady(a)) return { a: null, b: null, mix: 0 };
    const b = this.frameB;
    if (!b || !isReady(b)) return { a, b: null, mix: 0 };
    return { a, b, mix: this.mix };
  }

  /** salto direto, usado pela barra de tempo */
  seek(index: number) {
    this.cursor = Math.max(0, Math.min(this.frames.length - 1, index));
  }

  /**
   * Quais quadros pre-carregar, do mais urgente ao menos.
   * Sempre inclui o par atual; depois olha para a frente, que e para onde a
   * reproducao vai. Nao pre-carrega para tras: rebobinar e raro e o cache
   * costuma ainda ter o que passou.
   */
  prefetchQueue(ahead = 3): Frame[] {
    const out: Frame[] = [];
    for (let i = this.indexA; i <= this.indexA + ahead && i < this.frames.length; i++) {
      const f = this.frames[i];
      if (f) out.push(f);
    }
    return out;
  }
}