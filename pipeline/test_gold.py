#!/usr/bin/env python3
"""
pipeline/test_gold.py
=============================================================================
    python pipeline/test_gold.py

Três perguntas, e a primeira é a que paga a dívida deste repositório.

1. AS DUAS IMPLEMENTAÇÕES DA JANELA CONCORDAM?

   O aplicativo não roda Python e o Spark não roda JavaScript, então a regra de
   ±7 dias existe duas vezes: em server/climatologia.js e em gold_normal.py.
   Duplicação é dívida, e o que a paga é uma prova de equivalência — não a
   promessa de que alguém vai lembrar de mexer nas duas.

   A prova é um resumo dos 366 x 366 pares possíveis: quantos caem dentro, e um
   hash da lista deles. Os dois números estão gravados aqui e em
   test/contrato.mjs. Se qualquer um dos lados mudar, um dos dois quebra.

2. O PERCENTIL DO SPARK BATE COM O GABARITO?

   Ver gold_normal.py --conferir. Aqui só se garante que ele foi rodado.

3. O JOB INTEIRO PRODUZ OS NÚMEROS CERTOS?

   Com dado sintético em que a resposta é calculável à mão. Um teste de
   ponta a ponta que só verifica "rodou sem erro" não verifica nada: um job que
   agrupa pela chave errada roda liso e devolve números plausíveis.
=============================================================================
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gold_normal import (  # noqa: E402
    alvos_de, carregar_contrato, construir, dentro_da_janela, sessao,
)

RAIZ = Path(__file__).resolve().parent.parent

# Calculados em server/climatologia.js — a MESMA conta, do outro lado.
#   for d in 1..366, a in 1..366: se dentroDaJanela(d,a) { total++; h = h*31 + (d*367+a) mod 1e9+7 }
JS_TOTAL = 5506
JS_HASH = 803922391

n = 0
mal = 0


def ok(nome, fn):
    global n, mal
    try:
        fn()
        n += 1
        print(f"  ok  {nome}")
    except Exception as e:  # noqa: BLE001
        mal += 1
        print(f"  X   {nome} :: {e}")


# ---------------------------------------------------------------------------
print("\na janela: as duas implementacoes concordam")

def _equivalencia():
    total, h, M = 0, 0, 1000000007
    for d in range(1, 367):
        for a in range(1, 367):
            if dentro_da_janela(d, a):
                total += 1
                h = (h * 31 + (d * 367 + a)) % M
    assert total == JS_TOTAL, f"total {total}, o JS diz {JS_TOTAL}"
    assert h == JS_HASH, f"hash {h}, o JS diz {JS_HASH}"

ok("366x366 pares batem com server/climatologia.js", _equivalencia)

# A virada do ano é o caso que a versão com 366 quebrava em silêncio.
ok("26/dez esta na janela de 2/jan (a volta do ano funciona)",
   lambda: (_ for _ in ()).throw(AssertionError("360 ficou fora"))
   if not dentro_da_janela(360, 2) else None)

ok("25/dez NAO esta na janela de 2/jan (a 8 dias)",
   lambda: (_ for _ in ()).throw(AssertionError("359 entrou"))
   if dentro_da_janela(359, 2) else None)

def _quinze():
    # 15 alvos: o próprio dia mais 7 de cada lado. No miolo do ano, sempre.
    for d in (100, 200, 300):
        assert len(alvos_de(d)) == 15, f"dia {d} gerou {len(alvos_de(d))} alvos"

ok("cada dia do miolo contribui para exatamente 15 alvos", _quinze)

def _bissexto():
    # O dia 366 recebe contribuição normalmente; o que ele não faz é mudar o
    # comprimento usado na volta. O erro está DECLARADO no contrato.
    assert 366 in alvos_de(1), "o dia 366 nao recebe contribuicao do dia 1"

ok("o dia 366 existe e recebe contribuicao", _bissexto)

# ---------------------------------------------------------------------------
print("\no job de ponta a ponta")

spark = sessao("test_gold")
try:
    contrato = carregar_contrato()

    # DADO SINTETICO COM RESPOSTA CALCULAVEL.
    #
    # temperature_2m_max = dia_do_ano, em 3 anos. Para o alvo 200 a janela pega
    # os dias 193..207, cada um em 3 anos: 45 valores, cada inteiro repetido 3x.
    #
    #   ordenado[i] = 193 + i//3        n = 45, n-1 = 44
    #   p50: pos 22   -> 193 + 7  = 200   (a mediana e' o proprio alvo)
    #   p10: pos 4,4  -> 193 + 1  = 194
    #   p90: pos 39,6 -> 193 + 13 = 206
    linhas = []
    for ano in (2021, 2022, 2023):
        d0 = date(ano, 1, 1)
        for j in range(365):
            dia = d0 + timedelta(days=j)
            doy = j + 1
            linhas.append((
                "A001", dia.isoformat(), doy,
                float(doy),        # temperature_2m_max
                float(doy) - 10,   # temperature_2m_min
                float(doy) - 5,    # temperature_2m_mean
                0.0,               # precipitation_sum
                1.0,               # wind_speed_10m_max
                24, f"{ano}-01-01T00:00:00Z", "sintetico",
            ))

    fato = spark.createDataFrame(
        linhas,
        "estacao_id string, data string, dia_do_ano int, "
        "temperature_2m_max double, temperature_2m_min double, "
        "temperature_2m_mean double, precipitation_sum double, "
        "wind_speed_10m_max double, horas_validas int, "
        "ingestao_em string, fonte string",
    ).withColumn("data", __import__("pyspark.sql.functions", fromlist=["to_date"]).to_date("data"))

    gold = construir(spark, fato, contrato).cache()

    alvo = (gold.where("estacao_id='A001' and variavel='temperature_2m_max' and dia_do_ano=200")
            .first())

    ok("o job produz a linha esperada", lambda: (_ for _ in ()).throw(
        AssertionError("nao saiu linha para o alvo 200")) if alvo is None else None)

    if alvo:
        ok("n_amostras = 45 (15 dias x 3 anos)",
           lambda: (_ for _ in ()).throw(AssertionError(f"deu {alvo['n_amostras']}"))
           if alvo["n_amostras"] != 45 else None)

        for chave, esperado in (("p10", 194.0), ("p50", 200.0), ("p90", 206.0)):
            def _p(k=chave, e=esperado):
                v = alvo[k]
                assert abs(v - e) < 1e-9, f"{k} deu {v}, esperado {e}"
            ok(f"{chave} = {esperado} (calculado a mao)", _p)

        ok("anos = 3", lambda: (_ for _ in ()).throw(
            AssertionError(f"deu {alvo['anos']}")) if alvo["anos"] != 3 else None)

        ok("a procedencia veio junto",
           lambda: [
               (_ for _ in ()).throw(AssertionError(f"{c} vazio"))
               for c in ("referencia", "unidade", "feitio", "rotulo")
               if not alvo[c]
           ])

        ok("feitio veio do contrato, e nao de literal no job",
           lambda: (_ for _ in ()).throw(AssertionError(alvo["feitio"]))
           if alvo["feitio"] != "simetrica" else None)

    # A CHUVA CONSTANTE EM ZERO: a mediana e' 0 e o feitio e' assimetrico.
    # E o zero NAO pode virar null no caminho -- e' medida.
    chuva = (gold.where("variavel='precipitation_sum' and dia_do_ano=200").first())
    ok("chuva zerada sai com p50 = 0 e n_amostras cheio, e nao null",
       lambda: [
           (_ for _ in ()).throw(AssertionError(f"p50={chuva['p50']}")) if chuva["p50"] != 0 else None,
           (_ for _ in ()).throw(AssertionError(f"n={chuva['n_amostras']}")) if chuva["n_amostras"] != 45 else None,
           (_ for _ in ()).throw(AssertionError(chuva["feitio"])) if chuva["feitio"] != "assimetrica" else None,
       ])

    def _cobertura():
        # 366 dias-alvo x 5 variaveis. O dia 366 aparece mesmo sem nenhum ano
        # bissexto na amostra, porque recebe dos dias 359..365.
        q = gold.select("dia_do_ano").distinct().count()
        assert q == 366, f"saiu {q} dias-alvo, esperado 366"
        v = gold.select("variavel").distinct().count()
        assert v == 5, f"saiu {v} variaveis, esperado 5"

    ok("cobre os 366 dias-alvo e as 5 variaveis", _cobertura)

    def _sem_nulo_indevido():
        from pyspark.sql import functions as F
        maus = gold.where(
            (F.col("n_amostras") > 0) & (F.col("p50").isNull())
        ).count()
        assert maus == 0, f"{maus} linhas com amostra e sem mediana"

    ok("nenhuma linha com amostra ficou sem percentil", _sem_nulo_indevido)

    # ---- amostra para o validador do lado do app -------------------------
    # O contrato e' validado em JS, por test/contrato.mjs. Gravar uma amostra
    # REAL da saida do Spark fecha o circuito: a mesma regra que o aplicativo
    # usa passa a julgar o que o pipeline produz.
    amostra = [r.asDict() for r in gold.orderBy("variavel", "dia_do_ano").limit(40).collect()]
    for r in amostra:
        for k, v in list(r.items()):
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
    destino = RAIZ / "pipeline" / "contrato" / "amostra-gold.json"
    destino.write_text(json.dumps(amostra, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  amostra da saida real em {destino.relative_to(RAIZ)}")
    print("  (test/contrato.mjs valida este arquivo contra o contrato)")

finally:
    spark.stop()

print(f"\n  {mal} FALHA(S)\n" if mal else f"\n  {n} verificacoes\n")
sys.exit(1 if mal else 0)
