#!/usr/bin/env python3
"""
pipeline/model_server_template.py
-----------------------------------------------------------------------------
Servidor de Inferência FastAPI + ONNX Runtime para Modelos Meteorológicos de IA.
100% Gratuito, leve e compatível com o ObservEarth.

Modelos de Referência:
  - GraphCast (DeepMind)
  - FourCastNet (NVIDIA)
  - AIFS (ECMWF)

Rodar:
    pip install fastapi uvicorn numpy onnxruntime
    python pipeline/model_server_template.py

Variáveis de ambiente:
    AI_PORT   porta de escuta          (padrão 8000)
    AI_HOST   interface de escuta      (padrão 127.0.0.1 — ver `main`)
-----------------------------------------------------------------------------
"""

import os
import socket
import sys

import numpy as np

# -----------------------------------------------------------------------------
# CONSOLE EM UTF-8, ANTES DE QUALQUER `print`.
# -----------------------------------------------------------------------------
# No Windows o console herda a página de código do sistema — cp1252 em máquina
# brasileira — e o Python escreve UTF-8. O resultado aparecia assim na saída do
# `npm run dev:all`:
#
#     Servidor de Infer�ncia Neural Meteorol�gico rodando em ...
#
# Não é defeito do terminal nem do `concurrently`: é a codificação do fluxo de
# saída deste processo. `reconfigure` existe desde o Python 3.7; o `try` cobre
# o caso de a saída ser algo que não aceita reconfiguração, como um cano já
# fechado.
# -----------------------------------------------------------------------------
for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError, OSError):
        pass

try:
    from fastapi import FastAPI, Query
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("[ERRO] Para rodar o servidor de IA, instale as dependências:")
    print("pip install fastapi uvicorn numpy onnxruntime")
    sys.exit(1)

app = FastAPI(
    title="PhD Meteorological Neural Model Microservice",
    description="API local para servir previsões de modelos neurais em tempo real.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "online", "model": "NeuralForecast-v1 (GraphCast/FNO style)", "budget": "$0 free"}

@app.get("/predict")
def predict(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    lead_time_hours: int = Query(6, description="Horizonte de previsão (6h, 12h, 24h)")
):
    """
    Simula / realiza inferência de modelo neural treinado em ERA5/GFS.
    Retorna estimativa de parâmetros para o ponto desejado.

    ATENÇÃO: os números abaixo são SINTÉTICOS — fórmula fechada, sem modelo e
    sem dado. Este arquivo é um molde de integração, não uma fonte. O
    `confidence_score` de 0,94 é literal e não mede nada; ele existe para o
    cliente exercitar o formato da resposta.

    Nada disto alimenta o globo hoje. Quando alimentar, a procedência precisa
    viajar na resposta e a tela precisa lê-la — como já acontece com o vento,
    que declara quando cai do GFS de 0,25° para o recuo de 3°.
    """
    # Exemplo sintético demonstrativo da resposta da inferência neural
    base_temp = 25.0 - abs(lat) * 0.4 + np.sin(np.radians(lng)) * 2.0
    temp_pred = base_temp - (lead_time_hours * 0.1)
    wind_u = 5.0 * np.cos(np.radians(lat))
    wind_v = 3.0 * np.sin(np.radians(lng))
    pressure = 1013.25 - abs(lat) * 0.1

    return {
        "latitude": lat,
        "longitude": lng,
        "lead_time_hours": lead_time_hours,
        "model_architecture": "Fourier Neural Operator (FNO) / GraphNet",
        # Declarado na própria resposta: quem consumir não tem como confundir
        # este molde com previsão.
        "sintetico": True,
        "aviso": "valores gerados por fórmula fechada — molde de integração, não previsão",
        "predictions": {
            "temperature_2m_celsius": round(float(temp_pred), 2),
            "wind_u_component_ms": round(float(wind_u), 2),
            "wind_v_component_ms": round(float(wind_v), 2),
            "surface_pressure_hpa": round(float(pressure), 2),
            "confidence_score": 0.94
        }
    }


def porta_ocupada(host: str, porta: int, espera: float = 0.4) -> bool:
    """
    Alguém já está escutando aqui?

    O teste é por CONEXÃO, e não por `bind`. Um `bind` de sondagem se comporta
    de formas diferentes conforme `SO_REUSEADDR` e conforme o sistema — no
    Windows ele chega a conseguir sobrepor um ouvinte existente, que é
    exatamente o oposto do que se quer descobrir. Se `connect` completa, há
    alguém do outro lado. É simples e vale igual nos três sistemas.
    """
    alvo = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(espera)
        return s.connect_ex((alvo, porta)) == 0


def main() -> int:
    porta = int(os.environ.get("AI_PORT", "8000"))

    # ESCUTA LOCAL POR PADRÃO.
    #
    # Estava em 0.0.0.0, que publica na rede inteira um endpoint de inferência
    # sem autenticação nenhuma. Numa máquina de desenvolvimento em rede
    # compartilhada isso é exposição gratuita. Quem precisar do acesso externo
    # pede por `AI_HOST=0.0.0.0`, e aí é uma decisão, não um padrão herdado.
    host = os.environ.get("AI_HOST", "127.0.0.1")

    # -------------------------------------------------------------------------
    # PORTA OCUPADA NÃO É FALHA.
    # -------------------------------------------------------------------------
    # `npm run dev:all` sobe três processos, e é comum um deles sobreviver a um
    # encerramento anterior. O servidor Node já trata esse caso com uma linha
    # clara ("Porta 3001 em uso. O servidor backend já está ativo"); aqui a
    # mesma situação produzia doze linhas de INFO do uvicorn, um WinError 10048
    # com acento quebrado, e `exited with code 1` — que parece defeito e não é.
    #
    # A saída é 0 de propósito: já existe um servidor atendendo em 8000, então
    # não há nada errado. Sair com 1 marcaria a sessão inteira como falha.
    # -------------------------------------------------------------------------
    if porta_ocupada(host, porta):
        print(
            f"\n  [aviso] Porta {porta} já está em uso — o servidor de inferência "
            f"provavelmente já está rodando.\n"
            f"          Confira em http://localhost:{porta}/health\n"
            f"          Para subir outro, use AI_PORT=8001.\n",
            flush=True,
        )
        return 0

    # `flush=True` importa aqui. Sob `concurrently` a saída é um cano, e o
    # Python passa a bufferizar stdout — o banner chegava DEPOIS da mensagem de
    # erro do uvicorn, que vai por stderr sem buffer. A ordem invertida fazia
    # parecer que o servidor tinha subido e caído logo em seguida.
    print(f"\n  Servidor de Inferência Neural Meteorológico em http://localhost:{porta}\n", flush=True)

    try:
        uvicorn.run(app, host=host, port=porta)
    except OSError as e:
        # A janela entre a sondagem e o `bind` é pequena e existe: outro
        # processo pode ter tomado a porta no meio. Errno 48 é o BSD/macOS,
        # 98 o Linux, 10048 o Windows.
        if getattr(e, "errno", None) in (48, 98, 10048):
            print(f"\n  [aviso] Porta {porta} tomada durante a inicialização. "
                  f"Nada a fazer.\n", flush=True)
            return 0
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
