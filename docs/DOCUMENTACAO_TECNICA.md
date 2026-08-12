# DOCUMENTAÇÃO TÉCNICA COMPLETA & PIPELINE DE OPEN DATA
## ObservEarth 2.0 — Sistema GIS, Clima & Análise Socioambiental
### Arquitetura de Dados Apenas Open Data, Shaders WebGL e Catálogo Exclusivo de Dataviz

---

## SUMÁRIO

1. **Arquitetura Geral do Sistema (Open Data Pipeline)**
2. **Pipelines de Processamento por Tipo de Dado (Raster, Vetorial, Pontos, Derivados)**
3. **Catálogo Exclusivo de Formas e Efeitos de Dataviz (Zero Repetição Técnica)**
4. **Regra de Ouro: Hierarquia Z-Index por Família de Dados**
5. **Desenvolvimento de Modelo Próprio de IA (Fourier Neural Operator - FNO2d)**
6. **Cronograma de Implementação & Decisões Críticas de Infraestrutura ($0 Open Data)**

---

## 1. ARQUITETURA GERAL DO SISTEMA (OPEN DATA PIPELINE)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FONTES GRATUITAS DE DADOS                            │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────────┤
│   Raster     │  Vetorial    │   Pontos     │  Eventos     │   NetCDF/GRIB    │
│  (COG/XYZ)   │ (GeoJSON)    │  (GeoJSON)   │  (CSV/JSON)  │    (derivados)   │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴────────┬─────────┘
       │              │              │              │                │
       ▼              ▼              ▼              ▼                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      PROCESSAMENTO (Python + GDAL)                           │
├────────────────┬────────────────┬────────────────┬───────────────────────────┤
│  gdalwarp      │  Tippecanoe    │  pandas/       │  xarray + metpy           │
│  gdal2tiles.py │  → MVT tiles   │  geopandas     │  (cálculo derivados)      │
│  rio-viz       │  ogr2ogr       │  (spatial join)│  (WBGT, anomalias)        │
└────────┬───────┴────────┬───────┴────────┬───────┴───────────────┬───────────┘
         │                │                │                       │
         ▼                ▼                ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      SERVIÇO DE TILES (self-hosted)                          │
├──────────────────────────────────────────────────────────────────────────────┤
│  TiTiler / Cogeo-mosaic  →  raster COG via HTTP range (sem tiling prévio)   │
│  TileServer GL / Martin  →  MVT vetoriais (power lines, fronteiras)         │
│  nginx cache / CDN       →  cache de tiles imutáveis                        │
└──────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      CLIENTE — GLOBE WEBGL (THREE.JS / DECK.GL)               │
├──────────────────────────────────────────────────────────────────────────────┤
│  • TileLayer (raster: população, uso do solo, qualidade do ar)               │
│  • LineLayer / PathLayer (rede elétrica, hidrovias, ZEE)                     │
│  • ScatterplotLayer + HeatmapLayer (hospitais, eventos GDELT)                │
│  • ParticleLayer (correntes HYCOM / vento GFS GPU)                           │
│  • PolygonLayer / ColumnLayer (choropleth: vulnerabilidade, GHSL)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. PIPELINES DE PROCESSAMENTO POR TIPO DE DADO

### A. RASTER (WorldPop, GHSL, ESA WorldCover, GloFAS, NASA GIBS)
- **Download**: STAC API / Wget direto (`https://hub.worldpop.org/geodata/listing?id=76`).
- **Reprojeção**: `gdalwarp -t_srs EPSG:4326 -tr 0.001 0.001 input.tif output.tif`
- **Tiling**: `gdal2tiles.py -z 0-8 --xyz input.tif ./tiles/`
- **Servidor**: TiTiler (`uvicorn main:app`) para streaming de Cloud Optimized GeoTIFFs (COG) via HTTP range sem pré-processar milhões de arquivos PNG.

### B. VETORIAL DENSO (Rede Elétrica OSM, Hidrovias Natural Earth, ZEE Marineregions)
- **Download**: Overpass API (`http://overpass-api.de/api/interpreter?data=[out:json];way[power=line];out geom;`).
- **Simplificação**: `mapshaper -i input.geojson -simplify 10% -o output.geojson`
- **MVT Tiling**: `tippecanoe -o infra.mbtiles -z 10 -Z 0 --drop-densest-as-needed input.geojson`
- **Servidor**: TileServer GL (`tileserver-gl --mbtiles infra.mbtiles`).

### C. PONTOS GEOREFERENCIADOS (OpenAQ Ar, Hospitais OSM, Conflitos GDELT)
- **Normalização**: GeoPandas em Python (`gdf = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.lon, df.lat))`).
- **Visualização**: ScatterplotLayer ou HeatmapLayer com filtro deslizante de tempo no cliente.

### D. DADOS DERIVADOS (MetPy - Zero Custo de Aquisição)
- **Input**: NOAA GFS GRIB2 (Temperatura $T_{2m}$ + Umidade Relativa $RH$).
- **Cálculo (MetPy)**: `mpcalc.wet_bulb_temperature(pressure, T, Td)` para obter a Temperatura de Globo de Bulbo Úmido (WBGT).
- **Exportação**: GeoTIFF com `ds.rio.to_raster("wetbulb.tif")` e cache via Redis (`chave: wbgt_{run}_{hour}`).

---

## 3. CATÁLOGO EXCLUSIVO DE FORMAS E EFEITOS DE DATAVIZ (ZERO REPETIÇÃO TÉCNICA)

Para garantir que a sobreposição de múltiplas camadas ativas **nunca resulte em uma "sopa de pixels" incompreensível**, cada domínio técnico possui uma **técnica e forma visual exclusiva e inconfundível**:

| Domínio de Dado | Fonte Open Data | Forma & Efeito Visual Exclusivo | Comportamento & Justificativa Científica |
| :--- | :--- | :--- | :--- |
| **1. Fluidos & Dinâmica Atmosférica** | GFS 0.25° / HYCOM Ocean | **Partículas GPU com Rastro e Decay Advectivo (FBO Ping-Pong)** | Vetores de vento e correntes marítimas representados como 131.072 partículas em movimento contínuo sobre a esfera. O rastro esmaece proporcionalmente à intensidade do vetor $(u, v)$. |
| **2. Redes de Infraestrutura & Energia** | OpenStreetMap (Linhas de Energia, Subestações, Dutos) | **Linhas de Néon Animadas com Pulso Tridimensional (Glow & Dashed Flow)** | Linhas luminescentes flutuantes ligeiramente acima do solo (`polygonAltitude: 0.003`) com animação de traço tracejado (*dash animation*) indicando a direção do fluxo elétrico/logístico. |
| **3. Densidade Humana & Assentamentos** | WorldPop 100m / GHSL (Global Human Settlement) | **Colunas e Prismas Extrudados 3D (Hexbin / Grid Bar 3D Height Map)** | Extrusões volumétricas verticais em barras 3D proporcional à população por $km^2$. A altura da coluna codifica a massa populacional, eliminando ambiguidades entre cidades densas e regiões esparsas. |
| **4. Eventos Geopolíticos & Crises em Tempo Real** | GDELT Event Database / USGS Sismos | **Pulse Rings & Ondas de Choque Cónicas (Shockwave Ripple Rings)** | Anéis concêntricos animados que se expandem a partir do epicentro do evento (protestos, conflitos, tremores) e esmaecem suavemente (*ripple opacity fade*), capturando atenção imediata sem cobrir dados estáticos. |
| **5. Cobertura Vegetal & Uso do Solo** | ESA WorldCover 10m / MapBiomas | **Mosaico Categórico Texturizado com Color Palette Discreta (Isolines & Categorical Shading)** | Mosaico de superfícies estáticas com paleta de cores categorizada plana (florestas = esmeralda, agricultura = palha, áreas urbanas = ardósia), otimizada para discernimento visual instantâneo sem gradientes contínuos. |
| **6. Zonas de Risco & Inundação** | GloFAS Flood Hazard / Copérnico | **Superfície Isométrica Isolada com Shader de Pulsação de Risco (Transparent Dynamic Overlay)** | Máscara de textura bi-dimensional transparente com cintilação suave e contornos cromáticos destacando áreas suscetíveis a alagamentos ou secas extremas. |
| **7. Pontos de Interesse Críticos (POIs)** | OpenAQ (Estações do Ar), Hospitais OSM | **Marcadores Semânticos 3D Vetoriais com Halo Retrátil (Semantic Billboards + Proximity Halo)** | Ícones vetoriais dinâmicos em SVG/DOM que mantêm tamanho constante independente da distância de câmera, envoltos por um halo de luz circular que expande ao passar o mouse. |
| **8. Fluxos Migratórios & Deslocamento** | UNHCR Refugiados / OpenSky Network | **Arcos Parabólicos 3D Geodésicos (Great Circle Flow Arcs)** | Arcos em parábola 3D que emergem do ponto de origem, curvam-se na alta atmosfera e aterrissam no destino, com cometas de luz deslizando ao longo da curva indicando volume e direção do fluxo. |

---

## 4. REGRA DE OURO: HIERARQUIA Z-INDEX POR FAMÍLIA DE DADOS

Quando o usuário ativa 3 ou mais camadas simultaneamente, a hierarquia de profundidade Z-Index garante ordenação visual e transparência perfeita:

```
z-100:  Partículas GPU (vento, correntes oceânicas) — topo absoluto, semi-transparente
z-80:   Linhas de Néon com Glow (rede elétrica, dutos, cabos) — sobre a superfície
z-70:   Arcos Parabólicos 3D (fluxos migratórios, aviação) — atmosfera superior
z-60:   Volumes 3D Extrudados (população WorldPop, densidade de infraestrutura)
z-50:   Pulse Rings Animados (eventos GDELT, sismos USGS ao vivo)
z-40:   Superfícies Categóricas & Risco (inundação GloFAS, uso do solo ESA WorldCover)
z-20:   Marcadores Semânticos 3D (hospitais, estações OpenAQ)
z-0:    Base Esférica do Globo (Relevo Normal Map + Imagem de Satélite Blue Marble)
```

---

## 5. DESENVOLVIMENTO DE MODELO PRÓPRIO DE IA (FOURIER NEURAL OPERATOR - FNO2D)

### Arquitetura: Fourier Neural Operator 2D (PyTorch)
Implementado em `pipeline/train_fno_model.py` com Transformada Rápida de Fourier (2D FFT) no espaço espectral para prever a evolução do estado atmosférico ($t \rightarrow t+6h$) e servido via microserviço FastAPI (`pipeline/model_server_template.py`).

```python
# Fourier Neural Operator Layer 2D
class SpectralConv2d(nn.Module):
    def __init__(self, in_channels, out_channels, modes1, modes2):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.modes1 = modes1  # Modos de Fourier latitudinais
        self.modes2 = modes2  # Modos de Fourier longitudinais
        self.weights1 = nn.Parameter(torch.rand(in_channels, out_channels, self.modes1, self.modes2, dtype=torch.cfloat))
        self.weights2 = nn.Parameter(torch.rand(in_channels, out_channels, self.modes1, self.modes2, dtype=torch.cfloat))

    def forward(self, x):
        # 1. FFT 2D para o espaço de frequências
        x_ft = torch.fft.rfft2(x)
        # 2. Multiplicação por pesos aprendidos nos modos espectrais baixos
        out_ft = torch.zeros_like(x_ft)
        out_ft[:, :, :self.modes1, :self.modes2] = self.compl_mul2d(x_ft[:, :, :self.modes1, :self.modes2], self.weights1)
        # 3. IFFT 2D de volta para o espaço físico
        x = torch.fft.irfft2(out_ft, s=(x.size(-2), x.size(-1)))
        return x
```

---

## 6. CRONOGRAMA DE IMPLEMENTAÇÃO & INFRAESTRUTURA ($0 OPEN DATA)

| Semana | Fase | Camadas Entregues | Custo de Licença |
| :--- | :--- | :--- | :--- |
| **1–2** | Fundação GIS & Redes | Rede elétrica OSM + Hospitais OSM + Natural Earth (hidrovias, ZEE) | $0 |
| **3–4** | População & Extrusão | WorldPop 100m + GHSL (assentamentos) com extrusões 3D | $0 |
| **5–6** | Saúde & Risco Climático | Wet Bulb WBGT (derivado GFS) + Qualidade do Ar OpenAQ/CAMS + Inundação GloFAS | $0 |
| **7–8** | Uso do Solo & Eventos | ESA WorldCover / MapBiomas + Eventos GDELT (pulse rings animados) | $0 |
| **9–10** | Hidrodinâmica & Fluxos | HYCOM Correntes Oceânicas (partículas GPU) + UNHCR Fluxos Migratórios | $0 |

---

### Decisões Críticas de Infraestrutura ($0 Adicional):
1. **Raster**: COG + TiTiler via HTTP Range (evita gerar e armazenar milhões de arquivos PNG estáticos).
2. **Vetorial**: MVT comprimido via Tippecanoe + TileServer GL (comprime GeoJSONs de GBs em Mb).
3. **GDELT**: Filtro prévio por códigos CAMEO (14 = protestos, 20 = violência massiva) via Awk/Python antes de geocodificar.
4. **Cache HTTP**: `proxy_cache` no Nginx configurado por timestamp imutável.
