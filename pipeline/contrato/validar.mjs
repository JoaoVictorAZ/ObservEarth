// pipeline/contrato/validar.mjs
// -----------------------------------------------------------------------------
// O VALIDADOR DO CONTRATO
// -----------------------------------------------------------------------------
// Puro: recebe linhas e devolve problemas. Sem rede, sem disco, sem Spark — para
// poder rodar dentro de `npm test` e para o notebook poder chamar a MESMA regra
// via export JSON antes de gravar o Parquet.
//
// POR QUE ISTO EXISTE, E NÃO É BUROCRACIA
//
// O pipeline e o app são dois subsistemas que trocam arquivos. Sem um contrato
// executável, a discordância entre eles é SILENCIOSA: o Parquet sai com
// `temp_max`, o app espera `temperature_2m_max`, e a tela mostra um campo vazio
// que parece "não tem dado para este ponto". Ninguém investiga um vazio.
//
// A regra mais importante é a de ausência. Um `-9999` do INMET que escape para
// a camada Gold entra na média e no percentil sem levantar erro nenhum e
// desloca a distribuição inteira — a normal de 30 anos fica errada, e o app
// desenha essa normal com toda a confiança do mundo.
// -----------------------------------------------------------------------------

/** @typedef {{ tabela: string, linha: number, campo: string|null, erro: string }} Problema */

const SENTINELAS = new Set([-9999, -999, -99.9, -327.68]);

const ehData = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ehInstante = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v);

/** O valor bate com o tipo declarado? `null` é sempre aceito aqui; a obrigatoriedade é outra checagem. */
function tipoBate(tipo, v) {
  switch (tipo) {
    case "string": return typeof v === "string";
    case "double": return typeof v === "number" && Number.isFinite(v);
    case "int": return typeof v === "number" && Number.isInteger(v);
    case "bool": return typeof v === "boolean";
    case "date": return ehData(v);
    case "timestamp": return ehInstante(v);
    default: return false;
  }
}

/**
 * Valida uma coleção de linhas contra uma tabela do contrato.
 *
 * @param {object} contrato  o esquema.json já lido
 * @param {string} tabela    nome da tabela no contrato
 * @param {object[]} linhas
 * @returns {Problema[]}
 */
export function validar(contrato, tabela, linhas) {
  /** @type {Problema[]} */
  const problemas = [];
  const t = contrato.tabelas?.[tabela];
  if (!t) return [{ tabela, linha: -1, campo: null, erro: `tabela "${tabela}" não existe no contrato` }];

  const campos = t.campos;
  const nomes = new Set(Object.keys(campos));
  const proibidos = new Set(contrato.ausencia?.proibidos ?? []);
  const vistos = new Set();

  linhas.forEach((L, i) => {
    const p = (campo, erro) => problemas.push({ tabela, linha: i, campo, erro });

    // ---- campo a mais: quase sempre é nome errado, não campo novo ----------
    // `temp_max` no lugar de `temperature_2m_max` aparece exatamente assim: um
    // campo desconhecido presente e um campo conhecido ausente.
    for (const k of Object.keys(L)) {
      if (!nomes.has(k)) p(k, `campo fora do contrato (nome errado?)`);
    }

    for (const [nome, spec] of Object.entries(campos)) {
      const v = L[nome];
      const ausente = v === null || v === undefined;

      if (!(nome in L)) { p(nome, "campo do contrato ausente"); continue; }

      // ---- a regra de ausência --------------------------------------------
      // A ordem importa: sentinela é checada ANTES da faixa, porque -9999 cai
      // fora da faixa e o erro sairia como "abaixo do mínimo" — verdadeiro e
      // inútil, escondendo que o que houve foi ausência mal codificada.
      if (!ausente && typeof v === "number" && SENTINELAS.has(v)) {
        p(nome, `ausência codificada como sentinela (${v}); o contrato exige null`);
        continue;
      }
      if (!ausente && v === "" && spec.tipo === "string") {
        p(nome, "ausência codificada como string vazia; o contrato exige null");
        continue;
      }
      if (!ausente && proibidos.has(v) && v !== 0) {
        p(nome, `valor proibido para ausência (${v})`);
        continue;
      }

      if (ausente) {
        if (spec.obrigatorio) p(nome, "campo obrigatório está null");
        continue;
      }

      // ---- tipo, domínio, faixa -------------------------------------------
      if (!tipoBate(spec.tipo, v)) {
        p(nome, `tipo errado: esperava ${spec.tipo}, veio ${typeof v} (${JSON.stringify(v)})`);
        continue;
      }
      if (spec.dominio && !spec.dominio.includes(v)) {
        p(nome, `fora do domínio: ${JSON.stringify(v)} não está em ${JSON.stringify(spec.dominio)}`);
      }
      if (spec.dominioDe === "variaveis" && !contrato.variaveis[v]) {
        p(nome, `variável "${v}" não está no contrato`);
      }
      if (spec.tamanho != null && String(v).length !== spec.tamanho) {
        p(nome, `tamanho ${String(v).length}, esperado ${spec.tamanho}`);
      }
      if (spec.padrao && !new RegExp(spec.padrao).test(String(v))) {
        p(nome, `não casa com o padrão ${spec.padrao}: ${JSON.stringify(v)}`);
      }
      if (spec.min != null && typeof v === "number" && v < spec.min) {
        p(nome, `abaixo do mínimo (${v} < ${spec.min})`);
      }
      if (spec.max != null && typeof v === "number" && v > spec.max) {
        p(nome, `acima do máximo (${v} > ${spec.max})`);
      }
    }

    // ---- chave duplicada --------------------------------------------------
    // Numa tabela Gold, chave repetida significa que o agregado rodou duas
    // vezes sobre o mesmo grupo — e o app leria o primeiro que encontrasse.
    if (t.chave?.length) {
      const k = t.chave.map((c) => String(L[c])).join("|");
      if (vistos.has(k)) p(null, `chave duplicada: ${k}`);
      vistos.add(k);
    }

    // ---- invariantes ------------------------------------------------------
    for (const inv of t.invariantes ?? []) {
      if (inv.regra === "min<=max") {
        const [a, b] = inv.campos.map((c) => L[c]);
        if (typeof a === "number" && typeof b === "number" && a > b) {
          p(inv.campos.join(","), `invariante "${inv.nome}": ${a} > ${b}`);
        }
      }
      if (inv.regra === "crescente") {
        const vs = inv.campos.map((c) => L[c]);
        for (let j = 1; j < vs.length; j++) {
          if (typeof vs[j] === "number" && typeof vs[j - 1] === "number" && vs[j] < vs[j - 1]) {
            p(inv.campos.join(","), `invariante "${inv.nome}": ${inv.campos[j]} < ${inv.campos[j - 1]}`);
          }
        }
      }
      if (inv.regra === "n_amostras=0 => p10,p50,p90,media null") {
        if (L.n_amostras === 0) {
          for (const c of ["p10", "p50", "p90", "media"]) {
            if (L[c] !== null && L[c] !== undefined) {
              p(c, `invariante "${inv.nome}": há percentil sem amostra (${L[c]})`);
            }
          }
        }
      }
      if (inv.regra === "horas_validas<limiar => agregados null") {
        if (typeof L.horas_validas === "number" && L.horas_validas < inv.limiar) {
          for (const c of Object.keys(contrato.variaveis)) {
            if (c in L && L[c] !== null && L[c] !== undefined) {
              p(c, `invariante "${inv.nome}": agregado com só ${L.horas_validas} h válidas`);
            }
          }
        }
      }
    }
  });

  return problemas;
}

/**
 * O contrato concorda com o que o app REALMENTE fala?
 *
 * Esta é a checagem que costura os dois subsistemas, e ela não olha para
 * documentação: lê `VARIAVEIS` de `server/climatologia.js`, que é o objeto que
 * a rota usa de verdade. Documentação concorda com o código no dia em que é
 * escrita; um teste concorda todo dia.
 *
 * @param {object} contrato
 * @param {Record<string, {unidade:string, feitio:string, rotulo:string}>} variaveisDoApp
 */
export function conferirComOApp(contrato, variaveisDoApp) {
  /** @type {string[]} */
  const fora = [];
  const noContrato = new Set(Object.keys(contrato.variaveis));
  const noApp = new Set(Object.keys(variaveisDoApp));

  for (const k of noApp) if (!noContrato.has(k)) fora.push(`o app tem "${k}" e o contrato não`);
  for (const k of noContrato) if (!noApp.has(k)) fora.push(`o contrato tem "${k}" e o app não`);

  for (const k of noApp) {
    if (!noContrato.has(k)) continue;
    for (const prop of ["unidade", "feitio", "rotulo"]) {
      const a = variaveisDoApp[k][prop], c = contrato.variaveis[k][prop];
      if (a !== c) fora.push(`"${k}".${prop}: app diz ${JSON.stringify(a)}, contrato diz ${JSON.stringify(c)}`);
    }
  }
  return fora;
}
