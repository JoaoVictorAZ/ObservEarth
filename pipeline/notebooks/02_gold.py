# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Gold — normais, cobertura e confiança
# MAGIC
# MAGIC > O Gold lê as TABELAS que o Silver gravou, e não o DataFrame dele. São
# MAGIC > Parquet no Unity Catalog: ler de lá custa uma fração de reabrir os
# MAGIC > 7.955 CSVs e repassar a UDF Python por cima.
# MAGIC
# MAGIC Entra: `dim_estacao` e `fato_observacao_diaria`.
# MAGIC Sai: `gold_normal`, `gold_cobertura`, `gold_confianca`.
# MAGIC
# MAGIC Como no Silver, a lógica está nos módulos testados
# MAGIC (`gold_normal.py`, `gold_cobertura.py`). Aqui há distribuição e narrativa.

# COMMAND ----------

dbutils.widgets.text("catalogo", "observearth")
dbutils.widgets.text("esquema", "clima")
dbutils.widgets.text("referencia", "2010-2024")

CATALOGO = dbutils.widgets.get("catalogo")
ESQUEMA = dbutils.widgets.get("esquema")
REFERENCIA = dbutils.widgets.get("referencia")

# COMMAND ----------

import json
import os
import sys

d = os.getcwd()
while not os.path.exists(os.path.join(d, "pipeline", "contrato", "esquema.json")):
    pai = os.path.dirname(d)
    assert pai != d, f"não achei a raiz do repositório a partir de {os.getcwd()}"
    d = pai
sys.path.insert(0, os.path.join(d, "pipeline"))

from databricks import confianca_sem_rdd, salvar  # noqa: E402
from gold_cobertura import cobertura_por_ano  # noqa: E402
from gold_normal import construir as construir_normal  # noqa: E402

CONTRATO = json.load(open(os.path.join(d, "pipeline", "contrato", "esquema.json"), encoding="utf-8"))

dim = spark.table(f"{CATALOGO}.{ESQUEMA}.dim_estacao")
fato = spark.table(f"{CATALOGO}.{ESQUEMA}.fato_observacao_diaria")

# COMMAND ----------

# MAGIC %md
# MAGIC ## A conferência que precisa rodar AQUI
# MAGIC
# MAGIC `percentile_approx` **não interpola** — devolve estatística de ordem. Na
# MAGIC amostra `[10,20,30,40,50]` ele dá p10 = 10 onde o correto é 14. O erro
# MAGIC encolhe com amostra grande, mas vive nas **caudas**, que é exatamente onde
# MAGIC a faixa de anomalia do aplicativo mora.
# MAGIC
# MAGIC Medido em Spark 3.5.3 contra `pipeline/contrato/gabarito-quantis.json`,
# MAGIC cujos valores foram calculados **à mão**:
# MAGIC
# MAGIC ```
# MAGIC percentile          0 divergências em 15
# MAGIC percentile_approx   8 divergências em 15
# MAGIC ```
# MAGIC
# MAGIC O runtime daqui é outro. A conferência custa segundos e tem que passar
# MAGIC **antes** de gravar qualquer Gold — senão o número sai plausível e errado.

# COMMAND ----------

gab = json.load(open(os.path.join(d, "pipeline", "contrato", "gabarito-quantis.json"), encoding="utf-8"))
ruim = 0
for caso in gab["casos"]:
    amostra = [x for x in caso["amostra"] if x is not None]
    if not amostra:
        continue
    df = spark.createDataFrame([(float(x),) for x in amostra], "v double")
    for chave, p in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
        esp = caso["esperado"][chave]
        r = df.selectExpr(f"percentile(v,{p}) ex", f"percentile_approx(v,{p}) ap").first()
        ok_e = abs(r["ex"] - esp) < 1e-9
        ruim += not ok_e
        print(f"{caso['nome'][:40]:<42} {chave} gabarito={esp:>7} "
              f"percentile={r['ex']:>9.4f}{'' if ok_e else '  X'} "
              f"approx={r['ap']:>9.4f}{'' if abs(r['ap']-esp)<1e-9 else '  X'}")

assert ruim == 0, (
    "`percentile` deste runtime NÃO reproduz o gabarito tipo 7. "
    "Pare: o contrato assume pos = p*(n-1). Reveja antes de gravar Gold.")
print("\nOK — o percentil deste runtime bate com o gabarito.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gold A · as normais
# MAGIC
# MAGIC A janela de ±7 dias é uma **explosão, não um filtro**. A normal do dia 200
# MAGIC usa os dias 193 a 207 de *todos* os anos; agrupar por `dia_do_ano` daria
# MAGIC 15 amostras (uma por ano) em vez de ~225.
# MAGIC
# MAGIC A volta pelo ano usa comprimento **365**, e não 366: com 366 a conta dá 8
# MAGIC entre 26/dez e 2/jan, e a virada do ano perderia metade da vizinhança sem
# MAGIC nada indicar isso.

# COMMAND ----------

normal = construir_normal(spark, fato, CONTRATO, referencia=REFERENCIA)
print("linhas:", normal.count())
print(salvar(normal, CATALOGO, ESQUEMA, "gold_normal"))

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Uma estação, uma variável, o ano inteiro. É a envoltória que o
# MAGIC -- aplicativo desenha atrás do valor do dia.
# MAGIC SELECT dia_do_ano, p10, p50, p90, n_amostras
# MAGIC FROM IDENTIFIER(:catalogo || '.' || :esquema || '.gold_normal')
# MAGIC WHERE variavel = 'temperature_2m_max'
# MAGIC   AND estacao_id = (SELECT min(estacao_id) FROM IDENTIFIER(:catalogo || '.' || :esquema || '.gold_normal'))
# MAGIC ORDER BY dia_do_ano

# COMMAND ----------

# MAGIC %md
# MAGIC ## Gold C · cobertura e confiança
# MAGIC
# MAGIC `gold_confianca` é a camada que mostra a **ignorância** do aplicativo. Na
# MAGIC Amazônia quase não há estação, e hoje isso é invisível: o mapa pinta a
# MAGIC mesma cor que pinta São Paulo, e o vazio parece normalidade.
# MAGIC
# MAGIC ```
# MAGIC confianca = proximidade × serie × completude
# MAGIC ```
# MAGIC
# MAGIC **Multiplicativo, e não média.** Uma estação a 5 km com 1 ano de dados não
# MAGIC torna a célula conhecida; a média daria 0,5 e pintaria a célula como meio
# MAGIC confiável.

# COMMAND ----------

cob = cobertura_por_ano(spark, fato)
print(salvar(cob, CATALOGO, ESQUEMA, "gold_cobertura"))

conf = confianca_sem_rdd(spark, dim, cob)
print(salvar(conf, CATALOGO, ESQUEMA, "gold_confianca"))

# COMMAND ----------

# MAGIC %sql
# MAGIC -- O QUE O APLICATIVO NÃO SABE. Ordene por confiança e olhe onde estão as
# MAGIC -- células piores: elas contam a história da rede de observação do país.
# MAGIC SELECT
# MAGIC   round(confianca, 3) AS confianca,
# MAGIC   count(*)            AS celulas,
# MAGIC   round(min(dist_km)) AS dist_min_km,
# MAGIC   round(max(dist_km)) AS dist_max_km
# MAGIC FROM IDENTIFIER(:catalogo || '.' || :esquema || '.gold_confianca')
# MAGIC GROUP BY round(confianca, 3)
# MAGIC ORDER BY confianca

# COMMAND ----------

# MAGIC %md
# MAGIC ### A ressalva que acompanha o número
# MAGIC
# MAGIC A escala de 150 km da proximidade é a ordem de grandeza da decorrelação da
# MAGIC **temperatura** diária. Chuva decorrelaciona em dezenas de km — para
# MAGIC precipitação este índice é **otimista**. Corrigir exigiria uma grade por
# MAGIC variável; não foi feito, e está escrito no contrato para não virar
# MAGIC suposição de quem lê o mapa.
