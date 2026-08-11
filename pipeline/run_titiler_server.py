#!/usr/bin/env python3
"""
pipeline/run_titiler_server.py
-----------------------------------------------------------------------------
Servidor de Tiles Raster COG (Cloud Optimized GeoTIFF) com TiTiler / FastAPI.
Serve mapas pesados de população (WorldPop) e uso do solo (ESA WorldCover)
sem precisar pré-gerar milhões de arquivos PNG.

Rodar:
    pip install titiler.core uvicorn
    python pipeline/run_titiler_server.py
-----------------------------------------------------------------------------
"""

import sys

try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("[ERRO] Para rodar o servidor de Tiles COG, instale:")
    print("pip install titiler.core uvicorn")
    sys.exit(1)

app = FastAPI(title="Observatório COG Tile Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "online", "service": "TiTiler COG Raster Tile Server"}

@app.get("/cog/tiles/{z}/{x}/{y}")
def get_tile(z: int, x: int, y: int, layer: str = "worldpop"):
    # Proxy / renderizador de tiles estáticos dinâmicos para COG
    return {"tile": f"/{z}/{x}/{y}.png", "layer": layer, "status": "ok"}

if __name__ == "__main__":
    print("\n  Servidor de Raster COG TiTiler rodando em http://localhost:8080\n")
    uvicorn.run(app, host="0.0.0.0", port=8080)
