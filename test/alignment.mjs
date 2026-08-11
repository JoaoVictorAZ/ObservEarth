// test/alignment.mjs
// -----------------------------------------------------------------------------
// TESTE DE ALINHAMENTO — rode com `npm test`.
//
// Existe porque o desalinhamento de textura é o erro mais caro deste projeto:
// não quebra nada, não gera exceção, e passa despercebido até alguém olhar o
// globo e notar que a Amazônia está no Atlântico Norte.
//
// Percorre a cadeia inteira, latitude e longitude até o pixel:
//     lat/lng  ->  XYZ (fórmula do three-globe)  ->  UV (fórmula do shader)
// e compara com a posição esperada numa imagem equiretangular padrão.
//
// Cobre os dois erros que já aconteceram de verdade:
//   1. longitude com atan2(z, -x), que gira o mundo 90 graus para leste
//   2. textura com flipY, que espelha a latitude e troca os hemisférios
// -----------------------------------------------------------------------------

const R = 100;
const EPS = 1e-6;

/** conversão do three-globe: phi = 90 - lat, theta = 90 - lng */
function polar2Cartesian(lat, lng) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return {
    x: R * Math.sin(phi) * Math.cos(theta),
    y: R * Math.cos(phi),
    z: R * Math.sin(phi) * Math.sin(theta),
  };
}

/** o que o fragment shader faz em src/globe.ts */
function shaderUV(p, { flipY = false, wrongLng = false } = {}) {
  const n = Math.hypot(p.x, p.y, p.z);
  const lat = Math.asin(p.y / n);
  const lng = wrongLng
    ? Math.atan2(p.z / n, -p.x / n)     // o erro antigo
    : Math.atan2(p.x / n, p.z / n);     // o correto
  const v = 0.5 - lat / Math.PI;
  return { u: lng / (2 * Math.PI) + 0.5, v: flipY ? 1 - v : v };
}

/** pixel numa equiretangular padrão: norte no topo, -180 à esquerda */
function expected(lat, lng) {
  return { u: (lng + 180) / 360, v: (90 - lat) / 180 };
}

const POINTS = [
  ["Polo Norte", 90, 0],
  ["Polo Sul", -90, 0],
  ["Equador / Greenwich", 0, 0],
  ["Rio de Janeiro", -22.9, -43.2],
  ["Tóquio", 35.7, 139.7],
  ["Nairóbi", -1.3, 36.8],
  ["Reiquiavique", 64.1, -21.9],
  ["Antimeridiano", 0, 180],
];

function check(opts = {}) {
  return POINTS.every(([, lat, lng]) => {
    const got = shaderUV(polar2Cartesian(lat, lng), opts);
    const exp = expected(lat, lng);
    const du = Math.min(Math.abs(got.u - exp.u), 1 - Math.abs(got.u - exp.u));
    return du < EPS && Math.abs(got.v - exp.v) < EPS;
  });
}

let failures = 0;

console.log("Alinhamento de textura\n");
for (const [name, lat, lng] of POINTS) {
  const got = shaderUV(polar2Cartesian(lat, lng));
  const exp = expected(lat, lng);
  const du = Math.min(Math.abs(got.u - exp.u), 1 - Math.abs(got.u - exp.u));
  const dv = Math.abs(got.v - exp.v);
  const ok = du < EPS && dv < EPS;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FALHA"} ${name.padEnd(22)}` +
    `u=${got.u.toFixed(4)} v=${got.v.toFixed(4)}  esperado u=${exp.u.toFixed(4)} v=${exp.v.toFixed(4)}`
  );
}

// o teste só tem valor se souber acusar os erros reais
console.log("\nDetecção de regressão\n");
const traps = [
  ["latitude espelhada (flipY = true)", { flipY: true }],
  ["longitude girada (atan2(z, -x))", { wrongLng: true }],
];
for (const [name, opts] of traps) {
  const caught = !check(opts);
  if (!caught) failures++;
  console.log(`  ${caught ? "ok   detecta" : "FALHA não detecta"} ${name}`);
}

console.log(
  failures === 0
    ? "\nAlinhamento correto.\n"
    : `\n${failures} verificação(ões) falharam.\n`
);
process.exit(failures === 0 ? 0 : 1);
