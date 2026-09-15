#!/usr/bin/env python3
"""
pipeline/gold_cobertura.py
=============================================================================
M5 · GOLD C — a camada que mostra o que o aplicativo NÃO sabe

    silver/fato + silver/dim  ->  gold/gold_cobertura  +  gold/gold_confianca

    python pipeline/gold_cobertura.py --silver silver/ --saida gold/

-----------------------------------------------------------------------------
DUAS TABELAS, E ELAS RESPONDEM PERGUNTAS DIFERENTES
-----------------------------------------------------------------------------
`gold_cobertura`   por estação e ano — quantos dias ela mediu de fato.
                   Responde "dá para confiar NESTA estação neste ano".

`gold_confianca`   por célula de grade — quão longe está a estação mais
                   próxima, há quantos anos ela mede, e quão completa é.
                   Responde "o app sabe alguma coisa SOBRE ESTE PONTO".

A segunda é a que vira camada de mapa, e ela existe por um motivo ético, não
estético: na Amazônia quase não há estação, e hoje isso é invisível — o mapa
pinta a mesma cor que pinta São Paulo, e o vazio parece normalidade. É a mesma
regra que o código já segue no ponto (ausência é `null`, nunca zero) promovida
a camada desenhável.

-----------------------------------------------------------------------------
O ÍNDICE NÃO É UMA NOTA MÁGICA
-----------------------------------------------------------------------------
    confianca = proximidade * serie * completude

Os três fatores saem no Parquet AO LADO do resultado, para a tela poder dizer
por que a confiança é baixa — e não só que é. "Nenhuma estação num raio de
300 km" e "a estação ao lado só mediu 40% dos dias" são problemas diferentes,
com a mesma nota.

MULTIPLICATIVO, e não média: um zero em qualquer fator tem que zerar tudo. Uma
estação a 5 km com 1 ano de dados não torna a célula conhecida; a média daria
0,5 e pintaria a célula como meio confiável.

O QUE ELE ERRA, DECLARADO: a escala de 150 km da proximidade é a ordem de
grandeza da decorrelação da TEMPERATURA diária. Chuva decorrelaciona em dezenas
de km, não centenas — para precipitação este índice é OTIMISTA. Corrigir exigia
uma grade por variável; ficou por fazer, e está escrito no contrato para não
virar suposição de quem lê o mapa.
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONTRATO = RAIZ / "pipeline" / "contrato" / "esquema.json"

# O retângulo do Brasil, o mesmo domínio de `dim_estacao` no contrato.
LAT0, LAT1 = -34.0, 6.0
LNG0, LNG1 = -74.0, -34.0
PASSO = 0.25          # a mesma resolução dos campos GFS que o app já desenha

RAIO_TERRA_KM = 6371.0088
ESCALA_KM = 150.0     # ver a docstring e o contrato
ANOS_CHEIOS = 15      # o recorte adotado para o INMET (2010-2024)


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distância em km sobre a esfera.

    Esférica e não elipsoidal: o erro contra o WGS84 é de ~0,3%, ou 1 km em
    300 — irrelevante para um índice cuja escala é de 150 km, e que a própria
    fórmula amortece exponencialmente.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * RAIO_TERRA_KM * math.asin(min(1.0, math.sqrt(a)))


def grade() -> list[tuple[float, float]]:
    """Centros das células. Em 0,25° sobre o Brasil são 160 x 160 = 25.600."""
    n_lat = int(round((LAT1 - LAT0) / PASSO))
    n_lng = int(round((LNG1 - LNG0) / PASSO))
    return [
        (round(LAT0 + (i + 0.5) * PASSO, 4), round(LNG0 + (j + 0.5) * PASSO, 4))
        for i in range(n_lat) for j in range(n_lng)
    ]


def avaliar(lat: float, lng: float, estacoes: list[dict]) -> dict:
    """Uma célula contra a lista de estações. Pura, para poder ser testada."""
    melhor, d_melhor = None, float("inf")
    n_150 = 0
    for e in estacoes:
        d = haversine(lat, lng, e["lat"], e["lng"])
        if d <= 150.0:
            n_150 += 1
        if d < d_melhor:
            melhor, d_melhor = e, d

    # SEM ESTAÇÃO NO ALCANCE não há o que saber. Zero aqui é MEDIDA — significa
    # "não sabemos nada deste ponto" — e por isso `confianca` é 0 enquanto
    # `dist_km` e `completude` são null: a distância a uma estação inexistente
    # não é um número grande, é a ausência de número.
    if melhor is None:
        return {
            "lat": lat, "lng": lng, "estacao_id": None, "dist_km": None,
            "n_150km": 0, "anos": 0, "completude": None,
            "proximidade": 0.0, "serie": 0.0, "confianca": 0.0,
        }

    proximidade = math.exp(-d_melhor / ESCALA_KM)
    serie = min(1.0, (melhor.get("anos") or 0) / ANOS_CHEIOS)
    completude = melhor.get("completude")
    conf = proximidade * serie * (completude if completude is not None else 0.0)
    return {
        "lat": lat, "lng": lng,
        "estacao_id": melhor["estacao_id"],
        "dist_km": round(d_melhor, 2),
        "n_150km": n_150,
        "anos": int(melhor.get("anos") or 0),
        "completude": completude,
        "proximidade": round(proximidade, 6),
        "serie": round(serie, 6),
        "confianca": round(conf, 6),
    }


# ---------------------------------------------------------------------------
def cobertura_por_ano(spark, fato):
    """`gold_cobertura`: por estação e ano, quantos dias ela mediu de fato."""
    from pyspark.sql import functions as F

    contrato = json.loads(CONTRATO.read_text(encoding="utf-8"))
    minimo = contrato["tabelas"]["fato_observacao_diaria"]["invariantes"][1]["limiar"]

    return (fato
            .withColumn("ano", F.year("data"))
            .groupBy("estacao_id", "ano")
            .agg(
                F.count("*").cast("int").alias("dias_com_dado"),
                F.sum(F.when(F.col("horas_validas") >= minimo, 1).otherwise(0))
                 .cast("int").alias("dias_completos"),
            )
            # 366 no ano bissexto. Contar 365 sempre daria cobertura > 1 em
            # anos bissextos completos, e um campo declarado entre 0 e 1
            # sairia fora da própria faixa.
            .withColumn("dias_esperados",
                        F.when((F.col("ano") % 4 == 0) &
                               ((F.col("ano") % 100 != 0) | (F.col("ano") % 400 == 0)), 366)
                         .otherwise(365).cast("int"))
            .withColumn("cobertura",
                        F.col("dias_completos") / F.col("dias_esperados"))
            # `confiavel` é uma DECISÃO, declarada aqui e não inferida na tela.
            # 80% dos dias completos é o mesmo limiar que `anos_uteis` usa.
            .withColumn("confiavel", F.col("cobertura") >= 0.8)
            .select("estacao_id", "ano", "dias_esperados", "dias_com_dado",
                    "dias_completos", "cobertura", "confiavel"))


def confianca_na_grade(spark, dim, cob):
    """`gold_confianca`: uma linha por célula de grade."""
    from pyspark.sql import Row, functions as F

    # As estações resumidas: quantos anos e qual a completude média. São
    # centenas de linhas — cabem no driver, e daí viram broadcast.
    resumo = (cob.groupBy("estacao_id")
              .agg(F.count("ano").cast("int").alias("anos"),
                   F.avg("cobertura").alias("completude")))
    estacoes = [r.asDict() for r in
                dim.select("estacao_id", "lat", "lng")
                   .join(resumo, "estacao_id", "inner").collect()]

    # BROADCAST em vez de crossJoin. São 25.600 células x ~600 estações = 15
    # milhões de pares; materializar isso como linhas para depois agrupar é
    # trabalho e embaralhamento à toa quando um dos lados cabe na memória.
    bc = spark.sparkContext.broadcast(estacoes)

    def por_celula(celulas):
        lst = bc.value
        return [Row(**avaliar(lat, lng, lst)) for lat, lng in celulas]

    celulas = grade()
    rdd = spark.sparkContext.parallelize(celulas, 8).mapPartitions(
        lambda it: iter(por_celula(list(it))))
    return spark.createDataFrame(rdd)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--silver", required=True, help="diretório com dim_estacao/ e fato_observacao_diaria/")
    ap.add_argument("--saida")
    a = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import enviar_modulo, gravar, sessao

    spark = sessao("gold_cobertura")
    enviar_modulo(spark, str(Path(__file__).resolve()))
    try:
        # DEDUPLICAÇÃO NA LEITURA, e não é zelo excessivo.
        #
        # Rodando o Silver ano a ano com `--anexar`, a MESMA estação entra na
        # dimensão uma vez por ano — 15 vezes em quinze anos. Chave repetida
        # numa dimensão não quebra nada visivelmente: ela infla o `n_150km` da
        # confiança e faz uma estação pesar quinze na contagem de vizinhas.
        # O mapa sairia mais confiante do que a rede justifica.
        dim = spark.read.parquet(f"{a.silver}/dim_estacao").dropDuplicates(["estacao_id"])
        fato = spark.read.parquet(f"{a.silver}/fato_observacao_diaria")
        cob = cobertura_por_ano(spark, fato).cache()
        conf = confianca_na_grade(spark, dim, cob)
        print(f"  cobertura: {cob.count()} linhas · confianca: {conf.count()} celulas")
        if a.saida:
            gravar(cob, f"{a.saida}/gold_cobertura")
            gravar(conf, f"{a.saida}/gold_confianca")
            print(f"  gravado em {a.saida}")
        else:
            cob.show(5, truncate=False)
            conf.orderBy("confianca").show(5, truncate=False)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
