// server/windVerify.js
// -----------------------------------------------------------------------------
// Verificação de consistência e alinhamento do campo de vento (GFS vs Sonda).
// -----------------------------------------------------------------------------

/**
 * Amostra a grade em lat/lng com interpolação bilinear.
 *
 * Convenção da grade (a mesma que o shader do globo espera): primeira linha no
 * NORTE, coluna 0 em -180°, longitude dando a volta.
 */
export function sampleField(grid, lat, lng) {
  const { nx, ny, u, v } = grid;
  if (!nx || !ny) return null;

  // normaliza a longitude para [-180, 180)
  let L = ((((lng + 180) % 360) + 360) % 360) - 180;

  const fx = ((L + 180) / 360) * nx;
  const fy = ((90 - lat) / 180) * (ny - 1);

  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;

  const col = (x) => ((x % nx) + nx) % nx;              // envolve
  const row = (y) => (y < 0 ? 0 : y > ny - 1 ? ny - 1 : y);  // trava nos polos
  const at = (arr, x, y) => arr[row(y) * nx + col(x)] ?? 0;

  const bil = (arr) =>
    at(arr, x0, y0) * (1 - tx) * (1 - ty) +
    at(arr, x0 + 1, y0) * tx * (1 - ty) +
    at(arr, x0, y0 + 1) * (1 - tx) * ty +
    at(arr, x0 + 1, y0 + 1) * tx * ty;

  const uu = bil(u), vv = bil(v);
  return { u: uu, v: vv, speed: Math.hypot(uu, vv), direction: dirFromUV(uu, vv) };
}

/**
 * u/v -> direção METEOROLÓGICA (de onde o vento VEM), graus horários do norte.
 *
 * É a convenção da Open-Meteo e das cartas: "vento de 270°" é vento de oeste,
 * soprando PARA leste. A convenção oposta (para onde vai) difere exatamente
 * 180°, e trocá-las é o erro mais comum aqui — produz um mapa que parece
 * perfeito e está de ponta-cabeça.
 */
export function dirFromUV(u, v) {
  if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) return 0;
  return (270 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
}

/** menor diferença angular entre dois rumos, em graus (0..180) */
export function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Interpreta o desacordo. Cada defeito clássico tem assinatura própria.
 */
export function diagnose(pares) {
  const validos = pares.filter((p) => p.field && p.probe?.speed != null);
  if (!validos.length) return { veredito: "sem dados suficientes", n: 0 };

  const dSpeed = validos.map((p) => p.field.speed - p.probe.speed);
  const dDir = validos
    .filter((p) => p.probe.speed > 1.5 && p.field.speed > 1.5)   // rumo é ruído em calmaria
    .map((p) => angleDiff(p.field.direction, p.probe.direction));

  const med = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const mediaDir = med(dDir);
  const viesSpeed = med(dSpeed);
  const rmseSpeed = dSpeed.length
    ? Math.sqrt(dSpeed.reduce((s, x) => s + x * x, 0) / dSpeed.length) : null;

  // fração de pontos com rumo quase oposto: assinatura de sinal invertido
  const opostos = dDir.filter((d) => d > 150).length / (dDir.length || 1);
  const perpendiculares = dDir.filter((d) => d > 60 && d < 120).length / (dDir.length || 1);

  let veredito;
  if (mediaDir == null) veredito = "vento fraco demais para comparar rumo";
  else if (opostos > 0.5) veredito = "SINAL INVERTIDO — rumo oposto na maioria dos pontos";
  else if (perpendiculares > 0.5) veredito = "EIXOS TROCADOS — rumo perpendicular na maioria";
  else if (mediaDir > 60) veredito = "desacordo grande — verificar orientação da grade";
  else if (mediaDir > 35) veredito = "desacordo moderado — normal em vento fraco, suspeito em vento forte";
  else veredito = "concordância dentro do esperado entre modelos distintos";

  return {
    n: validos.length,
    nRumo: dDir.length,
    viesVelocidade: viesSpeed != null ? +viesSpeed.toFixed(2) : null,
    rmseVelocidade: rmseSpeed != null ? +rmseSpeed.toFixed(2) : null,
    erroMedioRumo: mediaDir != null ? +mediaDir.toFixed(1) : null,
    fracaoOposta: +opostos.toFixed(2),
    fracaoPerpendicular: +perpendiculares.toFixed(2),
    veredito,
  };
}

/** pontos de conferência espalhados, cobrindo os dois hemisférios */
export const PONTOS_PADRAO = [
  { nome: "Atlântico Norte", lat: 45, lng: -30 },
  { nome: "Pacífico Norte", lat: 35, lng: -160 },
  { nome: "Amazônia", lat: -3, lng: -60 },
  { nome: "Atlântico Sul", lat: -35, lng: -20 },
  { nome: "Oceano Índico", lat: -20, lng: 75 },
  { nome: "Pacífico Sul", lat: -45, lng: -120 },
  { nome: "Mar do Norte", lat: 56, lng: 3 },
  { nome: "Sul da Austrália", lat: -40, lng: 140 },
  { nome: "Sudeste asiático", lat: 10, lng: 110 },
  { nome: "Costa oeste africana", lat: 5, lng: -10 },
];
