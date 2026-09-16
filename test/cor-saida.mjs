// test/cor-saida.mjs
// -----------------------------------------------------------------------------
// TODO SHADER QUE PRODUZ COR TEM QUE DECLARAR O QUE FAZ NA SAÍDA.
// -----------------------------------------------------------------------------
//   node test/cor-saida.mjs
//
// O projeto converte as paradas das rampas de sRGB para LINEAR antes de mandar
// para a GPU (`sRGBparaLinear`, em src/malha/rampa.ts). Isso está certo:
// iluminação e interpolação só fazem sentido em espaço linear.
//
// A volta é que é fácil de esquecer. O framebuffer é sRGB, e quem converte
// linear→sRGB na saída é o chunk `<colorspace_fragment>`. Materiais embutidos
// do three recebem o chunk automaticamente; **ShaderMaterial não recebe**.
//
// MEDIDO EM 16/09/2026: `src/globo/terra.ts` e `src/globo/atmosfera.ts`
// incluíam o chunk; os quatro shaders de `src/bloco/cena.ts` não. O terreno do
// Recorte 3D saía com o valor linear escrito como se fosse sRGB — verde de
// planície [92,138,84] aparecendo como [27,66,22] — e o bloco inteiro era lido
// como "cinza espinhoso, sem textura".
//
// Ninguém percebe isso olhando um shader isolado: cada um está internamente
// coerente. Só a COMPARAÇÃO entre eles denuncia, e é essa comparação que este
// teste automatiza.
//
// -----------------------------------------------------------------------------
// E A SAÍDA QUE NÃO É COR
// -----------------------------------------------------------------------------
// Nem todo `gl_FragColor` é cor. A simulação de vento escreve POSIÇÃO e
// VELOCIDADE em texturas de float, e converter esses números destruiria o dado
// — é o mesmo motivo pelo qual máscara de dado precisa de `NoColorSpace`.
//
// Por isso o teste não exige o chunk: exige uma DECISÃO. Ou o shader inclui
// `<colorspace_fragment>`, ou declara `// saida: dado` e diz por quê. O que
// não se aceita é o silêncio, porque foi o silêncio que escondeu o defeito.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "src");

let n = 0;
const falhas = [];
const avisos = [];

function arquivos(dir) {
  const saida = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p));
    else if (/\.(ts|tsx)$/.test(f)) saida.push(p);
  }
  return saida;
}

/**
 * Os blocos de shader de um arquivo.
 *
 * O projeto marca todos com `/* glsl *\/` antes do template literal — é o que
 * dá realce de sintaxe no editor, e serve de âncora aqui. Um shader sem a marca
 * também é encontrado, porque a busca real é por `gl_FragColor`.
 */
function blocosDeShader(texto) {
  const blocos = [];
  const re = /`([^`]*gl_FragColor[^`]*)`/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    blocos.push({ corpo: m[1], em: texto.slice(0, m.index).split("\n").length });
  }
  return blocos;
}

/**
 * A CATRACA, E POR QUE ELA EXISTE EM VEZ DE UM CONSERTO GERAL.
 *
 * Achei o defeito em dois lugares e **medi os dois**: `src/bloco/cena.ts` e
 * `src/malha/malha3d.ts`, que pintam a partir de `sRGBparaLinear` e escreviam
 * sem converter de volta. Esses estão corrigidos.
 *
 * Os arquivos abaixo também escrevem `gl_FragColor` sem declarar nada, e eu
 * **não examinei** cada um. Sair incluindo o chunk neles seria mexer na
 * aparência de coisas que hoje parecem certas, no escuro — exatamente o erro
 * que este arquivo existe para combater.
 *
 * Então eles ficam listados: visíveis, com nome, e a lista não pode crescer.
 * Arquivo novo tem que decidir. Isto é dívida declarada, não permissão.
 */
const A_EXAMINAR = new Map([
  ["src/globe.ts", "textura de satélite e rastro de vento; conferir se a saída já está em sRGB"],
  ["src/mapa2d.ts", "seis shaders do mapa plano; mesma conferência do globo"],
  ["src/windGPU.ts", "dois escrevem POSIÇÃO e VELOCIDADE em textura float — esses são dado, não cor"],
]);

for (const caminho of arquivos(SRC)) {
  const texto = readFileSync(caminho, "utf8");
  if (!texto.includes("gl_FragColor")) continue;

  const rel = relative(RAIZ, caminho).replace(/\\/g, "/");
  const isento = A_EXAMINAR.get(rel);

  for (const { corpo, em } of blocosDeShader(texto)) {
    n++;
    const onde = `${rel}:${em}`;

    const converte = corpo.includes("<colorspace_fragment>");
    const declaraDado = /\/\/\s*saida:\s*dado/.test(corpo);

    if (converte && declaraDado) {
      falhas.push(`${onde}: declara 'saida: dado' E inclui o chunk de cor — ` +
                  "escolha um; dado convertido deixa de ser dado");
    } else if (!converte && !declaraDado) {
      if (isento) { avisos.push(`${onde} — ${isento}`); continue; }
      falhas.push(`${onde}: escreve gl_FragColor sem <colorspace_fragment> e ` +
                  "sem declarar '// saida: dado'.\n" +
                  "        Se produz COR, inclua o chunk — ShaderMaterial não o " +
                  "recebe sozinho.\n" +
                  "        Se produz DADO (posição, velocidade, máscara), " +
                  "escreva '// saida: dado' com o motivo.");
    }
  }
}

// A lista não pode ter nome que já não precisa estar nela: dívida quitada tem
// que sair do registro, senão o registro deixa de significar alguma coisa.
for (const [arq] of A_EXAMINAR) {
  if (!avisos.some((a) => a.startsWith(arq + ":"))) {
    falhas.push(`${arq} está em A_EXAMINAR e já não tem shader pendente — ` +
                "remova-o da lista");
  }
}

// A convenção não vale só para o bloco: estes dois são a referência de que ela
// já existia no projeto antes de alguém esquecê-la.
for (const [arq, porque] of [
  ["src/globo/terra.ts", "a esfera do planeta"],
  ["src/globo/atmosfera.ts", "o rim de atmosfera"],
]) {
  n++;
  const t = readFileSync(join(RAIZ, arq), "utf8");
  if (!t.includes("<colorspace_fragment>")) {
    falhas.push(`${arq}: perdeu o <colorspace_fragment> — ${porque} é a ` +
                "referência da convenção; sem ela o teste acima fica sem âncora");
  }
}

// ---------------------------------------------------------------------------
// CRASE DENTRO DE SHADER, QUE JÁ QUEBROU O BUILD DUAS VEZES NUM DIA SÓ.
//
// O hábito de escrever `identificador` em comentário vem do markdown, e dentro
// de um template literal a crase ENCERRA A STRING. O que vem depois passa a ser
// lido como TypeScript, e o erro aparece dezenas de linhas adiante, apontando
// para uma palavra inocente:
//
//     ERROR: Expected ";" but found "fwidth"
//
// Quem lê isso procura um erro de GLSL. Não há erro de GLSL.
//
// A verificação é sintática e grosseira: qualquer crase entre a abertura e o
// fechamento de um bloco de shader é suspeita. `${}` é interpolação legítima e
// não usa crase, então não há falso positivo a tratar.
console.log("");
for (const caminho of arquivos(SRC)) {
  const texto = readFileSync(caminho, "utf8");
  const rel = relative(RAIZ, caminho).replace(/\\/g, "/");
  // Os blocos marcados com /* glsl */ são os shaders do projeto.
  const re = /\/\* glsl \*\/\s*`([\s\S]*?)`;/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    n++;
    const linha = texto.slice(0, m.index).split("\n").length;
    const dentro = m[1].indexOf("`");
    if (dentro >= 0) {
      // A LINHA EXATA, e não a do começo do bloco.
      //
      // A primeira versão apontava para a abertura do shader, o que reproduzia
      // em menor escala o problema que este teste existe para resolver: uma
      // mensagem que manda a pessoa procurar no lugar errado. Um verificador
      // que aponta mal é pior que nenhum, porque tem autoridade.
      const exata = linha + m[1].slice(0, dentro).split("\n").length - 1;
      const trecho = m[1].split("\n")[m[1].slice(0, dentro).split("\n").length - 1].trim();
      falhas.push(`${rel}:${exata}: crase dentro do shader —\n` +
                  `          ${trecho.slice(0, 76)}\n` +
                  "        Em comentário GLSL, escreva o identificador sem crase: " +
                  "ela encerra o template literal, e o erro do esbuild aparece " +
                  "dezenas de linhas adiante, apontando para uma palavra inocente.");
    }
  }
}

if (falhas.length) {
  console.log(`\n  ${falhas.length} shader(s) sem decisão declarada:\n`);
  for (const f of falhas) console.log(`    X  ${f}`);
  console.log("");
  process.exit(1);
}
console.log(`  ok  ${n} shaders varridos; nenhum caso novo sem decisão`);
if (avisos.length) {
  console.log(`  --  ${avisos.length} pendente(s) de exame, em A_EXAMINAR:`);
  for (const a of avisos) console.log(`        ${a}`);
}
