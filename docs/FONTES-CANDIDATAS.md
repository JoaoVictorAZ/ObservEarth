# Fontes candidatas — o que falta e o que dá para preencher

**ObservEarth** · levantamento de 07/09/2026

---

## 0. Método, e o que ele não garante

O inventário do §1 foi lido do código (`src/design/taxonomy.ts` e as rotas de `server/index.js`), não de memória. As fontes do §3 foram **consultadas na web hoje**; as do §4 são candidatas que eu conheço mas **não verifiquei agora** — e a diferença está marcada em cada uma, porque endpoint muda e licença muda.

Nenhuma destas fontes foi testada com uma requisição real. "Existe e é aberta" não é a mesma coisa que "responde com o que a gente precisa no formato que a gente usa". A primeira coisa a fazer com qualquer uma delas é uma requisição de teste.

---

## 1. O que o app cobre hoje

| Domínio | Camadas existentes | Fonte |
|---|---|---|
| Escoamento atmosférico | vento à superfície, malha 3D do campo, vórtices | GFS 0,25° (GRIB2) |
| Escoamento oceânico | correntes | HYCOM |
| Estrutura | isóbaras, relevo e batimetria, fronteiras | GFS PRMSL · Mapzen/SRTM/GEBCO |
| Ocorrência | sismos, focos de calor, qualidade do ar, hospitais | USGS · VIIRS 375 m · OpenAQ · OSM |
| Ponto | sondagem vertical, série histórica, comparação entre modelos, climatologia e anomalia | Open-Meteo · ERA5 |
| Imagem | mosaicos diários | NASA GIBS |

---

## 2. Os buracos, ordenados por tamanho

| # | Domínio | Situação | Por que dói |
|---|---|---|---|
| 1 | **Hidrologia** | **zero** | Enchente é o desastre número um do Brasil. O app não sabe onde tem rio, quanto menos o nível dele. |
| 2 | **Alertas oficiais** | **zero** | O app mostra dado e nunca mostra **consequência declarada por autoridade**. |
| 3 | **Índices climáticos (ENSO)** | **zero** | A sonda diz "percentil 92" e não consegue dizer "e este é um ano de El Niño". Falta o contexto que explica a anomalia. |
| 4 | **Oceano além de correntes** | **zero** | Sem TSM nem anomalia de TSM — e anomalia virou a espinha dorsal do app. |
| 5 | **Vegetação, uso do solo, desmatamento** | **zero** | `pipeline/ingest_open_data.py` cita WorldCover e WorldPop, mas **nenhuma camada existe**. |
| 6 | **Descargas atmosféricas** | zero | A tempestade aparece como isóbara e vento; nunca como raio. |
| 7 | **Criosfera** | zero | Gelo marinho e neve. Impacto baixo para o Brasil, alto para "observação da Terra". |
| 8 | **Ciclones tropicais** | zero | Alto valor global, baixo para o Atlântico Sul. |
| 9 | **Exposição humana** | só hospitais | Sem população, todo dado é sobre lugares e nenhum é sobre gente. |

---

## 3. Fontes verificadas hoje

### 3.1 Avisos meteorológicos do INMET (Alert-AS) — **buraco 2**

> **Recomendação nº 1.** Melhor razão valor/esforço de toda a lista.

- **Acesso:** `https://apiprevmet3.inmet.gov.br/avisos/rss` — RSS, **sem chave**.
- **Verificação:** o link está publicado no rodapé do próprio portal do INMET, ao lado das redes sociais.
- **Licença:** mesmo regime dos demais dados do INMET — dado público sob LAI, **sem licença explícita declarada**. Mesma ressalva do §5 do roadmap.
- **O que entra na tela:** polígonos de aviso por severidade e por período de vigência, com o texto oficial.
- **Por que é a nº 1:** transforma o app de "aqui está o dado" em "aqui está o dado **e** o que a autoridade diz sobre ele". É a única fonte da lista que fala em consequência.
- **Esforço:** baixo. Parser de RSS, polígono por município, camada de família *ocorrência*.
- **Cuidado:** aviso tem **validade**. Um aviso expirado desenhado como ativo é pior que nenhum aviso. A camada precisa de relógio próprio.

### 3.2 Anomalia de TSM e Degree Heating Weeks — NOAA Coral Reef Watch — **buraco 4**

> **Recomendação nº 2.** É a que encaixa com menos atrito na arquitetura que já existe.

> **CORRIGIDO EM 07/09/2026, DEPOIS DE MEDIR O CATÁLOGO.** Duas coisas que eu
> tinha escrito de cabeça estavam erradas, e a segunda é séria. O que está
> abaixo veio do `.das` do dataset, não de memória.

- **Acesso:** ERDDAP `griddap`, HTTP puro, **sem chave**, resposta em JSON/CSV/NetCDF sob demanda.
  - `https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW` — **um dataset só**.
  - Eu tinha anotado dois datasets em dois servidores (`CRW_sst_anom_v1_0` e
    `CRW_dhw_v1_0`, no ERDDAP do PIFSC). Não precisa: `NOAA_DHW` traz
    `CRW_SST`, `CRW_SSTANOMALY`, `CRW_DHW`, `CRW_HOTSPOT` e `CRW_BAA` no mesmo
    lugar, e o griddap aceita as três numa requisição só.
- **Resolução:** 0,05° (5 km), diário. Grade de **3600 × 7200 = 25,9 milhões de
  células** — global inteira está fora de questão, tem que ir de `stride`.
- **Latência:** o dataset declara `testOutOfDate "now-60hours"`. **A camada
  nunca mostra hoje**; o mais recente é ontem, e o próprio provedor considera
  normal ficar até 60 h sem atualizar. A tela tem que dizer a data do dado.
- **Valor de preenchimento:** `-327.68` em SST, anomalia, DHW e HotSpot. Se
  vazar para a rampa, pinta o continente inteiro no fundo da escala. `CRW_BAA` é
  `Byte` **sem sinal** com `_FillValue -5` — que aparece como **251** em leitura
  sem sinal, e a própria licença avisa disso.
- **Escalas oficiais** (do `colorBarMinimum/Maximum`, para não inventar
  as nossas): anomalia −5…+5 °C, DHW 0…16 °C-semanas, SST −2…34 °C.
- **`CRW_BAA` é classificação, não medida** — `thematicClassification`, com
  `flag_meanings` "no_stress watch warning alert_level1 alert_level2". Vai de
  `modo: "faixas"` na régua, e não de rampa contínua. Essa distinção já existe
  em `src/legenda/regua.ts` e é exatamente para isto.

- **Licença — NÃO é simplesmente domínio público.** Isto era o erro que
  importava. O campo `license` do dataset tem **três regimes**, por período:
  - **1985–2002:** vem do OSTIA, do **UK Met Office**. Uso *"for pure academic
    research only, with no commercial or other application"*, prazo máximo de 5
    anos, exigência de **formulário de licença de reprodução** preenchido e de
    declaração de copyright da Crown.
  - **2002 até hoje:** GHRSST, *"free and open"*.
  - **Coral Reef Watch:** sem restrição de uso, mas com pedido explícito de
    crédito e citação com DOI.

  **Consequência de desenho:** a camada fica no **presente** (últimos dias), que
  é o regime GHRSST livre. Se algum dia a linha do tempo puder recuar até antes
  de 2002, aquilo é outro regime jurídico e precisa de aviso — não é a mesma
  fonte só que mais antiga.

- **Por que encaixa tão bem:** é um **campo em grade**, exatamente como os campos do GFS que `server/fields.js` já sabe consumir e desenhar. E é **anomalia** — a mesma gramática que o app adotou nesta semana. Não é uma camada nova conceitualmente; é a mesma ideia aplicada ao oceano.
- **Bônus:** DHW é acúmulo de estresse térmico em coral. Dá para dizer *"este trecho de recife está em alerta de branqueamento há N semanas"* — afirmação de consequência, não de medida.
- **Esforço:** médio-baixo. Uma rota nova moldada em `server/fields.js`.
- **O host oficial não é alcançável daqui, e os espelhos são** — medido em
  08/09/2026 com `tools/medir-fontes.mjs`:
  - `coastwatch.pfeg.noaa.gov`: DNS resolve, **TCP expira em IPv4 e em IPv6**,
    sem proxy, enquanto `nomads` e `cpc` respondem em centenas de ms. É o host
    nesse caminho de rede, não a máquina.
  - `pae-paha.pacioos.hawaii.edu` (PacIOOS, o **publisher declarado** no `.das`
    do coastwatch) responde e publica **`dhw_5km`**, com o mesmo título do
    `NOAA_DHW`. Também publica `dhw_5km_lon360` — mesmo dado em longitude
    0–360. **Escolher o `lon360` por engano deslocaria o mapa em 180°**, e o
    planeta continuaria parecendo um planeta.
  - `oceanwatch.pifsc.noaa.gov` responde e tem as grandezas **separadas**:
    `CRW_sst_anom_v1_0` e `CRW_dhw_v1_0`. Serve como plano B — uma requisição a
    mais por ponto, mesma grade.
  - `erddap.aoml.noaa.gov` responde mas a busca devolve 404: não hospeda este
    produto.
- **MEDIDO em 08/09/2026 — `dhw_5km` em `pae-paha.pacioos.hawaii.edu`.** Tudo
  que faltava, respondido pela fonte real:

  | Pergunta | Resposta medida |
  |---|---|
  | `[last]` funciona? | **Sim** — não é preciso ler `time_coverage_end` antes de cada consulta |
  | Dia mais recente | `2026-09-06T12:00:00Z`, **39,5 h atrás** |
  | Terra: `null` ou `-327.68`? | **`null`.** O JSON do ERDDAP já converte o valor de preenchimento |
  | Oceano (Abrolhos) | 20 linhas, `CRW_DHW = 0` — sem estresse térmico, e zero aqui é **medida** |
  | Grade global, passo 1° (`stride 20`) | 3,44 MB · 2,4 s |
  | Grade global, passo 0,5° (`stride 10`) | 13,70 MB · 7,8 s |
  | Data inexistente | **HTTP 404** — erro limpo, distinguível de "sem dado" |

  **Consequências de desenho:**
  - A latência de ~40 h **confirma que a camada nunca mostra hoje**. É o caso
    `degradado` de `src/dados/estado.ts` por natureza, não por falha: a tela tem
    que dizer a data do dado.
  - O parser **não precisa filtrar `-327.68`** no caminho JSON. A guarda fica
    mesmo assim: outros formatos do ERDDAP (`.csv`, `.nc`) podem devolver o
    número cru, e custa uma comparação.
  - `stride 20` é o tamanho de uma camada global; `stride 10` já é pesado para
    servir a cada carga e serve para construção em cache no servidor.
  - 404 numa data inexistente separa **"ainda não publicaram"** de **"a fonte
    caiu"** — a distinção que `indisponivel` e `degradado` precisam.

### 3.3 Índice Oceânico Niño (ONI) — NOAA CPC — **buraco 3**

> **Recomendação nº 3.** A mais barata da lista inteira, e a que mais muda o que a sonda consegue dizer.

- **Acesso:** `https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt` — **um arquivo de texto**, sem chave. Também há a versão v6 baseada no ERSST.
- **Licença:** NOAA, domínio público.
- **Tamanho:** kilobytes. Uma linha por trimestre desde 1950.
- **Por que vale tanto:** hoje a sonda diz *"máxima no percentil 92 para esta data"* e para aí. Com o ONI ela pode dizer *"…e 2026 é um ano de El Niño moderado"* — que é a diferença entre um número e uma explicação plausível.
- **E para o MVP:** este é o **segundo dataset ideal para o JOIN**. Une-se ao fato diário por trimestre e abre uma pergunta de negócio de primeira linha: *"os dias fora da faixa p10–p90 se concentram em anos de El Niño?"*. Custa quase nada de pipeline e rende muito de análise.
- **Cuidado:** correlação entre ENSO e clima local **varia por região do Brasil** — no Sul o El Niño costuma trazer chuva, no Nordeste costuma trazer seca. Uma frase única para o país inteiro seria falsa.

### 3.4 Hidrologia — ANA / HidroWeb / SNIRH — **buraco 1**

> **O maior buraco conceitual, e a integração mais chata.**

- **Acesso:** portal `snirh.gov.br/hidroweb`, `dadosabertos.ana.gov.br`, e web services da ANA — entre eles um serviço "HIDRO — Série Histórica por Estação".
- **Cobertura:** aproximadamente **7.300 estações** com nível e **4.100 pontos** com vazão; ~1.960 fluviométricas e ~2.840 pluviométricas na Rede Hidrometeorológica Nacional.
- **Licença:** dados abertos do governo federal.
- **Por que importa mais que tudo:** enchente é o desastre que mais afeta gente no Brasil, e o app não tem uma gota de dado hidrológico. Uma camada de nível de rio com percentil histórico — a mesma máquina de anomalia que já existe — responderia *"o Rio Doce está no percentil 97 do nível para esta data"*. Isso é útil de um jeito que nenhuma outra camada da lista é.
- **Esforço:** **alto**, e é honesto dizer. Os web services da ANA são por estação, o catálogo é grande, e a consistência do dado tem dois níveis (bruto e consistido) que não podem ser misturados.
- **Recomendação de sequência:** não é para agora. É o candidato natural para *depois* do MVP, reaproveitando exatamente o código de estações que o MVP vai produzir — a estrutura `dim_estacao` + `fato_diario` serve para rio do mesmo jeito que serve para termômetro.

### 3.5 Desmatamento — INPE TerraBrasilis (DETER e PRODES) — **buraco 5**

- **Acesso:** **WFS/GeoServer público**, `https://terrabrasilis.dpi.inpe.br/geoserver/ows`, além de download direto em shapefile.
- **Cobertura:** DETER (alertas quase em tempo real) hoje cobre Amazônia, Cerrado e Pantanal; PRODES é a taxa anual consolidada.
- **Licença:** dado público do INPE.
- **Por que encaixa:** é **vetorial**, e o app já tem a máquina de tiles vetoriais das fronteiras (`server/fronteiras.js` + `src/fronteiras.ts`). O caminho já está pavimentado.
- **Cuidado:** DETER é **alerta**, não medição consolidada — serve para tendência, não para número oficial. PRODES é o número oficial. Confundir os dois é o erro clássico com esse dado, e é o tipo de coisa que um pesquisador percebe na hora.

### 3.6 Ciclones tropicais — NOAA NHC — **buraco 8**

- **Acesso:** `https://www.nhc.noaa.gov/gis/` — shapefile e KML/KMZ do cone de incerteza, trajetória prevista, campo de vento e avisos; feeds RSS por bacia e um KML de "todos os ciclones ativos". **Sem chave.**
- **Verificação:** página consultada hoje; feeds presentes e sem ciclone ativo no momento da consulta.
- **Licença:** NOAA, domínio público.
- **A ressalva honesta:** o NHC cobre **Atlântico Norte e Pacífico**. O Atlântico Sul praticamente não tem ciclone tropical — o Catarina, em 2004, é a exceção célebre. Para um app com viés brasileiro, isto é **valor global, não local**.
- **Esforço:** baixo-médio. O cone é um polígono; a trajetória é uma linha.

### 3.7 Descargas atmosféricas — **buraco 6**

Duas rotas, ambas com pedra no caminho:

**Blitzortung / LightningMaps** — rede colaborativa de ~1.800 receptores VLF em 83 países, tempo real, gratuita. **Mas** os termos de uso são específicos e exigem que aplicações de terceiros sirvam os dados a partir dos **próprios servidores**, e o projeto é não comercial. A arquitetura do ObservEarth até favorece isso — já temos servidor próprio fazendo proxy — mas os termos precisam ser **lidos na íntegra** antes de qualquer linha de código, e essa leitura eu não fiz.

**GOES-16 GLM** — o mapeador de relâmpagos do satélite geoestacionário, cobrindo as Américas inclusive o Brasil, distribuído pela NOAA em S3 público. Licença limpa, cobertura certa. **Mas** o volume é pesado: NetCDF novo a cada 20 segundos. Viável em lote, ruim para tempo real com o orçamento atual.

**Veredito:** deixar para depois. É o buraco com pior relação valor/atrito da lista.

---

## 4. Candidatos NÃO verificados hoje

Listados por honestidade de escopo. Endpoint, licença e formato de cada um **precisam ser conferidos** antes de qualquer promessa.

| Fonte | Buraco | Observação |
|---|---|---|
| ESA WorldCover 10 m | 5 | Já citado em `pipeline/ingest_open_data.py`; nunca virou camada |
| WorldPop 100 m | 9 | Idem — o script existe, a camada não |
| NASA GPM IMERG | precipitação por satélite | Preencheria a chuva onde não há estação nem radar |
| NSIDC — gelo marinho | 7 | Extensão diária dos dois polos |
| NASA SMAP — umidade do solo | 5 | Liga seca a incêndio; conversa com a camada de focos que já existe |
| GRDC — vazão global | 1 | Equivalente global da ANA |
| NOAA GML — CO₂ Mauna Loa | contexto | Série icônica, arquivo minúsculo |
| Monitor de Secas do Brasil | 5 | Produto oficial, mensal, por município |
| Radar do INMET | precipitação | Alta resolução; formato e acesso a confirmar |
| EM-DAT / S2ID | desastres | Registro de eventos com impacto humano |

---

## 5. O que eu não integraria

| Fonte / ideia | Motivo |
|---|---|
| Qualquer API que exija chave paga ou cartão | Quebra a premissa do projeto: sem chave, sem custo |
| Interpolar estações num campo contínuo | Já discutido: reanálise faz melhor, com física |
| Agregadores comerciais de tempo (Weather API, Tomorrow.io…) | Redistribuição restrita e dependência de chave |
| Séries de estação como prova de tendência climática | Exige homogeneização; é área de pesquisa, não camada de app |
| GOES GLM em tempo real, hoje | Volume incompatível com o orçamento atual |

---

## 6. Recomendação

**Três agora, na ordem, e nenhuma delas atrasa o MVP:**

1. **ONI** — um arquivo de texto. Entra no pipeline como segunda fonte do JOIN (ganho direto na rubrica de *Modelagem*) **e** na sonda como contexto da anomalia. É o único item da lista que serve aos dois lados ao mesmo tempo.
2. **Avisos do INMET** — RSS sem chave, esforço baixo, e é a única fonte que faz o app falar de consequência.
3. **Anomalia de TSM / DHW** — encaixa em `server/fields.js` quase sem atrito e estende ao oceano a gramática de anomalia que o app acabou de adotar.

**Depois do MVP:** hidrologia da ANA, reaproveitando a estrutura de estações que o próprio MVP vai construir. É o maior buraco e o maior trabalho, e as duas coisas se resolvem na mesma sequência.

**Antes de qualquer código:** uma requisição de teste em cada uma. Esta lista prova que as fontes existem e são abertas — não prova que respondem o que a gente precisa.

---

### Fontes consultadas em 07/09/2026

- [NOAA Coral Reef Watch — produtos 5 km](https://coralreefwatch.noaa.gov/product/5km/) · [ERDDAP NOAA_DHW](https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.html) · [ERDDAP anomalia de TSM](https://oceanwatch.pifsc.noaa.gov/erddap/griddap/CRW_sst_anom_v1_0.html)
- [ANA — HidroWeb / Séries Históricas](https://www.snirh.gov.br/hidroweb/serieshistoricas) · [Dados Abertos ANA](https://dadosabertos.ana.gov.br/)
- [NHC — Data in GIS Formats](https://www.nhc.noaa.gov/gis/)
- [INPE TerraBrasilis](https://terrabrasilis.dpi.inpe.br/) · [WFS/GeoServer](https://terrabrasilis.dpi.inpe.br/geoserver/ows)
- [Blitzortung.org](https://www.blitzortung.org/) · [Documentação de dados do LightningMaps](https://docs.lightningmaps.org/general/data/lightning/)
- [NOAA CPC — ONI](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php)
- [INMET — portal](https://portal.inmet.gov.br/) (feed Alert-AS publicado no rodapé)
