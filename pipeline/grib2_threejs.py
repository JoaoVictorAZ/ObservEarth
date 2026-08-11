#!/usr/bin/env python3
"""
pipeline_grib2_threejs.py
-----------------------------------------------------------------------------
Pipeline 100% gratuito para Trabalhos de Campo e Pesquisa em Meteorologia.
Baixa arquivos GRIB2 do NOAA NOMADS (GFS) e converte para texturas PNG
ou arrays raw (.npy) prontas para visualização em Three.js / WebGL.

Requisitos:
    pip install xarray cfgrib netcdf4 pillow numpy requests
    (ou conda install -c conda-forge wgrib2 eccodes)

Uso:
    python pipeline_grib2_threejs.py --date 2026-08-06 --cycle 12 --forecast 000
-----------------------------------------------------------------------------
"""

import argparse
import os
import sys
import numpy as np
from PIL import Image

try:
    import urllib.request
except ImportError:
    pass

def download_gfs_grib2(date_str, cycle="00", forecast_hr="000", output_path="gfs.grib2"):
    """
    Baixa arquivo GRIB2 do GFS 0.25° via NOAA NOMADS.
    URL Base: https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
    """
    date_formatted = date_str.replace("-", "")
    url = (
        f"https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?"
        f"file=gfs.t{cycle}z.pgrb2.0p25.f{forecast_hr}&"
        f"all_var=on&all_lev=on&subregion=&"
        f"toplat=90&leftlon=-180&rightlon=180&bottomlat=-90&"
        f"dir=%2Fgfs.{date_formatted}%2F{cycle}%2Fatmos"
    )
    print(f"[NOMADS] Baixando GFS {date_str} {cycle}Z f{forecast_hr}...")
    print(f"URL: {url}")
    
    try:
        urllib.request.urlretrieve(url, output_path)
        print(f"[OK] Salvo em: {output_path} ({os.path.getsize(output_path)} bytes)")
        return output_path
    except Exception as e:
        print(f"[ERRO] Falha ao baixar do NOMADS: {e}")
        return None

def process_grib_to_png(grib_path, variable="tmp_2m", output_png="texture.png"):
    """
    Processa array escalar (ex: Temperatura 2m ou Pressão ao Nível do Mar)
    e normaliza para PNG 16-bit ou 8-bit equiretangular (360° x 180°).
    """
    try:
        # pyrefly: ignore [missing-import]
        import xarray as xr
    except ImportError:
        print("[ERRO] xarray e cfgrib necessários para abrir GRIB2 em Python.")
        print("Instale com: pip install xarray cfgrib eccodes")
        return False

    print(f"[xarray] Abrindo {grib_path}...")
    try:
        ds = xr.open_dataset(grib_path, engine="cfgrib")
        print("Variáveis encontradas no dataset:", list(ds.data_vars.keys()))
        
        # Seleciona primeira variável se específica não for achada
        var_name = list(ds.data_vars.keys())[0]
        data = ds[var_name].values
        
        # Normalização [0, 255]
        min_val, max_val = np.nanmin(data), np.nanmax(data)
        print(f"Valores no grid: min={min_val:.2f}, max={max_val:.2f}")
        
        norm = (data - min_val) / (max_val - min_val + 1e-6)
        uint8_data = (norm * 255).astype(np.uint8)
        
        img = Image.fromarray(uint8_data)
        img = img.resize((2048, 1024), Image.Resampling.BILINEAR)
        img.save(output_png)
        print(f"[OK] Textura PNG gerada com sucesso: {output_png}")
        return True
    except Exception as e:
        print(f"[ERRO] Falha no processamento: {e}")
        return False

def generate_sample_texture(output_png="sample_temperature.png"):
    """
    Gera uma textura de teste sintética no formato equiretangular
    caso o ambiente não tenha eccodes/cfgrib instalados.
    """
    lats = np.linspace(90, -90, 1024)
    lons = np.linspace(-180, 180, 2048)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    
    # Gradiente de temperatura sintético (quente no equador, frio nos polos + perturbações)
    temp = 300 - 40 * np.abs(lat_grid / 90.0) ** 1.5 + 5 * np.sin(np.radians(lon_grid * 3))
    norm = (temp - np.min(temp)) / (np.max(temp) - np.min(temp))
    uint8_img = (norm * 255).astype(np.uint8)
    
    img = Image.fromarray(uint8_img)
    img.save(output_png)
    print(f"[Sintético] Textura de teste criada: {output_png}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipeline GRIB2 -> Three.js Texture")
    parser.add_argument("--date", default="2026-08-06", help="Data AAA-MM-DD")
    parser.add_argument("--cycle", default="00", help="Ciclo (00, 06, 12, 18)")
    parser.add_argument("--forecast", default="000", help="Hora de previsão (000, 003, ...)")
    parser.add_argument("--out", default="temperature_gfs.png", help="Arquivo de saída PNG")
    parser.add_argument("--synthetic", action="store_true", help="Gera textura de teste sintética")
    
    args = parser.parse_args()
    
    if args.synthetic:
        generate_sample_texture(args.out)
    else:
        grib = download_gfs_grib2(args.date, args.cycle, args.forecast)
        if grib:
            process_grib_to_png(grib, output_png=args.out)
        else:
            print("Gerando amostra sintética de demonstração...")
            generate_sample_texture(args.out)
