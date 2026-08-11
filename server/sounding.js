// server/sounding.js
// -----------------------------------------------------------------------------
// PERFIL VERTICAL DA ATMOSFERA.
//
// O QUE ISTO SUBSTITUI
//
// A rota anterior montava o perfil inteiro com uma reta:
//
//     const lapseTemp = 25.0 - (1000 - hpa) * 0.08;
//     temperature: h[`temperature_${lvl}`]?.[idx] ?? +lapseTemp.toFixed(1)
//     humidity:    ... ?? Math.round(75 - (1000 - hpa) * 0.05)
//     windSpeed:   ... ?? +(15 + (1000 - hpa) * 0.04).toFixed(1)
//
// E o `catch` devolvia status 200 com `place: "Ponto Consultado"`.
//
// Três coisas erradas, em ordem crescente de gravidade:
//
//   1. Pedia `temperature_1000hpa`. A Open-Meteo publica `temperature_1000hPa`,
//      com P maiúsculo. Se a API rejeitava o parâmetro, TODO valor caía no `??`.
//      É plausível que este perfil nunca tenha mostrado um dado real.
//
//   2. A reta não é uma atmosfera. Temperatura caindo linearmente COM A PRESSÃO
//      não tem tropopausa, não tem inversão, não tem camada limite. A 200 hPa
//      dá −39 °C — plausível o bastante para ninguém desconfiar, e errado o
//      bastante para inutilizar qualquer índice calculado sobre ele.
//
//   3. Sondagem é de onde saem CAPE, CIN, índices de instabilidade. Um perfil
//      inventado não erra o gráfico: erra a previsão de tempestade.
//
// AQUI: nível sem dado é nível ausente. Falha é erro com código.
//
// SOBRE O ORVALHO
// A Open-Meteo não publica ponto de orvalho em níveis de pressão — publica
// umidade relativa. O orvalho é DERIVADO por Magnus-Tetens e vai marcado como
// derivado, com a fórmula e a faixa de validade declaradas. Derivar por uma
// relação física publicada não é inventar; apresentar sem dizer, sim.
// -----------------------------------------------------------------------------

/**
 * Níveis padrão de sondagem. São os níveis obrigatórios da OMM mais os
 * significativos que a Open-Meteo publica.
 */
export const NIVEIS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100];

/** grandezas disponíveis em nível de pressão (nomes exatos da Open-Meteo) */
export const CAMPOS = [
  "temperature",
  "relative_humidity",
  "wind_speed",
  "wind_direction",
  "geopotential_height",
];

/**
 * Ponto de orvalho por Magnus-Tetens.
 *
 *   γ = ln(UR/100) + (b·T)/(c + T)
 *   Td = c·γ / (b − γ)
 *
 * Coeficientes de Alduchov & Eskridge (1996), erro máximo 0,05 °C entre
 * −40 °C e +50 °C sobre água líquida. Acima da isoterma de −40 °C o vapor
 * está sobre gelo e a fórmula perde validade — por isso o teto.
 *
 * Devolve null quando não dá para calcular. Nunca chuta.
 */
export function orvalho(tempC, ur) {
  if (tempC == null || ur == null) return null;
  if (!Number.isFinite(tempC) || !Number.isFinite(ur)) return null;
  if (ur <= 0 || ur > 100) return null;
  if (tempC < -40 || tempC > 50) return null;   // fora da validade declarada
  const b = 17.625, c = 243.04;
  const g = Math.log(ur / 100) + (b * tempC) / (c + tempC);
  const td = (c * g) / (b - g);
  return Number.isFinite(td) ? +td.toFixed(2) : null;
}

/**
 * Gradiente térmico entre dois níveis, em °C/km.
 *
 * Positivo = temperatura CAINDO com a altura (o caso normal). Usa a altura
 * geopotencial real, não a altitude tabelada: o enunciado da própria
 * Open-Meteo diz que 1000 hPa fica "entre 60 e 160 metros", o que é uma
 * incerteza de 100 m e destruiria o gradiente da camada mais baixa.
 */
export function gradiente(a, b) {
  if (a?.temperatura == null || b?.temperatura == null) return null;
  if (a?.altura == null || b?.altura == null) return null;
  const dz = (b.altura - a.altura) / 1000;
  if (!Number.isFinite(dz) || Math.abs(dz) < 1e-3) return null;
  return +(-(b.temperatura - a.temperatura) / dz).toFixed(2);
}

/**
 * Classifica a camada pelo gradiente medido.
 *
 * Os limiares são físicos, não estéticos: 9,8 °C/km é o adiabático seco
 * (g/cp), abaixo de ~4 °C/km está próximo do saturado, e gradiente negativo
 * é inversão — ar quente sobre ar frio, que tampa a convecção.
 */
export function camada(g) {
  if (g == null) return null;
  if (g < 0) return "inversão";
  if (g < 1.5) return "isotérmica";
  if (g > 9.8) return "superadiabática";
  if (g > 6.5) return "condicionalmente instável";
  return "estável";
}

export async function buscarSondagem(fetchImpl, { lat, lng, hora = null }) {
  const vars = [];
  for (const n of NIVEIS) for (const c of CAMPOS) vars.push(`${c}_${n}hPa`);

  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: vars.join(","),
    // m/s pedido, não suposto. A sonda já mostrou 58,5 m/s onde havia 58,5 km/h.
    wind_speed_unit: "ms",
    forecast_days: "1",
    timezone: "UTC",
  });

  const r = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!r.ok) {
    throw Object.assign(
      new Error(`níveis de pressão indisponíveis (HTTP ${r.status})`),
      { code: "NIVEIS_INDISPONIVEIS", status: 502 }
    );
  }
  const j = await r.json();
  const h = j?.hourly;
  if (!h?.time?.length) {
    throw Object.assign(
      new Error(`a Open-Meteo não retornou níveis de pressão para ${lat}, ${lng}`),
      { code: "SEM_NIVEIS", status: 502 }
    );
  }

  // Qual instante. Pedido explícito, senão o mais próximo de agora — e o
  // instante escolhido volta na resposta, porque "a sondagem" sem hora é meia
  // informação.
  const alvo = hora ? Date.parse(hora) : Date.now();
  let idx = 0, melhor = Infinity;
  h.time.forEach((t, i) => {
    const d = Math.abs(Date.parse(`${t}Z`) - alvo);
    if (d < melhor) { melhor = d; idx = i; }
  });

  const perfil = NIVEIS.map((n) => {
    const g = (c) => {
      const v = h[`${c}_${n}hPa`]?.[idx];
      return v == null || !Number.isFinite(v) ? null : v;
    };
    const t = g("temperature");
    const ur = g("relative_humidity");
    return {
      pressao: n,
      altura: g("geopotential_height"),      // m acima do nível do mar, medido
      temperatura: t,
      umidade: ur,
      orvalho: orvalho(t, ur),               // DERIVADO
      ventoVel: g("wind_speed"),
      ventoDir: g("wind_direction"),
    };
  });

  // Um perfil onde tudo é nulo não é um perfil. Melhor dizer que não há do que
  // desenhar um eixo vazio com aparência de instrumento.
  const comDado = perfil.filter((p) => p.temperatura != null).length;
  if (comDado === 0) {
    throw Object.assign(
      new Error(`nenhum nível de pressão tem temperatura em ${lat}, ${lng}`),
      { code: "PERFIL_VAZIO", status: 502 }
    );
  }

  // Camadas entre níveis consecutivos que TÊM dado — pular os ausentes em vez
  // de interpolar por cima deles.
  const validos = perfil.filter((p) => p.temperatura != null && p.altura != null);
  const camadas = [];
  for (let i = 0; i < validos.length - 1; i++) {
    const g = gradiente(validos[i], validos[i + 1]);
    camadas.push({
      de: validos[i].pressao, ate: validos[i + 1].pressao,
      gradiente: g, classe: camada(g),
    });
  }

  return {
    lat, lng,
    instante: `${h.time[idx]}Z`,
    niveis: NIVEIS,
    perfil,
    camadas,
    ausentes: perfil.length - comDado,
    derivados: {
      orvalho: "Magnus-Tetens, coeficientes de Alduchov & Eskridge (1996); "
             + "erro ≤ 0,05 °C entre −40 e +50 °C sobre água líquida",
      gradiente: "diferença de temperatura sobre diferença de altura geopotencial medida",
    },
    fonte: "Open-Meteo · GFS, níveis de pressão",
    nota: comDado < perfil.length
      ? `${perfil.length - comDado} de ${perfil.length} níveis sem temperatura: ficam vazios, não são interpolados.`
      : "Todos os níveis com dado. Nada foi interpolado.",
    obtidoEm: new Date().toISOString(),
  };
}
