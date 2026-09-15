# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Silver — o CSV horário vira fato diário e dimensão
# MAGIC
# MAGIC Entra: os CSVs do Volume. Sai: `dim_estacao` e `fato_observacao_diaria`.
# MAGIC
# MAGIC **A lógica não mora neste notebook.** Ela está em
# MAGIC `pipeline/silver_inmet.py`, em funções puras com 23 verificações
# MAGIC automáticas. Aqui só há distribuição — quem entrega os bytes e quem
# MAGIC transforma isso em tabela.
# MAGIC
# MAGIC Essa separação não é estética: um notebook é JSON com saída embutida, não
# MAGIC dá para importar uma função dele e o diff de uma célula mostra imagem em
# MAGIC base64. Regra em módulo testado, narrativa em notebook.

# COMMAND ----------

dbutils.widgets.text("catalogo", "observearth")
dbutils.widgets.text("esquema", "clima")
dbutils.widgets.text("volume", "inmet")

CATALOGO = dbutils.widgets.get("catalogo")
ESQUEMA = dbutils.widgets.get("esquema")
VOLUME = dbutils.widgets.get("volume")
RAIZ = f"/Volumes/{CATALOGO}/{ESQUEMA}/{VOLUME}"

# COMMAND ----------

import os
import sys

# O diretório de trabalho de um notebook depende de como o repositório foi
# anexado. Cravar `/Workspace/Repos/...` quebraria para qualquer outra pessoa;
# procurar uma âncora conhecida funciona sem configuração.
d = os.getcwd()
while not os.path.exists(os.path.join(d, "pipeline", "contrato", "esquema.json")):
    pai = os.path.dirname(d)
    assert pai != d, f"não achei a raiz do repositório a partir de {os.getcwd()}"
    d = pai
sys.path.insert(0, os.path.join(d, "pipeline"))
print("repositório:", d)

from databricks import salvar, silver_de_binarios  # noqa: E402

# COMMAND ----------

# MAGIC %md
# MAGIC ## Por que `binaryFile`, e não um leitor de CSV
# MAGIC
# MAGIC Três motivos, e os três foram descobertos batendo neles:
# MAGIC
# MAGIC 1. **O metadado é por arquivo.** As 8 primeiras linhas descrevem a
# MAGIC    estação e não se repetem em cada registro. Um leitor de CSV não tem
# MAGIC    como devolver isso, e concatenar os arquivos perderia exatamente a
# MAGIC    informação que forma a dimensão.
# MAGIC 2. **O arquivo é LATIN-1.** Um leitor de texto decodifica como UTF-8;
# MAGIC    `PRECIPITAÇÃO TOTAL` chega como `PRECIPITA??O TOTAL`, o casamento da
# MAGIC    coluna falha, e a saída sai **vazia sem erro nenhum**.
# MAGIC 3. **Serverless não tem `sparkContext`.** O caminho local usa
# MAGIC    `parallelize`; aqui não existe. `binaryFile` é API de DataFrame.
# MAGIC
# MAGIC As duas tubulações foram comparadas linha a linha sobre o mesmo dado:
# MAGIC **zero diferenças** nos dois sentidos.

# COMMAND ----------

# NO SERVERLESS, GRAVAR É O CACHE. E ISSO MUDA A ORDEM DO NOTEBOOK.
#
# Um DataFrame é preguiçoso: a UDF só roda quando alguém pede resultado. Abaixo
# pedem CINCO vezes — `count`, as três células de qualidade e o `salvar`. Sem
# materializar, cada uma reabre os 7.955 arquivos, redecodifica 1,3 GB de
# latin-1 e reexecuta o parser inteiro. Ninguém percebe lendo o notebook,
# porque cada célula parece barata.
#
# A resposta óbvia seria `.cache()`. **Serverless não tem.**
#
#     PERSIST TABLE is not supported on serverless compute
#
# É a mesma família de restrição que já tinha tirado o `sparkContext`: o
# serverless não expõe o que depende de executor fixo, e cache de RDD depende.
#
# Então a materialização é a tabela, e a checagem de qualidade passa a rodar
# DEPOIS da gravação, contra o Parquet — não antes, contra o DataFrame.
#
# O portão de qualidade continua fechando: ninguém a jusante lê estas tabelas
# até o `02_gold`, e ele só roda se as contagens abaixo passarem. O que se
# perde é a pureza de "não gravar dado ruim"; o que se ganha é a execução
# terminar. A troca está aqui declarada em vez de escondida.
print(salvar(dim, CATALOGO, ESQUEMA, "dim_estacao"))
print(salvar(fato, CATALOGO, ESQUEMA, "fato_observacao_diaria"))

dim = spark.table(f"{CATALOGO}.{ESQUEMA}.dim_estacao")
fato = spark.table(f"{CATALOGO}.{ESQUEMA}.fato_observacao_diaria")

print("estações:", dim.count())
print("dias    :", fato.count())
display(dim.limit(10))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Qualidade — as contagens que a entrega pede
# MAGIC
# MAGIC Contra a tabela já gravada, pelo motivo explicado na célula acima:
# MAGIC serverless não tem `cache()`, e sem materializar cada uma destas
# MAGIC agregações reprocessaria os 7.955 CSVs do zero.
# MAGIC
# MAGIC **Elas continuam sendo portão.** Se alguma falhar, não siga para o
# MAGIC `02_gold` — conserte o parser e rode este notebook de novo. O `salvar`
# MAGIC sobrescreve, então não há resíduo.
# MAGIC
# MAGIC `horas_validas` é o campo que impede a mentira mais fácil deste dataset:
# MAGIC uma máxima calculada com 3 horas do dia não é a máxima do dia, e sai com
# MAGIC exatamente a mesma cara de um dia completo.

# COMMAND ----------

from pyspark.sql import functions as F

qualidade = fato.agg(
    F.count("*").alias("dias_totais"),
    F.sum(F.when(F.col("horas_validas") >= 18, 1).otherwise(0)).alias("dias_completos"),
    F.sum(F.when(F.col("horas_validas") < 18, 1).otherwise(0)).alias("dias_descartados"),
    F.sum(F.when(F.col("temperature_2m_max").isNull(), 1).otherwise(0)).alias("tmax_nula"),
    F.sum(F.when(F.col("precipitation_sum").isNull(), 1).otherwise(0)).alias("chuva_nula"),
    F.min("data").alias("primeiro_dia"),
    F.max("data").alias("ultimo_dia"),
)
display(qualidade)

# COMMAND ----------

# MAGIC %md
# MAGIC ### O que NÃO pode aparecer
# MAGIC
# MAGIC A sentinela. O arquivo de 2024 não tem `-9999` nenhuma vez — ausência é
# MAGIC campo vazio — mas anos antigos podem usá-la, e um `-9999` que escape para
# MAGIC a camada Gold entra na média e no percentil **sem levantar erro nenhum** e
# MAGIC desloca a distribuição inteira.
# MAGIC
# MAGIC Se qualquer contagem abaixo for diferente de zero, pare: o parser deixou
# MAGIC passar, e a normal que sair daqui estará errada com cara de certa.

# COMMAND ----------

sentinelas = fato.agg(*[
    F.sum(F.when(F.col(c).isin(-9999.0, -999.0), 1).otherwise(0)).alias(f"{c}_sentinela")
    for c in ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
              "precipitation_sum", "wind_speed_10m_max"]
])
display(sentinelas)

# COMMAND ----------

# MAGIC %md
# MAGIC ### Invariantes do contrato
# MAGIC
# MAGIC Mínima acima da máxima indica coluna trocada. Agregado preenchido num dia
# MAGIC incompleto indica que o limiar de `horas_validas` não foi respeitado.

# COMMAND ----------

violacoes = fato.agg(
    F.sum(F.when(F.col("temperature_2m_min") > F.col("temperature_2m_max"), 1).otherwise(0))
     .alias("minima_acima_da_maxima"),
    F.sum(F.when((F.col("horas_validas") < 18) & F.col("temperature_2m_max").isNotNull(), 1)
          .otherwise(0)).alias("agregado_em_dia_incompleto"),
    F.sum(F.when(F.col("dia_do_ano").isNull() | (F.col("dia_do_ano") < 1) |
                 (F.col("dia_do_ano") > 366), 1).otherwise(0)).alias("dia_do_ano_invalido"),
)
display(violacoes)

# COMMAND ----------

# MAGIC %md
# MAGIC ## O que ficou no catálogo
# MAGIC
# MAGIC A gravação aconteceu lá em cima — ver a nota sobre `cache()` no
# MAGIC serverless. Aqui só se confere o que está no Unity Catalog, que é o que
# MAGIC o `02_gold` vai ler.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Screenshot desta célula para a seção "Modelagem e Catálogo de Dados".
# MAGIC DESCRIBE TABLE EXTENDED IDENTIFIER(:catalogo || '.' || :esquema || '.fato_observacao_diaria')
