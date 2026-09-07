// test/currents.mjs
// -----------------------------------------------------------------------------
// Correntes marítimas.
//
// A rota anterior gerava o oceano inteiro por fórmula. O que a substitui tem um
// risco específico e sério, e a maior parte deste arquivo é sobre ele:
//
//   VENTO e CORRENTE usam convenções OPOSTAS, e as duas se chamam "direção".
//
//     vento    (meteorológica)  270° = vem DE oeste, sopra PARA leste
//     corrente (oceanográfica)  270° = vai PARA oeste
//
// Copiar a conversão do vento — que soma 180° — poria toda corrente do planeta
// ao contrário. E não quebraria nada: a Corrente do Golfo desceria a costa
// americana em vez de subir, com aparência perfeitamente normal para quem não
// conhece a circulação de cor.
//
// Por isso os casos de referência aqui são correntes REAIS, com sentido que se
// pode conferir num atlas.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import {
  PASSO, LOTE, TETO_MS, CONCORRENCIA, COBERTURA_MINIMA,
  uvDaCorrente, montarPontos, buscarCorrentes,
} from "../server/currents.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const okA = async (nome, fn) => { await fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ncorrentes marítimas");

// ---------------------------------------------------------------------------
// a convenção — o coração do arquivo
// ---------------------------------------------------------------------------
ok("direção 0° é água indo PARA O NORTE", () => {
  const { u, v } = uvDaCorrente(1, 0);
  assert.ok(Math.abs(u) < 1e-9, `u = ${u}`);
  assert.ok(Math.abs(v - 1) < 1e-9, `v = ${v}, esperava +1 (norte)`);
});

ok("direção 90° é água indo PARA O LESTE", () => {
  const { u, v } = uvDaCorrente(1, 90);
  assert.ok(Math.abs(u - 1) < 1e-9, `u = ${u}, esperava +1 (leste)`);
  assert.ok(Math.abs(v) < 1e-9, `v = ${v}`);
});

ok("NÃO é a convenção do vento — nada de somar 180°", () => {
  // Este é o teste que existe para impedir o copiar-e-colar. Com a fórmula do
  // vento, 90° daria u = −1: a corrente inteira do planeta invertida.
  const { u } = uvDaCorrente(1, 90);
  assert.ok(u > 0, "a conversão do vento foi copiada — todo oceano está ao contrário");
  const rad = ((90 + 180) * Math.PI) / 180;
  assert.notEqual(+u.toFixed(6), +(1 * Math.sin(rad)).toFixed(6));
});

ok("Corrente do Golfo: sentido nordeste sobe pela costa americana", () => {
  // Ao largo da Flórida ela corre para NNE, ~40°. Se o sinal estivesse
  // invertido, ela desceria — e pareceria normal para olho destreinado.
  const { u, v } = uvDaCorrente(1.8, 40);
  assert.ok(u > 0, "Golfo indo para oeste, contra o continente");
  assert.ok(v > 0, "Golfo descendo em vez de subir");
  assert.ok(v > u, "em 40° a componente norte tem que dominar");
});

ok("Circumpolar Antártica: para LESTE, dando a volta no continente", () => {
  // A maior corrente do planeta corre de oeste para leste. Direção ~90°.
  const { u, v } = uvDaCorrente(0.5, 90);
  assert.ok(u > 0, "a Circumpolar está indo para oeste");
  assert.ok(Math.abs(v) < 1e-9);
});

ok("Corrente das Canárias: para o SUL na costa africana", () => {
  const { u, v } = uvDaCorrente(0.3, 180);
  assert.ok(v < 0, "as Canárias estão subindo em vez de descer");
  assert.ok(Math.abs(u) < 1e-9);
});

ok("o módulo é preservado em qualquer direção", () => {
  for (let d = 0; d < 360; d += 15) {
    const { u, v } = uvDaCorrente(2.4, d);
    assert.ok(Math.abs(Math.hypot(u, v) - 2.4) < 1e-9, `direção ${d}° alterou o módulo`);
  }
});

ok("360° e 0° dão o mesmo vetor", () => {
  const a = uvDaCorrente(1, 0), b = uvDaCorrente(1, 360);
  assert.ok(Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9);
});

ok("ausência não vira vetor nulo", () => {
  // Terra volta null da API. Um (0,0) seria "água parada", que é uma
  // afirmação — e faria a partícula morrer em cima do continente em vez de
  // nunca nascer ali.
  assert.equal(uvDaCorrente(null, 90), null);
  assert.equal(uvDaCorrente(1, null), null);
  assert.equal(uvDaCorrente(NaN, 90), null);
  assert.equal(uvDaCorrente(1, NaN), null);
});

// ---------------------------------------------------------------------------
// a grade
// ---------------------------------------------------------------------------
ok("a grade cobre o globo sem furo nem repetição", () => {
  const { lats, lngs, nx, ny } = montarPontos(1.5);
  assert.equal(nx, 240); assert.equal(ny, 120);
  assert.ok(lats[0] < 90 && lats[0] > 88, `primeira latitude ${lats[0]}`);
  assert.ok(lats[ny - 1] > -90 && lats[ny - 1] < -88);
  assert.ok(lngs[0] > -180 && lngs[0] < -178);
  assert.ok(lngs[nx - 1] < 180 && lngs[nx - 1] > 178);
  assert.equal(new Set(lngs).size, nx, "longitude repetida");
});

ok("as células são centradas, não encostadas na borda", () => {
  // Ponto exatamente em ±180 seria amostrado duas vezes na emenda.
  const { lngs } = montarPontos(1.5);
  assert.ok(!lngs.includes(180) && !lngs.includes(-180));
});

ok("o custo em requisições cabe no orçamento", () => {
  // Teto do projeto: um quarto do limite gratuito, cacheado por 6 h.
  const { nx, ny } = montarPontos(PASSO);
  const reqs = Math.ceil((nx * ny) / LOTE);
  assert.ok(reqs <= 200, `${reqs} requisições por campo`);
});

ok("o LOTE cabe na URL que o nginx da fonte aceita", () => {
  // MEDIDO contra a API real: 400 pontos dão 7.277 bytes e passam; 600 dão
  // 10.969 e voltam 414 Request-URI Too Large. O limite não é de pontos, é de
  // bytes — e coordenadas negativas de três dígitos gastam mais que "0.75".
  const piorCaso = "-179.25";
  const bytes = LOTE * (piorCaso.length + 1) * 2 + 200;   // lat + lng + resto
  assert.ok(bytes < 8000, `lote de ${LOTE} geraria ~${bytes} bytes de URL`);
});

// ---------------------------------------------------------------------------
// a busca
// ---------------------------------------------------------------------------
function servidor({ status = 200, velocidade = 0.8, direcao = 90, terra = () => false } = {}) {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(String(url));
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const p = new URL(String(url)).searchParams;
    const lats = p.get("latitude").split(",").map(Number);
    const lngs = p.get("longitude").split(",").map(Number);
    const time = Array.from({ length: 24 }, (_, i) => `2026-08-12T${String(i).padStart(2, "0")}:00`);
    return {
      ok: true, status: 200,
      json: async () => lats.map((la, i) => ({
        hourly: {
          time,
          ocean_current_velocity: time.map(() => (terra(la, lngs[i]) ? null : velocidade)),
          ocean_current_direction: time.map(() => (terra(la, lngs[i]) ? null : direcao)),
        },
      })),
    };
  };
  impl.chamadas = chamadas;
  return impl;
}

await okA("a URL pede m/s e célula de MAR", async () => {
  // Sem `velocity_unit=ms` a API devolve km/h — fator 3,6. Sem
  // `cell_selection=sea` ela procura célula em terra e devolve nulo na costa.
  const f = servidor();
  await buscarCorrentes(f, { passo: 30, lote: 200 });
  const u = new URL(f.chamadas[0]);
  assert.equal(u.searchParams.get("velocity_unit"), "ms");
  assert.equal(u.searchParams.get("cell_selection"), "sea");
  assert.ok(u.hostname.includes("marine-api"), `bateu em ${u.hostname}`);
  assert.equal(u.searchParams.get("hourly"),
    "ocean_current_velocity,ocean_current_direction");
});

await okA("terra fica com valid = 0 e vetor zerado, não medido", async () => {
  const ehTerra = (la, ln) => la > 0 && ln > 0;
  const c = await buscarCorrentes(servidor({ terra: ehTerra }), { passo: 30, lote: 500 });
  let terraMarcada = 0;
  const { lats, lngs, nx } = montarPontos(30);
  for (let y = 0; y < lats.length; y++) {
    for (let x = 0; x < nx; x++) {
      if (ehTerra(lats[y], lngs[x])) {
        assert.equal(c.valid[y * nx + x], 0, "terra marcada como medida");
        terraMarcada++;
      }
    }
  }
  assert.ok(terraMarcada > 0, "o cenário não tinha terra");
  assert.ok(c.measuredPct < 100);
});

await okA("cobertura parcial é o resultado CERTO, e vem explicada", async () => {
  // 71% do planeta é oceano. Um campo de correntes com 100% medido seria o
  // sinal de que algo está preenchendo continente.
  const c = await buscarCorrentes(servidor({ terra: (la) => la > 30 }), { passo: 30, lote: 500 });
  assert.equal(c.marEsperadoPct, 71);
  assert.ok(c.measuredPct < 100);
  assert.match(c.convencao, /para onde a água VAI/);
});

await okA("valor absurdo é descartado, não clampado", async () => {
  // Clampar transformaria lixo num campo constante e convincente — foi assim
  // que o vento já mostrou listras diagonais perfeitas vindas de 2e7 m/s.
  const c = await buscarCorrentes(servidor({ velocidade: 50 }), { passo: 45, lote: 500 })
    .catch((e) => e);
  assert.ok(c instanceof Error, "50 m/s de corrente foi aceito");
  assert.equal(c.code, "SEM_CORRENTES");
});

await okA("corrente forte porém plausível passa", async () => {
  // A Corrente do Golfo passa de 2,5 m/s em pontos raros. O teto tem que
  // aceitar isso e recusar o absurdo.
  const c = await buscarCorrentes(servidor({ velocidade: 2.6 }), { passo: 45, lote: 500 });
  assert.ok(c.measuredPct > 0);
  assert.ok(TETO_MS > 2.6 && TETO_MS < 20);
});

await okA("fonte fora do ar é erro com código, nunca campo inventado", async () => {
  await assert.rejects(
    () => buscarCorrentes(servidor({ status: 503 }), { passo: 45, lote: 500 }),
    (e) => e.code === "SEM_CORRENTES" && e.status === 502
  );
});

await okA("a procedência declara a origem real, não a rota", async () => {
  const c = await buscarCorrentes(servidor(), { passo: 45, lote: 500 });
  assert.match(c.provider, /Copernicus/);
  assert.match(c.dataset, /GLOBAL_ANALYSISFORECAST_PHY_001_024/);
  assert.ok(!/HYCOM/i.test(c.provider), "voltou a dizer HYCOM sem ser HYCOM");
  assert.equal(c.stepDeg, 45);
});

await okA("o campo resultante aponta para leste onde a direção é 90°", async () => {
  // Fecha o laço: da resposta da API até o vetor que o shader recebe.
  const c = await buscarCorrentes(servidor({ direcao: 90, velocidade: 1.2 }), { passo: 45, lote: 500 });
  const i = c.valid.findIndex((x) => x === 1);
  assert.ok(i >= 0);
  assert.ok(c.u[i] > 1.19, `u = ${c.u[i]}, esperava ~+1,2 (leste)`);
  assert.ok(Math.abs(c.v[i]) < 1e-6);
});

// ---------------------------------------------------------------------------
// O TRANSPORTE — a parte que quebrou em produção
// ---------------------------------------------------------------------------
// O campo chegou à tela com 5,9% de cobertura, desenhado como faixas
// horizontais de partículas separadas por vazios de dezenas de graus. A causa
// não era o desenho: 132 dos 144 lotes voltavam 429, e como cada lote cobria
// quase exatamente uma linha da grade, cada falha apagava uma faixa inteira de
// latitude. Medido contra a API de verdade:
//
//     1 lote sozinho ......... 200 OK
//     6 lotes em paralelo .... 4 de 6 deram 429
//
// E nada disso aparecia: a rota devolvia `ok: true` porque o único critério de
// recusa era "zero pontos medidos".
// ---------------------------------------------------------------------------

/** fonte que só aguenta `teto` requisições simultâneas; acima disso, 429 */
function servidorComLimite({ teto = 2, velocidade = 0.8, atraso = 5 } = {}) {
  let emVoo = 0;
  const estado = { pico: 0, total: 0, recusadas: 0 };
  const impl = async (url) => {
    estado.total++;
    emVoo++;
    estado.pico = Math.max(estado.pico, emVoo);
    try {
      if (emVoo > teto) { estado.recusadas++; return { ok: false, status: 429, headers: new Map(), json: async () => ({}) }; }
      await new Promise((r) => setTimeout(r, atraso));
      const p = new URL(String(url)).searchParams;
      const lats = p.get("latitude").split(",").map(Number);
      const time = ["2026-08-12T12:00"];
      return {
        ok: true, status: 200,
        json: async () => lats.map(() => ({
          hourly: {
            time,
            ocean_current_velocity: [velocidade],
            ocean_current_direction: [90],
          },
        })),
      };
    } finally { emVoo--; }
  };
  return { impl, estado };
}

await okA("a fila NUNCA passa da concorrência declarada", async () => {
  // Com `Promise.all` este número era o total de lotes. É ele que produzia o
  // 429 em massa, e é ele que o teste trava.
  const { impl, estado } = servidorComLimite({ teto: 99 });
  await buscarCorrentes(impl, { passo: 10, lote: 40, concorrencia: 2, coberturaMinima: 0 });
  assert.ok(estado.total > 4, `poucos lotes para o teste valer: ${estado.total}`);
  assert.ok(estado.pico <= 2, `${estado.pico} requisições simultâneas, o limite é 2`);
});

await okA("429 é repetido com espera, não descartado", async () => {
  // Uma fonte que recusa acima de 1 simultânea. Com concorrência 2, metade dos
  // lotes toma 429 na primeira tentativa — e tem que voltar completo mesmo
  // assim.
  const { impl, estado } = servidorComLimite({ teto: 1 });
  const c = await buscarCorrentes(impl, { passo: 15, lote: 30, concorrencia: 2, coberturaMinima: 0 });
  assert.ok(estado.recusadas > 0, "o teste não chegou a provocar 429 nenhum");
  assert.equal(c.lotesComFalha, 0, `${c.lotesComFalha} lotes desistiram apesar da repetição`);
  assert.ok(c.measuredPct > 90, `cobertura ${c.measuredPct}% depois das repetições`);
});

await okA("COBERTURA BAIXA é recusada, e a mensagem traz o número", async () => {
  // O caso exato de produção: a maior parte dos lotes falha, alguns passam, e
  // o resultado é um campo com faixas vazias. Servir isso como `ok: true` foi
  // o defeito — a tela não tinha como saber que estava desenhando um buraco.
  let n = 0;
  const impl = async (url) => {
    // um em cada dez lotes responde; o resto morre de vez (400 não repete)
    if (n++ % 10 !== 0) return { ok: false, status: 400, headers: new Map(), json: async () => ({}) };
    const p = new URL(String(url)).searchParams;
    const lats = p.get("latitude").split(",").map(Number);
    return {
      ok: true, status: 200,
      json: async () => lats.map(() => ({
        hourly: { time: ["2026-08-12T12:00"], ocean_current_velocity: [0.8], ocean_current_direction: [90] },
      })),
    };
  };
  const e = await buscarCorrentes(impl, { passo: 10, lote: 40, concorrencia: 2 }).catch((x) => x);
  assert.ok(e instanceof Error, "um campo com 90% de buraco foi aceito");
  assert.equal(e.code, "CORRENTES_INCOMPLETAS");
  assert.match(e.message, /% dos pontos medidos/);
  assert.match(e.message, /lotes falharam/);
  assert.ok(typeof e.medidoPct === "number" && e.medidoPct > 0, "o número não veio no erro");
});

await okA("cobertura boa passa e declara a fração de mar medida", async () => {
  const { impl } = servidorComLimite({ teto: 99 });
  const c = await buscarCorrentes(impl, { passo: 10, lote: 40, concorrencia: 2 });
  // Sem terra na fonte falsa, tudo é medido: a fração passa de 1.
  assert.ok(c.coberturaDoMar > COBERTURA_MINIMA, `cobertura do mar ${c.coberturaDoMar}`);
  assert.equal(c.esquema, 2, "o esquema precisa viajar para a chave de cache mudar");
});

await okA("a concorrência padrão é conservadora — a fonte mede em rajada", async () => {
  assert.ok(CONCORRENCIA <= 3, `concorrência padrão ${CONCORRENCIA} é alta demais`);
  assert.ok(COBERTURA_MINIMA > 0.3 && COBERTURA_MINIMA < 1,
    `piso de cobertura ${COBERTURA_MINIMA} fora de faixa útil`);
});

await okA("o CUSTO contado é o de LOCALIDADES, não o de requisições", async () => {
  // O defeito que deixou a camada consumir a cota diária inteira do provedor.
  // O guarda de `server/budget.js` recebia `1` por um lote que carrega
  // centenas de pontos, então acreditava ter gasto 144 chamadas onde gastara
  // 28.800 — e a sonda, a série histórica, o perfil vertical e a comparação
  // de modelos, que saem do MESMO provedor, ficavam sem cota sem explicação.
  const contado = [];
  const { impl } = servidorComLimite({ teto: 99 });
  await buscarCorrentes(impl, {
    passo: 20, lote: 30, concorrencia: 1, coberturaMinima: 0,
    medir: (n, f) => { contado.push(n); return f(); },
  });
  const { nx, ny } = montarPontos(20);
  const total = contado.reduce((a, b) => a + b, 0);
  assert.equal(total, nx * ny, `contou ${total} onde ha ${nx * ny} localidades`);
  assert.ok(contado.every((x) => x > 1), "algum lote foi contado como uma chamada so");
});

await okA("orçamento estourado aborta a fila inteira, sem repetir", async () => {
  // Não é falha passageira da fonte: é a nossa salvaguarda. Repetir quatro
  // vezes por lote, em dezenas de lotes, gastaria minutos para receber a mesma
  // recusa.
  let chamadas = 0;
  const medir = () => {
    chamadas++;
    throw Object.assign(new Error("orçamento por minuto atingido"),
      { code: "BUDGET_EXCEEDED", window: "minuto", status: 429 });
  };
  const e = await buscarCorrentes(async () => ({ ok: true, status: 200, json: async () => [] }), {
    passo: 10, lote: 40, concorrencia: 2, medir,
  }).catch((x) => x);
  assert.ok(e instanceof Error);
  assert.equal(e.code, "SEM_CORRENTES");
  assert.match(e.message, /orçamento/);
  assert.ok(chamadas < 8, `${chamadas} tentativas depois de o orçamento acabar`);
});

console.log(`\n  ${n} verificações das correntes\n`);
export default n;