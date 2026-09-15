#!/usr/bin/env python3
"""
pipeline/exportar_estacoes.py
=============================================================================
M7 · A DIMENSÃO DE ESTAÇÕES, SEM SPARK E SEM NUVEM

    python pipeline/exportar_estacoes.py

Lê `data/bronze/*/*.CSV` e escreve `data/gold/estacoes.json` — a mesma
`dim_estacao` do contrato, no formato que o servidor do aplicativo consome.

-----------------------------------------------------------------------------
POR QUE ISTO EXISTE SEPARADO DO PIPELINE
-----------------------------------------------------------------------------
Porque ele **não precisa de nada**. A dimensão sai das 8 primeiras linhas de
cada arquivo: região, UF, nome, código WMO, latitude, longitude, altitude e
data de fundação. Não há agregação, não há janela, não há percentil — não há
motivo para pagar uma sessão Spark, um runtime de nuvem ou um catálogo por
isso.

E o efeito prático é o que importa: o aplicativo ganha 565 pontos de medição
REAL no globo sem esperar o Databricks. Até aqui todo o trabalho de dados
estava invisível para quem só abre o mapa; este arquivo é o que quebra isso.

A regra de parsing é a MESMA — `ler_estacao`, de `silver_inmet.py`, com as 23
verificações que já existem. Este script é só um caminho diferente até ela.

-----------------------------------------------------------------------------
O QUE ELE DERIVA, E O QUE RECUSA DERIVAR
-----------------------------------------------------------------------------
`anos_com_dado` sai da contagem de arquivos por estação — um arquivo por ano é
a estrutura do ZIP do INMET, e isso é barato e verdadeiro.

`primeiro_dado` e `ultimo_dado` do contrato NÃO saem aqui: eles exigem abrir o
arquivo inteiro e olhar as datas, e o campo ficaria parecido com a verdade sem
ser a verdade (um ano pode ter o arquivo e nenhuma linha medida). Quem preenche
esses dois é a camada Silver, que já lê tudo. Ficam ausentes em vez de
aproximados.

-----------------------------------------------------------------------------
O QUE A PRIMEIRA EXECUÇÃO REAL ENSINOU (15/09/2026)
-----------------------------------------------------------------------------
7.955 arquivos, **616 estações** — e não as 565 de 2024. A diferença são
estações que existiram em algum dos quinze anos e foram desativadas: a
dimensão é o histórico da rede, não a foto de hoje.

E a checagem recusou sete estações LEGÍTIMAS, por erro meu. Eu tinha escrito o
retângulo do Brasil continental e chamado isso de domínio da rede. Ver
`REDE_LAT` abaixo: o INMET opera ilha oceânica e Antártida, e o teto de
altitude de 1600 m não vinha de lugar nenhum.

O guarda estava certo em existir e errado no valor — que é o melhor tipo de
falha, porque aparece na primeira execução e não no mapa três semanas depois.
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from glob import glob
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from silver_inmet import ler_estacao  # noqa: E402


def cabeca(caminho: str, limite: int = 4096) -> str:
    """Os primeiros bytes, em latin-1. Gzip pelos bytes mágicos, não pela extensão."""
    import gzip
    with open(caminho, "rb") as fh:
        dois = fh.read(2)
        if dois == b"\x1f\x8b":
            bruto = gzip.decompress(dois + fh.read())[:limite]
        else:
            bruto = dois + fh.read(limite - 2)
    return bruto.decode("latin-1", errors="replace")


def coletar(padrao: str) -> tuple[list[dict], dict]:
    caminhos = sorted(glob(padrao, recursive=True))
    if not caminhos:
        raise SystemExit(f"nenhum arquivo casou com {padrao!r}")

    por_id: dict[str, dict] = {}
    anos: dict[str, set] = defaultdict(set)
    recusados = 0

    for c in caminhos:
        est, _ = ler_estacao(Path(c).name, cabeca(c))
        if est is None:
            # Formato novo ou arquivo truncado. Contado, não silenciado: uma
            # estação com dados vazios passaria por estação real sem medida.
            recusados += 1
            continue
        eid = est["estacao_id"]
        # O ano vem do diretório (data/bronze/2024/...), que é como o
        # `baixar-inmet.mjs` organiza. Sem diretório de ano, só não conta.
        pai = Path(c).parent.name
        if pai.isdigit():
            anos[eid].add(int(pai))
        # Fica a leitura MAIS RECENTE: a estação pode ter mudado de nome ou de
        # coordenada ao longo dos anos, e o que o mapa mostra é onde ela está
        # hoje. Como `caminhos` está ordenado, o último ano sobrescreve.
        por_id[eid] = est

    for eid, e in por_id.items():
        e["anos_com_dado"] = len(anos.get(eid, ()))
        e["primeiro_ano"] = min(anos[eid]) if anos.get(eid) else None
        e["ultimo_ano"] = max(anos[eid]) if anos.get(eid) else None
        if e.get("fundacao") is not None:
            e["fundacao"] = e["fundacao"].isoformat()

    resumo = {
        "arquivos": len(caminhos),
        "estacoes": len(por_id),
        "recusados": recusados,
    }
    return sorted(por_id.values(), key=lambda e: e["estacao_id"]), resumo


# O retângulo do Brasil CONTINENTAL. Não é o domínio da rede — ver abaixo.
CONT_LAT = (-34.0, 6.0)
CONT_LNG = (-74.0, -34.0)

# O domínio de verdade: a jurisdição onde o INMET opera.
#
# A PRIMEIRA VERSÃO DESTE ARQUIVO USAVA O RETÂNGULO CONTINENTAL E RECUSOU SETE
# ESTAÇÕES LEGÍTIMAS. Eu tinha escrito "o Brasil vai de -34 a 6 de latitude",
# que é verdade sobre o CONTINENTE e falso sobre a REDE:
#
#   ilhas oceânicas   Trindade (-20,5 / -29,3), São Pedro e São Paulo
#                     (0,9 / -29,3), Fernando de Noronha, Atol das Rocas
#   Antártida         o Programa Antártico Brasileiro opera estações lá
#   altitude          o teto de 1600 m saiu de lugar nenhum; o ponto mais alto
#                     do país tem 2995 m e há estação medindo a 2450 m
REDE_LAT = (-90.0, 6.0)
REDE_LNG = (-74.0, -28.0)
REDE_ALT = (-10.0, 3000.0)


def dentro(v, faixa) -> bool:
    return v is not None and faixa[0] <= v <= faixa[1]


def conferir(estacoes: list[dict]) -> tuple[list[str], list[dict]]:
    """Separa o que é IMPOSSÍVEL do que é apenas INCOMUM.

    O aplicativo vai desenhar isto num globo, e uma latitude com sinal trocado
    põe a estação no hemisfério errado — ninguém percebe olhando a tabela,
    percebe olhando o mapa, tarde. Por isso existe a checagem.

    Mas recusar tudo que sai do continente foi o erro oposto: apagar sete
    estações reais porque a minha caixa estava errada. As duas coisas precisam
    ser distinguidas:

      RECUSA    a coordenada não pode existir na operação do INMET. Não grava.
      MARCA     existe, mas fora do continente. Grava COM sinalização, e o
                relatório mostra nome e UF para quem lê poder julgar.

    A caixa larga só é segura por causa da marca: a exceção fica visível em vez
    de virar um ponto solitário no mapa que ninguém sabe explicar.
    """
    recusas, incomuns = [], []
    for e in estacoes:
        i, nome, uf = e["estacao_id"], e.get("nome") or "?", e.get("uf") or "??"
        etiqueta = f"{i} · {nome} ({uf})"

        if not dentro(e["lat"], REDE_LAT):
            recusas.append(f"{etiqueta}: lat {e['lat']} impossível")
        if not dentro(e["lng"], REDE_LNG):
            recusas.append(f"{etiqueta}: lng {e['lng']} impossível")
        if e["regiao"] not in ("N", "NE", "CO", "SE", "S"):
            recusas.append(f"{etiqueta}: regiao {e['regiao']!r} fora do domínio")
        if e["altitude_m"] is not None and not dentro(e["altitude_m"], REDE_ALT):
            recusas.append(f"{etiqueta}: altitude {e['altitude_m']} impossível")

        # LAT E LNG TROCADAS é o erro que uma caixa larga deixaria passar, e ele
        # é comum o bastante para merecer teste próprio: no Brasil a longitude é
        # sempre mais negativa que a latitude, e a troca põe a estação no mar.
        if (e["lat"] is not None and e["lng"] is not None
                and dentro(e["lng"], CONT_LAT) and dentro(e["lat"], CONT_LNG)):
            recusas.append(f"{etiqueta}: lat e lng parecem TROCADAS "
                           f"({e['lat']}, {e['lng']})")

        fora = not (dentro(e["lat"], CONT_LAT) and dentro(e["lng"], CONT_LNG))
        e["fora_do_continente"] = fora
        if fora:
            incomuns.append(e)
    return recusas, incomuns


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entrada", default=str(RAIZ / "data" / "bronze" / "*" / "*.CSV*"))
    ap.add_argument("--saida", default=str(RAIZ / "data" / "gold" / "estacoes.json"))
    a = ap.parse_args()

    estacoes, resumo = coletar(a.entrada)
    print(f"  {resumo['arquivos']} arquivos · {resumo['estacoes']} estações"
          + (f" · {resumo['recusados']} recusados" if resumo["recusados"] else ""))

    recusas, incomuns = conferir(estacoes)
    if recusas:
        print(f"\n  {len(recusas)} coordenada(s) impossível(is):")
        for p in recusas[:12]:
            print("    " + p)
        print("\n  NÃO gravei. Coordenada errada num mapa é pior que mapa vazio.")
        return 1

    if incomuns:
        # Fora do continente NÃO é erro — é onde o INMET também opera. Aparece
        # para ser conferido pelo nome, não para ser corrigido.
        print(f"\n  {len(incomuns)} estação(ões) fora do Brasil continental,"
              " gravadas e marcadas:")
        for e in incomuns:
            print(f"    {e['estacao_id']} · {e.get('nome')} ({e.get('uf')})"
                  f"  {e['lat']:.2f}, {e['lng']:.2f}"
                  + (f"  {e['altitude_m']:.0f} m" if e.get("altitude_m") is not None else ""))
        print("    (confira pelo nome: ilha oceânica e base antártica são esperadas)")

    saida = Path(a.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps({
        "fonte": "INMET · rede automática · dados históricos",
        "licenca": "dados públicos federais (LAI 12.527/2011); atribuição ao INMET",
        "gerado_de": resumo["arquivos"],
        "estacoes": estacoes,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    kb = saida.stat().st_size / 1024
    print(f"  gravado em {saida}  ({kb:.0f} kB)")

    # Uma leitura rápida do que saiu — a rede cresceu, e isso é conteúdo.
    porreg: dict[str, int] = defaultdict(int)
    for e in estacoes:
        porreg[e["regiao"]] += 1
    print("  por região: " + " · ".join(f"{k} {v}" for k, v in sorted(porreg.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
