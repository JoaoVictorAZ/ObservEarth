// tools/checar-entrega.mjs
// -----------------------------------------------------------------------------
// ESTÁ PRONTO PARA SUBMETER?
// -----------------------------------------------------------------------------
//   npm run checar-entrega
//
// Três perguntas, e a terceira é a que não dá para desfazer:
//
//   1. O documento avaliado está completo?
//   2. As peças que a rubrica procura existem?
//   3. Alguma coisa que NÃO pode virar pública está a caminho de virar?
//
// A terceira primeiro, sempre. Um `.env` num repositório público está
// comprometido no instante em que sobe — e apagar o commit depois não resolve,
// porque o histórico fica e os robôs varrem o GitHub em minutos. A única
// resposta é a chave ser rotacionada. Por isso este script recusa antes.
// -----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const cam = (...p) => join(RAIZ, ...p);
const le = (p) => { try { return readFileSync(cam(p), "utf8"); } catch { return null; } };

const problemas = [];
const avisos = [];
let n = 0;

const ok = (txt, extra = "") => { n++; console.log(`  ok   ${txt}${extra ? "  " + extra : ""}`); };
const mal = (txt, conserto) => { console.log(`  X    ${txt}`); problemas.push(conserto ?? txt); };
const talvez = (txt, nota) => { console.log(`  --   ${txt}`); avisos.push(nota ?? txt); };

/** `git` em modo leitura. Devolve null se o git não responder. */
function git(...args) {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args],
                        { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

// ---------------------------------------------------------------------------
console.log("\n1. SEGREDOS E DADO BRUTO — o que não pode virar público\n");

const rastreados = git("ls-files");
/** O que o git de fato leva. `null` quando o git não respondeu. */
let lista = null;
if (rastreados === null) {
  talvez("git não respondeu — não consigo conferir o que está rastreado",
         "rode `git status` à mão antes de publicar");
} else {
  lista = rastreados.split("\n").filter(Boolean);

  // O `.env` tem as suas chaves. É o item mais caro desta lista.
  const segredos = lista.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".example"));
  if (segredos.length) {
    mal(`.env RASTREADO PELO GIT: ${segredos.join(", ")}`,
        `URGENTE: \`git rm --cached ${segredos[0]}\` e ROTACIONE as chaves —\n` +
        "        se já houve push, considere-as comprometidas.");
  } else {
    ok(".env não está rastreado");
  }

  const brutos = lista.filter((f) => f.startsWith("data/bronze/") || /\.zip$/i.test(f));
  if (brutos.length) {
    mal(`${brutos.length} arquivo(s) de dado bruto rastreado(s) — ex.: ${brutos[0]}`,
        "`git rm -r --cached data/bronze` — o repositório entrega o código que baixa, não o dado");
  } else {
    ok("nenhum dado bruto rastreado");
  }

  // Um arquivo grande não impede o push, mas o GitHub recusa acima de 100 MB e
  // avisa acima de 50. Melhor saber antes.
  const grandes = lista
    .map((f) => { try { return [f, statSync(cam(f)).size]; } catch { return null; } })
    .filter((x) => x && x[1] > 25 * 1024 * 1024);
  if (grandes.length) {
    talvez(`${grandes.length} arquivo(s) acima de 25 MB rastreado(s)`,
           grandes.map(([f, s]) => `${f} (${(s / 1048576).toFixed(0)} MB)`).join(", "));
  } else {
    ok("nenhum arquivo rastreado acima de 25 MB");
  }

  ok(`${lista.length} arquivos rastreados`);
}

// ---------------------------------------------------------------------------
console.log("\n2. O DOCUMENTO AVALIADO\n");

const mvp = le("docs/MVP.md");
if (!mvp) {
  mal("docs/MVP.md não existe", "é o item avaliado; sem ele não há entrega");
} else {
  const TITULOS = [
    "Contexto de Negócios e Perguntas", "Carga dos Dados",
    "Modelagem e Catálogo de Dados", "Pipeline de Dados",
    "Qualidade de Dados", "Análise de Dados", "Autoavaliação",
  ];
  const faltando = TITULOS.filter(
    (t) => !new RegExp(`^## \\d+\\. ${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(mvp));
  if (faltando.length) {
    mal(`tópicos ausentes: ${faltando.join(" · ")}`,
        "os títulos são exigidos pelo enunciado, com essas palavras exatas");
  } else {
    ok("os sete tópicos estão presentes, como cabeçalhos numerados");
  }

  const pend = (mvp.match(/⟨PENDENTE/g) ?? []).length;
  if (pend > 0) {
    talvez(`${pend} marcador(es) ⟨PENDENTE⟩ no documento`,
           "preencha com o que os notebooks imprimirem — ou deixe marcado, mas saiba que está lá");
  } else {
    ok("nenhum ⟨PENDENTE⟩ restante");
  }

  // Segredo no texto do documento, que é o lugar mais fácil de esquecer.
  const suspeito = /api[_-]?key\s*[=:]\s*["']?[A-Za-z0-9]{16,}|\bBearer\s+[A-Za-z0-9._-]{20,}/i.exec(mvp);
  if (suspeito) mal("possível chave no texto do documento", `remova: ${suspeito[0].slice(0, 24)}…`);
  else ok("nenhuma chave aparente no documento");
}

// ---------------------------------------------------------------------------
console.log("\n3. AS PEÇAS QUE A RUBRICA PROCURA\n");

// ESTE TESTE JÁ CONFERIU A PROPRIEDADE ERRADA, E CUSTOU UMA PUBLICAÇÃO.
//
// A primeira versão perguntava `existsSync(caminho)` — "o arquivo está no
// disco?". Todos estavam, e ele ficou verde. Mas o `.gitignore` ainda tinha
// `*.md`, então `docs/MVP.md`, `docs/ENTREGA.md`, `docs/DATABRICKS.md` e
// `pipeline/contrato/esquema.md` NÃO subiram. O documento avaliado não estava
// no repositório avaliado, e o verificador da entrega disse que estava tudo
// bem.
//
// Quem corrige não abre o seu disco. A pergunta certa é "o git leva isto?" —
// e é por isso que a checagem agora atravessa `git ls-files` em vez do
// sistema de arquivos. `git add` recusa arquivo ignorado EM SILÊNCIO: não há
// erro para ver, só ausência, e ausência não aparece sozinha.
const PECAS = [
  ["pipeline/contrato/esquema.md", "catálogo de dados, legível"],
  ["pipeline/contrato/esquema.json", "catálogo, legível por máquina"],
  ["pipeline/contrato/validar.mjs", "o catálogo é executável"],
  ["pipeline/notebooks/00_bronze.py", "notebook Bronze"],
  ["pipeline/notebooks/01_silver.py", "notebook Silver"],
  ["pipeline/notebooks/02_gold.py", "notebook Gold"],
  ["docs/DATABRICKS.md", "como rodar na nuvem"],
  ["docs/ENTREGA.md", "o que é entregue"],
  ["README.md", "porta de entrada do repositório"],
  ["ATTRIBUTION.md", "procedência e licenças"],
];
const rastreia = (p) => lista === null ? existsSync(cam(p)) : lista.includes(p);
for (const [p, porque] of PECAS) {
  if (rastreia(p)) ok(p, `— ${porque}`);
  else if (existsSync(cam(p))) {
    mal(`${p} existe no disco mas NÃO ESTÁ NO GIT`,
        `${p} — ${porque}. Veja \`git check-ignore -v ${p}\`: quase sempre é` +
        " uma regra do .gitignore engolindo o arquivo.");
  } else {
    mal(`${p} não existe`, `${p} — ${porque}`);
  }
}

// A pasta inteira, não só os arquivos da lista: um `docs/` vazio no GitHub é o
// sintoma mais visível do `*.md` de volta.
if (lista !== null) {
  const docs = lista.filter((f) => f.startsWith("docs/")).length;
  if (docs === 0) mal("nenhum arquivo de docs/ rastreado",
                      "o `.gitignore` está escondendo a pasta da documentação inteira");
  else ok(`${docs} arquivo(s) de docs/ rastreado(s)`);
}

// ---------------------------------------------------------------------------
console.log("\n4. SCREENSHOTS\n");

// A CAIXA DO NOME DA PASTA IMPORTA, E SÓ FORA DO WINDOWS.
//
// No Windows `docs/imagens` e `docs/Imagens` são a mesma pasta; no GitHub e em
// qualquer Linux são duas. Uma imagem citada como `imagens/x.png` e guardada em
// `Imagens/` renderiza na sua máquina e dá 404 na página que o professor abre.
// Por isso a procura é pela pasta REAL, e a citação é conferida contra o nome
// exato dela.
const nomeDir = (existsSync(cam("docs")) ? readdirSync(cam("docs")) : [])
  .find((f) => f.toLowerCase() === "imagens");
const dirImg = nomeDir ? cam("docs", nomeDir) : cam("docs", "imagens");
const imgs = existsSync(dirImg)
  ? readdirSync(dirImg).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)) : [];

// Parêntese no nome do arquivo fecha o link do markdown antes da hora, e a
// imagem simplesmente não aparece — sem aviso de ninguém.
const comParenteses = imgs.filter((f) => /[()]/.test(f));
if (comParenteses.length) {
  mal(`${comParenteses.length} imagem(ns) com parêntese no nome: ${comParenteses.join(", ")}`,
      "renomeie: `(` e `)` quebram a sintaxe `![alt](caminho)` do markdown");
}
if (imgs.length === 0) {
  talvez("docs/imagens/ vazio ou inexistente",
         "a rubrica pede prova do que rodou por interface — Volume, Catalog, notebooks");
} else {
  ok(`${imgs.length} imagem(ns) em docs/${nomeDir ?? "imagens"}/`);
  // As imagens do PRODUTO são citadas no README, as da EXECUÇÃO no MVP.md.
  // Conferir só um dos dois acusaria falsamente metade delas.
  const textos = [mvp ?? "", le("README.md") ?? ""].join("\n");
  const citadas = imgs.filter((f) => textos.includes(f));
  if (citadas.length < imgs.length) {
    talvez(`${imgs.length - citadas.length} imagem(ns) não citada(s) no documento`,
           "imagem que ninguém referencia não é vista por quem corrige: " +
           imgs.filter((f) => !citadas.includes(f)).join(", "));
  } else {
    ok("todas as imagens são citadas no documento");
  }

  // E o CAMINHO citado tem que bater na caixa, não só o nome do arquivo.
  if (nomeDir) {
    const erradas = imgs.filter((f) => {
      const certo = `${nomeDir}/${f}`;
      const re = new RegExp(`\\]\\(\\s*([^)]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "g");
      return [...textos.matchAll(re)].some((m) => !m[1].endsWith(certo));
    });
    if (erradas.length) {
      mal(`${erradas.length} imagem(ns) citada(s) com a caixa errada da pasta`,
          `no GitHub a pasta é '${nomeDir}' e o caminho diferencia maiúscula: ` +
          erradas.join(", "));
    } else {
      ok(`os caminhos citados batem com 'docs/${nomeDir}/'`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log("\n5. O REPOSITÓRIO REMOTO\n");

const remoto = git("remote", "-v");
if (!remoto || !remoto.trim()) {
  talvez("nenhum remoto configurado",
         "crie o repositório PÚBLICO em github.com/new e siga docs/ENTREGA.md §3");
} else {
  const url = remoto.split("\n")[0].split(/\s+/)[1] ?? "?";
  ok("remoto configurado", url);
  console.log("       (abra numa janela anônima depois do push: privado dá 404)");
}

// O LINK DO REPOSITÓRIO ABRE O RAMO PADRÃO, E SÓ ELE.
//
// Trabalhar num ramo separado é bom: isola o que está pela metade. Mas a
// entrega é um LINK, e quem abre `github.com/usuario/repo` cai no ramo padrão
// sem saber que existe outro. Um MVP perfeito num ramo `mvp` que nunca voltou
// para o `main` é, para quem corrige, um MVP que não existe.
//
// Este aviso não diz "volte para o main". Diz: saiba em qual ramo você está,
// e termine com ele sendo o que o link abre.
const ramo = (git("rev-parse", "--abbrev-ref", "HEAD") ?? "").trim();
if (ramo && ramo !== "HEAD") {
  const padrao = (git("symbolic-ref", "--short", "refs/remotes/origin/HEAD") ?? "")
    .trim().replace(/^origin\//, "");
  if (padrao && ramo !== padrao) {
    talvez(`você está no ramo '${ramo}', e o padrão do remoto é '${padrao}'`,
           `o link do repositório abre '${padrao}'. Antes de submeter: faça o merge` +
           ` de '${ramo}' ou troque o ramo padrão em Settings → General → Default branch.`);
  } else {
    ok(`no ramo '${ramo}'`, padrao ? "— é o que o link abre" : "");
  }
  // Ramo local que nunca foi empurrado é trabalho que só existe na sua máquina.
  if (git("rev-parse", "--abbrev-ref", `${ramo}@{upstream}`) === null) {
    talvez(`'${ramo}' não tem correspondente no remoto`,
           `\`git push -u origin ${ramo}\` — sem isso o ramo só existe aqui`);
  }
}

const pendentes = git("status", "--porcelain");
if (pendentes && pendentes.trim()) {
  const q = pendentes.trim().split("\n").length;
  talvez(`${q} arquivo(s) com mudança não commitada`, "faltou `git add -A && git commit`");
} else if (pendentes !== null) {
  ok("nada pendente de commit");
}

// ---------------------------------------------------------------------------
console.log("");
if (problemas.length) {
  console.log(`  ${problemas.length} COISA(S) QUE IMPEDEM A ENTREGA:\n`);
  problemas.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
  console.log("");
}
if (avisos.length) {
  console.log(`  ${avisos.length} pendência(s) que não impedem, mas custam ponto:\n`);
  avisos.forEach((a, i) => console.log(`    ${i + 1}. ${a}`));
  console.log("");
}
if (!problemas.length && !avisos.length) {
  console.log(`  ${n} verificações — pronto para publicar.\n`);
  console.log("  git add -A && git commit -m \"Patch MVP\" && git push\n");
}
process.exit(problemas.length ? 1 : 0);
