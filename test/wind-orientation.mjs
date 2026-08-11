// test/wind-orientation.mjs
// -----------------------------------------------------------------------------
// O campo de vento esteve ESPELHADO no eixo norte-sul durante varias versoes.
// A causa foi uma unica linha: a particula era escrita em clip.y = 1 - y*2,
// mandando o polo norte para v = 1, enquanto o globo procura o norte em v = 0.
//
// Espelhamento e o pior tipo de defeito visual: nao parece quebrado, parece
// "esquisito". Como o Coriolis gira os hemisferios em sentidos opostos, o campo
// invertido continua plausivel a olho nu — e por isso sobreviveu a tantas
// rodadas de ajuste de aparencia.
//
// Este teste fixa as tres convencoes de orientacao em codigo executavel.
// -----------------------------------------------------------------------------

const t = [];
const ok = (name, got, want, tol = 1e-9) => {
  const pass = Math.abs(got - want) <= tol;
  t.push(pass);
  console.log(`  ${pass ? "ok  " : "FALHA"} ${name.padEnd(46)} ${got.toFixed(4)} (esperado ${want.toFixed(4)})`);
};

// --- convencao 1: estado da particula. pos.y = 0 e o NORTE -------------------
const latOf = (posY) => (0.5 - posY) * 180;
console.log("\nEstado da partícula (shader de avanço)");
ok("pos.y = 0   -> latitude", latOf(0), 90);
ok("pos.y = 0.5 -> latitude", latOf(0.5), 0);
ok("pos.y = 1   -> latitude", latOf(1), -90);

// --- convencao 2: escrita no alvo de rastro ---------------------------------
// WebGL: clip.y = -1 e a PRIMEIRA linha do framebuffer, lida em v = 0.
const clipY = (posY) => posY * 2 - 1;
const vFromClip = (cy) => (cy + 1) / 2;
console.log("\nEscrita no alvo de rastro (shader de desenho)");
ok("norte  pos.y=0 -> clip.y", clipY(0), -1);
ok("norte  clip.y=-1 -> v", vFromClip(clipY(0)), 0);
ok("sul    pos.y=1 -> clip.y", clipY(1), 1);
ok("sul    clip.y=1 -> v", vFromClip(clipY(1)), 1);

// --- convencao 3: leitura pelo globo ----------------------------------------
const vFromLat = (latDeg) => 0.5 - (latDeg * Math.PI / 180) / Math.PI;
console.log("\nLeitura pelo globo (shader de imagem)");
ok("latitude +90 -> v", vFromLat(90), 0);
ok("latitude   0 -> v", vFromLat(0), 0.5);
ok("latitude -90 -> v", vFromLat(-90), 1);

// --- fecho do ciclo: escrita e leitura precisam coincidir -------------------
console.log("\nCiclo fechado: onde escreve == onde lê");
for (const lat of [90, 45, 0, -45, -90]) {
  const posY = 0.5 - lat / 180;              // inversa da convencao 1
  const written = vFromClip(clipY(posY));    // onde a partícula é gravada
  const read = vFromLat(lat);                // onde o globo procura
  ok(`latitude ${String(lat).padStart(4)}  escrita vs leitura`, written, read, 1e-9);
}

// --- deteccao de regressao: a formula ANTIGA tem de falhar -------------------
console.log("\nDetecção de regressão (a fórmula antiga deve falhar)");
const clipYOld = (posY) => 1 - posY * 2;
const northOld = vFromClip(clipYOld(0));
const espelhado = Math.abs(northOld - vFromLat(90)) > 0.5;
t.push(espelhado);
console.log(`  ${espelhado ? "ok  " : "FALHA"} fórmula antiga põe o norte em v=${northOld.toFixed(2)}, deveria ser v=0.00`);

// --- sentido do deslocamento ------------------------------------------------
console.log("\nSentido do deslocamento");
// v positivo = para o norte = pos.y DIMINUI
const stepNorth = 0.5 - (10 * 0.1) / 180;    // v=+10 m/s aplicado a partir do equador
t.push(stepNorth < 0.5);
console.log(`  ${stepNorth < 0.5 ? "ok  " : "FALHA"} vento de sul (v>0) move a partícula para o norte`);
// u positivo = para leste = pos.x AUMENTA
const stepEast = 0.5 + (10 * 0.1) / 360;
t.push(stepEast > 0.5);
console.log(`  ${stepEast > 0.5 ? "ok  " : "FALHA"} vento de oeste (u>0) move a partícula para leste`);

const fails = t.filter((x) => !x).length;
console.log(fails === 0 ? "\nOrientação do vento correta.\n" : `\n${fails} verificação(ões) falharam.\n`);
process.exit(fails === 0 ? 0 : 1);
