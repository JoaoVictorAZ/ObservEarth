# Estado do backend, orçamento de APIs e roadmap unificado

Auditoria por inspeção do código em **6 de agosto de 2026**.
Arquivos: `server/index.js`, `server/budget.js`, `src/globe.ts`, `src/windGPU.ts`.

---

## 1. O que está conectado hoje

| Rota | Fonte externa | Situação | Cache |
|---|---|---|---|
| `/api/imagery/:id` | NASA GIBS (WMS) | **Real** | 6 h |
| `/api/models` | NASA GIBS (GetCapabilities) | **Real** — identificadores descobertos, não escritos à mão | processo |
| `/api/wind` | Open-Meteo (ECMWF/GFS ou ERA5) | **Real** — era sintético, corrigido nesta revisão | 3 h |
| `/api/probe` | Open-Meteo | **Real** | — |
| `/api/quakes` | USGS | **Real** | 1 h |
| `/api/analysis/timeseries` | Open-Meteo | **Real** | 1 h |
| `/api/analysis/sounding` | Open-Meteo (níveis de pressão) | **Real** | 2 h |
| `/api/analysis/compare` | Open-Meteo (multi-modelo) | **Real** | 2 h |
| `/api/boundaries` | Natural Earth (jsDelivr) | **Real** | processo |
| `/api/custom-model/predict` | — | **Vazio** — reservado para o modelo próprio (Fase 3) | — |

### Camadas de modelo: a dimensão temporal era ignorada

**Sintoma:** nenhuma camada MERRA-2 carregava. Todas.

**Causa:** o pedido usava `TIME = hoje − 1 dia` para toda camada, com um `lag`
fixo chutado por produto. O GIBS publica a verdade no próprio GetCapabilities:

```xml
<Dimension name="time" units="ISO8601" default="2026-03-01" nearestValue="0">
  1980-01-01/2023-11-01/P1M,2024-02-01/2024-04-01/P1M,2024-06-01/2026-03-01/P1M
</Dimension>
```

Três motivos independentes para a recusa, cada um suficiente sozinho:

1. **`P1M`** — só existe imagem no primeiro dia de cada mês. Dia 05 não existe.
2. **Termina em `2026-03-01`** — MERRA-2 é *reanálise*: passa por controle de
   qualidade e sai com meses de atraso. Pedir "ontem" é pedir dado ainda não
   produzido.
3. **`nearestValue="0"`** — o GIBS não arredonda. O valor tem de chegar exato.

E há **buracos** no meio da série (nada entre 2023-11 e 2024-02), que tratar a
cobertura como intervalo contínuo não pegaria.

**Correção:** `server/gibsTime.js` lê a dimensão de cada camada e resolve a data
pedida para o instante válido mais próximo **para trás** — nunca para a frente,
porque mostrar dado posterior à data escolhida seria mentir sobre a tela. O
`lag` sobrou só como degradação para camadas ausentes do documento.

Medido contra o capabilities real, em 06/08/2026:

| | camadas MERRA-2 com `TIME` dentro da cobertura |
|---|---|
| antes (`TIME=2026-08-05`) | **0** |
| depois | **todas** |

**A interface agora diz.** Quando o instante servido difere do pedido, o painel
escreve qual é e por quê ("esta série termina em 2026-03-01 — reanálise sai com
atraso"), e cada camada mostra até quando existe dado. Sem isso, um mapa que não
muda ao trocar a data é indistinguível de um mapa quebrado — foi exatamente
assim que esse defeito passou despercebido.

**De quebra, dois nomes ambíguos.** `MERRA2_2m_Air_Temperature_Monthly` e
`MERRA2_2m_Air_Temperature_Assimilated_Monthly` apareciam com o mesmo rótulo:
o nível `2m` não era detectado (a regexp exigia um `_` antes, e ali ele está no
início) e o qualificador `Assimilated` era descartado. Duas linhas idênticas com
dados diferentes tornam a escolha um sorteio.

### Corrigido nesta revisão

**1. O campo de vento era inventado.** `/api/wind` gerava o campo com soma de
senoides e "centros sinóticos" fixos escritos à mão — um ciclone permanente na
Islândia, uma alta permanente nos Açores. Era animado e plausível, mas nenhum
valor correspondia a observação e nenhuma data mudava o resultado de forma
física. Agora vem da Open-Meteo em grade de 10°, com difusão dos vizinhos para
preencher vazios (interpolação entre medidas, não invenção) e recusa explícita
quando a cobertura fica abaixo de 30%.

**2. A "Temperatura Global (Windy)" era inventada.** `setThermalOverlay` pintava
um campo a partir de caixas de latitude/longitude escritas à mão (`se lat>12 e
lat<34 e lng>-16 e lng<55, soma 13 graus` para o Saara). Isso reintroduzia os
setores retangulares e apresentava números fabricados como observação. Removido:
o botão agora seleciona o produto real de temperatura do GIBS.

### O que ainda falta conectar

| Prioridade | Fonte | Ganho | Atrito |
|---|---|---|---|
| Alta | **NASA FIRMS** | focos de incêndio reais (hoje só imagem) | chave gratuita |
| Alta | **NOAA NHC** `CurrentStorms.json` | ciclones ativos reais | nenhum |
| Alta | **NASA POWER** | radiação solar e climatologia por ponto | nenhum |
| Média | **NOAA NOMADS (GFS GRIB2)** | campo nativo 0,25° em vez de 10° interpolado | precisa pipeline GRIB |
| Média | **Copernicus CDS (ERA5)** | reanálise 1940–hoje para treino | cadastro |
| Média | **DWD ICON opendata** | segundo modelo para comparação | nenhum |
| Baixa | **Meteostat** | séries de estação de superfície | chave p/ volume |

---

## 2. Orçamento de APIs — teto em 25% do plano gratuito

Regra do projeto: **nunca ultrapassar um quarto do limite gratuito**. A margem de
75% absorve replay de desenvolvimento, recarga em demonstração e uso simultâneo
sem jamais bater no teto — bater no teto significa a plataforma parar no meio de
uma apresentação.

Implementado em `server/budget.js`: contadores por provedor por dia UTC, **recusa
controlada** ao atingir o teto (429 com mensagem clara em vez de deixar o
provedor recusar por nós) e telemetria em `GET /api/budget`.

| Provedor | Limite gratuito | Nosso teto (25%) | Carga estimada/dia | Uso do teto |
|---|---|---|---|---|
| Open-Meteo | 10.000 | **2.500** | ~0 (reserva) | **0%** ² |
| NOAA NOMADS | sem teto publicado | — | ~100 | — |
| NASA GIBS | 40.000 ¹ | **10.000** | ~96 | **1,0%** |
| USGS | 20.000 ¹ | **5.000** | ~24 | **0,5%** |
| NASA POWER | 5.000 | **1.250** | ~10 | **0,8%** |

¹ Sem teto rígido publicado; adotamos limite próprio conservador.
² Desde a migração para GRIB2, o Open-Meteo é só o plano B do vento.

**Como a carga foi estimada.** O caso mais pesado é o vento. Desde a migração
para GRIB2, **uma fatia = uma requisição** ao NOMADS (o filtro devolve U e V no
mesmo arquivo). O pré-cálculo aquece 25 fatias — a janela de 72 h da animação —
quatro vezes por dia: **~100 requisições/dia**, ao NOMADS, que não tem teto de
chamadas publicado.

**O caso de falha é que dita o desenho.** Se o NOMADS cair, cada fatia volta a
custar 21 requisições ao Open-Meteo: 25 × 21 × 4 = **2.100/dia**, ou 84% do
nosso teto — o trabalho de fundo consumiria quase todo o orçamento e sobraria
pouco para quem está olhando a tela. Por isso `precompute.js` tem um freio
(`HEADROOM_STOP = 0.6`): passados 60% do teto diário, para de aquecer quadros
distantes e devolve os 1.000 restantes ao uso interativo. Os primeiros quadros
sempre entram; o resto carrega sob demanda.

Verificado por teste: 3.000 tentativas consecutivas resultaram em 2.500 aceitas e
500 recusadas, sem nunca exceder 25% do plano gratuito.

### Se precisar de mais volume

1. Subir o cache do vento de 3 h para 6 h — corta a carga pela metade.
2. Servir a grade pré-computada de um arquivo (cron a cada 6 h) — desacopla o
   número de usuários do número de chamadas. **É o passo certo antes de publicar.**
3. Migrar para GRIB do NOMADS: sem limite de chamadas, custo passa a ser disco e
   CPU. É o caminho da Fase 2 do roadmap acadêmico.

---

## 3. Desempenho — o que foi corrigido

### O vento consumia 1,5 GB/s de banda de textura

A versão anterior mantinha um canvas 2D de **4096×2048**, limpava-o inteiro a
cada quadro (8,4 milhões de pixels no fio principal), desenhava 12.000 segmentos
em CPU e marcava `needsUpdate` — reenviando **33,5 MB** para a GPU a 45 Hz.

Nenhum ajuste de contagem de partículas resolvia isso: o custo estava no upload,
não nas partículas.

**Agora (`src/windGPU.ts`):** ping-pong FBO, técnica do Windy e do
earth.nullschool.

| | Antes | Depois |
|---|---|---|
| Partículas | 12.000 | **32.768** |
| Trabalho de CPU por quadro | 8,4 M px limpos + 12 k segmentos | **zero** |
| Upload de textura por quadro | **33,5 MB** | **0 bytes** |
| Fragment shader por quadro | — | 16 k px (avanço) + 2 M px (rastro) |

O estado das partículas vive numa textura `HalfFloat` 181×181; o shader de avanço
lê o vento na posição atual e integra — advecção de verdade, não vetor fixo.

Três detalhes que a implementação resolve e que costumam passar batido:

- **Compensação dos polos.** Em projeção equiretangular o mesmo Δlon cobre
  distância menor perto dos polos; sem dividir a componente zonal por `cos(lat)`
  as partículas disparam em latitude alta.
- **Distribuição uniforme na esfera.** Sortear latitude linearmente amontoa
  partículas nos polos. O renascimento usa `acos(1−2u)`, que distribui por área.
- **Costura do antimeridiano.** Desenhamos **pontos**, não segmentos — um ponto
  nunca cruza a tela, então o risco horizontal deixa de existir por construção,
  sem precisar de filtro na mão.

### Globo: oceano e relevo

- **Máscara de água como `specularMap`**: só o mar reflete o Sol, a terra fica
  fosca. É o detalhe que separa "esfera com foto colada" de "planeta", e custa
  uma textura pequena e nenhum shader novo.
- **`bumpScale` calibrado em 6**: relevo perceptível sem virar plástico enrugado.
- **`pixelRatio` limitado a 2**: em tela 3× o custo de fragment cresce ~9× sem
  diferença perceptível. É o maior ganho isolado em notebook.
- **Anisotropia 8×** na textura base: nitidez em ângulo rasante, onde a esfera
  mais sofre.

---

## 4. Roadmap unificado

Os dois roadmaps (produto publicável + trabalho de doutorado) compartilham o
mesmo pipeline. A diferença está apenas na **fonte** que alimenta as texturas.

```
                    ┌──────────────────────────────┐
   FASE 1 (feito)   │  Imagem real (NASA GIBS)     │──┐
                    │  Grade real (Open-Meteo)     │  │
                    └──────────────────────────────┘  │
                                                      ├──►  MESMO GLOBO
   FASE 2 (produto) ┌──────────────────────────────┐  │     MESMOS SHADERS
                    │  GRIB2 nativo (NOMADS/ICON)  │──┤     MESMA UI
                    │  0,25° · pré-computado       │  │
                    └──────────────────────────────┘  │
                                                      │
   FASE 3 (tese)    ┌──────────────────────────────┐  │
                    │  Modelo próprio (FNO/ONNX)   │──┘
                    │  treinado em ERA5            │
                    └──────────────────────────────┘
```

O ponto de troca já existe: `/api/wind` e `/api/imagery` são o contrato. Trocar a
fonte não toca uma linha do front.

### Fase 2 — produto publicável (2–4 semanas)

1. ~~**Pré-computar a grade** com cron de 6 h~~ — **feito** (`server/precompute.js`).
   Desacopla número de usuários de número de chamadas.
2. ~~**Pipeline GRIB2**~~ — **feito**, e sem dependência externa: `server/grib2.js`
   decodifica GRIB2 em Node puro (seções 0–8, templates 5.0/5.2/5.3, empacotamento
   complexo com diferenciação espacial). Não precisou de `wgrib2` nem de Python.
3. ~~Conectar **FIRMS** e **NOAA NHC**~~ — **feito**.
4. ~~**Animação temporal**~~ — **feito**. Ver abaixo.
5. ~~Nuvens (`var_TCDC`) e precipitação (`var_APCP`)~~ — **feito**.
6. ~~Isóbaras a partir de `var_PRMSL`~~ — **feito**.

**Fase 2 está fechada.**

#### Campos escalares e isóbaras — como ficou

O painel tinha satélite (só existe onde o sensor passou, de dia, sem nuvem por
cima) e reanálise da NASA (termina meses atrás). Nenhum dos dois responde *está
chovendo agora, e onde*. Estes respondem, e saem do mesmo GRIB2 do vento.

| Produto | Variável | Saída | Requisições |
|---|---|---|---|
| Nuvens | `TCDC` coluna inteira | PNG ~70 kB | 1 |
| Precipitação | `APCP` superfície | PNG ~40 kB | 1 |
| Isóbaras | `PRMSL` nível do mar | JSON ~110 kB | 1 |

**Por que PNG e não JSON.** O campo tem 1.038.240 nós: ~16 MB como JSON,
inviável. Como PNG equirretangular são dezenas de kB, e o cliente já sabe
desenhar PNG no globo — é o mesmo caminho das imagens do GIBS. O codificador
(`server/png.js`) é próprio, ~120 linhas sobre `node:zlib`, pela mesma razão que
o decodificador GRIB2 é próprio: o subconjunto necessário é pequeno e não vale
uma árvore de dependências para auditar.

**Por que isóbara é linha e não raster.** A informação da pressão está na
*forma* das curvas e na posição dos centros. Pintada em cores diria menos e
ainda competiria com nuvem e chuva pelo mesmo espaço visual.

Quatro decisões que mudam o resultado:

- **Suavizar e reamostrar para 1° antes de contornar.** A 0,25° o campo tem
  ruído de escala de grade, e a isóbara sai serrilhada — com aparência de erro
  numérico, que é o que de fato seria. Análise sinóptica se faz em 1°.
- **Fechar no antimeridiano.** Tratando a grade como folha plana, toda isóbara
  que cruza 180° fica cortada, e o corte vira uma cicatriz vertical no Pacífico
  — onde quase ninguém olha, e por isso demora a ser notada.
- **Centro precisa de amplitude, não só de comparação.** Numa região plana
  nenhum vizinho é maior nem menor, então todo ponto marcava mínimo *e* máximo:
  milhares de "B" espalhados por qualquer área de gradiente fraco.
- **A legenda é derivada da rampa**, nunca transcrita. Um hexadecimal escrito ao
  lado da paleta casa hoje e diverge na primeira vez que alguém clareia um tom.

Bugs que os testes pegaram e a leitura do código não pegaria:

1. **`chain` só andava para a frente.** Marching squares não garante orientação
   do segmento; numa curva fechada, começar pelo meio capturava metade dela.
2. **Alfa da nuvem valia exatamente 0 no piso** — o primeiro degrau da legenda
   anunciava uma cor que o mapa nunca pintava.
3. **`pressureCenters` com passo fixo de 1°** — só correto para o GFS 0,25°;
   qualquer outra resolução dava raio de busca errado.
4. **Teste assíncrono sem `await`** virava rejeição não tratada: o conjunto
   passava verde com o caso quebrado. Ao corrigir, ele acusou `meta.legend`
   indefinido.

Custo por fatia, medido: 4 requisições ao NOMADS com tudo ligado (vento, nuvem,
chuva, isóbaras), **zero ao Open-Meteo**. Decodificar + desenhar bloqueia o laço
de eventos por ~170 ms (campo) a ~360 ms (isóbaras), uma vez por fatia; depois
vem do cache.

#### Animação temporal — como ficou

O botão de reprodução andava `(hora + 3) % 24`: dava a volta no **mesmo dia**.
A hora subia na tela, então parecia funcionar, mas nenhum sistema meteorológico
jamais atravessava o globo.

Agora a sequência vem de um **único ciclo do GFS** (f000…f240, passo de 3 h), o
que a torna fisicamente coerente — uma frente nasce num quadro e avança nos
seguintes, em vez de cada quadro ser uma rodada diferente do modelo.

| Peça | Arquivo | Papel |
|---|---|---|
| Enumeração dos quadros | `server/forecast.js` | Diz até onde o ciclo alcança e o que já está em cache. Corta no primeiro buraco em vez de saltar por cima. |
| Cursor e pré-carga | `src/forecastPlayer.ts` | Cursor fracionário; segura quando o próximo quadro não chegou, em vez de pular. |
| Interpolação | `src/windGPU.ts` | Dois campos + `uMix`. Mistura **vetorial** (`u`,`v`), nunca angular. |
| Aquecimento | `server/precompute.js` | 25 fatias de 3 h, na ordem de reprodução, com freio de orçamento em 60%. |

Três decisões que valem registro na metodologia:

- **Mistura vetorial, não angular.** Entre 350° e 10° a média dos ângulos dá
  180° — o vento *inverteria*. Interpolando `u` e `v` separadamente, o
  escoamento cruza o norte pelo caminho curto. Fixado em `test/player.mjs`.
- **Validade pelo mínimo.** Só anima onde os *dois* passos têm medição. A média
  daria 0,5 e passaria raspando pelo limiar do shader, inventando partícula em
  cima de dado ausente.
- **O reprodutor espera, não salta.** Quadro faltando mostra "carregando" e
  segura o cursor. Saltar mostraria o tempo pulando 6 h sem aviso — a diferença
  entre "o modelo evolui assim" e "às vezes some um pedaço".

Custo de memória, medido: `Float32Array` no cliente (metade do `number[]` do
JSON) × 6 quadros = 48 MB de heap, mais 3 texturas de 8 MB = **~71 MB** para o
vento inteiro.

### Fase 3 — modelo próprio (3–6 meses)

1. ERA5 via CDS API, subconjunto do domínio de interesse, em Zarr.
2. Treinar FNO ou GraphNet simples para 6 h–24 h.
3. Validar contra GFS como *baseline* — RMSE, MAE, viés e correlação.
4. Exportar para ONNX e servir em `/api/custom-model/predict`, que **já existe**
   como esqueleto.

### Bibliotecas para as fases seguintes

| Camada | Ferramenta | Licença |
|---|---|---|
| GRIB → array | `cfgrib` + `ecCodes` | Apache 2.0 |
| Manipulação | `xarray` + `dask` | Apache 2.0 |
| Operações climáticas | CDO | GPLv2 |
| Conversão/subset | `wgrib2` | domínio público (NOAA) |
| Armazenamento | Zarr | MIT |
| Treino | PyTorch ou JAX | BSD / Apache 2.0 |
| Inferência | ONNX Runtime | MIT |
| API do modelo | FastAPI + Uvicorn | MIT |

Todas gratuitas e de uso acadêmico livre.

---

## 5. Diagnóstico rápido

```
GET /api/health     estado do servidor
GET /api/budget     consumo por provedor, teto e folga
```

Se uma camada não aparecer, `/api/budget` é o primeiro lugar a olhar: `denied`
maior que zero significa que o teto foi atingido, não que o código quebrou.
