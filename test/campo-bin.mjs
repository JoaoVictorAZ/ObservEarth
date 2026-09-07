// test/campo-bin.mjs
// -----------------------------------------------------------------------------
// O CAMPO ESCALAR EM BINÁRIO, IDA E VOLTA.
// -----------------------------------------------------------------------------
// Duas implementações leem este formato: `server/campoBin.js`, que é a de
// referência e existe para o teste, e `src/campoBin.ts`, que é a que roda no
// navegador de verdade. Este arquivo confere que as duas concordam.
//
// Uma delas sozinha não provaria nada: um leitor escrito junto com o escritor
// concorda com ele mesmo por construção, inclusive nos erros. É a mesma razão
// pela qual `test/wind-bin.mjs` existe, e o formato daqui herda dali o
// alinhamento a múltiplo de 4.
//
// O TESTE QUE MAIS PEGA DEFEITO é o do ALINHAMENTO. O tamanho do JSON de
// metadados varia com o nome do provedor, e `new Float32Array(buffer, off)`
// lança RangeError quando `off` não é múltiplo de 4. Sem o preenchimento, a
// decodificação quebraria em ALGUMAS respostas e funcionaria em outras — o
// pior tipo de defeito, porque some quando se vai procurar. Por isso o teste
// varre comprimentos de metadado de 1 a 40 caracteres, um por um.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { empacotarCampo, desempacotarCampo, CABECALHO } from "../server/campoBin.js";
import { lerCampoBinario, ehCampoBinario } from "../src/campoBin.ts";
import { reamostrar } from "../server/campo.js";

let n = 0;
const ok = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

console.log("\ncampo escalar em binário");

/** Buffer do Node → ArrayBuffer isolado, que é o que o navegador recebe. */
const paraArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function campoDeTeste(nx = 7, ny = 5, extra = {}) {
  const nn = nx * ny;
  const t = new Float32Array(nn);
  const r = new Float32Array(nn);
  for (let k = 0; k < nn; k++) { t[k] = -40 + k * 0.5; r[k] = (k * 7) % 101; }
  return { nx, ny, planos: { temp2m: t, rh2m: r }, unidade: "°C", ...extra };
}

ok("ida e volta preserva valores, ordem dos planos e metadados", () => {
  const c = campoDeTeste(7, 5, { dataset: "NOAA GFS 0.25", forecastHour: 12 });
  const buf = empacotarCampo(c);

  for (const [quem, lido] of [
    ["servidor", desempacotarCampo(buf)],
    ["navegador", lerCampoBinario(paraArrayBuffer(buf))],
  ]) {
    assert.equal(lido.nx, 7, `${quem}: nx`);
    assert.equal(lido.ny, 5, `${quem}: ny`);
    assert.equal(lido.dataset, "NOAA GFS 0.25", `${quem}: procedência`);
    assert.equal(lido.forecastHour, 12, `${quem}: hora`);
    assert.equal(lido.unidade, "°C", `${quem}: unidade`);
    assert.deepEqual(Object.keys(lido.planos), ["temp2m", "rh2m"], `${quem}: ordem dos planos`);
    for (const nome of ["temp2m", "rh2m"]) {
      assert.deepEqual(
        Array.from(lido.planos[nome]), Array.from(c.planos[nome]), `${quem}: plano ${nome}`,
      );
    }
  }
});

ok("A ORDEM DOS PLANOS é parte do formato, não um detalhe", () => {
  // Os bytes não carregam nome nenhum: quem diz qual bloco é qual variável é a
  // lista `planos` do metadado. Trocar a ordem na escrita sem trocar na
  // leitura devolveria umidade rotulada como temperatura, com valores
  // perfeitamente plausíveis e completamente errados.
  const a = new Float32Array([1, 2, 3, 4]);
  const b = new Float32Array([90, 91, 92, 93]);
  const buf = empacotarCampo({ nx: 2, ny: 2, planos: { primeiro: a, segundo: b } });
  const lido = lerCampoBinario(paraArrayBuffer(buf));
  assert.deepEqual(Array.from(lido.planos.primeiro), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(lido.planos.segundo), [90, 91, 92, 93]);
});

ok("a máscara de ausência sobrevive — zero e 'não medido' continuam distintos", () => {
  const c = campoDeTeste(4, 3);
  c.planos.temp2m[5] = 0;                    // zero LEGÍTIMO
  c.valido = new Uint8Array(12).fill(1);
  c.valido[6] = 0;                           // ausência, cujo valor não importa
  const lido = lerCampoBinario(paraArrayBuffer(empacotarCampo(c)));
  assert.equal(lido.valido[5], 1, "o zero medido virou ausência");
  assert.equal(lido.valido[6], 0, "a ausência virou medida");
  assert.equal(lido.planos.temp2m[5], 0, "o zero legítimo se perdeu");
});

ok("sem máscara declarada, o leitor não inventa uma", () => {
  const lido = lerCampoBinario(paraArrayBuffer(empacotarCampo(campoDeTeste())));
  assert.equal(lido.valido, undefined);
});

ok("o alinhamento aguenta metadado de QUALQUER comprimento", () => {
  // É aqui que mora o defeito intermitente. Um nome de provedor com um
  // caractere a mais desloca o início dos planos, e sem o preenchimento até
  // múltiplo de 4 o Float32Array recusa o deslocamento.
  for (let len = 1; len <= 40; len++) {
    const c = campoDeTeste(3, 3, { dataset: "x".repeat(len) });
    const buf = empacotarCampo(c);
    const metaLen = buf.readUInt16LE(6);
    assert.equal(metaLen % 4, 0, `metadado de ${len} não ficou alinhado: ${metaLen}`);
    assert.equal((CABECALHO + metaLen) % 4, 0, `deslocamento desalinhado em ${len}`);

    const lido = lerCampoBinario(paraArrayBuffer(buf));
    assert.equal(lido.dataset, "x".repeat(len), `metadado de ${len} corrompido`);
    assert.deepEqual(
      Array.from(lido.planos.temp2m), Array.from(c.planos.temp2m),
      `valores corrompidos com metadado de ${len}`,
    );
  }
});

ok("o tamanho fecha na conta: cabeçalho + metadado + k planos + máscara", () => {
  const nx = 6, ny = 4, nn = nx * ny;
  const c = campoDeTeste(nx, ny);
  c.valido = new Uint8Array(nn).fill(1);
  const buf = empacotarCampo(c);
  const metaLen = buf.readUInt16LE(6);
  assert.equal(buf.length, CABECALHO + metaLen + 2 * nn * 4 + nn);
});

console.log("\nrecusas");

ok("assinatura errada é recusada em vez de decodificada como lixo", () => {
  const lixo = Buffer.alloc(200);
  lixo.write("JSON", 0);
  assert.equal(ehCampoBinario(paraArrayBuffer(lixo)), false, "reconheceu lixo como campo");
  assert.throws(() => lerCampoBinario(paraArrayBuffer(lixo)), /assinatura/);
  assert.throws(() => desempacotarCampo(lixo), /assinatura/);
});

ok("buffer truncado dá erro que DIZ quanto faltou", () => {
  const buf = empacotarCampo(campoDeTeste(10, 10));
  const cortado = Buffer.from(buf.subarray(0, buf.length - 100));
  assert.throws(
    () => lerCampoBinario(paraArrayBuffer(cortado)),
    /truncado: \d+ bytes, esperados \d+/,
  );
});

ok("versão futura é recusada com o número na mensagem", () => {
  const buf = empacotarCampo(campoDeTeste());
  buf.writeUInt16LE(99, 4);
  assert.throws(() => lerCampoBinario(paraArrayBuffer(buf)), /versão 99/);
  assert.throws(() => desempacotarCampo(buf), /versão 99/);
});

ok("plano que não cobre a grade inteira é recusado na ESCRITA", () => {
  // Melhor falhar ao empacotar do que servir um buffer curto que só vai
  // estourar no navegador de outra pessoa.
  assert.throws(
    () => empacotarCampo({ nx: 10, ny: 10, planos: { t: new Float32Array(50) } }),
    /não cobre 100 pontos/,
  );
  assert.throws(() => empacotarCampo({ nx: 4, ny: 4, planos: {} }), /sem nenhum plano/);
  assert.throws(
    () => empacotarCampo({ nx: 0, ny: 4, planos: { t: [] } }), /grade inválida/,
  );
});

ok("um campo pequeno demais para ter cabeçalho não é confundido com campo", () => {
  const curto = Buffer.alloc(8);
  assert.equal(ehCampoBinario(paraArrayBuffer(curto)), false);
  assert.throws(() => lerCampoBinario(paraArrayBuffer(curto)), /truncad/);
});

console.log("\ncusto");

ok("o binário é bem menor que o JSON equivalente, e a leitura é sem cópia", () => {
  const nx = 360, ny = 181, nn = nx * ny;
  const t = new Float32Array(nn);
  for (let k = 0; k < nn; k++) t[k] = -7.234375 + (k % 97) * 0.015625;
  const buf = empacotarCampo({ nx, ny, planos: { temp2m: t } });
  const json = Buffer.byteLength(JSON.stringify({ nx, ny, temp2m: Array.from(t) }), "utf8");

  assert.ok(buf.length < json / 2, `binário ${buf.length} contra JSON ${json}`);

  // SEM CÓPIA: o Float32Array devolvido aponta para dentro do próprio buffer
  // recebido. Escrever nele muda o buffer — é essa identidade que faz a
  // leitura custar ~0 ms em vez dos ~250 ms de um JSON.parse de um milhão de
  // números. Se um dia alguém trocar por `slice()`, este teste avisa.
  const ab = paraArrayBuffer(buf);
  const lido = lerCampoBinario(ab);
  assert.equal(lido.planos.temp2m.buffer, ab, "a leitura copiou em vez de apontar");
});

console.log("\nreamostragem");

ok("reduzir a grade NÃO desloca o campo em latitude nem em longitude", () => {
  // O defeito que este teste existe para pegar: somar os p×p pontos que
  // "pertencem" ao bloco desloca o resultado meio passo, porque numa grade
  // registrada em ponto o centro de massa de p pontos consecutivos não é o
  // primeiro deles. A 0,25° isso são 14 km — pouco para o olho e o bastante
  // para um centro de baixa pressão mudar de lugar.
  //
  // Um campo LINEAR revela o deslocamento na hora: a média de uma janela
  // simétrica sobre uma rampa é o valor do ponto central, exatamente.
  const ni = 360, nj = 181;
  const v = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) v[j * ni + i] = j;   // rampa em latitude

  const r = reamostrar(v, ni, nj, 4);
  assert.equal(r.ni, 90, "colunas");
  assert.equal(r.nj, 46, "linhas: (181−1)/4 + 1");

  // Longe dos polos, onde a janela não trava, a rampa é reproduzida exata.
  for (const j of [10, 22, 35]) {
    assert.ok(Math.abs(r.values[j * r.ni + 20] - j * 4) < 1e-4,
      `linha ${j}: ${r.values[j * r.ni + 20]} em vez de ${j * 4}`);
  }
});

ok("a linha do polo continua sendo o polo depois de reduzir", () => {
  // Se a linha 0 da grade reduzida não for +90°, todo o resto sai torto — e
  // sai torto de um jeito que só aparece como um mapa levemente deslocado.
  const ni = 72, nj = 37;
  const v = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) v[j * ni + i] = 90 - j * 5;
  const r = reamostrar(v, ni, nj, 3);
  assert.equal(r.nj, 13, "linhas");
  // A janela trava no polo, então a média das 2 linhas de dentro dá 87,5.
  assert.ok(r.values[0] > 85, `topo virou ${r.values[0]}, longe do polo`);
  assert.ok(r.values[(r.nj - 1) * r.ni] < -85, `fundo virou ${r.values[(r.nj - 1) * r.ni]}`);
});

ok("a longitude ENROLA na reamostragem, sem costura no antimeridiano", () => {
  const ni = 360, nj = 5;
  const v = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) v[j * ni + i] = Math.cos((i * 2 * Math.PI) / ni);
  }
  const r = reamostrar(v, ni, nj, 4);
  // A coluna 0 é −180°, cujo cosseno de fase vale 1 no nosso gerador. Sem
  // enrolar, a janela dela perderia metade dos pontos e o valor cairia.
  const c0 = r.values[0];
  const c1 = r.values[1];
  assert.ok(c0 > c1, `a coluna 0 devia ser o pico: ${c0} vs ${c1}`);
  assert.ok(Math.abs(c0 - 1) < 0.01, `coluna 0 = ${c0}, devia ser ~1`);
});

ok("NaN não contamina o bloco inteiro", () => {
  const ni = 40, nj = 21;
  const v = new Float32Array(ni * nj).fill(10);
  v[10 * ni + 10] = NaN;
  const r = reamostrar(v, ni, nj, 2);
  for (let k = 0; k < r.ni * r.nj; k++) {
    assert.ok(Number.isFinite(r.values[k]), `NaN vazou para a célula ${k}`);
    assert.ok(Math.abs(r.values[k] - 10) < 1e-5, "o valor mudou por causa do buraco");
  }
});

ok("passo 1 devolve o MESMO vetor, sem cópia nem custo", () => {
  const v = new Float32Array(12).fill(3);
  const r = reamostrar(v, 4, 3, 1);
  assert.equal(r.values, v, "passo 1 copiou à toa");
});

console.log(`\n  ${n} verificações do campo binário\n`);
