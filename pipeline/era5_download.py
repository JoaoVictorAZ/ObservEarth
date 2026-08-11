#!/usr/bin/env python3
"""
pipeline/era5_download.py
-----------------------------------------------------------------------------
Script de download de dados históricos ERA5 (Copernicus Climate Data Store - CDS)
100% Gratuito para Pesquisa Acadêmica e Doutorado.

Requisitos:
    pip install cdsapi

Configuração:
    Crie o arquivo ~/.cdsapirc com suas credenciais gratuitas da Copernicus:
    url: https://cds.climate.copernicus.eu/api/v2
    key: UID:API-KEY
-----------------------------------------------------------------------------
"""

import os
import sys

def download_era5_sample(year="2024", month="01", day="01", output_nc="era5_sample.nc"):
    """
    Baixa dataset de reanálise ERA5 em formato NetCDF para variáveis superficiais.
    """
    try:
        import cdsapi
    except ImportError:
        print("[AVISO] cdsapi não instalado. Para instalar execute: pip install cdsapi")
        print("Exemplo de requisição Python para ERA5:")
        print_code_example(year, month, day, output_nc)
        return

    print(f"[CDS API] Solicitando ERA5 Reanalysis para {year}-{month}-{day}...")
    try:
        c = cdsapi.Client()
        c.retrieve(
            'reanalysis-era5-single-levels',
            {
                'product_type': 'reanalysis',
                'variable': [
                    '2m_temperature',
                    '10m_u_component_of_wind',
                    '10m_v_component_of_wind',
                    'mean_sea_level_pressure',
                    'total_precipitation'
                ],
                'year': str(year),
                'month': str(month).zfill(2),
                'day': str(day).zfill(2),
                'time': ['00:00', '06:00', '12:00', '18:00'],
                'format': 'netcdf',
            },
            output_nc
        )
        print(f"[OK] Dados ERA5 salvos em {output_nc}")
    except Exception as e:
        print(f"[ERRO] Falha ao comunicar com a CDS API: {e}")
        print("Certifique-se de configurar o arquivo ~/.cdsapirc")

def print_code_example(year, month, day, output_nc):
    code = f"""
import cdsapi

c = cdsapi.Client()
c.retrieve('reanalysis-era5-single-levels', {{
    'product_type': 'reanalysis',
    'variable': [
        '2m_temperature', '10m_u_component_of_wind',
        '10m_v_component_of_wind', 'mean_sea_level_pressure'
    ],
    'year': '{year}',
    'month': '{month:0>2}',
    'day': '{day:0>2}',
    'time': ['00:00', '06:00', '12:00', '18:00'],
    'format': 'netcdf'
}}, '{output_nc}')
"""
    print(code)

if __name__ == "__main__":
    print("=== Pipeline de Download ERA5 (Acadêmico) ===")
    download_era5_sample()
