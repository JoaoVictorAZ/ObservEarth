// server/forecast.js
// -----------------------------------------------------------------------------
// Geração da linha do tempo e ordenação de quadros de previsão GFS.
// -----------------------------------------------------------------------------

import { gfsCoverage, GFS_MAX_LEAD } from "./gfs.js";
import { windKey } from "./wind.js";

/** passo da linha do tempo, em horas. Igual a cadencia do GFS acima de f120. */
export const FRAME_STEP = 3;

/**
 * Janela padrao de reproducao, em horas.
 *
 * Nao usamos as 240 h inteiras por escolha de custo: cada quadro e uma
 * requisicao ao NOMADS e ~8 MB de textura na GPU. 72 h dao 25 quadros — a 4 por
 * segundo, uma animacao de ~6 s, tempo suficiente para ler a evolucao de um
 * sistema sinotico sem gastar dez dias de banda que ninguem vai assistir.
 */
export const DEFAULT_SPAN_H = 72;

function toUTC(dateStr, hour) {
  return Date.UTC(
    +dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10), hour
  );
}

function splitUTC(ms) {
  const d = new Date(ms);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/**
 * Alinha um instante ao passo da grade temporal.
 *
 * Sem isto, comecar as 14h07 pediria quadros em horas quebradas, que nao
 * existem no GFS: cada um cairia no passo mais proximo e dois quadros seguidos
 * poderiam resolver para o MESMO campo — a animacao teria repeticoes.
 */
export function alignToStep(ms) {
  const stepMs = FRAME_STEP * 3600e3;
  return Math.floor(ms / stepMs) * stepMs;
}

/**
 * Enumera os quadros da linha do tempo.
 *
 * @param {object}   opts
 * @param {string}  [opts.from]    data inicial UTC (AAAA-MM-DD); padrao: agora
 * @param {number}  [opts.hour]    hora inicial UTC; padrao: hora alinhada de agora
 * @param {number}  [opts.spanH]   duracao da janela, em horas
 * @param {Date}    [opts.now]     injetavel para teste
 * @param {(k:string)=>boolean} [opts.isCached]  consulta ao cache
 */
export function forecastTimeline(opts = {}) {
  const now = opts.now ?? new Date();
  const spanH = Math.max(FRAME_STEP, Math.min(GFS_MAX_LEAD, opts.spanH ?? DEFAULT_SPAN_H));

  const startMs = opts.from
    ? toUTC(opts.from, opts.hour ?? 0)
    : alignToStep(now.getTime());

  const frames = [];
  for (let h = 0; h <= spanH; h += FRAME_STEP) {
    const at = alignToStep(startMs + h * 3600e3);
    const { date, hour } = splitUTC(at);
    const cov = gfsCoverage(at, now);

    frames.push({
      date,
      hour,
      at,
      /** horas desde o inicio da janela — e o que o rotulo "+018h" mostra */
      offsetH: h,
      /** horas desde a analise do modelo: mede a CONFIANCA, nao a posicao */
      leadH: cov?.leadH ?? null,
      kind: cov?.kind ?? null,
      cycle: cov?.cycle ?? null,
      /** sem cobertura do GFS o quadro sai da animacao em vez de degradar */
      available: Boolean(cov),
      cached: opts.isCached ? Boolean(opts.isCached(windKey(date, hour))) : false,
    });
  }

  // Cortar no primeiro buraco, nao filtrar os buracos. Uma lista com falhas no
  // meio faria o tempo saltar durante a reproducao — o usuario veria o campo
  // pular 6 h de uma vez sem nenhuma indicacao de que algo foi omitido.
  const firstGap = frames.findIndex((f) => !f.available);
  const usable = firstGap === -1 ? frames : frames.slice(0, Math.max(1, firstGap));

  return {
    step: FRAME_STEP,
    spanH,
    frames: usable,
    truncated: usable.length < frames.length,
    ready: usable.filter((f) => f.cached).length,
  };
}
