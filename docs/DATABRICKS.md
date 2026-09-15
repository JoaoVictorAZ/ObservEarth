# Rodar o pipeline no Databricks

O destino do MVP é o Databricks — não uma alternativa, é o que a entrega pede.
Lá não há Windows, não há `winutils`, não há `JAVA_HOME` para configurar e não
há escolha de versão de Python: o runtime já vem casado.

---

## Por que serverless muda o código

Databricks Free Edition é **serverless-only**, e serverless **não expõe
`sparkContext`**. Sem ele não existe `parallelize`, não existe `broadcast`, não
existe RDD — e é disso que o caminho local depende.

`pipeline/databricks.py` é a mesma coisa pela API de DataFrame:

| local | serverless |
|---|---|
| `sparkContext.parallelize(caminhos)` | `spark.read.format("binaryFile")` |
| `sparkContext.broadcast(estacoes)` | lista no fechamento da UDF |
| `df.write.parquet(caminho)` | `saveAsTable` no Unity Catalog |
| `df.cache()` | gravar a tabela e reler dela |

A última linha foi descoberta em execução, e custou uma tentativa: `.cache()`
responde `PERSIST TABLE is not supported on serverless compute`. Faz sentido —
cache de RDD depende de executor fixo, e é justamente isso que o serverless não
tem. A consequência para o `01_silver` é que a checagem de qualidade roda
**depois** da gravação, contra o Parquet, e não antes contra o DataFrame.

**A lógica não foi reescrita.** `ler_estacao` e `avaliar` são as mesmas funções
puras, chamadas de dentro de uma UDF. Duas implementações da mesma regra
divergem — foi o que quase aconteceu com a janela de ±7 dias, que só não
divergiu porque existe uma prova de equivalência entre os dois lados.

As duas tubulações foram comparadas linha a linha sobre o mesmo dado:
**zero diferenças nos dois sentidos**, tanto no fato quanto na dimensão.

---

## Passo a passo

### 1. Levar o repositório para o workspace

**Workspace → Repos → Add Repo**, com a URL do GitHub. É o caminho que a
avaliação espera ver, porque amarra o notebook ao commit.

Sem repositório público ainda: **Workspace → Import** e suba os arquivos de
`pipeline/`. Os notebooks procuram a raiz subindo os diretórios até achar
`pipeline/contrato/esquema.json`, então funcionam nos dois casos.

### 2. Criar catálogo, esquema e volume

O notebook `00_bronze` faz isso na primeira célula. Os nomes vêm de widgets —
`observearth` / `clima` / `inmet` por padrão.

### 3. Os ZIPs

Duas rotas, e **qual delas você usou entra na entrega** (§2, *Carga dos Dados*):

- **R2 destravado** (verificação por LinkedIn liberou a saída): a célula de
  download do `00_bronze` resolve.
- **R1 valendo**: suba `data/bronze/{ano}.zip` da sua máquina para
  `/Volumes/observearth/clima/inmet/zips/` por **Catalog → Volume → Upload**.
  São 15 arquivos, ~1,3 GB. Tire screenshot do Volume preenchido.

Se você já rodou `node tools/baixar-inmet.mjs`, os ZIPs estão em
`data/bronze/` e é só subir.

### 4. Rodar, nesta ordem

| Notebook | Produz |
|---|---|
| `00_bronze` | CSVs no Volume + `bronze_inmet_arquivo` |
| `01_silver` | `dim_estacao`, `fato_observacao_diaria` + contagens de qualidade |
| `02_gold` | `gold_normal`, `gold_cobertura`, `gold_confianca` |

O `02_gold` **para sozinho** se o `percentile` do runtime não reproduzir o
gabarito. Isso é deliberado: um percentil aproximado produz números plausíveis
e errados, e é melhor o job falhar do que a normal sair torta.

### 5. Screenshots para a entrega

- **Carga**: o Volume com os ZIPs e a pasta `csv/` preenchida.
- **Modelagem e Catálogo**: `DESCRIBE TABLE EXTENDED` (última célula do `01`)
  e a árvore do Catalog Explorer com as seis tabelas.
- **Pipeline**: os três notebooks executados, com os tempos das células.
- **Qualidade**: as três células de contagem do `01_silver` — totais,
  sentinelas e invariantes.
- **Análise**: os gráficos SQL do `02_gold` — a envoltória p10–p90 de uma
  estação e a distribuição de confiança.

### 6. Preencher o documento

`docs/MVP.md` tem os números marcados como `⟨PENDENTE — execução real⟩`. Eles
saem direto das células de contagem. **Não preencha por estimativa** — a
convenção declarada no começo do documento é que todo número é medido ou está
marcado, e é isso que separa a entrega de um relatório genérico.

---

## Se algo falhar

**`ModuleNotFoundError: silver_inmet`** — a busca pela raiz não achou a âncora.
Rode `print(os.getcwd())` numa célula: o notebook precisa estar dentro do
repositório, com `pipeline/contrato/esquema.json` em algum diretório acima.

**`sparkContext is not supported`** — alguma célula chamou o caminho local.
`00`, `01` e `02` usam só `pipeline/databricks.py`; os módulos `silver_inmet.py`
e `gold_cobertura.py` têm funções `construir`/`confianca_na_grade` que são do
caminho **local** e não devem ser chamadas aqui.

**A assertiva do percentil falhou no `02`** — não force. Significa que o
`percentile` daquele runtime não usa `pos = p*(n-1)`, e a normal sairia
diferente da que o aplicativo desenha. Me mande a saída da célula.

---

## O que continua sendo local

`npm test` e `npm run test:pipeline` rodam na sua máquina e não precisam de
Spark: são as funções puras — parsing, distância, viés, índice de confiança, o
contrato. São elas que garantem que o que roda no Databricks está certo.
