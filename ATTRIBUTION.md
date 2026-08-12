# Atribuição das fontes de dados

O código deste repositório está sob a licença MIT (ver `LICENSE`). **Os dados
não.** Cada fonte tem os seus próprios termos, e algumas **exigem** atribuição
visível de quem publica qualquer coisa feita com elas.

Se você for hospedar este app, publicar uma imagem gerada por ele ou usar os
dados num trabalho, esta página é a sua lista de obrigações.

---

## Exigem atribuição

### Mapzen Terrain Tiles — relevo e batimetria

Tiles de elevação servidos pela AWS Open Data (`elevation-tiles-prod`).
Agregam vários levantamentos públicos, entre eles SRTM, GMTED e batimetria
oceânica.

- Termos e texto de atribuição: <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- Registro AWS: <https://registry.opendata.aws/terrain-tiles/>

> A lista de créditos varia conforme a região exibida, porque cada área vem de
> um levantamento diferente. Consulte o documento acima antes de publicar: ele é
> a fonte oficial do texto exigido, e este arquivo não substitui a leitura dele.

### Open-Meteo — previsão, reanálise, sondagem e correntes

Usado na sonda do clique, nas séries históricas, no perfil vertical, na
comparação entre modelos e nas correntes oceânicas.

- Licença: CC BY 4.0
- Site: <https://open-meteo.com/>

Os dados subjacentes são de terceiros e têm créditos próprios: **ERA5** do
ECMWF/Copernicus, **ICON** do DWD, **GFS** do NOAA, e as correntes do
**Copernicus Marine Service (SMOC)**.

---

## Pedem reconhecimento

### NASA GIBS — imagens de satélite e reanálise

Global Imagery Browse Services, parte do ESDIS da NASA. É a origem de todas as
camadas de satélite e de reanálise MERRA-2 e GEOS.

- Documentação: <https://nasa-gibs.github.io/gibs-api-docs/>
- Site: <https://worldview.earthdata.nasa.gov/>

A NASA pede reconhecimento do uso das imagens e dos serviços do GIBS/ESDIS.
Confira o texto vigente na documentação antes de publicar.

### NASA FIRMS — focos de calor

Fire Information for Resource Management System, sensor VIIRS a 375 m.

- <https://firms.modaps.eosdis.nasa.gov/>

---

## Domínio público

Sem obrigação formal, mas creditar é o mínimo de honestidade.

- **USGS Earthquake Hazards Program** — sismos ao vivo. <https://earthquake.usgs.gov/>
- **NOAA / NCEP** — modelo GFS, obtido em GRIB2 pelo NOMADS. <https://nomads.ncep.noaa.gov/>
- **Natural Earth** — fronteiras e rótulos. <https://www.naturalearthdata.com/>
- **OpenAQ** — qualidade do ar. <https://openaq.org/>

---

## Bibliotecas

three.js, globe.gl, React, Vite, Zustand, Radix UI, lucide-react, cmdk e
`@mlc-ai/web-llm`, cada uma sob a sua própria licença — ver `package.json` e
`node_modules/<pacote>/LICENSE`.

---

## Uma observação sobre o que este arquivo NÃO é

Isto é um mapa das obrigações, não parecer jurídico. Os termos de cada serviço
mudam, e quem publica é responsável por conferir a versão vigente nos links
acima. Em caso de dúvida entre o que está escrito aqui e o que está na fonte,
**a fonte vence**.
