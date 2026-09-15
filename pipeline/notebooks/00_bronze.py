# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Bronze — o dado cru, sem transformação
# MAGIC
# MAGIC Entra: os ZIPs anuais do INMET num Volume do Unity Catalog.
# MAGIC Sai: os CSVs extraídos no Volume + a tabela `bronze_inmet_arquivo`.
# MAGIC
# MAGIC **Bronze não transforma nada.** Ele descompacta e registra o que chegou.
# MAGIC A tabela é um manifesto de ingestão — quantos arquivos, de que ano, com
# MAGIC quantos bytes, lidos quando. É o que permite responder "este número veio
# MAGIC de onde" três semanas depois, e é o que torna o reprocessamento possível
# MAGIC sem baixar 1,3 GB de novo.
# MAGIC
# MAGIC O formato do CSV foi **medido** antes de qualquer código — 565 estações
# MAGIC por ano, LATIN-1, separador `;`, vírgula decimal, 8 linhas de metadados,
# MAGIC e ausência como campo vazio (não `-9999`). Ver `pipeline/silver_inmet.py`.

# COMMAND ----------

dbutils.widgets.text("catalogo", "observearth")
dbutils.widgets.text("esquema", "clima")
dbutils.widgets.text("volume", "inmet")

CATALOGO = dbutils.widgets.get("catalogo")
ESQUEMA = dbutils.widgets.get("esquema")
VOLUME = dbutils.widgets.get("volume")
RAIZ = f"/Volumes/{CATALOGO}/{ESQUEMA}/{VOLUME}"

spark.sql(f"CREATE CATALOG IF NOT EXISTS {CATALOGO}")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOGO}.{ESQUEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOGO}.{ESQUEMA}.{VOLUME}")
print(RAIZ)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Os ZIPs
# MAGIC
# MAGIC Suba os arquivos `{ano}.zip` para `{RAIZ}/zips/` — pela interface
# MAGIC (Catalog → Volume → Upload) ou, se a verificação por LinkedIn liberou a
# MAGIC internet de saída, pela célula abaixo.
# MAGIC
# MAGIC **A restrição R1 é real**: o Free Edition limita a saída a domínios
# MAGIC confiáveis. Se a célula falhar, não é o código — é a rede, e o caminho é
# MAGIC o upload manual. Registre qual dos dois você usou: a diferença aparece na
# MAGIC seção *Carga dos Dados* da entrega.

# COMMAND ----------

import os
import urllib.request

DE, ATE = 2010, 2024
os.makedirs(f"{RAIZ}/zips", exist_ok=True)

for ano in range(DE, ATE + 1):
    destino = f"{RAIZ}/zips/{ano}.zip"
    if os.path.exists(destino):
        print(f"  {ano}  já está no Volume ({os.path.getsize(destino)/1048576:.0f} MB)")
        continue
    url = f"https://portal.inmet.gov.br/uploads/dadoshistoricos/{ano}.zip"
    try:
        # Arquivo temporário: só vira o definitivo quando fecha. Um ZIP truncado
        # com o nome final passaria por "já baixado" na próxima execução, e o
        # erro só apareceria lá na frente, na descompactação.
        with urllib.request.urlopen(url, timeout=300) as r, open(destino + ".parcial", "wb") as f:
            f.write(r.read())
        os.replace(destino + ".parcial", destino)
        print(f"  {ano}  {os.path.getsize(destino)/1048576:.0f} MB")
    except Exception as e:
        print(f"  {ano}  FALHOU ({type(e).__name__}) — suba pela interface. R1.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Descompactar
# MAGIC
# MAGIC Um diretório por ano. Só os `.CSV`, com o nome achatado: alguns anos
# MAGIC trazem os arquivos dentro de uma pasta, outros na raiz do ZIP.

# COMMAND ----------

import zipfile

for ano in range(DE, ATE + 1):
    zip_path = f"{RAIZ}/zips/{ano}.zip"
    dir_ano = f"{RAIZ}/csv/{ano}"
    if not os.path.exists(zip_path):
        print(f"  {ano}  sem ZIP, pulando")
        continue
    if os.path.isdir(dir_ano) and os.listdir(dir_ano):
        print(f"  {ano}  já extraído ({len(os.listdir(dir_ano))} arquivos)")
        continue
    os.makedirs(dir_ano, exist_ok=True)
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for e in z.infolist():
            if not e.filename.upper().endswith(".CSV"):
                continue
            with z.open(e) as origem, open(f"{dir_ano}/{os.path.basename(e.filename)}", "wb") as saida:
                saida.write(origem.read())
            n += 1
    print(f"  {ano}  {n} CSVs")

# COMMAND ----------

# MAGIC %md
# MAGIC ## O manifesto
# MAGIC
# MAGIC A tabela Bronze. Ela não tem medição nenhuma — tem **procedência**:
# MAGIC que arquivo, de que ano, com quantos bytes, lido quando.

# COMMAND ----------

from pyspark.sql import functions as F

bronze = (spark.read.format("binaryFile")
          .option("pathGlobFilter", "*.CSV")
          .option("recursiveFileLookup", "true")
          .load(f"{RAIZ}/csv/")
          .select(
              F.col("path"),
              F.regexp_extract("path", r"/csv/(\d{4})/", 1).cast("int").alias("ano"),
              F.element_at(F.split(F.col("path"), "/"), -1).alias("arquivo"),
              # O código WMO está no nome do arquivo E dentro dele. Aqui sai do
              # nome porque Bronze não abre o conteúdo — quem confere os dois é
              # a camada Silver.
              F.regexp_extract(F.element_at(F.split(F.col("path"), "/"), -1),
                               r"_([A-Z]\d{3})_", 1).alias("estacao_id_do_nome"),
              F.col("length").alias("bytes"),
              F.col("modificationTime").alias("modificado_em"),
              F.current_timestamp().alias("ingestao_em"),
          ))

bronze.write.mode("overwrite").saveAsTable(f"{CATALOGO}.{ESQUEMA}.bronze_inmet_arquivo")
display(spark.sql(f"""
  SELECT ano, count(*) AS arquivos, round(sum(bytes)/1048576) AS mb
  FROM {CATALOGO}.{ESQUEMA}.bronze_inmet_arquivo
  GROUP BY ano ORDER BY ano
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC A contagem por ano é o primeiro resultado do trabalho, e já diz algo:
# MAGIC a rede automática **cresceu**. Se 2010 tem menos estações que 2020, isso
# MAGIC não é falha de ingestão — é a história da rede, e ela precisa aparecer na
# MAGIC discussão de cobertura (§6.4 da entrega).
