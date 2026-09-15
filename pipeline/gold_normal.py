#!/usr/bin/env python3
"""
pipeline/gold_normal.py
=============================================================================
M3 · GOLD A — as normais climatológicas por estação, variável e dia do ano

    silver/fato_observacao_diaria  ->  gold/gold_normal

Roda igual no Databricks e local:

    python pipeline/gold_normal.py --entrada silver/fato --saida gold/normal
    python pipeline/gold_normal.py --conferir          # roda contra o gabarito

-----------------------------------------------------------------------------
POR QUE ESTE ARQUIVO NÃO É UM NOTEBOOK
-----------------------------------------------------------------------------
Porque ele precisa entrar em teste automático. Um `.ipynb` é JSON com saída
embutida: não dá para importar uma função dele, e o diff de uma célula mostra
imagem base64. A lógica mora aqui, testada; o notebook do Databricks importa
este módulo e fica com o que notebook faz bem — narrativa e gráfico.

-----------------------------------------------------------------------------
AS DUAS ARMADILHAS DESTE JOB
-----------------------------------------------------------------------------

1. `percentile_approx` NÃO SERVE, E A DIFERENÇA NÃO É DE ARREDONDAMENTO.

   MEDIDO nesta máquina (Spark 3.5.3, Java 11) contra
   pipeline/contrato/gabarito-quantis.json:

       percentile          divergiu do gabarito em  0 de 15 casos
       percentile_approx   divergiu do gabarito em  8 de 15 casos

   E o modo da falha é estrutural, não numérico: `percentile_approx` devolve
   estatísticas de ordem sem interpolar. Na amostra [10,20,30,40,50] ele dá
   p10 = 10 onde o correto é 14. No caso da chuva ele dá p90 = 5,0 onde o
   correto é 6,5. O erro encolhe com a amostra grande, mas vive justamente nas
   CAUDAS — que é onde a faixa de anomalia do aplicativo mora.

2. A JANELA DE ±7 DIAS É UMA EXPLOSÃO, NÃO UM FILTRO.

   A normal do dia 200 usa os dias 193 a 207 de TODOS os anos. Agrupar por
   `dia_do_ano` daria 30 amostras (uma por ano) em vez de ~450, e a normal
   ficaria ruidosa demais para significar alguma coisa.

   Cada observação contribui para os 15 dias-alvo à sua volta. A regra é
   `min(|d - alvo|, 365 - |d - alvo|) <= 7`, com 365 e não 366 — ver
   server/climatologia.js:dentroDaJanela e o contrato em §algoritmos.janela.
   Com 366 a conta dá 8 entre 26/dez e 2/jan, e a virada do ano perderia
   metade da vizinhança sem nada indicar isso.
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONTRATO = RAIZ / "pipeline" / "contrato" / "esquema.json"
GABARITO = RAIZ / "pipeline" / "contrato" / "gabarito-quantis.json"

DIAS_NO_ANO = 365          # ver docstring, armadilha 2
JANELA = 7


def carregar_contrato() -> dict:
    """As variáveis, unidades e feitios vêm do contrato — nunca de literal aqui.

    Duas listas da mesma coisa é como elas passam a discordar, e o teste
    test/contrato.mjs já garante que o contrato bate com server/climatologia.js.
    """
    return json.loads(CONTRATO.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# a janela, em Python puro — para poder ser testada sem Spark
# ---------------------------------------------------------------------------
def dentro_da_janela(dia: int, alvo: int, janela: int = JANELA) -> bool:
    """Réplica exata de `dentroDaJanela` em server/climatologia.js.

    Duas implementações da mesma regra é uma dívida assumida: o app não roda
    Python e o Spark não roda JavaScript. O que paga a dívida é o teste de
    equivalência, que compara as duas para os 366 x 366 pares possíveis.
    """
    d = abs(dia - alvo)
    return min(d, DIAS_NO_ANO - d) <= janela


def alvos_de(dia: int, janela: int = JANELA) -> list[int]:
    """Os dias-alvo para os quais uma observação do dia `dia` conta.

    Devolve dias em 1..366. O dia 366 existe (anos bissextos) e recebe
    contribuição normalmente; o que ele não faz é alterar o comprimento usado
    na volta do ano.
    """
    return [a for a in range(1, 367) if dentro_da_janela(dia, a, janela)]


# ---------------------------------------------------------------------------
# o job
# ---------------------------------------------------------------------------
def construir(spark, fato, contrato: dict, referencia: str = "1991-2020"):
    """`fato` é um DataFrame no formato `fato_observacao_diaria` do contrato."""
    from pyspark.sql import functions as F
    from pyspark.sql.types import ArrayType, IntegerType

    variaveis = contrato["variaveis"]
    minimo = contrato["algoritmos"]["minimoDeAmostras"]["valor"]

    # ---- 1. largo -> comprido -------------------------------------------
    # Cinco colunas de grandeza viram cinco linhas. Sem isso, cada variável
    # exigiria o seu próprio caminho no job e as cinco divergiriam com o tempo.
    empilhado = F.explode(F.array(*[
        F.struct(F.lit(nome).alias("variavel"), F.col(nome).cast("double").alias("valor"))
        for nome in variaveis
    ]))
    longo = (fato
             .select("estacao_id", "dia_do_ano", empilhado.alias("v"))
             .select("estacao_id", "dia_do_ano", "v.variavel", "v.valor")
             # AUSÊNCIA SAI AQUI, e não depois do agrupamento. Um null que
             # chegue ao percentile é ignorado por ele, mas entraria no count
             # e `n_amostras` passaria a contar dias sem medida.
             .where(F.col("valor").isNotNull()))

    # ---- 2. a explosão da janela ----------------------------------------
    # Tabela de 366 linhas com os alvos de cada dia, calculada uma vez no
    # driver e distribuída por broadcast. É pequena (366 x 15) e evita um
    # cross join de 366 x 366 que o Spark teria que materializar.
    mapa = spark.createDataFrame(
        [(d, alvos_de(d)) for d in range(1, 367)],
        "dia_do_ano int, alvos array<int>",
    )
    espalhado = (longo
                 .join(F.broadcast(mapa), on="dia_do_ano", how="inner")
                 .select("estacao_id", "variavel", "valor",
                         F.explode("alvos").alias("alvo")))

    # ---- 3. os percentis -------------------------------------------------
    # `percentile`, NUNCA `percentile_approx`. Ver a armadilha 1 na docstring.
    normal = (espalhado
              .groupBy("estacao_id", "variavel", F.col("alvo").alias("dia_do_ano"))
              .agg(
                  F.expr("percentile(valor, 0.1)").alias("p10"),
                  F.expr("percentile(valor, 0.5)").alias("p50"),
                  F.expr("percentile(valor, 0.9)").alias("p90"),
                  F.avg("valor").alias("media"),
                  F.count("valor").cast("int").alias("n_amostras"),
              ))

    # ---- 4. os anos distintos -------------------------------------------
    # `anos` não é `n_amostras / 15`: uma estação com falhas tem menos dias por
    # ano, e a divisão inventaria uma cobertura que não existe.
    anos = (fato
            .select("estacao_id", F.year("data").alias("ano"))
            .distinct()
            .groupBy("estacao_id")
            .agg(F.count("ano").cast("int").alias("anos")))

    # ---- 5. a procedência, que é campo obrigatório em gold --------------
    meta = spark.createDataFrame(
        [(k, v["unidade"], v["feitio"], v["rotulo"]) for k, v in variaveis.items()],
        "variavel string, unidade string, feitio string, rotulo string",
    )

    saida = (normal
             .join(anos, on="estacao_id", how="left")
             .join(F.broadcast(meta), on="variavel", how="inner")
             .withColumn("referencia", F.lit(referencia))
             # SEM AMOSTRA NÃO HÁ PERCENTIL. O agrupamento não produz linha com
             # n_amostras = 0, mas a regra fica escrita: se algum caminho futuro
             # produzir, ela não vira zero.
             .withColumn("p10", F.when(F.col("n_amostras") > 0, F.col("p10")))
             .withColumn("p50", F.when(F.col("n_amostras") > 0, F.col("p50")))
             .withColumn("p90", F.when(F.col("n_amostras") > 0, F.col("p90")))
             .withColumn("media", F.when(F.col("n_amostras") > 0, F.col("media")))
             .select("estacao_id", "variavel", "dia_do_ano",
                     "p10", "p50", "p90", "media",
                     "n_amostras", "anos", "referencia", "feitio",
                     "unidade", "rotulo"))

    # A normal fraca é PUBLICADA com o n real: apagar esconderia a fraqueza,
    # completar inventaria dado. Quem decide o que dizer é a tela.
    fracas = saida.where(F.col("n_amostras") < minimo).count()
    if fracas:
        print(f"  aviso: {fracas} linhas com menos de {minimo} amostras "
              f"(publicadas com n_amostras real, não removidas)")

    return saida


# ---------------------------------------------------------------------------
# conferência contra o gabarito
# ---------------------------------------------------------------------------
def conferir(spark) -> int:
    """Compara `percentile` e `percentile_approx` com os valores do gabarito.

    O gabarito foi calculado à mão pela fórmula do tipo 7. Isto não confere se
    o Spark é consistente consigo mesmo — confere se ele produz o MESMO número
    que server/climatologia.js, que é o que o aplicativo vai desenhar.
    """
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))
    print(f"\n{'caso':<44} {'p':<4} {'gabarito':>9} {'percentile':>11} {'approx':>11}")
    print("-" * 84)
    ruim_exato = ruim_aprox = 0
    for caso in gab["casos"]:
        amostra = [x for x in caso["amostra"] if x is not None]
        if not amostra:
            continue
        df = spark.createDataFrame([(float(x),) for x in amostra], "v double")
        for chave, p in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
            esp = caso["esperado"][chave]
            r = df.selectExpr(f"percentile(v,{p}) ex", f"percentile_approx(v,{p}) ap").first()
            ok_e, ok_a = abs(r["ex"] - esp) < 1e-9, abs(r["ap"] - esp) < 1e-9
            ruim_exato += not ok_e
            ruim_aprox += not ok_a
            print(f"{caso['nome'][:42]:<44} {chave:<4} {esp:>9} "
                  f"{r['ex']:>11.4f}{'' if ok_e else ' X'} {r['ap']:>11.4f}{'' if ok_a else ' X'}")
    print("-" * 84)
    print(f"  percentile        divergiu em {ruim_exato} de 15")
    print(f"  percentile_approx divergiu em {ruim_aprox} de 15")
    if ruim_exato:
        print("\n  FALHA: `percentile` do Spark NÃO reproduz o gabarito nesta versão.")
        print("  O contrato assume tipo 7 (pos = p*(n-1)). Reveja antes de gravar Gold.")
    return 1 if ruim_exato else 0


def procurar_jdks() -> list[tuple[str, int]]:
    """Onde os instaladores comuns põem o JDK. Devolve (diretório, versão maior).

    "Não está no PATH" não é "não está instalado" — e no Windows a diferença é
    rotineira: o instalador põe o JDK no disco e não mexe no PATH, ou mexe e a
    janela aberta não vê. Procurar custa milissegundos e evita mandar alguém
    reinstalar o que já tem.
    """
    import glob
    import subprocess
    padroes = [
        r"C:\Program Files\Microsoft\jdk-*",
        r"C:\Program Files\Eclipse Adoptium\jdk-*",
        r"C:\Program Files\Java\jdk*",
        r"C:\Program Files\Zulu\zulu-*",
        r"C:\Program Files\Amazon Corretto\jdk*",
        r"C:\Program Files\BellSoft\LibericaJDK-*",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-*"),
        "/usr/lib/jvm/*",
        "/Library/Java/JavaVirtualMachines/*/Contents/Home",
    ]
    achados = []
    for p in padroes:
        for d in glob.glob(p):
            exe = os.path.join(d, "bin", "java.exe" if os.name == "nt" else "java")
            if not os.path.exists(exe):
                continue
            try:
                s = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=30)
                m = re.search(r'version "(\d+)(?:\.(\d+))?', (s.stderr or "") + (s.stdout or ""))
                if not m:
                    continue
                maior = int(m.group(1))
                # "1.8.0_xxx" é Java 8; de 9 em diante o primeiro número já é a versão.
                achados.append((d, int(m.group(2)) if maior == 1 and m.group(2) else maior))
            except Exception:  # noqa: BLE001
                continue
    return sorted(set(achados), key=lambda x: -x[1])


def garantir_java() -> str | None:
    """Aponta o JAVA_HOME para um JDK instalado, se ninguém apontou.

    `setx JAVA_HOME` só vale para janelas NOVAS, e `$env:JAVA_HOME` morre com a
    janela. O resultado prático é que o pipeline funciona num terminal e falha
    no seguinte, com uma mensagem que sugere que o Java sumiu do computador.

    Isto não substitui configurar a variável — substitui ter que lembrar dela.
    """
    import shutil
    if os.environ.get("JAVA_HOME") or shutil.which("java"):
        return None
    achados = procurar_jdks()
    if not achados:
        return None
    # A linha 3.5 do PySpark aceita 8, 11 e 17; a 4 exige 17+. Preferir o mais
    # novo dentro de 17 serve às duas, e evita escolher um Java 21 que a 3.5
    # pode recusar.
    escolhido = next((d for d, v in achados if 8 <= v <= 17), achados[0][0])
    os.environ["JAVA_HOME"] = escolhido
    print(f"  (JAVA_HOME não estava definido; usando {escolhido})")
    return escolhido


def sessao(nome="gold_normal"):
    garantir_java()
    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")

    # O EXECUTOR TEM QUE CHAMAR ESTE MESMO PYTHON.
    #
    # O Spark lança o worker rodando `python` (ou `python3`). No Windows, esse
    # nome costuma cair no ATALHO DA MICROSOFT STORE — um stub que imprime
    # "Python não foi encontrado" e sai. O worker nunca conecta de volta, e o
    # erro que aparece é:
    #
    #     org.apache.spark.SparkException: Python worker failed to connect back
    #     Caused by: java.net.SocketTimeoutException: Accept timed out
    #
    # Trinta linhas de stacktrace de Scala que não mencionam Python em lugar
    # nenhum, e a única pista — a mensagem do stub — some no meio do log.
    #
    # `sys.executable` é o interpretador que está rodando este arquivo. Apontar
    # os dois lados para ele resolve sem exigir que ninguém mexa em alias de
    # execução do Windows nem no PATH.
    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    os.environ.setdefault("PYSPARK_DRIVER_PYTHON", sys.executable)

    # E TEM QUE ACHAR OS MÓDULOS DAQUI.
    #
    # `sys.path.insert` vale só para o processo do driver; o worker é outro
    # processo e não herda isso. `PYTHONPATH` ele herda, porque é ambiente.
    #
    # A alternativa seria `addPyFile`, e ela QUEBRA no Windows: o executor
    # busca o arquivo enviado e chama `chmod` nele —
    #
    #     Utils.fetchFile -> FileUtil.chmod -> Shell.getWinUtilsPath
    #     RuntimeException: HADOOP_HOME and hadoop.home.dir are unset
    #
    # …e `chmod` num sistema que não tem permissão POSIX precisa do winutils.
    # Em modo local o envio é inútil de qualquer jeito: driver e executor são a
    # mesma máquina e o mesmo disco.
    aqui = str(Path(__file__).resolve().parent)
    anterior = os.environ.get("PYTHONPATH", "")
    if aqui not in anterior.split(os.pathsep):
        os.environ["PYTHONPATH"] = aqui + (os.pathsep + anterior if anterior else "")

    from pyspark.sql import SparkSession
    s = (SparkSession.builder.appName(nome)
         .config("spark.sql.shuffle.partitions", "8")
         .config("spark.ui.enabled", "false")
         # Em modo local o driver É o executor, e o padrão de 1 GB é apertado
         # para 8.000 arquivos. Ajustável por OBSERVEARTH_MEM para quem tiver
         # menos memória — não adianta pedir 4 GB numa máquina de 8.
         .config("spark.driver.memory", os.environ.get("OBSERVEARTH_MEM", "4g"))
         .getOrCreate())
    s.sparkContext.setLogLevel("ERROR")
    return s


def enviar_modulo(spark, arquivo: str) -> None:
    """Manda um módulo para os executores — **exceto** em modo local.

    Num cluster de verdade o módulo do repositório não está no path dos
    workers, e `addPyFile` resolve. Em `local[*]` ele é inútil (mesma máquina,
    mesmo disco, e o `PYTHONPATH` de `sessao()` já resolve) e no Windows é pior
    que inútil: o executor faz `chmod` no arquivo recebido e isso exige o
    winutils, derrubando o job antes de ler o primeiro CSV.
    """
    try:
        if str(spark.sparkContext.master).startswith("local"):
            return
        spark.sparkContext.addPyFile(arquivo)
    except Exception:
        # Já enviado nesta sessão, ou master indisponível — nenhum dos dois
        # é motivo para parar.
        pass


def gravar(df, destino: str, anexar: bool = False) -> str:
    """Grava Parquet, com um plano B para o Windows sem winutils.

    O Hadoop precisa de um binário nativo (`winutils.exe` + `hadoop.dll`) para
    mexer em arquivo local no Windows. Sem ele:

        UnsatisfiedLinkError: NativeIO$Windows.access0

    Isso não é problema do dado nem do código — é o sistema de arquivos do
    Hadoop. E instalar o winutils significa baixar um .exe e uma .dll de um
    repositório não oficial e confiar neles.

    O plano B escreve o mesmo Parquet com PyArrow, que vem do PyPI e não
    precisa de binário externo. O ESQUEMA VEM DO SPARK, e não da inferência do
    PyArrow: uma coluna inteiramente nula viraria tipo `null` e o arquivo
    deixaria de casar com o contrato.

    Devolve qual caminho foi usado — a procedência importa aqui também.
    """
    try:
        df.write.mode("append" if anexar else "overwrite").parquet(destino)
        return "spark"
    except Exception as e:  # noqa: BLE001
        t = str(e)
        if "NativeIO" not in t and "winutils" not in t.lower() and "HADOOP_HOME" not in t:
            raise
        print("    (o Hadoop não escreve sem winutils; usando PyArrow)")

    import pyarrow as pa
    import pyarrow.parquet as pq
    from pyspark.sql import types as T

    def tipo(dt):
        if isinstance(dt, T.StringType): return pa.string()
        if isinstance(dt, T.DoubleType): return pa.float64()
        if isinstance(dt, T.FloatType): return pa.float32()
        if isinstance(dt, T.IntegerType): return pa.int32()
        if isinstance(dt, T.LongType): return pa.int64()
        if isinstance(dt, T.BooleanType): return pa.bool_()
        if isinstance(dt, T.DateType): return pa.date32()
        if isinstance(dt, T.TimestampType): return pa.timestamp("us")
        return pa.string()

    esquema = pa.schema([(c.name, tipo(c.dataType)) for c in df.schema])
    Path(destino).mkdir(parents=True, exist_ok=True)
    if anexar:
        # NOME ÚNICO POR EXECUÇÃO. Rodar ano a ano acumula partes no mesmo
        # diretório; um nome fixo faria a segunda execução apagar a primeira em
        # silêncio, e a saída ficaria com o último ano parecendo o conjunto
        # inteiro. Contar os arquivos que já existem é suficiente e não depende
        # de relógio.
        n = len([p for p in Path(destino).glob("parte-*.parquet")])
        alvo = str(Path(destino) / f"parte-{n:04d}.parquet")
    else:
        for velho in Path(destino).glob("parte-*.parquet"):
            velho.unlink()
        alvo = str(Path(destino) / "parte-0000.parquet")

    # `toLocalIterator` traz uma partição por vez: 3 milhões de linhas não
    # precisam caber todas na memória do driver ao mesmo tempo.
    escritor = pq.ParquetWriter(alvo, esquema, compression="snappy")
    lote, n = [], 0
    try:
        for r in df.toLocalIterator():
            lote.append(r.asDict())
            if len(lote) >= 200_000:
                escritor.write_table(pa.Table.from_pylist(lote, schema=esquema))
                n += len(lote); lote = []
        if lote:
            escritor.write_table(pa.Table.from_pylist(lote, schema=esquema))
            n += len(lote)
    finally:
        escritor.close()
    print(f"    {n} linhas via PyArrow -> {alvo}")
    return "pyarrow"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entrada", help="caminho do fato_observacao_diaria (parquet)")
    ap.add_argument("--saida", help="onde gravar gold_normal (parquet)")
    ap.add_argument("--referencia", default="1991-2020")
    ap.add_argument("--conferir", action="store_true",
                    help="só roda a conferência contra o gabarito e sai")
    a = ap.parse_args()

    spark = sessao()
    try:
        if a.conferir or not a.entrada:
            return conferir(spark)
        saida = construir(spark, spark.read.parquet(a.entrada), carregar_contrato(), a.referencia)
        if a.saida:
            gravar(saida, a.saida)
            print(f"  gravado em {a.saida}")
        else:
            saida.show(20, truncate=False)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
