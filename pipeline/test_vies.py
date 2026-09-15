#!/usr/bin/env python3
"""
pipeline/test_vies.py
=============================================================================
    python pipeline/test_vies.py            (não precisa de Spark)

O M4 é o marco mais fácil de fazer errado de um jeito que PARECE certo, e o
teste central deste arquivo é o que separa as duas coisas:

    um conjunto de estações em que o viés é INTEIRAMENTE altitude.

Se a correção funciona, o resíduo é constante e igual ao viés real. Se não
funciona, o resultado é um mapa de relevo com nome de mapa de erro — suave,
coerente, e completamente enganoso.
=============================================================================
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gold_vies import (  # noqa: E402
    LAPSO_PADRAO, MIN_ESTACOES, ajustar_lapso, estatisticas, por_variavel,
)

CONTRATO = json.loads(
    (Path(__file__).resolve().parent / "contrato" / "esquema.json").read_text(encoding="utf-8"))

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


print("\nas tres estatisticas")

def _basico():
    # obs 20 e 22, modelo 21 e 25 -> diferencas +1 e +3
    #   vies = 2 ; EAM = 2 ; RMSE = sqrt((1+9)/2) = sqrt(5) = 2,23607
    r = estatisticas([(20.0, 21.0), (22.0, 25.0)])
    assert abs(r["vies_medio"] - 2.0) < 1e-12, r
    assert abs(r["erro_absoluto_medio"] - 2.0) < 1e-12, r
    assert abs(r["rmse"] - math.sqrt(5)) < 1e-12, r
    assert r["n_pares"] == 2

ok("vies, EAM e RMSE num caso calculado a mao", _basico)

# O CASO QUE MOSTRA POR QUE OS TRES SAEM JUNTOS. Com diferencas -1 e +3 o vies
# cai para 1 enquanto o EAM continua 2: o sinal se cancela e a magnitude nao.
def _cancelamento():
    r = estatisticas([(20.0, 19.0), (22.0, 25.0)])
    assert abs(r["vies_medio"] - 1.0) < 1e-12, r
    assert abs(r["erro_absoluto_medio"] - 2.0) < 1e-12, r
    assert r["erro_absoluto_medio"] > r["vies_medio"], "o cancelamento sumiu"

ok("vies cancela sinal e EAM nao — por isso os dois existem", _cancelamento)

ok("EAM <= RMSE sempre (Jensen)", lambda: [
    (_ for _ in ()).throw(AssertionError(str(r)))
    for r in [estatisticas([(0.0, 1.0), (0.0, 3.0), (0.0, 10.0)])]
    if not (r["erro_absoluto_medio"] <= r["rmse"] + 1e-12)
])

ok("ausencia nao entra na conta, e nao vira zero", lambda: [
    (_ for _ in ()).throw(AssertionError(str(r)))
    for r in [estatisticas([(20.0, 21.0), (None, 25.0), (22.0, None)])]
    if r["n_pares"] != 1 or abs(r["vies_medio"] - 1.0) > 1e-12
])

ok("sem par nenhum devolve null, e nao zero", lambda: [
    (_ for _ in ()).throw(AssertionError(str(r)))
    for r in [estatisticas([])]
    if r["vies_medio"] is not None or r["n_pares"] != 0
])

print("\no ajuste do gradiente")

# ESTE E O TESTE QUE IMPORTA.
#
# Oito estacoes cujo vies e' EXATAMENTE 1,0 de erro real mais o efeito de
# altitude com gradiente 0,0065 C/m. Um ajuste correto tem que recuperar
# b = 0,0065 e a = 1,0 — e o residuo de todas tem que dar 1,0.
#
# Sem a correcao, o "vies do modelo" iria de 1,0 a 4,25 conforme a altitude, e
# o mapa mostraria as serras erradas e os vales certos.
DELTAS = [-400.0, -250.0, -100.0, 0.0, 100.0, 200.0, 350.0, 500.0]
VIES_REAL = 1.0

def _recupera():
    pts = [(d, VIES_REAL + LAPSO_PADRAO * d) for d in DELTAS]
    b, a, origem = ajustar_lapso(pts)
    assert origem == "ajustado", origem
    assert abs(b - LAPSO_PADRAO) < 1e-12, f"gradiente {b}"
    assert abs(a - VIES_REAL) < 1e-9, f"intercepto {a}"

ok("recupera o gradiente e o vies real de um conjunto sintetico", _recupera)

def _residuo():
    pts = [(d, VIES_REAL + LAPSO_PADRAO * d) for d in DELTAS]
    b, _, _ = ajustar_lapso(pts)
    for d, v in pts:
        residual = v - b * d
        assert abs(residual - VIES_REAL) < 1e-9, f"delta {d}: residuo {residual}"

ok("o residuo fica CONSTANTE: o que sobra e' o erro do modelo", _residuo)

# A prova de que a correcao nao e' cosmetica: SEM ela, o mesmo conjunto produz
# um "vies" que varia 3,25 C so por causa do relevo.
def _sem_correcao():
    brutos = [VIES_REAL + LAPSO_PADRAO * d for d in DELTAS]
    espalhamento = max(brutos) - min(brutos)
    assert espalhamento > 3.0, espalhamento
    assert abs(espalhamento - LAPSO_PADRAO * (max(DELTAS) - min(DELTAS))) < 1e-9

ok("sem corrigir, o mesmo conjunto daria 3,25 C de 'vies' que e' so relevo", _sem_correcao)

def _gradiente_negativo():
    # Inversao: em vale frio o gradiente efetivo perto da superficie pode ate
    # trocar de sinal. O ajuste tem que devolver o que o dado diz, e nao ser
    # grampeado no valor teorico.
    pts = [(d, 1.0 - 0.002 * d) for d in DELTAS]
    b, a, origem = ajustar_lapso(pts)
    assert origem == "ajustado"
    assert b < 0, f"grampeou o gradiente em positivo: {b}"
    assert abs(b + 0.002) < 1e-12

ok("gradiente negativo (inversao) e' devolvido como e', sem grampo", _gradiente_negativo)

print("\nquando o ajuste NAO e' confiavel")

# Uma inclinacao obtida de quatro estacoes e' um numero, nao uma medida.
ok("poucas estacoes: recusa ajustar e diz por que", lambda: [
    (_ for _ in ()).throw(AssertionError(str(r)))
    for r in [ajustar_lapso([(d, 1.0) for d in DELTAS[:MIN_ESTACOES - 1]])]
    if r[0] is not None or r[2] != "insuficiente"
])

# Todas no mesmo planalto: sem espalhamento em x a reta gira livre e a
# inclinacao vira ruido amplificado.
def _sem_espalhamento():
    pts = [(1000.0 + i, 1.0 + 0.01 * i) for i in range(10)]
    b, a, origem = ajustar_lapso(pts)
    assert b is None, f"ajustou com altitudes quase iguais: {b}"
    assert origem == "sem_espalhamento", origem

ok("altitudes parecidas demais: recusa e diz por que", _sem_espalhamento)

print("\nque variaveis se corrige")

# Chuva e vento tambem dependem do relevo, mas nao por uma reta com a altura.
# Aplicar o mesmo ajuste neles seria inventar uma fisica.
ok("so temperatura entra na correcao por altitude", lambda: [
    (_ for _ in ()).throw(AssertionError(v))
    for v in CONTRATO["variaveis"]
    if por_variavel(v, CONTRATO) != (CONTRATO["variaveis"][v]["unidade"] == "°C")
])

ok("as tres temperaturas entram e as duas outras nao", lambda: [
    (_ for _ in ()).throw(AssertionError("temperatura fora"))
    if not all(por_variavel(v, CONTRATO) for v in
               ("temperature_2m_max", "temperature_2m_min", "temperature_2m_mean")) else None,
    (_ for _ in ()).throw(AssertionError("chuva ou vento dentro"))
    if any(por_variavel(v, CONTRATO) for v in
           ("precipitation_sum", "wind_speed_10m_max")) else None,
])

print("\no recuo declarado")

# O gradiente da atmosfera padrao e' 6,5 C/km. Ele existe aqui como RECUO
# declarado, e o codigo marca `padrao:` na origem quando cai nele — senao um
# numero teorico passaria por medido.
ok("o gradiente padrao e' 6,5 C/km", lambda: (_ for _ in ()).throw(
    AssertionError(str(LAPSO_PADRAO))) if abs(LAPSO_PADRAO - 0.0065) > 1e-12 else None)

ok("o contrato registra gold_vies com delta_altitude_m e vies_residual", lambda: [
    (_ for _ in ()).throw(AssertionError(f"falta {c}"))
    for c in ("delta_altitude_m", "vies_residual", "n_pares")
    if c not in CONTRATO["tabelas"]["gold_vies"]["campos"]
])

print("\no pareamento com a Open-Meteo")

from parear_era5 import DIARIAS, VERSOES, ler_resposta, url  # noqa: E402

# A FORMA DA RESPOSTA FOI MEDIDA, NAO SUPOSTA. Campos escalares e um objeto
# `daily` com `time` mais uma lista por variavel — exatamente o que
# tools/medir-fontes.mjs viu em 08/09/2026.
RESPOSTA = {
    "latitude": -23.89, "longitude": -46.42,
    "generationtime_ms": 0.2, "utc_offset_seconds": 0,
    "timezone": "UTC", "timezone_abbreviation": "UTC",
    "elevation": 238.0,
    "daily": {
        "time": ["2024-01-01", "2024-01-02"],
        "temperature_2m_max": [26.3, None],
        "temperature_2m_min": [19.1, 19.4],
        "temperature_2m_mean": [22.4, 22.9],
        "precipitation_sum": [0.0, 12.5],
        "wind_speed_10m_max": [4.1, 6.0],
    },
}

def _forma():
    linhas = ler_resposta("A001", "ERA5", RESPOSTA)
    # 2 dias x 5 variaveis = 10, MENOS o unico null
    assert len(linhas) == 9, f"saiu {len(linhas)} linhas"
    assert all(l["elevacao_modelo"] == 238.0 for l in linhas)
    assert all(l["modelo"] == "ERA5" for l in linhas)

ok("a resposta medida vira linhas de par", _forma)

# `null` na serie e' ausencia de verdade. Virar zero aqui colocaria um dia de
# 0 °C na conta do vies.
def _nulo():
    linhas = ler_resposta("A001", "ERA5", RESPOSTA)
    maximas = [l for l in linhas if l["variavel"] == "temperature_2m_max"]
    assert len(maximas) == 1, f"o null virou linha: {maximas}"
    assert maximas[0]["data"] == "2024-01-01"

ok("null na serie e' descartado, e nao vira zero", _nulo)

# A DECISAO CENTRAL DO M4 DEPOIS DA MEDICAO: sao duas versoes, e a que responde
# "vies do modelo" e' a que desliga o rebaixamento.
def _duas_versoes():
    assert set(VERSOES) == {"ERA5", "ERA5_rebaixado"}, VERSOES.keys()
    assert VERSOES["ERA5"].get("elevation") == "nan", \
        "a versao crua parou de desligar o rebaixamento — ela voltaria a medir o produto rebaixado"
    assert VERSOES["ERA5_rebaixado"] == {}, "a versao do app deixou de ser a rota padrao"

ok("duas versoes, e so a crua passa elevation=nan", _duas_versoes)

def _url():
    u = url(-23.89, -46.42, "2024-01-01", "2024-01-01", VERSOES["ERA5"])
    assert "elevation=nan" in u, u
    assert "timezone=UTC" in u, "sem fuso declarado o dia do modelo escorrega"
    for v in DIARIAS:
        assert v in u, f"a variavel {v} nao foi pedida"

ok("a URL pede as cinco variaveis do contrato, em UTC", _url)

# As chaves pedidas TEM que ser as do contrato: e' o que faz o Parquet cair no
# app sem tradutor.
ok("as diarias pedidas sao exatamente as variaveis do contrato", lambda: (_ for _ in ()).throw(
    AssertionError(f"{sorted(DIARIAS)} != {sorted(CONTRATO['variaveis'])}"))
    if sorted(DIARIAS) != sorted(CONTRATO["variaveis"]) else None)

ok("o contrato aceita as duas versoes em `modelo`", lambda: [
    (_ for _ in ()).throw(AssertionError(f"{v} fora do dominio"))
    for v in VERSOES
    if v not in CONTRATO["tabelas"]["gold_vies"]["campos"]["modelo"]["dominio"]
])

print(f"\n  {mal} FALHA(S)\n" if mal else f"\n  {n} verificacoes\n")
sys.exit(1 if mal else 0)
