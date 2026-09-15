#!/usr/bin/env python3
"""
pipeline/gold_vies.py
=============================================================================
M4 · GOLD B — quanto o modelo erra contra o termômetro, e quanto disso é relevo

    silver/fato + pares(ERA5)  ->  gold/gold_vies

-----------------------------------------------------------------------------
POR QUE ESTE É O MARCO QUE VALE MAIS, E O QUE MAIS ERRA EM SILÊNCIO
-----------------------------------------------------------------------------
Ele produz uma afirmação SOBRE A CONFIABILIDADE de todas as outras afirmações
do aplicativo: *"neste ponto o modelo erra sistematicamente +2,1 °C em
setembro"*. E ela compõe com a previsão — *"o modelo diz 31 °C; aqui ele
costuma errar +2 °C nesta época"*.

E é o mais fácil de fazer errado de um jeito que parece certo, por um motivo
só: **uma boa parte do que se chamaria de "viés do modelo" é diferença de
altitude, não erro de modelo.**

Uma célula de reanálise tem dezenas de quilômetros de lado e UMA altitude
média. A estação está num ponto dessa célula, e pode estar 400 m acima ou
abaixo dessa média. O ar esfria com a altura; então o modelo, que representa a
altitude média da célula, sai sistematicamente mais quente que uma estação de
serra e mais frio que uma de vale — sem errar nada.

Publicar isso como "viés do modelo" produziria um mapa de relevo com nome de
mapa de erro. E ele pareceria perfeitamente plausível: as serras vermelhas, os
vales azuis, tudo suave e coerente.

-----------------------------------------------------------------------------
COMO SE SEPARA UMA COISA DA OUTRA
-----------------------------------------------------------------------------
Para cada (modelo, variável, mês), ajusta-se uma reta entre as estações:

    vies_i  =  a  +  b · delta_altitude_i

    b  a inclinação — o efeito de altitude, em °C por metro. Se a física
       manda, ela fica perto de +0,0065 °C/m (6,5 °C/km, o gradiente da
       atmosfera padrão), porque estação MAIS ALTA que a célula observa mais
       frio e o viés (modelo − obs) fica positivo.
    a  o intercepto — o viés que SOBRA depois de tirar a altitude. É este o
       número que interessa, e é o único que se pode chamar de viés do modelo.

    vies_residual_i = vies_i − b · delta_altitude_i

O gradiente é **ajustado do próprio dado**, e não cravado em 6,5 °C/km. Cravar
seria assumir a resposta: o gradiente perto da superfície não é o da atmosfera
livre — inversão noturna, vale frio, encosta ensolarada, tudo isso muda o
número, e às vezes troca o sinal. Comparar o `b` ajustado com o 6,5 teórico é
uma das coisas mais informativas que este pipeline produz.

Quando não há estações suficientes ou elas têm altitudes parecidas demais, o
ajuste não é confiável e o código **diz isso** (`lapso_origem = "padrao"` ou
`"insuficiente"`) em vez de devolver um número instável com cara de medida.

-----------------------------------------------------------------------------
E O QUE NÃO SE CORRIGE
-----------------------------------------------------------------------------
Só temperatura. Chuva e vento também dependem do relevo — orografia, canal de
vale, exposição — mas não por um gradiente linear com a altura. Aplicar a mesma
reta neles seria inventar uma física. Para essas variáveis o `delta_altitude_m`
sai registrado e o `vies_residual` é igual ao `vies_medio`, com
`lapso_origem = "nao_aplicavel"`.
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

# Gradiente da atmosfera padrão, em °C por metro. Usado só como recuo
# declarado, nunca como resposta.
LAPSO_PADRAO = 0.0065
# Abaixo disto o ajuste não é confiável: poucas estações, ou todas na mesma
# altitude — nos dois casos a inclinação é ruído com cara de medida.
MIN_ESTACOES = 5
MIN_DESVIO_ALTITUDE_M = 50.0


def estatisticas(pares: list[tuple[float, float]]) -> dict:
    """`pares` são (observado, modelado). Devolve viés, EAM, RMSE e n.

    Os três números respondem coisas diferentes e por isso os três saem:
      viés   tem sinal — diz para que lado o modelo erra, e é o que se corrige
      EAM    magnitude típica do erro
      RMSE   pesa mais os erros grandes; RMSE >> EAM significa que há episódios
             ruins, e não um erro constante

    `EAM <= RMSE` sempre, por Jensen. O contrato tem essa invariante, e violá-la
    denuncia erro de agregação.
    """
    d = [m - o for o, m in pares
         if o is not None and m is not None
         and math.isfinite(o) and math.isfinite(m)]
    n = len(d)
    if n == 0:
        return {"vies_medio": None, "erro_absoluto_medio": None, "rmse": None, "n_pares": 0}
    return {
        "vies_medio": sum(d) / n,
        "erro_absoluto_medio": sum(abs(x) for x in d) / n,
        "rmse": math.sqrt(sum(x * x for x in d) / n),
        "n_pares": n,
    }


def ajustar_lapso(pontos: list[tuple[float, float]]) -> tuple[float | None, float | None, str]:
    """Mínimos quadrados de `vies = a + b*delta`, sobre as estações.

    `pontos` são (delta_altitude_m, vies_medio).
    Devolve (b, a, origem) — `b` em °C/m.

    Recusa ajustar quando o resultado seria instável, e diz por quê. Uma
    inclinação obtida de quatro estações todas no mesmo planalto é um número,
    não uma medida.
    """
    xs = [x for x, y in pontos if x is not None and y is not None
          and math.isfinite(x) and math.isfinite(y)]
    ys = [y for x, y in pontos if x is not None and y is not None
          and math.isfinite(x) and math.isfinite(y)]
    n = len(xs)
    if n < MIN_ESTACOES:
        return None, None, "insuficiente"

    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    # Desvio padrão populacional das altitudes relativas. Sem espalhamento em x
    # não há como separar inclinação de intercepto: a reta gira livre.
    if math.sqrt(sxx / n) < MIN_DESVIO_ALTITUDE_M or sxx == 0:
        return None, None, "sem_espalhamento"

    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return b, my - b * mx, "ajustado"


def por_variavel(variavel: str, contrato: dict) -> bool:
    """A correção por altitude só faz sentido em temperatura. Ver a docstring."""
    v = contrato["variaveis"].get(variavel)
    return bool(v and v["unidade"] == "°C")


def construir(spark, pares, dim, contrato: dict, modelo: str = "ERA5"):
    """`pares` precisa das colunas:

        estacao_id, data, variavel, valor_obs, valor_modelo, elevacao_modelo

    `elevacao_modelo` é a altitude da CÉLULA do modelo, e ela vem da própria
    resposta da fonte — não de um modelo digital de terreno nosso. Misturar as
    duas mediria a diferença entre dois DEMs junto com o viés.
    """
    from pyspark.sql import Row, functions as F

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import enviar_modulo
    enviar_modulo(spark, str(Path(__file__).resolve()))

    # ---- 1. as estatísticas por estação, variável e mês ------------------
    # POR MÊS, e não por ano: o viés é sazonal, e a média anual o esconde. Um
    # modelo que erra +3 °C no inverno e −3 °C no verão tem viés anual zero.
    base = (pares
            .withColumn("mes", F.month("data"))
            .withColumn("d", F.col("valor_modelo") - F.col("valor_obs"))
            .where(F.col("d").isNotNull())
            .groupBy("estacao_id", "variavel", "mes")
            .agg(
                F.avg("d").alias("vies_medio"),
                F.avg(F.abs(F.col("d"))).alias("erro_absoluto_medio"),
                F.sqrt(F.avg(F.col("d") * F.col("d"))).alias("rmse"),
                F.count("d").cast("int").alias("n_pares"),
                F.first("elevacao_modelo").alias("elevacao_modelo"),
            ))

    com_alt = (base
               .join(dim.select("estacao_id", F.col("altitude_m").alias("alt_est")),
                     "estacao_id", "inner")
               .withColumn("delta_altitude_m", F.col("alt_est") - F.col("elevacao_modelo")))

    # ---- 2. o gradiente, ajustado por (variável, mês) --------------------
    # No driver: são no máximo 5 variáveis x 12 meses = 60 ajustes sobre
    # centenas de pontos cada. Levar isso para o cluster seria orquestração
    # para um cálculo que cabe numa função.
    pontos = com_alt.select("variavel", "mes", "delta_altitude_m", "vies_medio").collect()
    porGrupo: dict[tuple[str, int], list[tuple[float, float]]] = {}
    for r in pontos:
        porGrupo.setdefault((r["variavel"], r["mes"]), []).append(
            (r["delta_altitude_m"], r["vies_medio"]))

    lapsos = []
    for (var, mes), pts in porGrupo.items():
        if not por_variavel(var, contrato):
            lapsos.append(Row(variavel=var, mes=mes, lapso=None,
                              lapso_intercepto=None, lapso_origem="nao_aplicavel"))
            continue
        b, a, origem = ajustar_lapso(pts)
        if b is None:
            # Recuo DECLARADO: usa o gradiente da atmosfera padrão e diz que
            # usou. Silenciar isso faria um número teórico passar por medido.
            lapsos.append(Row(variavel=var, mes=mes, lapso=LAPSO_PADRAO,
                              lapso_intercepto=None, lapso_origem=f"padrao:{origem}"))
        else:
            lapsos.append(Row(variavel=var, mes=mes, lapso=float(b),
                              lapso_intercepto=float(a), lapso_origem=origem))

    tabLapso = spark.createDataFrame(lapsos)

    # ---- 3. o resíduo ----------------------------------------------------
    saida = (com_alt
             .join(F.broadcast(tabLapso), ["variavel", "mes"], "left")
             .withColumn("modelo", F.lit(modelo))
             .withColumn("vies_residual",
                         F.when(F.col("lapso").isNull(), F.col("vies_medio"))
                          .otherwise(F.col("vies_medio")
                                     - F.col("lapso") * F.col("delta_altitude_m")))
             .select("estacao_id", "modelo", "variavel", "mes",
                     "vies_medio", "erro_absoluto_medio", "rmse", "n_pares",
                     "delta_altitude_m", "vies_residual",
                     "lapso", "lapso_origem"))
    return saida


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pares", required=True, help="parquet com obs x modelo pareados")
    ap.add_argument("--dim", required=True, help="parquet de dim_estacao")
    ap.add_argument("--saida")
    ap.add_argument("--modelo", default="ERA5")
    a = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import enviar_modulo, gravar, sessao

    spark = sessao("gold_vies")
    try:
        contrato = json.loads(CONTRATO.read_text(encoding="utf-8"))
        s = construir(spark, spark.read.parquet(a.pares),
                      spark.read.parquet(a.dim), contrato, a.modelo)
        print(f"  {s.count()} linhas")
        if a.saida:
            gravar(s, a.saida)
            print(f"  gravado em {a.saida}")
        else:
            s.orderBy("variavel", "mes").show(20, truncate=False)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
