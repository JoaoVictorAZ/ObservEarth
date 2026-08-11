// test/rotas-analise.mjs
// -----------------------------------------------------------------------------
// FIAÇÃO das três rotas de análise.
//
// Os outros testes provam a matemática dos módulos. Este prova outra coisa: que
// a ROTA chama o módulo certo, passa os parâmetros certos e devolve o status
// certo. É exatamente a costura onde os defeitos anteriores viviam — o módulo
// pedia `?range=`, a rota lia `?days=`, e ninguém percebeu porque cada metade,
// isolada, estava correta.
//
// Sobe o servidor de verdade com a rede substituída. Nada sai para a internet.
// -----------------------------------------------------------------------------

import { createServer } from "node:http";
import http from "node:http";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIARIAS } from "../server/timeseries.js";
import { NIVEIS, CAMPOS } from "../server/sounding.js";
import { MODELOS, VARIAVEIS } from "../server/compare.js";

const PORTA = 3941;
process.env.PORT = String(PORTA);

// Banco NOVO a cada execução.
//
// Na primeira vez que rodei isto duas vezes seguidas, três verificações
// passaram a falhar: "10 anos custam UMA chamada de rede" contou ZERO. O cache
// em disco da execução anterior tinha sobrevivido, e a rota respondeu sem tocar
// na rede — comportamento correto do servidor, teste mal isolado.
//
// Um teste que depende do que ficou da última execução não mede o código: mede
// a ordem em que se rodou.
const DB = join(tmpdir(), `observatorio-teste-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB;
const limpar = () => { for (const s of ["", "-wal", "-shm"]) rmSync(DB + s, { force: true }); };
process.on("exit", limpar);

const vistas = [];
let modo = "ok";

/** rede de mentira: devolve o formato real da Open-Meteo, sem sair da máquina */
globalThis.fetch = async (url) => {
  const u = String(url);
  vistas.push(u);
  if (modo === "falha") return { ok: false, status: 503, json: async () => ({}) };

  if (u.includes("archive-api")) {
    const p = new URL(u).searchParams;
    const t = [];
    for (let d = Date.parse(p.get("start_date")); d <= Date.parse(p.get("end_date")); d += 86400e3) {
      t.push(new Date(d).toISOString().slice(0, 10));
    }
    const daily = { time: t };
    for (const v of DIARIAS) daily[v] = t.map((_, i) => 20 + (i % 7));
    return { ok: true, status: 200, json: async () => ({ daily }) };
  }
  if (u.includes("models=")) {
    const time = Array.from({ length: 48 }, (_, i) =>
      new Date(Date.UTC(2026, 7, 11, i)).toISOString().slice(0, 16));
    const hourly = { time };
    for (const v of VARIAVEIS) {
      for (const m of MODELOS) {
        hourly[`${v.id}_${m.id}`] = time.map((_, i) => 20 + i * 0.1 + m.id.length);
      }
    }
    return { ok: true, status: 200, json: async () => ({ hourly }) };
  }
  if (u.includes("hPa")) {
    const time = Array.from({ length: 24 }, (_, i) => `2026-08-11T${String(i).padStart(2, "0")}:00`);
    const hourly = { time };
    for (const nv of NIVEIS) {
      for (const c of CAMPOS) {
        const base = c === "temperature" ? 25 - (1000 - nv) * 0.05
          : c === "relative_humidity" ? 65
          : c === "wind_speed" ? 8
          : c === "wind_direction" ? 280
          : (1000 - nv) * 11;
        hourly[`${c}_${nv}hPa`] = time.map(() => base);
      }
    }
    return { ok: true, status: 200, json: async () => ({ hourly }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

// A porta pode estar ocupada por um servidor de desenvolvimento: melhor pular
// do que falhar a suíte inteira por um motivo que não é o do teste.
const livre = await new Promise((res) => {
  const s = createServer();
  s.once("error", () => res(false));
  s.once("listening", () => s.close(() => res(true)));
  s.listen(PORTA, "127.0.0.1");
});
if (!livre) {
  console.log(`\nfiação das rotas de análise\n  (pulado: porta ${PORTA} ocupada)\n`);
  process.exit(0);
}

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));

const pegar = (p) => new Promise((res, rej) => {
  http.get(`http://127.0.0.1:${PORTA}/api/analysis${p}`, (r) => {
    let b = "";
    r.on("data", (c) => (b += c));
    r.on("end", () => res({ status: r.statusCode, json: JSON.parse(b || "{}") }));
  }).on("error", rej);
});

let n = 0, falhas = 0;
const ok = (nome, cond, det = "") => {
  if (cond) { n++; console.log(`  ok  ${nome}`); }
  else { falhas++; console.log(`  FALHOU  ${nome} ${det}`); }
};
const doArquivo = () => vistas.filter((u) => u.includes("archive")).length;

console.log("\nfiação das rotas de análise");

// --- série -------------------------------------------------------------------
let r = await pegar("/timeseries?lat=-23.55&lng=-46.63&range=10y");
ok("série responde 200", r.status === 200, r.status);
ok("a janela de 10 anos chega inteira à rota", r.json.intervalo?.dias === 3652, r.json.intervalo?.dias);
ok("o contrato é `{ ok, serie, resumos }`",
   r.json.ok === true && Array.isArray(r.json.serie?.time) && !!r.json.resumos);
ok("10 anos custam UMA chamada de rede", doArquivo() === 1, doArquivo());
ok("nenhuma pressão média diária no contrato", !("surface_pressure_mean" in (r.json.serie ?? {})));
ok("toda variável servida tem unidade e rótulo",
   r.json.variaveis.every((v) => r.json.unidades[v] && r.json.rotulos[v]));

// O precompute do vento roda em segundo plano; contar só o arquivo isola o
// que este teste mede.
const antes = doArquivo();
await pegar("/timeseries?lat=-23.55&lng=-46.63&range=10y");
ok("a segunda chamada vem do cache", doArquivo() === antes, `${antes} -> ${doArquivo()}`);

// --- sondagem ----------------------------------------------------------------
r = await pegar("/sounding?lat=-23.55&lng=-46.63");
ok("sondagem responde 200", r.status === 200, r.status);
ok("o perfil traz todos os níveis", r.json.perfil?.length === NIVEIS.length, r.json.perfil?.length);
ok("o orvalho derivado nunca passa da temperatura",
   r.json.perfil?.every((p) => p.orvalho == null || p.orvalho <= p.temperatura + 1e-9));
ok("a requisição usou hPa MAIÚSCULO", vistas.some((u) => u.includes("temperature_1000hPa")));
ok("o instante da sondagem volta declarado", /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(r.json.instante ?? ""));

// --- modelos -----------------------------------------------------------------
r = await pegar("/compare?lat=-23.55&lng=-46.63&horas=48");
ok("comparação responde 200", r.status === 200, r.status);
ok("cada modelo traz série própria",
   MODELOS.every((m) => Array.isArray(r.json.serie?.temperature_2m?.[m.id])));
ok("a dispersão é medida, não constante", r.json.espalhamento?.temperature_2m?.maiorAmplitude > 0);
ok("os três modelos num único pedido", vistas.filter((u) => u.includes("models=")).length === 1);

// --- falha: onde estava a fabricação -----------------------------------------
modo = "falha";
r = await pegar("/timeseries?lat=10&lng=10&range=1y");
ok("fonte fora do ar vira 502 — NUNCA 200 com série inventada", r.status === 502, r.status);
ok("a falha traz motivo e código", r.json.ok === false && !!r.json.error && !!r.json.code);
ok("a resposta de erro não carrega série nenhuma", !r.json.serie && !r.json.stats);

r = await pegar("/sounding?lat=10&lng=10");
ok("sondagem fora do ar vira 502, não perfil de reta", r.status === 502, r.status);
ok("nenhum perfil na resposta de erro", !r.json.perfil);

r = await pegar("/compare?lat=10&lng=10");
ok("comparação fora do ar vira 502", r.status === 502, r.status);

r = await pegar("/timeseries?lat=abc&lng=10");
ok("coordenada inválida vira 400", r.status === 400, r.status);

console.log(falhas ? `\n  ${falhas} FALHA(S) de fiação\n` : `\n  ${n} verificações de fiação\n`);
process.exit(falhas ? 1 : 0);
