#!/usr/bin/env python3
"""
pipeline/checar_ambiente.py
=============================================================================
    python pipeline/checar_ambiente.py

Diz o que falta para rodar o pipeline nesta máquina, em quatro camadas, porque
cada uma falha por um motivo diferente e o conserto de cada uma é outro:

    1. Python      versão
    2. Java        existe? qual versão? (o Spark é exigente com isso)
    3. PySpark     instalado? qual linha?
    4. ESCRITA     — e esta é a que pega no Windows

A quarta é a que importa. No Windows, ler Parquet costuma funcionar e
**escrever** falha, porque o Hadoop usa uma biblioteca nativa (`winutils.exe`)
para ajustar permissões de arquivo. O erro sai como `UnsatisfiedLinkError` no
meio de um stacktrace de Java e não parece nada com "falta um executável".

Descobrir isso depois de processar 8.000 CSVs seria descobrir tarde.
=============================================================================
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VERDE = "ok "
RUIM = "X  "


def linha(marca, texto, detalhe=""):
    print(f"  {marca} {texto}" + (f"\n        {detalhe}" if detalhe else ""))


problemas: list[str] = []


def diagnosticar(erro: str) -> str:
    """Lê a exceção e nomeia a causa.

    A primeira versão deste arquivo devolvia "quase sempre é versão de Java"
    para QUALQUER falha da sessão — um chute que, no primeiro caso real, errou:
    o problema era o atalho da Microsoft Store no lugar do Python. Um
    diagnóstico que responde a mesma coisa para tudo não é diagnóstico.
    """
    e = erro.lower()
    if "python worker failed to connect back" in e or "accept timed out" in e:
        return ("o EXECUTOR não conseguiu abrir um Python.\n"
                "        No Windows isso é quase sempre o atalho da Microsoft Store: `python`\n"
                "        aponta para um stub que imprime 'Python não foi encontrado' e sai.\n"
                "        O pipeline já contorna (PYSPARK_PYTHON = sys.executable). Se ainda\n"
                "        falhar, veja se um antivírus ou firewall bloqueia soquete local —\n"
                "        o worker conversa com o driver por 127.0.0.1.")
    if "10038" in e or "not a socket" in e or "não é um soquete" in e:
        return ("WinError 10038 no worker: o Python e o PySpark NÃO SE ENTENDEM.\n"
                "        O soquete que o worker usa para falar com o driver é fechado\n"
                "        de um jeito que este Python não aceita. É incompatibilidade de\n"
                "        versão, não de memória nem de dado — e aparece como 'worker\n"
                "        exited unexpectedly', que sugere outra coisa.\n"
                "        Ver a linha 'Python x PySpark' acima.")
    if "worker exited unexpectedly" in e or "eofexception" in e:
        return ("o worker do Spark MORREU no meio. Duas causas, nesta ordem:\n"
                "        1. INCOMPATIBILIDADE Python x PySpark — ver a linha acima.\n"
                "        2. MEMÓRIA: em modo local o driver é o executor.\n"
                "           setx OBSERVEARTH_MEM 6g   (e reabra o terminal)\n"
                "           ou processe por ano: --entrada 'data/bronze/2024/*.CSV'")
    if "nativeio" in e or "winutils" in e or "hadoop_home" in e:
        return ("é o winutils, e não o seu código. O Hadoop precisa de um binário nativo\n"
                "        no Windows para ajustar permissão de arquivo:\n"
                "          1. baixe winutils.exe + hadoop.dll da versão 3.3.x\n"
                "          2. ponha em C:\\hadoop\\bin\n"
                "          3. setx HADOOP_HOME C:\\hadoop\n"
                "          4. feche e reabra o terminal")
    if "unsupportedclassversion" in e or "class file version" in e:
        return ("versão de Java incompatível com esta linha do PySpark.\n"
                "        PySpark 4 exige Java 17+; PySpark 3.5 aceita 8, 11 ou 17.")
    if "java gateway" in e or "javahome" in e:
        return "o Java não subiu. Confira o JAVA_HOME impresso acima."
    if "address already in use" in e or "bind" in e:
        return "porta ocupada — feche outra sessão Spark que tenha ficado rodando."
    # Sem palpite: devolver o erro é mais honesto que inventar uma causa.
    return "causa não reconhecida. A mensagem acima é o que há; me mande ela inteira."

print(f"\nambiente · {platform.system()} {platform.machine()}\n")

# ---- 1. Python ------------------------------------------------------------
v = sys.version_info
if v >= (3, 9):
    linha(VERDE, f"Python {v.major}.{v.minor}.{v.micro}")
else:
    linha(RUIM, f"Python {v.major}.{v.minor} — o pipeline pede 3.9 ou mais")
    problemas.append("atualizar o Python")

# ---- 2. Java --------------------------------------------------------------
#
# "não está no PATH" NÃO é o mesmo que "não está instalado", e a primeira versão
# deste arquivo confundia as duas — mandou instalar um JDK que já estava lá.
#
# O PySpark nem precisa do `java` no PATH: se `JAVA_HOME` estiver definido, ele
# usa `%JAVA_HOME%\bin\java` direto. Então a ordem certa é: JAVA_HOME primeiro,
# PATH depois, e só então PROCURAR nos lugares onde os instaladores põem o JDK.
def versao_de(exe: str) -> int | None:
    try:
        s = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=30)
        t = (s.stderr or "") + (s.stdout or "")
        m = re.search(r'version "(\d+)(?:\.(\d+))?', t)
        if not m:
            return None
        maior = int(m.group(1))
        # "1.8.0_xxx" é Java 8; de 9 em diante o primeiro número já é a versão.
        return int(m.group(2)) if maior == 1 and m.group(2) else maior
    except Exception:  # noqa: BLE001
        return None


# A BUSCA MORA NO PIPELINE, e não aqui.
#
# `sessao()` precisa dela para funcionar sem JAVA_HOME, e este checador precisa
# dela para relatar. Duas cópias da mesma lista de diretórios divergiriam no
# primeiro instalador novo, e o checador passaria a dizer "tudo pronto" para um
# JDK que o pipeline não acha — ou o contrário.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gold_normal import procurar_jdks  # noqa: E402


java_home = os.environ.get("JAVA_HOME")
java = None
java_maior = None

if java_home:
    exe = os.path.join(java_home, "bin", "java.exe" if os.name == "nt" else "java")
    if os.path.exists(exe):
        java, java_maior = exe, versao_de(exe)
        linha(VERDE, f"Java {java_maior} via JAVA_HOME", java_home)
    else:
        linha(RUIM, f"JAVA_HOME aponta para um lugar sem java: {java_home}")
        problemas.append(f"corrigir ou apagar JAVA_HOME (hoje: {java_home})")

if not java:
    java = shutil.which("java")
    if java:
        java_maior = versao_de(java)
        linha(VERDE, f"Java {java_maior or '?'} no PATH", java)

if not java:
    achados = procurar_jdks()
    if achados:
        # ESTE É O CASO QUE EU TINHA ERRADO. O JDK existe; só falta apontar.
        melhor = next((d for d, v in achados if 8 <= v <= 17), achados[0][0])
        linha(RUIM, "Java instalado, mas fora do PATH e sem JAVA_HOME")
        for d, v in achados:
            print(f"        Java {v}: {d}")
        if os.name == "nt":
            problemas.append(
                "apontar o JAVA_HOME para o JDK que já está instalado:\n"
                f'          setx JAVA_HOME "{melhor}"\n'
                "        e então FECHE E REABRA o terminal (setx só vale para janelas novas).\n"
                "        Para usar já nesta janela, sem fechar:\n"
                f'          $env:JAVA_HOME = "{melhor}"')
        else:
            problemas.append(f'export JAVA_HOME="{melhor}"')
    else:
        linha(RUIM, "Java não encontrado — nem no PATH, nem no JAVA_HOME, nem nos lugares usuais")
        problemas.append(
            "instalar um JDK. Para PySpark 3.5: Java 8, 11 ou 17. Para PySpark 4: Java 17+.\n"
            "        Windows:  winget install Microsoft.OpenJDK.17")

# ---- 3. PySpark -----------------------------------------------------------
pyspark_versao = None
try:
    import pyspark  # noqa: F401
    pyspark_versao = pyspark.__version__
    linha(VERDE, f"PySpark {pyspark_versao}")
    # PYTHON x PYSPARK — a checagem que faltava, e que teria poupado horas.
    #
    # Eu conferia a versão do Java contra a do PySpark e NÃO conferia a do
    # Python. A linha 3.5 do PySpark é testada até o Python 3.11; em 3.12+ o
    # worker quebra no fim, ao fechar o soquete que fala com o driver:
    #
    #     OSError: [WinError 10038] operação em algo que não é um soquete
    #     org.apache.spark.SparkException: Python worker exited unexpectedly
    #
    # O erro não menciona versão em lugar nenhum e parece falta de memória.
    maior_ps = int(pyspark_versao.split(".")[0])
    menor_ps = int(pyspark_versao.split(".")[1])
    py = (v.major, v.minor)
    teto = (3, 11) if (maior_ps, menor_ps) <= (3, 5) else (3, 12)
    if py > teto:
        linha(RUIM, f"Python {v.major}.{v.minor} x PySpark {pyspark_versao}: fora do testado "
                    f"(até {teto[0]}.{teto[1]})")
        problemas.append(
            f"o PySpark {pyspark_versao} não é testado no Python {v.major}.{v.minor}.\n"
            "        Dois caminhos, e o primeiro é o mais curto:\n"
            "          1. um Python compatível SÓ para o pipeline:\n"
            "               winget install Python.Python.3.11\n"
            "               py -3.11 -m venv .venv\n"
            "               .venv\\Scripts\\activate\n"
            "               pip install pyspark==3.5.3 pyarrow\n"
            "          2. rodar no Databricks, que é o destino do MVP de qualquer jeito.")
    else:
        linha(VERDE, f"Python {v.major}.{v.minor} x PySpark {pyspark_versao}: combinação testada")

    # PyArrow é o plano B de escrita no Windows sem winutils — ver
    # `gravar()` em gold_normal.py. Vem do PyPI, não é binário de terceiro.
    try:
        import pyarrow  # noqa: F401
        linha(VERDE, f"PyArrow {pyarrow.__version__} (plano B de escrita)")
    except ModuleNotFoundError:
        linha(RUIM, "PyArrow ausente — sem ele não há plano B se o winutils faltar")
        problemas.append("pip install pyarrow")
except ModuleNotFoundError:
    linha(RUIM, "PySpark não instalado")
    # A linha 3.5 roda em Java 8/11/17 e é a que combina com o runtime do
    # Databricks hoje. Recomendar a mais nova sem olhar o Java instalado seria
    # trocar um erro por outro.
    if java_maior and java_maior >= 17:
        problemas.append("pip install pyspark")
    else:
        problemas.append("pip install \"pyspark==3.5.3\"   (a linha 3.5 aceita Java 8/11/17)")

# Compatibilidade entre as duas versões — é a fonte de erro mais confusa aqui,
# porque a mensagem fala de "class file version" e não de Java.
if pyspark_versao and java_maior:
    maior_pyspark = int(pyspark_versao.split(".")[0])
    if maior_pyspark >= 4 and java_maior < 17:
        linha(RUIM, f"PySpark {pyspark_versao} exige Java 17+, e aqui é Java {java_maior}")
        problemas.append(
            "ou instalar Java 17+, ou baixar o PySpark:  pip install \"pyspark==3.5.3\"")
    elif maior_pyspark == 3 and java_maior > 17:
        linha(RUIM, f"PySpark 3.5 pode não subir em Java {java_maior}")
        problemas.append("usar Java 17 ou 11 com o PySpark 3.5")

# ---- 4. A escrita, que é onde o Windows quebra ----------------------------
if pyspark_versao and java:
    print()
    hadoop_home = os.environ.get("HADOOP_HOME")
    if platform.system() == "Windows":
        linha(VERDE if hadoop_home else RUIM,
              f"HADOOP_HOME = {hadoop_home}" if hadoop_home else "HADOOP_HOME não definido")

    # O MESMO PYTHON NOS DOIS LADOS — ver o comentário em gold_normal.sessao().
    # No Windows, `python` costuma cair no atalho da Microsoft Store, que
    # imprime "Python não foi encontrado" e sai; o worker do Spark nunca conecta
    # de volta e o erro sai como `SocketTimeoutException: Accept timed out`.
    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    os.environ.setdefault("PYSPARK_DRIVER_PYTHON", sys.executable)
    linha(VERDE, "worker do Spark vai usar este Python", sys.executable)

    # E vale avisar se o atalho da Store está no PATH, porque ele volta a morder
    # em qualquer script que não passe por `sessao()`.
    py_path = shutil.which("python") or ""
    if "WindowsApps" in py_path:
        linha(RUIM, "o `python` do PATH é o atalho da Microsoft Store", py_path)
        print("        (o pipeline contorna sozinho; só atrapalha se você chamar spark-submit à mão)")

    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
    try:
        from pyspark.sql import SparkSession
        s = (SparkSession.builder.master("local[1]").appName("checagem")
             .config("spark.ui.enabled", "false")
             .config("spark.sql.shuffle.partitions", "1").getOrCreate())
        s.sparkContext.setLogLevel("ERROR")
        linha(VERDE, "sessão local sobe")

        df = s.createDataFrame([(1, "a"), (2, "b")], "n int, s string")
        assert df.count() == 2
        linha(VERDE, "leitura em memória funciona")

        with tempfile.TemporaryDirectory() as tmp:
            destino = os.path.join(tmp, "teste")
            try:
                df.write.mode("overwrite").parquet(destino)
                lido = s.read.parquet(destino).count()
                assert lido == 2
                linha(VERDE, "ESCRITA de Parquet funciona — a máquina está pronta")
            except Exception as e:  # noqa: BLE001
                msg = str(e).split("\n")[0][:180]
                linha(RUIM, "escrita de Parquet FALHOU", msg)
                problemas.append(diagnosticar(str(e)))
        s.stop()
    except Exception as e:  # noqa: BLE001
        linha(RUIM, "a sessão não subiu", str(e).split("\n")[0][:200])
        problemas.append(diagnosticar(str(e)))

# ---------------------------------------------------------------------------
print()
if not problemas:
    print("  Tudo pronto. Próximo passo:\n")
    print("    python pipeline/silver_inmet.py --entrada 'data/bronze/*/*.CSV' --saida data/silver\n")
    sys.exit(0)

print(f"  {len(problemas)} coisa(s) para resolver:\n")
for i, p in enumerate(problemas, 1):
    print(f"    {i}. {p}")
print()
sys.exit(1)
