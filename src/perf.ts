// src/perf.ts
// -----------------------------------------------------------------------------
// Medição de desempenho (FPS / CPU / GPU) e controle de qualidade adaptativa.
// -----------------------------------------------------------------------------

export interface FrameStats {
  fps: number;
  frameMs: number;       // tempo entre quadros
  cpuMs: number;         // tempo do NOSSO trabalho por quadro
  calls: number;         // draw calls do WebGL
  tris: number;
  points: number;
  textures: number;
  geometries: number;
  tier: QualityTier;
  dpr: number;
}

export type QualityTier = 0 | 1 | 2;   // 0 alta, 1 equilibrada, 2 desempenho

/**
 * PISO DE QUALIDADE DO VENTO.
 *
 * O rastro e uma textura equiretangular esticada sobre a esfera INTEIRA. A
 * 1024x512 sobram ~2,8 texels por grau no equador — de perto vira borrao, e foi
 * exatamente o que a versao anterior produziu. 2048 e o minimo aceitavel; abaixo
 * disso o sistema deixa de parecer um campo de vento.
 *
 * Isso so cabe no orcamento porque o decaimento passou a ser feito por MISTURA
 * (ver windGPU.ts): antes cada pixel do alvo custava uma leitura de textura mais
 * uma escrita, agora custa so a escrita. O passe ficou barato o bastante para
 * que a resolucao alta deixe de ser o item que derruba o quadro.
 *
 * O que desce entre degraus e a RESOLUCAO DE TELA e a contagem de particulas —
 * nunca a nitidez do rastro.
 */
export const TIERS = {
  0: { label: "Alta", dpr: 2.0, trail: 4096, particles: 40000, fadeEvery: 1, fires: 4000 },
  1: { label: "Equilibrada", dpr: 1.5, trail: 2048, particles: 22500, fadeEvery: 1, fires: 2000 },
  2: { label: "Desempenho", dpr: 1.0, trail: 2048, particles: 12100, fadeEvery: 2, fires: 900 },
} as const;

const BUDGET_MS = 20;      // acima disso, degrada
const CRITICAL_MS = 33;    // abaixo de 30 FPS, degrada imediatamente
const RECOVER_MS = 13;     // folga consistente: pode voltar a subir

export class PerfMonitor {
  tier: QualityTier = 0;
  /** trava a qualidade num degrau; null volta ao automatico */
  locked: QualityTier | null = null;

  private frames: number[] = [];
  private cpu = 0;
  private last = 0;
  private t0 = 0;
  private goodStreak = 0;
  private badStreak = 0;
  private onTier: ((t: QualityTier) => void) | null = null;

  stats: FrameStats = {
    fps: 0, frameMs: 0, cpuMs: 0, calls: 0, tris: 0,
    points: 0, textures: 0, geometries: 0, tier: 0, dpr: 1,
  };

  onTierChange(fn: (t: QualityTier) => void) { this.onTier = fn; }

  /** marca o inicio do nosso trabalho no quadro */
  begin() { this.t0 = performance.now(); }

  /** marca o fim e atualiza as medias */
  end(now: number, renderer?: { info?: { render?: { calls?: number; triangles?: number; points?: number }; memory?: { textures?: number; geometries?: number } }; getPixelRatio?: () => number }) {
    this.cpu = performance.now() - this.t0;

    if (this.last) {
      const dt = now - this.last;
      this.frames.push(dt);
      if (this.frames.length > 60) this.frames.shift();
    }
    this.last = now;

    if (this.frames.length < 20) return;

    // MEDIANA, nao media: um unico quadro de 300 ms (carregar textura, montar
    // geometria) nao deve derrubar a qualidade da sessao inteira.
    const sorted = [...this.frames].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];

    const info = renderer?.info;
    this.stats = {
      fps: Math.round(1000 / med),
      frameMs: +med.toFixed(1),
      cpuMs: +this.cpu.toFixed(1),
      calls: info?.render?.calls ?? 0,
      tris: info?.render?.triangles ?? 0,
      points: info?.render?.points ?? 0,
      textures: info?.memory?.textures ?? 0,
      geometries: info?.memory?.geometries ?? 0,
      tier: this.tier,
      dpr: +(renderer?.getPixelRatio?.() ?? 1).toFixed(2),
    };

    if (this.locked !== null) return;

    // histerese por sequencia: so muda de degrau depois de um comportamento
    // sustentado, senao a qualidade oscila e o resultado pisca
    if (med > CRITICAL_MS) { this.badStreak += 3; this.goodStreak = 0; }
    else if (med > BUDGET_MS) { this.badStreak++; this.goodStreak = 0; }
    else if (med < RECOVER_MS) { this.goodStreak++; this.badStreak = 0; }
    else { this.badStreak = 0; this.goodStreak = 0; }

    if (this.badStreak >= 12 && this.tier < 2) {
      this.setTier((this.tier + 1) as QualityTier);
    } else if (this.goodStreak >= 150 && this.tier > 0) {
      // subir e MUITO mais lento que descer: melhor ficar um degrau abaixo do
      // possivel do que oscilar entre dois
      this.setTier((this.tier - 1) as QualityTier);
    }
  }

  setTier(t: QualityTier) {
    if (t === this.tier) return;
    this.tier = t;
    this.badStreak = 0;
    this.goodStreak = 0;
    this.frames.length = 0;
    this.onTier?.(t);
  }

  lock(t: QualityTier | null) {
    this.locked = t;
    if (t !== null) this.setTier(t);
  }
}
