// server/estacoes.js
// -----------------------------------------------------------------------------
// AS ESTAÇÕES DO INMET — a primeira camada de MEDIÇÃO do aplicativo
// -----------------------------------------------------------------------------
// Até aqui o ObservEarth mostrava modelo: GFS, ERA5, reanálise. Coisas
// calculadas. Isto é diferente — são termômetros, num lugar, com um número de
// série. É a mudança de patamar do M7.
//
// O arquivo vem de `pipeline/exportar_estacoes.py`, que lê as 8 primeiras
// linhas de cada CSV do INMET. Não passa por Spark nem por nuvem: a dimensão
// não precisa de nenhum dos dois, e fazer o aplicativo esperar por eles seria
// deixar 565 pontos reais fora da tela sem motivo.
//
// -----------------------------------------------------------------------------
// LIDO UMA VEZ, NA SUBIDA
// -----------------------------------------------------------------------------
// São ~200 kB e não mudam durante a execução. Ler a cada requisição gastaria
// disco para devolver sempre a mesma coisa; e manter em memória permite
// responder à pergunta que a sonda faz o tempo todo — "qual a estação mais
// próxima deste ponto?" — sem tocar em I/O.
//
// SE O ARQUIVO NÃO EXISTIR, a rota responde 503 com o motivo e o comando que
// o gera. Não é erro de programação: é uma etapa da carga que não rodou, e a
// tela precisa distinguir "não há estação aqui" de "o export não foi feito".
// -----------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO = join(RAIZ, "data", "gold", "estacoes.json");

const RAIO_TERRA_KM = 6371.0088;

let cache = null;

/** Distância em km sobre a esfera. A mesma conta de `pipeline/gold_cobertura.py`. */
export function haversine(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const p1 = lat1 * r, p2 = lat2 * r;
  const dp = p2 - p1, dl = (lng2 - lng1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function carregar() {
  if (cache) return cache;
  if (!existsSync(ARQUIVO)) {
    cache = { ok: false, motivo: "export de estações não encontrado", estacoes: [] };
    return cache;
  }
  try {
    const j = JSON.parse(readFileSync(ARQUIVO, "utf8"));
    const lista = (j.estacoes ?? []).filter(
      (e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
    cache = {
      ok: true,
      fonte: j.fonte ?? "INMET",
      licenca: j.licenca ?? null,
      geradoEm: statSync(ARQUIVO).mtime.toISOString(),
      estacoes: lista,
    };
    return cache;
  } catch (e) {
    cache = { ok: false, motivo: `arquivo ilegível: ${e.message}`, estacoes: [] };
    return cache;
  }
}

/**
 * A estação mais próxima de um ponto, com a distância.
 *
 * A DISTÂNCIA SAI JUNTO, SEMPRE, e é isso que torna a resposta honesta: uma
 * estação a 300 km não descreve o quintal de ninguém. Quem decide se aquilo
 * vale ser mostrado é a tela, e ela só consegue decidir se souber o número.
 */
export function maisProxima(lat, lng) {
  const { estacoes } = carregar();
  let melhor = null, d = Infinity;
  for (const e of estacoes) {
    const k = haversine(lat, lng, e.lat, e.lng);
    if (k < d) { melhor = e; d = k; }
  }
  return melhor ? { ...melhor, dist_km: Math.round(d * 10) / 10 } : null;
}

export function registrarRotasEstacoes(app) {
  app.get("/api/estacoes", (_req, res) => {
    const c = carregar();
    if (!c.ok) {
      // 503, e não 500: o serviço está de pé, o dado é que não foi gerado.
      return res.status(503).json({
        ok: false,
        error: c.motivo,
        hint: "Execute: python pipeline/exportar_estacoes.py",
      });
    }
    res.json({
      ok: true,
      count: c.estacoes.length,
      fonte: c.fonte,
      licenca: c.licenca,
      geradoEm: c.geradoEm,
      estacoes: c.estacoes,
    });
  });

  app.get("/api/estacoes/proxima", (req, res) => {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "lat e lng são obrigatórios" });
    }
    const c = carregar();
    if (!c.ok) return res.status(503).json({ ok: false, error: c.motivo });
    const e = maisProxima(lat, lng);
    res.json({ ok: true, estacao: e });
  });
}
