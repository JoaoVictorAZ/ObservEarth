# Databricks notebook source
# MAGIC %md
# MAGIC # 03 · Análise — as perguntas que os números levantaram
# MAGIC
# MAGIC Entra: `dim_estacao`, `fato_observacao_diaria`, `gold_normal`.
# MAGIC Sai: nenhuma tabela. Este notebook **não grava nada** — ele interroga.
# MAGIC
# MAGIC Os três primeiros blocos nascem de observações da execução de 15/09/2026
# MAGIC que eram **hipóteses**, e existem para virarem medida ou caírem. O quarto
# MAGIC fecha a §6.2 da entrega.
# MAGIC
# MAGIC Nenhum deles reprocessa CSV: tudo aqui lê Delta, e responde em segundos.

# COMMAND ----------

dbutils.widgets.text("catalogo", "observearth")
dbutils.widgets.text("esquema", "clima")

CATALOGO = dbutils.widgets.get("catalogo")
ESQUEMA = dbutils.widgets.get("esquema")
spark.sql(f"USE {CATALOGO}.{ESQUEMA}")
print(f"{CATALOGO}.{ESQUEMA}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## A · Os 16,6% de dias incompletos se concentram?
# MAGIC
# MAGIC 477.129 de 2.869.788 dias não sustentam agregado. A pergunta é se isso é
# MAGIC **ruído de operação**, espalhado por toda a rede, ou **retrato de
# MAGIC manutenção**, concentrado em certas estações e certos anos.
# MAGIC
# MAGIC A diferença importa para a §6.4: se for concentrado, a `completude` do
# MAGIC índice de confiança está carregando informação de verdade, e não um
# MAGIC nivelamento.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Por ano. Se a taxa for plana, é ruído. Se tiver degrau, é operação.
# MAGIC SELECT
# MAGIC   year(data)                                              AS ano,
# MAGIC   count(DISTINCT estacao_id)                              AS estacoes,
# MAGIC   count(*)                                                AS dias,
# MAGIC   round(100.0 * sum(CASE WHEN horas_validas < 18 THEN 1 ELSE 0 END)
# MAGIC         / count(*), 1)                                    AS pct_incompleto,
# MAGIC   round(avg(horas_validas), 1)                            AS horas_medias
# MAGIC FROM fato_observacao_diaria
# MAGIC GROUP BY ano
# MAGIC ORDER BY ano

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Por estação. A CONCENTRAÇÃO é o que se procura: se 10% das estações
# MAGIC -- respondem por metade dos dias perdidos, a rede não é homogênea.
# MAGIC WITH por_estacao AS (
# MAGIC   SELECT estacao_id,
# MAGIC          count(*) AS dias,
# MAGIC          sum(CASE WHEN horas_validas < 18 THEN 1 ELSE 0 END) AS perdidos
# MAGIC   FROM fato_observacao_diaria
# MAGIC   GROUP BY estacao_id
# MAGIC )
# MAGIC SELECT d.uf, d.regiao, p.estacao_id, d.nome,
# MAGIC        p.dias, p.perdidos,
# MAGIC        round(100.0 * p.perdidos / p.dias, 1) AS pct_perdido
# MAGIC FROM por_estacao p
# MAGIC JOIN dim_estacao d USING (estacao_id)
# MAGIC WHERE p.dias >= 365          -- pelo menos um ano, senão a razão é frágil
# MAGIC ORDER BY pct_perdido DESC
# MAGIC LIMIT 25

# COMMAND ----------

# MAGIC %sql
# MAGIC -- E por região, que é como a entrega discute cobertura.
# MAGIC SELECT d.regiao,
# MAGIC        count(DISTINCT f.estacao_id) AS estacoes,
# MAGIC        count(*)                     AS dias,
# MAGIC        round(100.0 * sum(CASE WHEN f.horas_validas < 18 THEN 1 ELSE 0 END)
# MAGIC              / count(*), 1)         AS pct_incompleto
# MAGIC FROM fato_observacao_diaria f
# MAGIC JOIN dim_estacao d USING (estacao_id)
# MAGIC GROUP BY d.regiao
# MAGIC ORDER BY pct_incompleto DESC

# COMMAND ----------

# MAGIC %md
# MAGIC ## B · A UF declarada bate com a coordenada?
# MAGIC
# MAGIC `S104 · DTCEA VILHENA (RO)` apareceu com longitude perto de −50; Vilhena
# MAGIC fica perto de −60. **Nenhum guarda atual pega esse erro**: a coordenada
# MAGIC está dentro do Brasil, dentro do domínio da rede, e a checagem de lat/lng
# MAGIC trocadas não dispara porque elas não estão trocadas — estão erradas.
# MAGIC
# MAGIC Não há tabela de polígonos de UF aqui, e importar uma seria trabalho
# MAGIC desproporcional. **A rede serve de referência para si mesma:** as outras
# MAGIC estações da mesma UF formam uma nuvem, e quem está fora do estado cai
# MAGIC longe dessa nuvem.
# MAGIC
# MAGIC O cuidado necessário é que UF grande tem nuvem grande — no Amazonas,
# MAGIC 500 km do centro é normal. Por isso a comparação não é contra uma
# MAGIC distância fixa, e sim contra **a dispersão da própria UF**.

# COMMAND ----------

# MAGIC %sql
# MAGIC WITH centro AS (
# MAGIC   -- Mediana, e não média: uma estação muito fora puxaria a média para
# MAGIC   -- perto de si e se esconderia atrás do próprio erro.
# MAGIC   SELECT uf,
# MAGIC          percentile(lat, 0.5) AS lat_c,
# MAGIC          percentile(lng, 0.5) AS lng_c,
# MAGIC          count(*)             AS n
# MAGIC   FROM dim_estacao
# MAGIC   WHERE lat IS NOT NULL AND lng IS NOT NULL
# MAGIC   GROUP BY uf
# MAGIC   HAVING count(*) >= 4     -- com 3 estações não há dispersão para comparar
# MAGIC ),
# MAGIC dist AS (
# MAGIC   SELECT e.estacao_id, e.nome, e.uf, e.regiao, e.lat, e.lng, c.n,
# MAGIC          -- haversine, raio médio 6371 km
# MAGIC          2 * 6371 * asin(sqrt(
# MAGIC            pow(sin((radians(e.lat) - radians(c.lat_c)) / 2), 2)
# MAGIC            + cos(radians(c.lat_c)) * cos(radians(e.lat))
# MAGIC              * pow(sin((radians(e.lng) - radians(c.lng_c)) / 2), 2)
# MAGIC          )) AS km_do_centro
# MAGIC   FROM dim_estacao e
# MAGIC   JOIN centro c USING (uf)
# MAGIC   WHERE e.lat IS NOT NULL AND e.lng IS NOT NULL
# MAGIC )
# MAGIC SELECT estacao_id, nome, uf, regiao,
# MAGIC        round(lat, 3) AS lat, round(lng, 3) AS lng,
# MAGIC        round(km_do_centro) AS km_do_centro,
# MAGIC        round(percentile(km_do_centro, 0.9) OVER (PARTITION BY uf)) AS km_p90_da_uf,
# MAGIC        round(km_do_centro
# MAGIC              / nullif(percentile(km_do_centro, 0.9) OVER (PARTITION BY uf), 0), 1)
# MAGIC          AS vezes_o_p90
# MAGIC FROM dist
# MAGIC QUALIFY vezes_o_p90 > 1.8
# MAGIC ORDER BY vezes_o_p90 DESC
# MAGIC LIMIT 25

# COMMAND ----------

# MAGIC %md
# MAGIC **Como ler.** `vezes_o_p90` acima de 1,8 significa que a estação está quase
# MAGIC o dobro mais longe do centro do que 90% das suas conterrâneas. Isso **não
# MAGIC prova erro** — pode ser uma estação legitimamente periférica, e ilha
# MAGIC oceânica aparece aqui por construção.
# MAGIC
# MAGIC É uma lista de suspeitos para conferir pelo nome, exatamente como a
# MAGIC marcação `fora_do_continente` faz em `exportar_estacoes.py`: a exceção
# MAGIC aparece para ser julgada, não para ser apagada.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- E o metadado incompleto, que é o achado irmão deste: estações sem
# MAGIC -- altitude NÃO entram no ajuste de viés por relevo da §6.3. Se forem
# MAGIC -- muitas, o gradiente sai de uma amostra enviesada.
# MAGIC SELECT
# MAGIC   CASE WHEN estacao_id LIKE 'S%' THEN 'prefixo S' ELSE 'prefixo A' END AS grupo,
# MAGIC   count(*)                                                   AS estacoes,
# MAGIC   sum(CASE WHEN altitude_m IS NULL THEN 1 ELSE 0 END)        AS sem_altitude,
# MAGIC   sum(CASE WHEN fundacao  IS NULL THEN 1 ELSE 0 END)         AS sem_fundacao,
# MAGIC   count(DISTINCT fundacao)                                   AS datas_distintas,
# MAGIC   min(fundacao)                                              AS fundacao_min,
# MAGIC   max(fundacao)                                              AS fundacao_max
# MAGIC FROM dim_estacao
# MAGIC GROUP BY grupo

# COMMAND ----------

# MAGIC %md
# MAGIC ## C · O vale de 2021 existe nos dados, ou só nos bytes?
# MAGIC
# MAGIC Os ZIPs crescem até 2018–2019 e caem 32% em 2021. **Bytes não são
# MAGIC medidas** — um arquivo menor pode ser menos estações ou mais campos
# MAGIC vazios, e as duas coisas contam histórias diferentes.
# MAGIC
# MAGIC Esta consulta separa as duas.

# COMMAND ----------

# MAGIC %sql
# MAGIC WITH por_ano AS (
# MAGIC   SELECT year(data)                   AS ano,
# MAGIC          count(DISTINCT estacao_id)   AS estacoes,
# MAGIC          count(*)                     AS dias,
# MAGIC          sum(horas_validas)           AS horas_medidas,
# MAGIC          round(avg(horas_validas), 2) AS horas_por_dia
# MAGIC   FROM fato_observacao_diaria
# MAGIC   GROUP BY ano
# MAGIC )
# MAGIC SELECT ano, estacoes, dias, horas_medidas, horas_por_dia,
# MAGIC        estacoes - lag(estacoes) OVER (ORDER BY ano) AS delta_estacoes,
# MAGIC        round(100.0 * horas_medidas
# MAGIC              / nullif(lag(horas_medidas) OVER (ORDER BY ano), 0) - 100, 1)
# MAGIC          AS pct_horas_vs_ano_anterior
# MAGIC FROM por_ano
# MAGIC ORDER BY ano

# COMMAND ----------

# MAGIC %md
# MAGIC **Como ler.** Se `estacoes` cair em 2021, a rede encolheu — estações
# MAGIC desligadas. Se `estacoes` ficar e `horas_por_dia` cair, as estações
# MAGIC continuaram de pé medindo menos — falha de manutenção, não de rede.
# MAGIC
# MAGIC São diagnósticos diferentes com o mesmo sintoma no tamanho do arquivo, e é
# MAGIC por isso que a hipótese não podia ser escrita como achado.

# COMMAND ----------

# MAGIC %md
# MAGIC ## D · §6.2 — os dias fora da faixa
# MAGIC
# MAGIC **A ressalva vem antes do número, de propósito.** Por construção, ~20% dos
# MAGIC dias caem fora de p10–p90. Vinte por cento não é notícia: é a definição de
# MAGIC percentil. O resultado só interessa como **desvio dessa expectativa**.
# MAGIC
# MAGIC Por isso a consulta devolve `pct_fora` e o afastamento de 20, e não uma
# MAGIC contagem bruta chamada de "dias anormais".
# MAGIC
# MAGIC Uma armadilha de método: a normal foi calculada **com** 2024 dentro. Um
# MAGIC ano comparado contra uma climatologia que o inclui está parcialmente se
# MAGIC comparando consigo mesmo, e isso puxa o resultado para os 20%. Com 15
# MAGIC anos o efeito é pequeno, mas existe, e fica declarado.

# COMMAND ----------

# MAGIC %sql
# MAGIC WITH ultimo AS (
# MAGIC   SELECT estacao_id, data, dia_do_ano, temperature_2m_max AS v
# MAGIC   FROM fato_observacao_diaria
# MAGIC   WHERE year(data) = 2024 AND temperature_2m_max IS NOT NULL
# MAGIC ),
# MAGIC faixa AS (
# MAGIC   SELECT estacao_id, dia_do_ano, p10, p90, n_amostras
# MAGIC   FROM gold_normal
# MAGIC   WHERE variavel = 'temperature_2m_max'
# MAGIC     AND n_amostras >= 20        -- faixa fraca não sustenta a comparação
# MAGIC ),
# MAGIC marcado AS (
# MAGIC   SELECT u.estacao_id, u.data,
# MAGIC          CASE WHEN u.v < f.p10 THEN 1 ELSE 0 END AS abaixo,
# MAGIC          CASE WHEN u.v > f.p90 THEN 1 ELSE 0 END AS acima
# MAGIC   FROM ultimo u
# MAGIC   JOIN faixa f USING (estacao_id, dia_do_ano)
# MAGIC )
# MAGIC SELECT d.regiao,
# MAGIC        count(DISTINCT m.estacao_id)                      AS estacoes,
# MAGIC        count(*)                                          AS dias,
# MAGIC        round(100.0 * sum(m.abaixo) / count(*), 1)        AS pct_abaixo_p10,
# MAGIC        round(100.0 * sum(m.acima)  / count(*), 1)        AS pct_acima_p90,
# MAGIC        round(100.0 * sum(m.abaixo + m.acima) / count(*), 1) AS pct_fora,
# MAGIC        round(100.0 * sum(m.abaixo + m.acima) / count(*) - 20, 1) AS desvio_do_esperado
# MAGIC FROM marcado m
# MAGIC JOIN dim_estacao d USING (estacao_id)
# MAGIC GROUP BY d.regiao
# MAGIC ORDER BY desvio_do_esperado DESC

# COMMAND ----------

# MAGIC %md
# MAGIC **A assimetria é o achado, não o total.** `pct_abaixo_p10` e
# MAGIC `pct_acima_p90` deveriam dar ~10% cada. Se a soma der 20 mas a divisão for
# MAGIC 4 e 16, o ano não foi "anormal" — foi **quente**, e o total esconderia
# MAGIC exatamente isso.
# MAGIC
# MAGIC O cruzamento com ENSO (`server/oni.js`) entra aqui, **por região**: no Sul
# MAGIC o El Niño costuma trazer chuva e no Nordeste seca, e uma frase única para
# MAGIC o país seria falsa.
