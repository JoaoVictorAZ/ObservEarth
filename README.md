# Observatório da Terra

Globo interativo com dados reais de observação da Terra. Imagens de satélite da
NASA, correntes de ar animadas, terremotos ao vivo e sonda meteorológica por
clique, tudo navegável por data.

## Rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`. O comando `dev` sobe o backend (porta 3001) e o
frontend juntos. Se preferir separados, use `npm run server` e `npm run web` em
dois terminais.

Nenhuma chave de API é necessária.

## As duas naturezas de camada

Ambas chegam como imagem do NASA GIBS. A diferença está no produto, não no
transporte.

**Modelo** (MERRA-2, GEOS). Reanálise e assimilação: o modelo calcula valor em
**cada ponto do planeta**, inclusive onde nenhum satélite olhou. Cobertura
sempre total. É o que o Windy mostra.

**Satélite** (MODIS, VIIRS). Observação direta. Só existe onde o sensor passou,
de dia e sem nuvem. Buraco é a regra, e para incêndio ou gelo isso está
**correto**: um incêndio é localizado mesmo.

Os identificadores das camadas de modelo não são escritos à mão. O servidor lê
o `GetCapabilities` do próprio GIBS e expõe o que realmente existe, filtrando
por prefixo `MERRA2_` e `GEOS_`. Se a NASA publicar novas, elas aparecem
sozinhas.

## Por que a Open-Meteo não serve para grade global

A Open-Meteo cobra por **localização**, não por requisição. Uma grade de 4 graus
são 4.050 pontos, ou seja, 4.050 unidades de cota para **um** campo. O limite
diário gratuito é 10.000. Estoura em duas camadas, e o que sobra na tela são
faixas vazias. Isso não é ajustável, é aritmética.

Ela continua sendo a fonte certa onde a consulta por ponto é natural: a **sonda
do clique**, que é literalmente um ponto, e o **campo de vento das partículas**,
onde a grade grossa não importa porque a advecção suaviza a trajetória.

## Estrutura

```
server/index.js    backend inteiro: proxy GIBS, vento, sonda, terremotos, fronteiras
src/globe.ts       motor: globe.gl, three.js, shaders, partículas
src/App.tsx        interface
src/index.css      estilo
src/main.tsx       ponto de entrada
```

Cinco arquivos de código. A concentração é deliberada: o motor encapsula todo o
contato com three.js e globe.gl, então a interface nunca lida com geometria.

## Fontes

NASA GIBS (imagens), Open-Meteo (vento e sonda), USGS (terremotos),
Natural Earth (fronteiras).
