#!/usr/bin/env python3
"""
pipeline/test_silver.py
=============================================================================
    python pipeline/test_silver.py          (não precisa de Spark)

O fixture reproduz o formato REAL, medido em 08/09/2026 sobre
INMET_CO_DF_A001_BRASILIA_01-01-2024_A_31-12-2024.CSV: as mesmas 20 colunas com
os mesmos nomes e acentuação, a coluna final vazia, vírgula decimal, campo
vazio como ausência.

Os valores são escolhidos para que as duas armadilhas do arquivo APAREÇAM: a
coluna de máximo horário difere da instantânea, e a rajada difere da velocidade
sustentada. Se o parser pegar a coluna errada, o número que sai é plausível — e
só um valor esperado diferente denuncia.
=============================================================================
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from silver_inmet import (  # noqa: E402
    fundacao_de, ler_estacao, normalizar, numero,
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


# --- o cabeçalho REAL, copiado da medição ----------------------------------
CABECALHO = ";".join([
    "Data", "Hora UTC",
    "PRECIPITAÇÃO TOTAL, HORÁRIO (mm)",
    "PRESSAO ATMOSFERICA AO NIVEL DA ESTACAO, HORARIA (mB)",
    "PRESSÃO ATMOSFERICA MAX.NA HORA ANT. (AUT) (mB)",
    "PRESSÃO ATMOSFERICA MIN. NA HORA ANT. (AUT) (mB)",
    "RADIACAO GLOBAL (Kj/m²)",
    "TEMPERATURA DO AR - BULBO SECO, HORARIA (°C)",
    "TEMPERATURA DO PONTO DE ORVALHO (°C)",
    "TEMPERATURA MÁXIMA NA HORA ANT. (AUT) (°C)",
    "TEMPERATURA MÍNIMA NA HORA ANT. (AUT) (°C)",
    "TEMPERATURA ORVALHO MAX. NA HORA ANT. (AUT) (°C)",
    "TEMPERATURA ORVALHO MIN. NA HORA ANT. (AUT) (°C)",
    "UMIDADE REL. MAX. NA HORA ANT. (AUT) (%)",
    "UMIDADE REL. MIN. NA HORA ANT. (AUT) (%)",
    "UMIDADE RELATIVA DO AR, HORARIA (%)",
    "VENTO, DIREÇÃO HORARIA (gr) (° (gr))",
    "VENTO, RAJADA MAXIMA (m/s)",
    "VENTO, VELOCIDADE HORARIA (m/s)",
    "",                                    # a coluna vazia do fim, medida
])

METADADOS = "\n".join([
    "REGIAO:;CO", "UF:;DF", "ESTACAO:;BRASILIA", "CODIGO (WMO):;A001",
    "LATITUDE:;-15,78944444", "LONGITUDE:;-47,92583332",
    "ALTITUDE:;1160,96", "DATA DE FUNDACAO:;07/05/00",
])


def vg(x):
    """float -> texto com vírgula, como o arquivo escreve."""
    return "" if x is None else str(x).replace(".", ",")


def linha(dia, hora, chuva, t_inst, t_max_h, t_min_h, rajada, vento):
    c = [""] * 20
    c[0], c[1] = dia, f"{hora:02d}00 UTC"
    c[2] = vg(chuva)
    c[3], c[4], c[5] = "885,7", "885,7", "885,3"
    c[6] = ""                       # radiação vazia: é noite, e isso é real
    c[7] = vg(t_inst)
    c[8] = "18,2"
    c[9], c[10] = vg(t_max_h), vg(t_min_h)
    c[11], c[12] = "18,6", "18,2"
    c[13], c[14], c[15] = "81", "77", "79"
    c[16] = "311"
    c[17] = vg(rajada)
    c[18] = vg(vento)
    return ";".join(c)


# --- o dia de teste --------------------------------------------------------
# t_inst  = 20, exceto a hora 12 = 25          -> máximo instantâneo 25,0
# t_max_h = t_inst + 3                          -> máximo REAL do dia   28,0
# vento   = 5, exceto a hora 3 = 9              -> sustentado máximo     9,0
# rajada  = vento * 2                           -> rajada máxima        18,0
# chuva   = 0, exceto a hora 6 = 2,5            -> soma                  2,5
linhas_dia = []
for h in range(24):
    t = 25.0 if h == 12 else 20.0
    v = 9.0 if h == 3 else 5.0
    linhas_dia.append(linha("2024/01/01", h, 2.5 if h == 6 else 0, t, t + 3, t - 2, v * 2, v))

# Segundo dia: só 5 horas. O contrato manda o agregado virar null.
for h in range(5):
    linhas_dia.append(linha("2024/01/02", h, 0, 21.0, 24.0, 19.0, 8.0, 4.0))

CSV = METADADOS + "\n" + CABECALHO + "\n" + "\n".join(linhas_dia) + "\n"

print("\nleitura de numero e data")

ok("virgula decimal vira float", lambda: (_ for _ in ()).throw(
    AssertionError(numero("21,4"))) if numero("21,4") != 21.4 else None)

# float("21,4") levanta ValueError em Python; em outras linguagens trunca em
# silêncio. Aqui o risco é o contrário: engolir e devolver None onde havia dado.
ok("campo vazio vira None, e NAO zero", lambda: [
    (_ for _ in ()).throw(AssertionError("vazio virou " + repr(numero("")))) if numero("") is not None else None,
    (_ for _ in ()).throw(AssertionError("espaco virou " + repr(numero("  ")))) if numero("  ") is not None else None,
])

ok("zero continua sendo zero, e nao ausencia", lambda: (_ for _ in ()).throw(
    AssertionError(repr(numero("0")))) if numero("0") != 0.0 else None)

ok("a sentinela -9999 continua recusada, mesmo nao aparecendo em 2024",
   lambda: (_ for _ in ()).throw(AssertionError(repr(numero("-9999"))))
   if numero("-9999") is not None else None)

# `07/05/00` — a rede automática nasce em 2000, então 00 é 2000 e não 1900.
ok("ano de dois digitos vira 2000, e nao 1900", lambda: (_ for _ in ()).throw(
    AssertionError(str(fundacao_de("07/05/00")))) if fundacao_de("07/05/00") != date(2000, 5, 7) else None)

# "PRESSAO" e "PRESSÃO" convivem no MESMO arquivo de 2024.
ok("a normalizacao junta PRESSAO e PRESSÃO", lambda: (_ for _ in ()).throw(
    AssertionError()) if normalizar("PRESSÃO  ATMOSFERICA") != "PRESSAO ATMOSFERICA" else None)

print("\nos metadados da estacao")

est, fatos = ler_estacao("INMET_CO_DF_A001_BRASILIA_01-01-2024_A_31-12-2024.CSV", CSV)

ok("a estacao foi reconhecida", lambda: (_ for _ in ()).throw(
    AssertionError("nao leu")) if est is None else None)

ok("id, uf e regiao saem do bloco de metadados", lambda: [
    (_ for _ in ()).throw(AssertionError(est["estacao_id"])) if est["estacao_id"] != "A001" else None,
    (_ for _ in ()).throw(AssertionError(est["uf"])) if est["uf"] != "DF" else None,
    (_ for _ in ()).throw(AssertionError(str(est["regiao"]))) if est["regiao"] != "CO" else None,
])

ok("lat, lng e altitude vem com virgula decimal e nao truncam", lambda: [
    (_ for _ in ()).throw(AssertionError(str(est["lat"]))) if abs(est["lat"] + 15.78944444) > 1e-9 else None,
    (_ for _ in ()).throw(AssertionError(str(est["lng"]))) if abs(est["lng"] + 47.92583332) > 1e-9 else None,
    (_ for _ in ()).throw(AssertionError(str(est["altitude_m"]))) if abs(est["altitude_m"] - 1160.96) > 1e-9 else None,
])

ok("a estacao cai dentro do retangulo do Brasil", lambda: [
    (_ for _ in ()).throw(AssertionError("lat")) if not (-34 <= est["lat"] <= 6) else None,
    (_ for _ in ()).throw(AssertionError("lng")) if not (-74 <= est["lng"] <= -34) else None,
])

print("\nas duas armadilhas do arquivo")

d1 = next(f for f in fatos if f["data"] == date(2024, 1, 1))

# ARMADILHA 1. Se o parser tirar a maxima da coluna instantanea, sai 25,0 —
# plausivel, e sistematicamente baixo. O pico raramente cai no minuto cheio.
ok("a maxima vem da coluna de EXTREMO HORARIO (28,0), nao da instantanea (25,0)",
   lambda: (_ for _ in ()).throw(AssertionError(
       f"deu {d1['temperature_2m_max']}; 25,0 significa que pegou a coluna instantanea"))
   if abs(d1["temperature_2m_max"] - 28.0) > 1e-9 else None)

ok("a minima vem da coluna de extremo horario (18,0)",
   lambda: (_ for _ in ()).throw(AssertionError(str(d1["temperature_2m_min"])))
   if abs(d1["temperature_2m_min"] - 18.0) > 1e-9 else None)

# ARMADILHA 2. Rajada e' outra grandeza. Usa-la aqui encheria a coluna com
# valores ~2x e a comparacao com o ERA5 mediria a diferenca entre duas
# grandezas achando que mede vies de modelo.
ok("o vento e' a VELOCIDADE SUSTENTADA (9,0), nao a rajada (18,0)",
   lambda: (_ for _ in ()).throw(AssertionError(
       f"deu {d1['wind_speed_10m_max']}; 18,0 significa que pegou a rajada"))
   if abs(d1["wind_speed_10m_max"] - 9.0) > 1e-9 else None)

print("\nos agregados do dia")

# A MEDIA sai da instantanea -- e' o que "media das horas" significa.
ok("a media e' das horas instantaneas: (23x20 + 25)/24 = 20,2083...",
   lambda: (_ for _ in ()).throw(AssertionError(str(d1["temperature_2m_mean"])))
   if abs(d1["temperature_2m_mean"] - 485 / 24) > 1e-9 else None)

ok("a chuva e' a SOMA do dia (2,5), e nao o maximo horario",
   lambda: (_ for _ in ()).throw(AssertionError(str(d1["precipitation_sum"])))
   if abs(d1["precipitation_sum"] - 2.5) > 1e-9 else None)

ok("horas_validas = 24", lambda: (_ for _ in ()).throw(
    AssertionError(str(d1["horas_validas"]))) if d1["horas_validas"] != 24 else None)

ok("dia_do_ano = 1", lambda: (_ for _ in ()).throw(
    AssertionError(str(d1["dia_do_ano"]))) if d1["dia_do_ano"] != 1 else None)

ok("a fonte registra o arquivo de origem", lambda: (_ for _ in ()).throw(
    AssertionError(d1["fonte"])) if "A001_BRASILIA" not in d1["fonte"] else None)

print("\ndia incompleto")

d2 = next(f for f in fatos if f["data"] == date(2024, 1, 2))

# Uma maxima calculada com 5 horas do dia nao e' a maxima do dia, e sai com a
# mesma cara de um dia completo.
ok("com 5 horas validas TODOS os agregados sao null", lambda: [
    (_ for _ in ()).throw(AssertionError(f"{c} = {d2[c]}"))
    for c in ("temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
              "precipitation_sum", "wind_speed_10m_max")
    if d2[c] is not None
])

ok("mas horas_validas registra as 5, para a cobertura poder contar",
   lambda: (_ for _ in ()).throw(AssertionError(str(d2["horas_validas"])))
   if d2["horas_validas"] != 5 else None)

print("\narquivo que nao tem a forma esperada")

# Formato novo tem que aparecer como arquivo PULADO e contado, nao como estacao
# com dados vazios -- que passaria por estacao real sem medida.
ok("arquivo curto demais e' recusado", lambda: (_ for _ in ()).throw(
    AssertionError("aceitou")) if ler_estacao("x.CSV", "REGIAO:;CO\n")[0] is not None else None)

ok("codigo WMO fora do padrao e' recusado", lambda: (_ for _ in ()).throw(
    AssertionError("aceitou")) if ler_estacao("x.CSV", CSV.replace("A001", "XX1"))[0] is not None else None)

ok("cabecalho sem a coluna de temperatura e' recusado", lambda: (_ for _ in ()).throw(
    AssertionError("aceitou"))
    if ler_estacao("x.CSV", CSV.replace("TEMPERATURA DO AR - BULBO SECO, HORARIA (°C)", "OUTRA COISA"))[0] is not None
    else None)

print(f"\n  {mal} FALHA(S)\n" if mal else f"\n  {n} verificacoes\n")
sys.exit(1 if mal else 0)
