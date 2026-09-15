#!/usr/bin/env python3
"""
pipeline/databricks.py
=============================================================================
O ENCANAMENTO PARA O DATABRICKS SERVERLESS

Serverless **não expõe `sparkContext`**. Sem ele não há `parallelize`, não há
`broadcast`, não há RDD — e é exatamente disso que `silver_inmet.construir` e
`gold_cobertura.confianca_na_grade` dependem para rodar na sua máquina.

Este arquivo é a mesma coisa pelo caminho que o serverless aceita: só API de
DataFrame. E a lógica NÃO é reescrita: `ler_estacao` e `avaliar` continuam
sendo as mesmas funções puras, chamadas de dentro de uma UDF. O que muda é
quem entrega os bytes e quem distribui as linhas.

-----------------------------------------------------------------------------
POR QUE ISSO NÃO É UMA SEGUNDA IMPLEMENTAÇÃO
-----------------------------------------------------------------------------
Duas implementações da mesma regra divergem — foi o que aconteceu com a janela
de ±7 dias, que existe em JavaScript e em Python e só não divergiu porque há
uma prova de equivalência entre as duas.

Aqui não há esse risco, e é de propósito: o parsing inteiro (`ler_estacao`) e o
índice de confiança inteiro (`avaliar`) são importados. Se um deles mudar, muda
para os dois caminhos ao mesmo tempo. O que este arquivo contém é distribuição,
não regra.
=============================================================================
"""

from __future__ import annotations

import os
import sys


# ---------------------------------------------------------------------------
def raiz_do_repo(inicio: str | None = None) -> str:
    """Sobe os diretórios até achar `pipeline/contrato/esquema.json`.

    No Databricks o diretório de trabalho de um notebook depende de como o
    repositório foi anexado, e cravar `/Workspace/Repos/...` quebraria para
    qualquer outra pessoa. Procurar uma âncora conhecida funciona nos dois
    lados sem configuração.
    """
    d = os.path.abspath(inicio or os.getcwd())
    while True:
        if os.path.exists(os.path.join(d, "pipeline", "contrato", "esquema.json")):
            return d
        pai = os.path.dirname(d)
        if pai == d:
            raise RuntimeError(
                "não achei a raiz do repositório (pipeline/contrato/esquema.json). "
                f"Comecei em {inicio or os.getcwd()}")
        d = pai


def preparar_caminho(inicio: str | None = None) -> str:
    """Põe `pipeline/` no `sys.path` e devolve a raiz do repositório."""
    raiz = raiz_do_repo(inicio)
    p = os.path.join(raiz, "pipeline")
    if p not in sys.path:
        sys.path.insert(0, p)
    return raiz


# ---------------------------------------------------------------------------
def esquema_fato():
    from pyspark.sql import types as T
    return T.StructType([
        T.StructField("estacao_id", T.StringType()),
        T.StructField("data", T.DateType()),
        T.StructField("dia_do_ano", T.IntegerType()),
        T.StructField("temperature_2m_max", T.DoubleType()),
        T.StructField("temperature_2m_min", T.DoubleType()),
        T.StructField("temperature_2m_mean", T.DoubleType()),
        T.StructField("precipitation_sum", T.DoubleType()),
        T.StructField("wind_speed_10m_max", T.DoubleType()),
        T.StructField("horas_validas", T.IntegerType()),
        T.StructField("ingestao_em", T.StringType()),
        T.StructField("fonte", T.StringType()),
    ])


def esquema_dim():
    from pyspark.sql import types as T
    return T.StructType([
        T.StructField("estacao_id", T.StringType()),
        T.StructField("nome", T.StringType()),
        T.StructField("uf", T.StringType()),
        T.StructField("regiao", T.StringType()),
        T.StructField("lat", T.DoubleType()),
        T.StructField("lng", T.DoubleType()),
        T.StructField("altitude_m", T.DoubleType()),
        T.StructField("fundacao", T.DateType()),
        T.StructField("rede", T.StringType()),
    ])


def silver_de_binarios(spark, caminho: str):
    """Bronze -> Silver sem RDD. `caminho` é um glob de CSVs num Volume.

    `binaryFile` é o leitor de DataFrame que entrega os BYTES de cada arquivo
    junto com o caminho. É o que substitui o `parallelize(caminhos)` do
    caminho local, e existe justamente para este caso: arquivo inteiro como
    unidade, sem o Hadoop tentar interpretar o conteúdo.

    Os bytes importam: o CSV do INMET é LATIN-1, e um leitor de texto o
    decodificaria como UTF-8 — `PRECIPITAÇÃO` viraria lixo, a coluna sumiria, e
    a saída sairia VAZIA sem erro nenhum. Ver silver_inmet.py.
    """
    import gzip
    from pyspark.sql import functions as F, types as T

    from silver_inmet import ler_estacao

    fato_t = T.ArrayType(esquema_fato())
    dim_t = esquema_dim()

    def _texto(dados: bytes) -> str:
        if len(dados) > 2 and dados[0] == 0x1F and dados[1] == 0x8B:
            dados = gzip.decompress(dados)
        return dados.decode("latin-1", errors="replace")

    @F.udf(returnType=fato_t)
    def fatos_do_arquivo(caminho, dados):
        if dados is None:
            return []
        _, fatos = ler_estacao(os.path.basename(caminho), _texto(bytes(dados)))
        return [tuple(f[c.name] for c in esquema_fato()) for f in fatos]

    @F.udf(returnType=dim_t)
    def dim_do_arquivo(caminho, dados):
        if dados is None:
            return None
        # Só os primeiros 4 kB: o bloco de metadados são 8 linhas. Decodificar
        # 800 kB para ler 8 linhas seria pagar o arquivo inteiro duas vezes.
        est, _ = ler_estacao(os.path.basename(caminho), _texto(bytes(dados))[:4096])
        return None if est is None else tuple(est[c.name] for c in dim_t)

    # `recursiveFileLookup` NÃO É OPCIONAL AQUI, e a falta dele é silenciosa.
    #
    # Os CSVs ficam em `csv/{ano}/`, um nível abaixo do caminho passado. Sem
    # esta opção o Spark liga a descoberta de partição e trata `2023/`, `2024/`
    # como estrutura de partição em vez de conteúdo — e devolve ZERO linhas sem
    # erro nenhum. O `00_bronze` já tinha a opção; este caminho não, e a
    # divergência entre os dois leitores só apareceu com dado real no Volume.
    #
    # Zero linhas é o pior modo de falha possível: o esquema sai certo, o
    # `display` desenha as colunas, e parece que o dado é que está vazio.
    bruto = (spark.read.format("binaryFile")
             .option("pathGlobFilter", "*.CSV*")
             .option("recursiveFileLookup", "true")
             .load(caminho)
             .select("path", "content"))

    # E se ainda assim vier vazio, isso não pode passar por "não há dado".
    if bruto.limit(1).count() == 0:
        raise RuntimeError(
            f"nenhum arquivo casou com *.CSV* em {caminho!r}.\n"
            "  Confira, nesta ordem:\n"
            "    1. o `00_bronze` extraiu? Catalog -> Volume -> csv/ deve ter uma pasta por ano\n"
            "    2. a extensão está em maiúscula? o filtro é *.CSV* e o glob diferencia caixa\n"
            "    3. o caminho termina em /csv/ e não em /csv/{ano}/")

    fato = (bruto
            .select(F.explode(fatos_do_arquivo("path", "content")).alias("r"))
            .select("r.*")
            .withColumn("ingestao_em", F.to_timestamp("ingestao_em")))

    dim = (bruto
           .select(dim_do_arquivo("path", "content").alias("r"))
           .where(F.col("r").isNotNull())
           .select("r.*")
           # A mesma estação aparece uma vez por ANO. Chave repetida numa
           # dimensão infla a contagem de vizinhas do índice de confiança e faz
           # o mapa parecer mais confiante do que a rede justifica.
           .dropDuplicates(["estacao_id"]))

    return dim, fato


def confianca_sem_rdd(spark, dim, cob):
    """`gold_confianca` sem `parallelize` nem `broadcast`.

    A lista de estações vai para o driver (são centenas de linhas) e entra na
    UDF pelo fechamento — que o Spark serializa junto com a função. É o mesmo
    efeito do broadcast para um conjunto deste tamanho, e não precisa de
    `sparkContext`.
    """
    from pyspark.sql import functions as F, types as T

    from gold_cobertura import avaliar, grade

    resumo = (cob.groupBy("estacao_id")
              .agg(F.count("ano").cast("int").alias("anos"),
                   F.avg("cobertura").alias("completude")))
    estacoes = [r.asDict() for r in
                dim.select("estacao_id", "lat", "lng")
                   .join(resumo, "estacao_id", "inner").collect()]

    saida_t = T.StructType([
        T.StructField("lat", T.DoubleType()), T.StructField("lng", T.DoubleType()),
        T.StructField("estacao_id", T.StringType()), T.StructField("dist_km", T.DoubleType()),
        T.StructField("n_150km", T.IntegerType()), T.StructField("anos", T.IntegerType()),
        T.StructField("completude", T.DoubleType()), T.StructField("proximidade", T.DoubleType()),
        T.StructField("serie", T.DoubleType()), T.StructField("confianca", T.DoubleType()),
    ])

    @F.udf(returnType=saida_t)
    def avaliar_celula(lat, lng):
        r = avaliar(lat, lng, estacoes)
        return tuple(r[c.name] for c in saida_t)

    celulas = spark.createDataFrame(grade(), "lat double, lng double")
    return (celulas
            .select(avaliar_celula("lat", "lng").alias("r"))
            .select("r.*"))


# ---------------------------------------------------------------------------
def salvar(df, catalogo: str, esquema: str, tabela: str) -> str:
    """Grava como TABELA do Unity Catalog, e não como caminho de arquivo.

    A entrega pede catálogo de dados e screenshots das tabelas persistidas.
    Um Parquet solto num Volume não aparece no catálogo, não tem histórico e
    não tem esquema consultável — três coisas que a avaliação procura.
    """
    nome = f"{catalogo}.{esquema}.{tabela}"
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(nome)
    return nome
