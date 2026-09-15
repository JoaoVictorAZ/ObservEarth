#!/usr/bin/env python3
"""
pipeline/test_cobertura.py
=============================================================================
    python pipeline/test_cobertura.py       (não precisa de Spark)

O índice de confiança é a peça mais fácil de escrever errado sem ninguém
perceber, porque toda saída dele é um número entre 0 e 1 e todo número entre 0
e 1 parece plausível. Os testes abaixo fixam os pontos em que ele TEM que dar
um valor específico, calculado à mão.
=============================================================================
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gold_cobertura import (  # noqa: E402
    ANOS_CHEIOS, ESCALA_KM, LAT0, LAT1, LNG0, LNG1, PASSO,
    avaliar, grade, haversine,
)

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


print("\ndistancia")

# Um grau de latitude = 111,19 km na esfera de raio médio. É o número que
# permite conferir a fórmula sem confiar nela.
ok("um grau de latitude da 111,19 km", lambda: (_ for _ in ()).throw(
    AssertionError(f"{haversine(0,0,1,0):.3f}"))
    if abs(haversine(0, 0, 1, 0) - 111.195) > 0.01 else None)

ok("o mesmo ponto da zero", lambda: (_ for _ in ()).throw(
    AssertionError()) if haversine(-15, -47, -15, -47) != 0 else None)

# Um grau de LONGITUDE encolhe com o cosseno da latitude. Uma fórmula que
# tratasse lat e lng como equivalentes daria o mesmo valor nos dois, e o erro
# só apareceria longe do equador.
ok("um grau de longitude encolhe com a latitude", lambda: [
    (_ for _ in ()).throw(AssertionError("no equador nao bateu"))
    if abs(haversine(0, 0, 0, 1) - 111.195) > 0.01 else None,
    (_ for _ in ()).throw(AssertionError(f"{haversine(60,0,60,1):.2f}"))
    if abs(haversine(60, 0, 60, 1) - 111.195 * math.cos(math.radians(60))) > 0.2 else None,
])

print("\na grade")

g = grade()

ok("a grade cobre o retangulo do Brasil em 0,25 grau", lambda: (_ for _ in ()).throw(
    AssertionError(f"{len(g)} celulas"))
    if len(g) != int(round((LAT1 - LAT0) / PASSO)) * int(round((LNG1 - LNG0) / PASSO)) else None)

# Os centros ficam DENTRO do retângulo: uma célula cujo centro caísse na borda
# violaria o domínio declarado de lat/lng no contrato.
ok("todo centro de celula cai dentro do dominio do contrato", lambda: [
    (_ for _ in ()).throw(AssertionError(f"{lat},{lng}"))
    for lat, lng in g
    if not (LAT0 <= lat <= LAT1 and LNG0 <= lng <= LNG1)
])

print("\no indice de confianca")

PERTO = {"estacao_id": "A001", "lat": -15.0, "lng": -47.0, "anos": 15, "completude": 1.0}

# Em cima da estação, com série cheia e completude cheia: a confiança é 1.
# Qualquer outro valor aqui significa que um dos fatores está mal normalizado.
ok("em cima de uma estacao perfeita a confianca e' 1", lambda: (_ for _ in ()).throw(
    AssertionError(str(avaliar(-15.0, -47.0, [PERTO]))))
    if abs(avaliar(-15.0, -47.0, [PERTO])["confianca"] - 1.0) > 1e-9 else None)

def _decai():
    # A 150 km — a escala da fórmula — a proximidade tem que valer exatamente
    # 1/e. É o ponto que define a escala, e o único que a verifica.
    r = avaliar(-15.0 - 150 / 111.195, -47.0, [PERTO])
    assert abs(r["proximidade"] - math.exp(-1)) < 1e-3, f"proximidade {r['proximidade']}"

ok("a 150 km a proximidade e' 1/e (0,3679)", _decai)

def _produto():
    # Metade da série e metade da completude: 0,25 do que seria, e não 0,5.
    # Uma média daria 0,75 e pintaria a célula como bem conhecida.
    e = {**PERTO, "anos": ANOS_CHEIOS // 2, "completude": 0.5}
    r = avaliar(-15.0, -47.0, [e])
    esperado = 1.0 * (7 / 15) * 0.5
    assert abs(r["confianca"] - esperado) < 1e-6, f"{r['confianca']} != {esperado}"

ok("os fatores MULTIPLICAM, e nao tiram media", _produto)

def _serie_curta():
    r = avaliar(-15.0, -47.0, [{**PERTO, "anos": 1}])
    # 1e-6 e nao 1e-9: `avaliar` arredonda os fatores em 6 casas de proposito —
    # e' um indice em 0..1, nao uma medida, e 17 digitos ali sugeririam uma
    # precisao que a formula nao tem. O teste cobra a precisao PROMETIDA.
    assert abs(r["serie"] - 1 / 15) < 1e-6, f"serie {r['serie']}"
    # Uma estação em cima do ponto com 1 ano de dados NÃO torna a célula
    # conhecida. Este é o caso que justifica o produto.
    assert r["confianca"] < 0.07, f"1 ano de dados deu confianca {r['confianca']}"

ok("estacao colada com 1 ano nao torna a celula conhecida", _serie_curta)

print("\nquando nao ha estacao")

def _vazio():
    r = avaliar(-3.0, -60.0, [])           # meio da Amazônia, sem estação
    assert r["confianca"] == 0.0, "confianca deveria ser 0"
    assert r["n_150km"] == 0
    # Distância a uma estação inexistente NÃO é um número grande: é a ausência
    # de número. Um 9999 aqui entraria em qualquer média depois.
    assert r["dist_km"] is None, f"dist_km virou {r['dist_km']}"
    assert r["estacao_id"] is None
    assert r["completude"] is None

ok("sem estacao: confianca 0, mas dist_km e completude sao null", _vazio)

def _sem_completude():
    # Estação sem cobertura calculada não pode virar confiança alta por
    # omissão. Faltar o fator é o mesmo que ele valer zero.
    r = avaliar(-15.0, -47.0, [{**PERTO, "completude": None}])
    assert r["confianca"] == 0.0, f"deu {r['confianca']}"

ok("completude ausente nao vira 1 por omissao", _sem_completude)

print("\ncontagem no raio")

def _raio():
    ests = [
        {"estacao_id": "A001", "lat": -15.0, "lng": -47.0, "anos": 15, "completude": 1.0},
        {"estacao_id": "A002", "lat": -15.5, "lng": -47.0, "anos": 15, "completude": 1.0},  # ~56 km
        {"estacao_id": "A003", "lat": -18.0, "lng": -47.0, "anos": 15, "completude": 1.0},  # ~334 km
    ]
    r = avaliar(-15.0, -47.0, ests)
    assert r["n_150km"] == 2, f"contou {r['n_150km']}"
    assert r["estacao_id"] == "A001", "a mais proxima nao foi a escolhida"

ok("conta as estacoes dentro de 150 km e escolhe a mais proxima", _raio)

print("\nos limites declarados no contrato")

def _faixas():
    import json
    C = json.loads((Path(__file__).resolve().parent / "contrato" / "esquema.json")
                   .read_text(encoding="utf-8"))
    campos = C["tabelas"]["gold_confianca"]["campos"]
    r = avaliar(-15.0, -47.0, [PERTO])
    for k, v in r.items():
        spec = campos.get(k)
        assert spec, f"campo {k} fora do contrato"
        if v is None:
            assert not spec["obrigatorio"], f"{k} obrigatorio veio null"
            continue
        if spec.get("min") is not None:
            assert v >= spec["min"], f"{k}={v} abaixo de {spec['min']}"
        if spec.get("max") is not None:
            assert v <= spec["max"], f"{k}={v} acima de {spec['max']}"

ok("a saida respeita os dominios declarados em gold_confianca", _faixas)

# A ressalva sobre chuva tem que continuar escrita: com uma escala unica de
# 150 km o indice e' OTIMISTA para precipitacao, que decorrelaciona em dezenas
# de km. Apagar isso transformaria uma simplificacao declarada em silencio.
def _ressalva():
    import json
    C = json.loads((Path(__file__).resolve().parent / "contrato" / "esquema.json")
                   .read_text(encoding="utf-8"))
    f = C["algoritmos"]["confianca"]["fatores"]["proximidade"]
    assert str(ESCALA_KM) in f["conta"] or "150" in f["conta"], "a escala do codigo saiu do contrato"
    assert len(f.get("erroDeclarado", "")) > 60, "sumiu a ressalva sobre chuva"

ok("o contrato mantem a ressalva de que o indice e' otimista para chuva", _ressalva)

print(f"\n  {mal} FALHA(S)\n" if mal else f"\n  {n} verificacoes\n")
sys.exit(1 if mal else 0)
