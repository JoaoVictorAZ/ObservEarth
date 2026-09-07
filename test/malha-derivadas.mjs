// test/malha-derivadas.mjs
// -----------------------------------------------------------------------------
// CÁLCULO NA ESFERA, CONFERIDO CONTRA SOLUÇÃO ANALÍTICA.
// -----------------------------------------------------------------------------
// Não há aqui nenhum número que eu tenha produzido rodando o próprio código.
// Todo valor esperado sai de uma identidade que vale independentemente desta
// implementação — e é isso que faz o teste ter poder de recusa.
//
// A IDENTIDADE PRINCIPAL é a dos harmônicos esféricos. Eles são as
// autofunções do operador de Laplace–Beltrami na esfera:
//
//     Δ Yₗᵐ = − l(l+1)/R² · Yₗᵐ
//
// Isso é forte de um jeito raro num teste numérico: o laplaciano de Y₁⁰ tem
// que ser MENOS DUAS VEZES o próprio Y₁⁰ dividido por R², em toda célula da
// grade, com a constante saindo certa até a terceira casa. Um sinal trocado,
// um R esquecido, um fator cos φ no lugar errado — nada disso sobrevive a uma
// autofunção, porque o erro não some na média: ele muda o autovalor.
//
// O TERMO DE tan φ tem teste próprio, e é o mais importante deles. Ele é a
// diferença entre Laplace–Beltrami e "somar as duas segundas derivadas", e é
// o erro mais comum em código de grade. Ele não desaparece com refinamento:
// é modelo errado, não discretização grossa. Por isso o teste compara as duas
// contas em latitude alta, onde a diferença é grande, e exige que a nossa
// acerte e a ingênua erre.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { latDaLinha, lngDaColuna, RAIO_TERRA } from "../src/malha/campo.ts";
import {
  gradienteEm, hessianaEm, laplacianoEm, campoGradiente, campoLaplaciano, COS_MIN,
} from "../src/malha/derivadas.ts";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };
const rad = Math.PI / 180;

const relPerto = (a, b, tolRel, msg) => {
  const escala = Math.max(Math.abs(b), 1e-300);
  const err = Math.abs(a - b) / escala;
  assert.ok(err <= tolRel, `${msg ?? ""}: ${a} vs ${b} — erro relativo ${err.toExponential(2)}`);
};

function campoDe(nx, ny, f, unidade = "u") {
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = f(latDaLinha(j, ny) * rad, lngDaColuna(i, nx) * rad);
  }
  return { nx, ny, valores: v, unidade, titulo: "teste" };
}

/** o mesmo campo em float64, para o teste não medir o erro do float32 */
function campo64(nx, ny, f, unidade = "u") {
  const c = campoDe(nx, ny, f, unidade);
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = f(latDaLinha(j, ny) * rad, lngDaColuna(i, nx) * rad);
  }
  return { ...c, valores: v };
}

console.log("\ngradiente na esfera");

const NX = 720, NY = 361;   // 0,5° — fino o bastante para O(h²) fechar em 1e-4

ok("o gradiente de f = φ aponta ao norte e vale 1/R", () => {
  // ∂φ/∂y = 1/R por construção da base local. É o teste da UNIDADE: se o
  // código dividisse pelo passo angular em vez do comprimento físico, sairia
  // 1 em vez de 1,57e−7.
  const c = campo64(NX, NY, (phi) => phi);
  for (const lat of [-70, -30, 0, 25, 60]) {
    const j = Math.round((90 - lat) / (180 / (NY - 1)));
    const g = gradienteEm(c, 100, j);
    relPerto(g.dy, 1 / RAIO_TERRA, 1e-6, `∂/∂y em ${lat}°`);
    assert.ok(Math.abs(g.dx) < 1e-18, `∂/∂x devia ser 0, veio ${g.dx}`);
    relPerto(g.azimute, 0, 1e-9, "azimute devia ser norte");
  }
});

ok("o gradiente de f = λ vale 1/(R cos φ) — e é aí que a esfera aparece", () => {
  // f = λ é a longitude em radianos. Um passo de longitude vale MENOS metro
  // quanto maior a latitude, então a derivada em METRO cresce com 1/cos φ.
  // É o fator que separa "grade regular em grau" de "planeta".
  const c = campo64(NX, NY, (_phi, lam) => lam);
  for (const lat of [0, 30, 60, 75]) {
    const j = Math.round((90 - lat) / (180 / (NY - 1)));
    // longe do salto de −π para π, que é descontinuidade da PARAMETRIZAÇÃO
    const g = gradienteEm(c, NX / 2, j);
    relPerto(g.dx, 1 / (RAIO_TERRA * Math.cos(lat * rad)), 1e-6, `∂/∂x em ${lat}°`);
    relPerto(g.azimute, 90, 1e-6, "azimute devia ser leste");
  }
});

ok("no hemisfério norte, um campo que cresce ao norte tem azimute 0", () => {
  // O SINAL DA LATITUDE. A linha j=0 é +90° e j cresce para o SUL. Trocar a
  // ordem no numerador espelharia o campo: um vale viraria crista.
  const c = campo64(NX, NY, (phi) => Math.sin(phi));
  const j = Math.round((90 - 45) / (180 / (NY - 1)));
  const g = gradienteEm(c, 200, j);
  assert.ok(g.dy > 0, `sen φ cresce ao norte, mas dy = ${g.dy}`);
  relPerto(g.azimute, 0, 1e-6, "azimute");
});

ok("o gradiente devolve null nos polos em vez de um número gigante", () => {
  const c = campo64(NX, NY, (phi, lam) => Math.cos(phi) * Math.cos(lam));
  assert.equal(gradienteEm(c, 10, 0), null, "linha do polo norte");
  assert.equal(gradienteEm(c, 10, NY - 1), null, "linha do polo sul");
  const jLimite = Math.round((90 - 88) / (180 / (NY - 1)));
  assert.equal(gradienteEm(c, 10, jLimite), null, "acima do corte de cos φ");
  // e logo abaixo do corte ele volta a existir
  const jOk = Math.round((90 - 80) / (180 / (NY - 1)));
  assert.ok(gradienteEm(c, 10, jOk) !== null, "80° devia ter gradiente");
});

ok("diferença centrada exige os dois lados: buraco vira null", () => {
  const c = campo64(NX, NY, (phi) => phi);
  c.valido = new Uint8Array(NX * NY).fill(1);
  const j = 100;
  c.valido[j * NX + 51] = 0;
  assert.equal(gradienteEm(c, 50, j), null, "vizinho leste ausente");
  assert.ok(gradienteEm(c, 48, j) !== null, "duas células adiante devia valer");
});

console.log("\nlaplaciano de Laplace–Beltrami");

/**
 * Δ Yₗᵐ = −l(l+1)/R² Yₗᵐ. Testamos três autofunções de graus diferentes:
 * se o código tivesse um fator errado que por acaso acertasse l=1, ele não
 * acertaria l=2 e l=3 com a mesma constante.
 */
const HARMONICOS = [
  { nome: "Y₁⁰ = sen φ", l: 1, f: (phi) => Math.sin(phi) },
  { nome: "Y₁¹ = cos φ cos λ", l: 1, f: (phi, lam) => Math.cos(phi) * Math.cos(lam) },
  { nome: "Y₂⁰ ∝ 3sen²φ − 1", l: 2, f: (phi) => 3 * Math.sin(phi) ** 2 - 1 },
  { nome: "Y₂² ∝ cos²φ cos 2λ", l: 2, f: (phi, lam) => Math.cos(phi) ** 2 * Math.cos(2 * lam) },
  { nome: "Y₃³ ∝ cos³φ cos 3λ", l: 3, f: (phi, lam) => Math.cos(phi) ** 3 * Math.cos(3 * lam) },
];

for (const h of HARMONICOS) {
  ok(`Δ ${h.nome} = −${h.l * (h.l + 1)}/R² · f, em toda a grade`, () => {
    const c = campo64(NX, NY, h.f);
    const autovalor = -(h.l * (h.l + 1)) / (RAIO_TERRA * RAIO_TERRA);
    let pior = 0, contados = 0;
    for (let j = 1; j < NY - 1; j += 7) {
      const lat = latDaLinha(j, NY);
      if (Math.abs(Math.cos(lat * rad)) < COS_MIN + 0.05) continue;
      for (let i = 0; i < NX; i += 11) {
        const lap = laplacianoEm(c, i, j);
        assert.ok(lap != null, `sem laplaciano em (${i},${j})`);
        const esperado = autovalor * c.valores[j * NX + i];
        // Erro ABSOLUTO na escala do autovalor: onde f ≈ 0 o erro relativo
        // não tem sentido, mas o laplaciano também tem que ser ≈ 0 ali.
        const err = Math.abs(lap - esperado) * RAIO_TERRA * RAIO_TERRA;
        pior = Math.max(pior, err);
        contados++;
      }
    }
    assert.ok(contados > 1000, `amostragem rala: ${contados}`);
    // O(h²) com h = 0,5° dá ~1e−4. Uma constante errada daria da ordem de 1.
    assert.ok(pior < 5e-3, `pior erro ${pior.toExponential(2)} em ${contados} pontos`);
  });
}

ok("SEM o termo de tan φ, a conta erra — e erra mais quanto maior a latitude", () => {
  // Este é o teste que justifica o operador. A versão ingênua soma as duas
  // segundas derivadas escalonadas e ignora ∂/∂φ(cos φ ·). O termo que falta é
  // −tan φ ∂f/∂φ / R², que em 60° já vale 1,73 vezes o gradiente meridional.
  const c = campo64(NX, NY, (phi) => Math.sin(phi));
  const autovalor = -2 / (RAIO_TERRA * RAIO_TERRA);
  const R2 = RAIO_TERRA * RAIO_TERRA;
  const dPhi = Math.PI / (NY - 1);

  for (const lat of [30, 60, 75]) {
    const j = Math.round((90 - lat) / (180 / (NY - 1)));
    const i = 200;
    const f = c.valores;
    const k = j * NX + i;

    const nosso = laplacianoEm(c, i, j);
    const d2Phi = (f[k - NX] - 2 * f[k] + f[k + NX]) / (dPhi * dPhi);
    const d2Lam = 0;   // sen φ não depende de λ
    const ingenuo = d2Phi / R2 + d2Lam;

    const esperado = autovalor * f[k];
    const errNosso = Math.abs(nosso - esperado) * R2;
    const errIngenuo = Math.abs(ingenuo - esperado) * R2;

    assert.ok(errNosso < 1e-3, `nosso errou em ${lat}°: ${errNosso}`);
    assert.ok(errIngenuo > 0.5, `a versão ingênua devia errar feio em ${lat}°, errou ${errIngenuo}`);
    assert.ok(errIngenuo > 100 * errNosso, `em ${lat}° a diferença não apareceu`);
  }
});

ok("o sinal do laplaciano: negativo em cima do morro, positivo no fundo do poço", () => {
  // Convenção que a tela vai usar. Um sinal invertido pintaria centro de baixa
  // pressão com a cor de crista — o mesmo tipo de erro que `vorticidade.js`
  // documenta para o sentido de rotação.
  const c = campo64(NX, NY, (phi, lam) => Math.cos(phi) * Math.cos(lam));  // máximo em (0,0)
  const jEq = (NY - 1) / 2;
  const iMax = NX / 2;      // lng = 0
  assert.ok(laplacianoEm(c, iMax, jEq) < 0, "topo devia ter Δ < 0");
  assert.ok(laplacianoEm(c, 0, jEq) > 0, "fundo devia ter Δ > 0");
});

console.log("\nhessiana");

ok("num máximo isotrópico os dois autovalores são iguais e negativos", () => {
  const c = campo64(NX, NY, (phi, lam) => Math.cos(phi) * Math.cos(lam));
  const H = hessianaEm(c, NX / 2, (NY - 1) / 2);
  const esperado = -1 / (RAIO_TERRA * RAIO_TERRA);
  relPerto(H.fxx, esperado, 1e-4, "fxx");
  relPerto(H.fyy, esperado, 1e-4, "fyy");
  assert.ok(Math.abs(H.fxy) < 1e-18, `cruzada devia ser 0, veio ${H.fxy}`);
  assert.ok(H.determinante > 0 && H.traco < 0, "não classificaria como máximo");
  relPerto(Math.abs(H.lambda1 / H.lambda2), 1, 1e-3, "anisotropia de uma cúpula");
});

ok("numa sela o determinante é negativo", () => {
  // f = cos 2λ − cos 2φ tem gradiente nulo em (0°, 0°) e curvaturas de sinais
  // opostos ali: máximo ao longo do paralelo, mínimo ao longo do meridiano.
  // É a assinatura de uma zona de deformação — o colo entre dois sistemas de
  // pressão, que é exatamente onde as frentes se organizam.
  const c = campo64(NX, NY, (phi, lam) => Math.cos(2 * lam) - Math.cos(2 * phi));
  const H = hessianaEm(c, NX / 2, (NY - 1) / 2);
  assert.ok(H.determinante < 0, `det devia ser < 0, veio ${H.determinante}`);
  assert.ok(H.lambda1 * H.lambda2 < 0, "autovalores de mesmo sinal numa sela");
  relPerto(H.fxx, -4 / (RAIO_TERRA * RAIO_TERRA), 1e-4, "curvatura zonal");
  relPerto(H.fyy, +4 / (RAIO_TERRA * RAIO_TERRA), 1e-4, "curvatura meridional");
});

ok("no mínimo de cos²φ cos 2λ os DOIS autovalores são positivos", () => {
  // O caso complementar: uma célula que "parece sela" por estar entre dois
  // máximos e não é. Só a Hessiana separa os dois, e é por isso que a
  // classificação não pode sair da contagem de vizinhos.
  const c = campo64(NX, NY, (phi, lam) => Math.cos(phi) ** 2 * Math.cos(2 * lam));
  const H = hessianaEm(c, (3 * NX) / 4, (NY - 1) / 2);   // λ = 90°, equador
  const R2 = RAIO_TERRA * RAIO_TERRA;
  relPerto(H.fxx, 4 / R2, 1e-4, "curvatura zonal");
  relPerto(H.fyy, 2 / R2, 1e-4, "curvatura meridional");
  assert.ok(H.determinante > 0 && H.traco > 0, "devia classificar como mínimo");
});

ok("uma crista tem anisotropia alta e eixo orientado", () => {
  // Alongada em longitude: curva depressa em φ e devagar em λ.
  const c = campo64(NX, NY, (phi, lam) => Math.exp(-((phi / 0.05) ** 2)) * (1 + 0.02 * Math.cos(lam)));
  const H = hessianaEm(c, NX / 2, (NY - 1) / 2);
  const aniso = Math.abs(H.lambda1 / H.lambda2);
  assert.ok(aniso > 20, `crista devia ser muito anisotrópica, veio ${aniso}`);
});

console.log("\ncampos derivados inteiros");

ok("|∇| marca ausente onde não dá para calcular, e não zero", () => {
  const c = campoDe(180, 91, (phi) => Math.sin(phi));
  const g = campoGradiente(c);
  assert.equal(g.unidade, "u/m");
  assert.equal(g.valido[0], 0, "linha do polo devia ser ausente");
  const jMeio = 45;
  assert.equal(g.valido[jMeio * 180 + 10], 1, "meio da grade devia valer");
  // A distinção que importa: ausente é 0 na MÁSCARA, não 0 no valor.
  assert.ok(g.valores[jMeio * 180 + 10] > 0, "gradiente de sen φ não é zero em 0°… ");
});

ok("∇² como campo inteiro concorda com o ponto a ponto", () => {
  const c = campo64(360, 181, (phi, lam) => Math.cos(phi) * Math.cos(lam));
  const L = campoLaplaciano(c);
  assert.equal(L.unidade, "u/m²");
  for (const [i, j] of [[100, 40], [200, 90], [359, 120]]) {
    const pt = laplacianoEm(c, i, j);
    // O campo inteiro guarda em float32; a comparação aceita essa precisão.
    relPerto(L.valores[j * 360 + i], pt, 1e-5, `(${i},${j})`);
  }
});

console.log(`\n  ${n} verificações do cálculo na esfera\n`);
