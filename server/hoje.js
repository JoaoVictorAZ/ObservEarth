// server/hoje.js
// -----------------------------------------------------------------------------
// O AGREGADO DIÁRIO DE HOJE — o outro lado da comparação
// -----------------------------------------------------------------------------
// A normal de `climatologia.js` é uma distribuição de valores DIÁRIOS: máxima do
// dia, mínima do dia, total de chuva do dia. A sonda, até aqui, só tinha o valor
// INSTANTÂNEO de uma hora.
//
// COMPARAR OS DOIS SERIA ERRADO, E ERRADO DE UM JEITO QUE NÃO APARECE.
//
// A temperatura das 15 h fica sistematicamente acima da média diária — em quase
// todo lugar, todo dia, faça o tempo que fizer. Confrontá-la com a distribuição
// das médias diárias faria toda tarde de céu limpo virar "acima do normal" e
// toda madrugada virar "abaixo", com percentis altíssimos e nenhum significado.
// O viés é de vários graus e ele é do MÉTODO, não do tempo: não some com mais
// dados, não aparece como erro, e o número continua parecendo plausível.
//
// Por isso a anomalia é declarada para o DIA, não para o instante:
//
//   máxima de hoje   contra a distribuição das máximas de 1991–2020
//   mínima de hoje   contra a distribuição das mínimas
//   chuva de hoje    contra a distribuição dos totais diários
//
// Grandeza contra grandeza, sem correção nenhuma no meio. As chaves aqui são
// EXATAMENTE as mesmas de `VARIAVEIS` em climatologia.js — o cliente casa uma
// com a outra pela chave, e um nome trocado vira ausência visível em vez de
// comparação silenciosamente torta.
//
// O valor instantâneo continua na tela. Ele responde "como está agora"; esta
// rota responde "e isso é muito?".
// -----------------------------------------------------------------------------

import { VARIAVEIS } from "./climatologia.js";

/** As mesmas chaves da normal: o casamento é por nome, e tem que ser exato. */
export const CAMPOS = Object.keys(VARIAVEIS);

/**
 * A janela que a API de previsão cobre com agregado diário: ~92 dias para trás
 * e 16 para frente. Fora disso o pedido volta vazio, e vazio aqui é ausência
 * declarada, nunca zero.
 */
export function urlDia(lat, lng, data) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: CAMPOS.join(","),
    wind_speed_unit: "ms",
    timezone: "UTC",
    start_date: data,
    end_date: data,
  });
  return `https://api.open-meteo.com/v1/forecast?${qs}`;
}

/**
 * Chave de cache.
 *
 * Grade de 0,25° como a da normal, mas com a DATA dentro: o agregado de hoje
 * muda ao longo do dia — a máxima ainda não aconteceu de manhã — enquanto a
 * normal de 1991–2020 não muda nunca. São dois tempos de vida diferentes e por
 * isso são dois caches.
 */
export function chaveDia(lat, lng, data) {
  const r = (x) => (Math.round(x * 4) / 4).toFixed(2);
  return `dia:${data}:${r(lat)}:${r(lng)}`;
}

/** Extrai a primeira (e única) linha do agregado, preservando ausências. */
export function lerDia(diario, data) {
  const tempos = diario?.time ?? [];
  const i = tempos.indexOf(data);
  if (i < 0) return null;

  const valores = {};
  for (const k of CAMPOS) {
    const col = diario[k];
    const v = Array.isArray(col) ? col[i] : undefined;
    // null e não 0. "Não mediu" e "mediu zero" são coisas diferentes, e em
    // precipitação a diferença é a fronteira entre seca e falta de dado.
    valores[k] = v == null || !Number.isFinite(v) ? null : v;
  }
  return valores;
}

export async function buscarDia(fetchImpl, lat, lng, data, cached) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error("lat e lng são obrigatórios"), { status: 400 });
  }

  const TRES_HORAS = 3 * 3600e3;
  return cached(chaveDia(lat, lng, data), TRES_HORAS, async () => {
    const r = await fetchImpl(urlDia(lat, lng, data));
    if (!r.ok) throw Object.assign(new Error(`previsão diária HTTP ${r.status}`), { status: 502 });
    const j = await r.json();
    const valores = lerDia(j?.daily, data);
    if (!valores) throw Object.assign(new Error(`sem agregado diário para ${data}`), { status: 502 });
    return {
      data,
      valores,
      fonte: "Open-Meteo (melhor modelo disponível para o ponto)",
      nota:
        "Agregado do dia inteiro, para casar com a normal, que também é diária. " +
        "Antes do fim do dia a máxima e o total de chuva ainda são previsão.",
    };
  });
}
