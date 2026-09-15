#!/usr/bin/env python3
"""
pipeline/parear_era5.py
=============================================================================
M4 · o pareamento — a série do modelo nas coordenadas de cada estação

    python pipeline/parear_era5.py --dim data/silver/dim_estacao \\
        --inicio 2010-01-01 --fim 2024-12-31 --saida data/pares

-----------------------------------------------------------------------------
DUAS VERSÕES DO MESMO MODELO, E ISSO NÃO É REDUNDÂNCIA
-----------------------------------------------------------------------------
Medido em 08/09/2026 (`tools/medir-fontes.mjs`): a rota padrão da Open-Meteo
**rebaixa o valor por altitude** antes de devolver. O campo `elevation` que ela
retorna é a altitude do PONTO, num DEM fino — não a média da célula.

    Cubatão (-23,89; -46,42)        elevation = 5 m     tmax = 27,4 °C
    Paranapiacaba (-23,78; -46,30)  elevation = 824 m   tmax = 22,9 °C

São 17 km um do outro. Uma célula de reanálise não tem 819 m de degrau interno:
isso é DEM fino. E `elevation=nan` desliga o rebaixamento —

    Cubatão com elevation=nan       elevation = 238 m   tmax = 26,3 °C

238 m é a orografia da célula. Então buscamos as DUAS séries, porque elas
respondem perguntas diferentes:

    ERA5             valor cru da célula. Responde "quanto o MODELO erra",
                     depois de separar altitude. É o viés de modelo.

    ERA5_rebaixado   valor da rota padrão. Responde "quanto erra O PRODUTO QUE
                     O APLICATIVO CONSOME" — `server/climatologia.js` usa
                     exatamente este caminho.

**A diferença entre os dois mede a qualidade do rebaixamento da Open-Meteo.**
Esse número não existe em lugar nenhum, e é ele que diz se o aplicativo pode
confiar na própria rota climatológica.

De brinde, a medição já contradisse o gradiente teórico: +1,1 °C ao descer
233 m dá 4,7 °C/km, não os 6,5 da atmosfera padrão. Mais um motivo para o M4
ajustar o gradiente do próprio dado em vez de cravar.

-----------------------------------------------------------------------------
ORÇAMENTO
-----------------------------------------------------------------------------
Duas requisições por estação (uma por versão), 565 estações = ~1130 chamadas,
UMA VEZ. O teto do projeto é ¼ do free tier. O script guarda cada resposta em
disco e pula o que já baixou: reprocessar não gasta cota, e uma queda no meio
não obriga a recomeçar.
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://archive-api.open-meteo.com/v1/archive"

# As chaves são as do contrato — as mesmas que o aplicativo já fala.
DIARIAS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "precipitation_sum",
    "wind_speed_10m_max",
]

VERSOES = {
    # rota padrão: já rebaixada para o ponto pela Open-Meteo
    "ERA5_rebaixado": {},
    # `elevation=nan` devolve o valor cru da célula, e `elevation` na resposta
    # passa a ser a orografia do modelo
    "ERA5": {"elevation": "nan"},
}


def url(lat: float, lng: float, inicio: str, fim: str, extra: dict) -> str:
    q = {
        "latitude": f"{lat:.4f}", "longitude": f"{lng:.4f}",
        "start_date": inicio, "end_date": fim,
        "daily": ",".join(DIARIAS),
        "timezone": "UTC",
        **extra,
    }
    return BASE + "?" + "&".join(f"{k}={v}" for k, v in q.items())


def ler_resposta(estacao_id: str, versao: str, j: dict) -> list[dict]:
    """A resposta da Open-Meteo -> linhas de par, no formato que `gold_vies` espera.

    A forma foi medida, não suposta: campos escalares `latitude`, `longitude`,
    `generationtime_ms`, `utc_offset_seconds`, `timezone`,
    `timezone_abbreviation`, `elevation`; e um objeto `daily` com `time` mais
    uma lista por variável pedida.
    """
    d = j.get("daily") or {}
    tempos = d.get("time") or []
    elev = j.get("elevation")
    linhas = []
    for i, t in enumerate(tempos):
        for var in DIARIAS:
            serie = d.get(var)
            if not serie or i >= len(serie):
                continue
            v = serie[i]
            # `null` é ausência de verdade na resposta da Open-Meteo. Não vira
            # zero aqui nem em lugar nenhum — ver a regra de ausência do
            # contrato.
            if v is None:
                continue
            linhas.append({
                "estacao_id": estacao_id,
                "data": t,
                "variavel": var,
                "modelo": versao,
                "valor_modelo": float(v),
                "elevacao_modelo": float(elev) if elev is not None else None,
            })
    return linhas


def baixar(lat, lng, inicio, fim, versao, destino: Path, pausa=1.2) -> dict | None:
    """Baixa e guarda em disco. Se o arquivo já existe, NÃO gasta cota."""
    if destino.exists():
        try:
            return json.loads(destino.read_text(encoding="utf-8"))
        except Exception:
            destino.unlink()          # arquivo truncado de uma queda anterior
    u = url(lat, lng, inicio, fim, VERSOES[versao])
    try:
        with urllib.request.urlopen(u, timeout=90) as r:
            j = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"    falhou: {e}")
        return None
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(j), encoding="utf-8")
    # A pausa é cortesia com um serviço gratuito, não exigência técnica.
    time.sleep(pausa)
    return j


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dim", required=True, help="parquet ou json de dim_estacao")
    ap.add_argument("--inicio", default="2010-01-01")
    ap.add_argument("--fim", default="2024-12-31")
    ap.add_argument("--cache", default="data/bronze/era5")
    ap.add_argument("--saida", help="onde gravar os pares (parquet)")
    ap.add_argument("--limite", type=int, help="parar depois de N estações (para ensaio)")
    a = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import gravar, sessao

    spark = sessao("parear_era5")
    try:
        # `dropDuplicates`: rodando o Silver ano a ano, a mesma estação entra
        # na dimensão uma vez por ano. Sem isto, baixaríamos a série do modelo
        # 15 vezes para o mesmo ponto — 15x a cota, para o mesmo número.
        dim = (spark.read.json(a.dim) if a.dim.endswith(".json")
               else spark.read.parquet(a.dim)).dropDuplicates(["estacao_id"])
        estacoes = [r.asDict() for r in dim.select("estacao_id", "lat", "lng").collect()]
        if a.limite:
            estacoes = estacoes[:a.limite]
        print(f"  {len(estacoes)} estações × {len(VERSOES)} versões = "
              f"{len(estacoes) * len(VERSOES)} requisições (só as que faltarem)")

        cache = Path(a.cache)
        todas = []
        for k, e in enumerate(estacoes, 1):
            for versao in VERSOES:
                alvo = cache / versao / f"{e['estacao_id']}.json"
                novo = not alvo.exists()
                j = baixar(e["lat"], e["lng"], a.inicio, a.fim, versao, alvo)
                if j:
                    todas.extend(ler_resposta(e["estacao_id"], versao, j))
                if novo:
                    print(f"  [{k}/{len(estacoes)}] {e['estacao_id']} {versao}")

        if not todas:
            print("  nada baixado")
            return 1
        df = spark.createDataFrame(todas)
        print(f"  {df.count()} linhas de modelo")
        if a.saida:
            gravar(df, a.saida)
            print(f"  gravado em {a.saida}")
        else:
            df.show(5, truncate=False)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
