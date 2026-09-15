#!/usr/bin/env python3
"""
pipeline/silver_inmet.py
=============================================================================
M1+M2 · BRONZE -> SILVER — o CSV horário do INMET vira fato diário e dimensão

    bronze/{ano}/*.CSV  ->  silver/fato_observacao_diaria  +  silver/dim_estacao

-----------------------------------------------------------------------------
O FORMATO AQUI NÃO É SUPOSTO. FOI MEDIDO EM 08/09/2026
-----------------------------------------------------------------------------
`tools/medir-fontes.mjs --inmet 2024`, sobre o arquivo real
INMET_CO_DF_A001_BRASILIA_01-01-2024_A_31-12-2024.CSV:

    565 estações no ZIP do ano       98 MB comprimido, ~793 kB por CSV
    codificação  LATIN-1             o cabeçalho tem PRECIPITAÇÃO, °C, Kj/m²
    separador    ";"
    decimal      VÍRGULA             float("21,4") levanta ValueError; pior,
                                     em outras linguagens trunca em silêncio
    8 linhas de metadados, cabeçalho na 9, dado a partir da 10
    20 colunas, e a última é VAZIA   toda linha termina em ";"
    8784 linhas de dado em 2024      366 x 24: o ano fecha certo

E A CORREÇÃO QUE IMPORTA:

    -9999 NÃO APARECE. Nenhuma vez.

Eu tinha escrito o contrato prevendo a sentinela clássica do INMET, e o arquivo
de 2024 diz outra coisa: ausência é **campo vazio**, 4284 vezes só nesta
estação. A proibição de -9999 fica no contrato — anos antigos podem usá-la, e
custa nada continuar recusando — mas o parser tem que tratar o vazio, que é o
caso real e o que passaria despercebido.

-----------------------------------------------------------------------------
AS TRÊS ARMADILHAS DESTE ARQUIVO
-----------------------------------------------------------------------------

1. A MÁXIMA DIÁRIA NÃO SAI DA COLUNA HORÁRIA.

   Há duas temperaturas no CSV: `TEMPERATURA DO AR - BULBO SECO, HORARIA`, que
   é o valor NO instante da leitura, e `TEMPERATURA MÁXIMA NA HORA ANT. (AUT)`,
   que é o máximo DENTRO da hora anterior.

   Tirar o máximo diário da coluna instantânea perde o pico que acontece entre
   duas leituras — e o pico de temperatura raramente cai em cima do minuto
   cheio. O viés é sistemático e para baixo, de alguns décimos a mais de um
   grau, e é invisível: o número sai plausível.

   Máxima e mínima saem das colunas de extremo horário. A MÉDIA sai da coluna
   instantânea, que é o que "média das horas" significa.

2. VENTO É VELOCIDADE SUSTENTADA, NÃO RAJADA.

   O CSV tem `VENTO, VELOCIDADE HORARIA (m/s)` e `VENTO, RAJADA MAXIMA (m/s)`.
   O contrato chama o campo de `wind_speed_10m_max`, que é o nome da
   Open-Meteo — e lá esse campo é o máximo da velocidade média horária. Rajada
   tem campo próprio (`wind_gusts_10m_max`).

   Usar a rajada aqui encheria a mesma coluna com valores ~40% maiores, e a
   comparação com o caminho ERA5 do aplicativo passaria a medir a diferença
   entre duas grandezas achando que mede viés de modelo.

3. CAMPO VAZIO NÃO É SEMPRE A MESMA COISA.

   `RADIACAO GLOBAL` vem vazia à noite — e isso não é falha de medida, é a
   ausência de sol. Como radiação não entra no contrato, aqui isso não faz
   diferença; ficou escrito porque a próxima pessoa que for acrescentar a
   variável vai precisar decidir, e a decisão não é "0" nem "null" sem pensar.
=============================================================================
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

LINHAS_DE_METADADO = 8
# Abaixo disto o dia não produz agregado. Ver o contrato, invariante
# "dia incompleto nao produz agregado".
MINIMO_DE_HORAS = 18


# ---------------------------------------------------------------------------
# parsing puro — sem Spark, para poder ser testado
# ---------------------------------------------------------------------------
def normalizar(s: str) -> str:
    """Sem acento, maiúsculo, espaços colapsados.

    O cabeçalho muda de acentuação e de espaçamento entre anos ("PRESSAO" e
    "PRESSÃO" convivem no MESMO arquivo de 2024). Casar por texto cru faria a
    coluna sumir num ano e aparecer no outro, e o efeito seria uma variável
    virando toda nula a partir de certa data — sem erro nenhum.
    """
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()


def numero(s: str | None) -> float | None:
    """Vírgula decimal -> float. Vazio -> None.

    NUNCA devolve 0 para ausência: 0 mm é um dia seco e 0 m/s é calmaria.
    """
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        v = float(s.replace(",", "."))
    except ValueError:
        return None
    # Sentinela clássica, que não apareceu em 2024 mas pode aparecer em anos
    # antigos. Recusar custa uma comparação.
    if v in (-9999.0, -999.0):
        return None
    return v


def data_de(s: str) -> date | None:
    """`2024/01/01` e `01/01/2024` convivem entre anos do INMET."""
    for f in ("%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), f).date()
        except ValueError:
            continue
    return None


def fundacao_de(s: str) -> date | None:
    """`07/05/00` — ano de DOIS dígitos.

    A rede automática nasce em 2000, então `00` é 2000 e não 1900. A regra do
    corte em 50 é arbitrária e está aqui explícita: sem ela, `strptime` com
    `%y` já faz a mesma coisa em silêncio e ninguém sabe que houve escolha.
    """
    s = s.strip()
    for f in ("%d/%m/%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s, f).date()
            return d.replace(year=d.year + 100) if d.year < 1950 else d
        except ValueError:
            continue
    return None


REGIOES = {"N", "NE", "CO", "SE", "S"}

# Como cada campo do contrato sai do CSV. A chave é o trecho normalizado que
# identifica a coluna; a ordem importa porque o casamento é por prefixo.
COLUNAS = {
    "chuva":   "PRECIPITACAO TOTAL",
    "t_inst":  "TEMPERATURA DO AR",
    "t_max_h": "TEMPERATURA MAXIMA",     # não casa com "TEMPERATURA ORVALHO MAX"
    "t_min_h": "TEMPERATURA MINIMA",
    "vento":   "VENTO, VELOCIDADE",      # NÃO "VENTO, RAJADA" — ver armadilha 2
}


def indices_das_colunas(cabecalho: list[str]) -> dict[str, int]:
    achados: dict[str, int] = {}
    normais = [normalizar(c) for c in cabecalho]
    for chave, marca in COLUNAS.items():
        for i, c in enumerate(normais):
            if c.startswith(marca):
                achados[chave] = i
                break
    return achados


def ler_estacao(nome_arquivo: str, texto: str) -> tuple[dict | None, list[dict]]:
    """Um CSV do INMET -> (dim_estacao, [fato_observacao_diaria]).

    Devolve `(None, [])` se o arquivo não tiver a forma esperada — um formato
    novo tem que aparecer como arquivo pulado e contado, não como estação com
    dados vazios.
    """
    linhas = texto.splitlines()
    if len(linhas) < LINHAS_DE_METADADO + 2:
        return None, []

    meta: dict[str, str] = {}
    for l in linhas[:LINHAS_DE_METADADO]:
        if ";" in l:
            k, _, v = l.partition(";")
            meta[normalizar(k).rstrip(":")] = v.strip()

    estacao_id = meta.get("CODIGO (WMO)", "").strip()
    if not re.fullmatch(r"[A-Z]\d{3}", estacao_id):
        return None, []

    regiao = meta.get("REGIAO", "").strip().upper()
    estacao = {
        "estacao_id": estacao_id,
        "nome": meta.get("ESTACAO", "").strip(),
        "uf": meta.get("UF", "").strip().upper()[:2],
        "regiao": regiao if regiao in REGIOES else None,
        "lat": numero(meta.get("LATITUDE")),
        "lng": numero(meta.get("LONGITUDE")),
        "altitude_m": numero(meta.get("ALTITUDE")),
        "fundacao": fundacao_de(meta.get("DATA DE FUNDACAO", "")),
        # O ZIP baixado é o da rede automática. Fica declarado, não inferido.
        "rede": "automatica",
    }

    cab = linhas[LINHAS_DE_METADADO].split(";")
    idx = indices_das_colunas(cab)
    if "t_inst" not in idx or "chuva" not in idx:
        return None, []
    iData = 0

    # ---- horário -> diário -------------------------------------------------
    por_dia: dict[date, dict] = {}
    for l in linhas[LINHAS_DE_METADADO + 1:]:
        if not l.strip():
            continue
        # A última coluna é sempre vazia (toda linha termina em ";"). Não é
        # dado; ignorar por índice já resolve, mas fica dito porque um leitor
        # de CSV genérico cria uma coluna `_c19` que ninguém entende depois.
        c = l.split(";")
        if len(c) <= max(idx.values()):
            continue
        d = data_de(c[iData])
        if d is None:
            continue
        b = por_dia.setdefault(d, {"tmax": [], "tmin": [], "tinst": [], "chuva": [], "vento": []})
        # `horas_validas` conta a hora com TEMPERATURA instantânea medida. É a
        # variável mais contínua do arquivo; usar a chuva daria um dia inteiro
        # "válido" com só a temperatura faltando.
        v = numero(c[idx["t_inst"]])
        if v is not None:
            b["tinst"].append(v)
        for chave, alvo in (("t_max_h", "tmax"), ("t_min_h", "tmin"),
                            ("chuva", "chuva"), ("vento", "vento")):
            if chave in idx:
                x = numero(c[idx[chave]])
                if x is not None:
                    b[alvo].append(x)

    fatos = []
    # `utcnow()` está obsoleto no Python 3.12+ e emite DeprecationWarning uma
    # vez por worker — no meio de um job de 8.000 arquivos isso vira ruído que
    # esconde o erro de verdade.
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for d, b in sorted(por_dia.items()):
        horas = len(b["tinst"])
        completo = horas >= MINIMO_DE_HORAS
        fatos.append({
            "estacao_id": estacao_id,
            "data": d,
            "dia_do_ano": d.timetuple().tm_yday,
            # Máxima e mínima das colunas de EXTREMO HORÁRIO — ver armadilha 1.
            # Sem elas no arquivo, cai para a instantânea, que subestima; por
            # isso a origem fica registrada em `fonte`.
            "temperature_2m_max": max(b["tmax"] or b["tinst"], default=None) if completo else None,
            "temperature_2m_min": min(b["tmin"] or b["tinst"], default=None) if completo else None,
            "temperature_2m_mean": (sum(b["tinst"]) / horas) if completo and horas else None,
            "precipitation_sum": sum(b["chuva"]) if completo and b["chuva"] else (0.0 if completo else None),
            "wind_speed_10m_max": max(b["vento"], default=None) if completo else None,
            "horas_validas": horas,
            "ingestao_em": agora,
            "fonte": f"INMET/automatica/{nome_arquivo}",
        })
    return estacao, fatos


# ---------------------------------------------------------------------------
# o job
# ---------------------------------------------------------------------------
# Estas três funções são de MÓDULO, e não closures dentro de `construir`.
# O cloudpickle serializa função de módulo por referência — manda o nome — e
# o worker importa. Uma closure viraria bytes em cada tarefa.
def _texto(caminho: str, limite: int | None = None) -> str:
    """Lê o arquivo e devolve texto latin-1. `limite` lê só os primeiros bytes.

    GZIP PELOS BYTES MÁGICOS, e não pela extensão: `--gz` guarda os CSVs
    comprimidos (~4,5× menos disco; 15 anos abertos passam de 6 GB), e olhar o
    nome do arquivo funcionaria hoje e quebraria no dia em que alguém
    renomeasse. Os dois primeiros bytes não mentem.

    Um `.gz` não pode ser lido pela metade, então o `limite` só vale para o
    arquivo cru — e é justamente o caso em que ler 6 GB para pegar 8 linhas de
    metadado seria absurdo.
    """
    import gzip as _gzip
    with open(caminho, "rb") as fh:
        cabeca = fh.read(2)
        if cabeca == b"\x1f\x8b":
            bruto = _gzip.decompress(cabeca + fh.read())
            if limite:
                bruto = bruto[:limite]
        else:
            bruto = cabeca + (fh.read(limite - 2) if limite else fh.read())
    # `replace` e não `strict`: um byte solto fora do latin-1 não pode derrubar
    # um ano inteiro de uma estação.
    return bruto.decode("latin-1", errors="replace")


def _linha_de_dimensao(caminho: str) -> list:
    """Só o bloco de metadados. 4 kB bastam para as 8 linhas + o cabeçalho."""
    from pyspark.sql import Row
    est, _ = ler_estacao(os.path.basename(caminho), _texto(caminho, 4096))
    return [Row(**est)] if est else []


def _linhas_de_fato(caminho: str) -> list:
    from pyspark.sql import Row
    # `os.path.basename`, e não `rsplit("/")`: no Windows o separador é a barra
    # invertida, e o nome vai para o campo `fonte` do contrato — sairia o
    # caminho inteiro em vez do nome da estação.
    _, fatos = ler_estacao(os.path.basename(caminho), _texto(caminho))
    return [Row(**f) for f in fatos]


def construir(spark, padrao: str):
    """`padrao` é um glob de CSVs, ex. data/bronze/2024/*.CSV"""
    from pyspark.sql import Row, functions as F

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import enviar_modulo

    # ESTE MÓDULO PRECISA VIAJAR ATÉ O EXECUTOR.
    #
    # `ler_estacao` roda dentro do `flatMap`, ou seja, em outro processo. O
    # cloudpickle serializa função de módulo importável POR REFERÊNCIA — manda
    # o nome, não o corpo — e o executor tenta `import silver_inmet` e não
    # acha. O erro é `ModuleNotFoundError` no meio de um stacktrace de Py4J,
    # que não parece nada com "faltou enviar o arquivo".
    #
    # Vale igual no Databricks: um módulo do repositório não está no path dos
    # workers só por estar no workspace.
    enviar_modulo(spark, str(Path(__file__).resolve()))

    # ARQUIVO INTEIRO, porque o metadado é POR ARQUIVO: as 8 primeiras linhas
    # descrevem a estação e não se repetem em cada registro. Um leitor de CSV
    # comum não tem como devolver isso, e concatenar os arquivos perderia
    # exatamente a informação que forma a dimensão.
    #
    # A LISTA DE ARQUIVOS SAI DO PYTHON, E NÃO DO SISTEMA DE ARQUIVOS DO HADOOP.
    #
    # A versão anterior usava `binaryFiles(padrao)`, e no Windows isso morre:
    #
    #     UnsatisfiedLinkError: NativeIO$Windows.access0
    #       at FileUtil.canRead -> RawLocalFileSystem.listStatus -> Globber.glob
    #
    # O Hadoop precisa de um binário nativo (`winutils.exe` + `hadoop.dll`) só
    # para LISTAR arquivos locais no Windows. Não é problema de código nem de
    # dado: é o `glob` do Hadoop.
    #
    # Listar em Python e distribuir os CAMINHOS resolve por eliminação — o
    # Hadoop deixa de participar da leitura. Cada tarefa abre o seu arquivo com
    # `open()`, que funciona igual no Windows, no Linux e nos Volumes do Unity
    # Catalog (que são montados como caminho local em todos os nós).
    #
    # A condição para isso valer num cluster de verdade é que os caminhos sejam
    # visíveis de todos os executores — o que é o caso em `local[*]` e em
    # Volumes, e NÃO seria com um disco só do driver.
    from glob import glob as _glob
    caminhos = sorted(_glob(padrao))
    if not caminhos:
        raise SystemExit(f"nenhum arquivo casou com {padrao!r}")

    # Uma partição por punhado de arquivos: cada CSV tem ~793 kB e vira uma
    # tarefa curta. Milhares de partições de um arquivo só custam mais em
    # agendamento do que economizam em paralelismo.
    particoes = max(8, min(256, len(caminhos) // 16 or 1))
    rdd = spark.sparkContext.parallelize(caminhos, particoes)

    # ESQUEMA DECLARADO, E NÃO INFERIDO.
    #
    # `createDataFrame` sem esquema olha uma amostra e adivinha. Duas maneiras
    # de isso quebrar, e a primeira já aconteceu aqui:
    #
    #   1. Coluna inteiramente nula na amostra -> "CANNOT_DETERMINE_TYPE". Uma
    #      estação com poucos dias completos produz exatamente isso, e o job
    #      morre com um erro que não fala de dados.
    #   2. Pior, e silencioso: uma amostra em que `precipitation_sum` é sempre
    #      0 vira `bigint`, e daí em diante 0,2 mm de chuva é truncado para 0.
    #
    # Os tipos abaixo são os do contrato. `ingestao_em` sai como texto ISO da
    # função pura — que precisa continuar serializável em JSON para o validador
    # — e vira timestamp aqui.
    ESQ_DIM = ("estacao_id string, nome string, uf string, regiao string, "
               "lat double, lng double, altitude_m double, fundacao date, rede string")
    ESQ_FATO = ("estacao_id string, data date, dia_do_ano int, "
                "temperature_2m_max double, temperature_2m_min double, "
                "temperature_2m_mean double, precipitation_sum double, "
                "wind_speed_10m_max double, horas_validas int, "
                "ingestao_em string, fonte string")

    # DOIS PASSES, E NENHUM `cache()`.
    #
    # A versão anterior fazia UM passe e guardava o resultado com `.cache()`
    # para derivar a dimensão e o fato do mesmo trabalho. Parecia economia e
    # era o contrário: cada registro é uma estação-ano com ~365 dicionários,
    # e 8.000 arquivos dão ~2,9 milhões de dicionários Python guardados de uma
    # vez. O worker morre, e o erro não fala de memória:
    #
    #     Python worker exited unexpectedly (crashed)
    #     Caused by: java.io.EOFException
    #       at MemoryStore.putIteratorAsBytes   <- o cache
    #
    # Sem cache, os dois passes são fluxos: o Spark lê, transforma e escreve
    # sem nunca segurar o conjunto inteiro. O passe da DIMENSÃO nem lê o
    # arquivo todo — só os primeiros 4 kB, que é onde moram os 8 campos de
    # metadado. Ele custa quase nada, e é isso que torna o segundo passe barato
    # de pagar.
    dim = spark.createDataFrame(
        rdd.flatMap(_linha_de_dimensao), ESQ_DIM).dropDuplicates(["estacao_id"])
    fato = (spark.createDataFrame(rdd.flatMap(_linhas_de_fato), ESQ_FATO)
            .withColumn("ingestao_em", F.to_timestamp("ingestao_em")))
    return dim, fato


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entrada", required=True, help="glob dos CSVs, ex. data/bronze/2024/*.CSV")
    ap.add_argument("--saida", help="diretório onde gravar silver/")
    # ANO A ANO, ACUMULANDO NA MESMA SAÍDA.
    #
    # Numa máquina apertada, 8.000 arquivos de uma vez não cabem. Rodar ano a
    # ano resolve — mas gravar cada ano num diretório próprio criaria o
    # problema seguinte: o Gold teria que ler `data/silver/*/fato...`, e o glob
    # é justamente o que quebra no Windows sem winutils.
    #
    # Com `--anexar`, os 15 anos caem no MESMO diretório como partes, e o Gold
    # lê um caminho só.
    ap.add_argument("--anexar", action="store_true",
                    help="acrescenta à saída em vez de substituir (para rodar ano a ano)")
    a = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gold_normal import enviar_modulo, gravar, sessao

    spark = sessao("silver_inmet")
    try:
        dim, fato = construir(spark, a.entrada)
        print(f"  {dim.count()} estacoes · {fato.count()} dias")
        if a.saida:
            gravar(dim, f"{a.saida}/dim_estacao", a.anexar)
            gravar(fato, f"{a.saida}/fato_observacao_diaria", a.anexar)
            print(f"  gravado em {a.saida}")
        else:
            dim.show(5, truncate=False)
            fato.show(5, truncate=False)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
