# ObservEarth

Um globo terrestre que mostra o que está realmente acontecendo na atmosfera —
imagem de satélite da NASA, vento animado a partir do GRIB2 bruto do GFS,
terremotos, incêndios, sondagem por clique e análise histórica de dez anos, tudo
navegável por data e hora.

O princípio que governa o projeto cabe numa frase: **se o dado não existe, a tela
diz que não existe.** Nada é preenchido com estimativa silenciosa, nada é
inventado para a interface não ficar vazia. Um campo sem fonte aparece como
"sem dado", e é assim de propósito — pessoas podem tomar decisões olhando para
isto.

---

## Sumário

- [Antes de começar](#antes-de-começar)
- [Instalação em três minutos](#instalação-em-três-minutos)
- [Seus primeiros cinco minutos no app](#seus-primeiros-cinco-minutos-no-app)
- [A interface, painel por painel](#a-interface-painel-por-painel)
- [Os dois modos](#os-dois-modos)
- [Atalhos](#atalhos)
- [A stack](#a-stack)
- [De onde vem cada número](#de-onde-vem-cada-número)
- [O orçamento de API](#o-orçamento-de-api)
- [Chaves e variáveis de ambiente](#chaves-e-variáveis-de-ambiente)
- [A API do servidor](#a-api-do-servidor)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Testes](#testes)
- [Limites conhecidos](#limites-conhecidos)
- [Quando algo dá errado](#quando-algo-dá-errado)

---

## Antes de começar

**Node 22 ou superior.** Não é preciosismo de versão: o servidor usa `node:sqlite`
(`DatabaseSync`), que só existe a partir do Node 22. Em Node 20 o processo morre
na primeira linha do `server/store.js`.

```bash
node -v   # precisa mostrar v22.x ou maior
```

**Um navegador com WebGL2.** Qualquer Chrome, Edge, Firefox ou Safari dos
últimos anos serve. O globo e as partículas de vento rodam inteiramente na GPU.

**WebGPU, só se você quiser o console de IA.** O terminal LLM roda o modelo
*dentro do navegador*, sem servidor de inferência. Isso exige WebGPU (Chrome ou
Edge 113+, ou Safari 18+). Sem WebGPU o resto do app funciona normalmente —
apenas o console avisa que não pode carregar.

**Python é opcional.** A pasta `pipeline/` contém experimentos de treino de
modelo próprio e ingestão em lote. Nada disso é necessário para rodar o app.

---

## Instalação em três minutos

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`.

O comando `dev` sobe duas coisas ao mesmo tempo, com saídas coloridas
separadas: o **servidor** na porta 3001 (azul) e o **frontend** Vite na 5173
(verde). Se preferir dois terminais:

```bash
npm run server   # backend, porta 3001
npm run web      # frontend, porta 5173
```

**Nenhuma chave de API é necessária para começar.** Tudo que o app consome por
padrão — NASA GIBS, NOAA, Open-Meteo, USGS, Natural Earth — é aberto e sem
cadastro. A única exceção é a camada de incêndios, que precisa de uma chave
gratuita do NASA FIRMS (ver [Chaves](#chaves-e-variáveis-de-ambiente)).

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run build` | Checa tipos (`tsc -b`) e gera o bundle de produção em `dist/` |
| `npm run preview` | Serve o `dist/` para conferir o build |
| `npm test` | Roda a suíte inteira (~456 verificações) |
| `npm run dev:all` | `dev` + o servidor Python de modelo próprio |
| `npm run ingest` | Ingestão em lote de dados abertos (pipeline Python) |

---

## Seus primeiros cinco minutos no app

Se você abriu agora e não sabe por onde começar, siga esta sequência. Ela toca
em quase tudo que o app faz.

**1. Ligue o vento.** No painel da esquerda, procure a chave *Vento*. Milhares
de partículas começam a correr sobre o globo seguindo o campo real do GFS. Elas
não são decorativas: cada uma é advectada pelo vetor (u, v) daquela célula, e a
espessura e o brilho do rastro crescem com a velocidade.

**2. Arraste o globo até um ciclone.** Onde as partículas fazem espiral, há
rotação de verdade. Aproxime com a roda do mouse.

**3. Clique em um ponto.** Abre a **sonda** — uma janela flutuante com
temperatura, ponto de orvalho, vento, rajada, umidade, pressão, precipitação,
nuvens, UV e elevação. Cada linha tem uma barra colorida mostrando onde aquele
valor cai na faixa possível: você lê "quente" ou "ventania" antes de ler o
número.

**4. Arraste a janela pelo cabeçalho.** Ela vai para onde você quiser, inclusive
metade para fora da tela. As bordas e os cantos redimensionam. A posição fica
salva entre sessões; o botão de reset no cabeçalho a traz de volta ao canto.

**5. Mexa no tempo.** Na barra superior, escolha uma data no calendário e
arraste o controle de hora. Todas as camadas — imagem, vento, campos escalares —
se movem juntas. O botão de play anima a linha do tempo sozinho.

**6. Peça a análise completa.** No rodapé da sonda, *Análise completa* abre um
modal com três abas: série histórica de até dez anos, perfil vertical da
atmosfera naquele ponto e a dispersão entre três modelos globais. A série
histórica pode ser baixada em CSV.

**7. Converse com os dados.** *Terminal LLM 8B* abre um console que baixa um
modelo de linguagem para a sua GPU e responde perguntas sobre o dossiê daquele
ponto — a conversa não sai da sua máquina. O primeiro carregamento baixa alguns
gigabytes; escolha o modelo conforme a sua placa (a detecção sugere um).

---

## A interface, painel por painel

### Barra superior (Tier 1)

A marca, a **busca** e as ferramentas.

A busca é **por coordenada**, e aceita quase qualquer forma de escrevê-la:
`-23.55, -46.63`, `-23.55 -46.63`, `23°33'S 46°38'O`, `23.55S 46.63W`,
`51.5N 0.13L` — decimal ou grau-minuto-segundo, com hemisfério em português
(N/S/L/O) ou inglês (N/S/E/W). Coordenada fora de faixa é recusada em vez de
virar um ponto errado no oceano. Para ir a uma cidade por nome, use a paleta de
comandos (`Ctrl/Cmd + K`), que tem uma lista de atalhos de localidade.

À direita, as ferramentas:

- **Globo / mapa plano** — troca a projeção. Ver [Os dois modos](#os-dois-modos).
- **Rotação automática** do globo (interruptor, fica aceso)
- **Terminador dia/noite** na posição solar real (interruptor)
- **Centralizar em 0°, 0°** — o golfo da Guiné, ponto neutro do mapa
- **Capturar PNG** da vista atual
- **Estado do motor** — quadros por segundo, tempo de CPU, degrau de qualidade,
  número de partículas, chamadas de desenho. Números medidos a cada quadro, não
  texto fixo.

### Os dois modos

O primeiro botão da barra troca entre o **globo 3D** e o **mapa plano**. Não é
um efeito visual: são dois motores de renderização distintos, e o botão desmonta
um e monta o outro. Data, hora, camadas ligadas e a posição das suas janelas
sobrevivem à troca; a escolha fica salva para a próxima sessão.

O mapa plano usa projeção **equirretangular** (plate carrée), e essa escolha tem
um motivo técnico antes de ter um motivo estético: é o espaço em que os dados já
estão. O GFS entrega uma grade igualmente espaçada em grau, o GIBS serve em
`epsg4326`, e a simulação de partículas do vento já trabalha em UV normalizado.
No globo, um shader precisa reprojetar tudo isso na esfera. No plano, cola
direto — **o motor de vento é reaproveitado sem uma linha de mudança.**

Mercator teria sido a escolha familiar, e foi descartada por duas razões: exige
reprojetar a textura de rastro e pedir as imagens noutro esquema, e infla a
Groenlândia ao tamanho da África. Num app em que se lê a extensão de um
fenômeno, isso é uma mentira visual.

O que o plano faz melhor:

- **O antimeridiano deixa de partir o mundo.** O mapa é desenhado três vezes
  lado a lado e a longitude enrola, então dá para arrastar indefinidamente para
  o lado e seguir um tufão do Pacífico sem que ele se corte na borda.
- **Zoom ancorado no cursor.** A roda aproxima no ponto que você está mirando,
  não no centro da tela.
- **Comparar áreas distantes** sem girar o planeta — o Ártico e a Antártida
  aparecem ao mesmo tempo.

O custo, dito na cara: os polos aparecem esticados na horizontal. É a projeção
sendo honesta sobre o que ela é. No globo há um corte que esconde o leque de
partículas perto dos polos, porque lá ele é artefato de reprojeção; no mapa
plano esse corte não existe, porque ali o esticamento é o dado real — e é
justamente onde a corrente de jato importa.

O terminador dia/noite também muda de implementação: no globo é luz direcional
sobre a esfera, no plano é calculado por pixel a partir do ângulo zenital solar,
com o crepúsculo civil na borda da sombra.

### Barra de tempo (Tier 2)

Rodada do modelo, hora da previsão, calendário, régua do tempo e controles de
reprodução. Tudo que está no globo obedece a esta barra.

### Painel esquerdo — camadas

Três famílias, com busca por nome:

**Campos do modelo (GFS 0.25°)** — temperatura a 2 m, ponto de orvalho, umidade
relativa, precipitação acumulada, pressão ao nível do mar, cobertura de nuvens,
estresse térmico WBGT. São grades calculadas: têm valor em *todo* ponto do
planeta.

**Satélite (NASA GIBS)** — MODIS Terra e VIIRS SNPP em cor verdadeira,
GOES-East geoestacionário, temperatura da superfície do mar, aerossóis, gelo
marinho, NDVI, neve, ozônio. Observação direta: só existe onde o sensor passou,
de dia e sem nuvem. Buraco na imagem é o comportamento correto.

**Reanálise (MERRA-2, GEOS-FP)** — médias mensais e assimilação da NASA. Os
identificadores não são escritos à mão: o servidor lê o `GetCapabilities` do
próprio GIBS e expõe o que existe de fato. Se a NASA publicar uma camada nova,
ela aparece sozinha.

Sobrepostos a qualquer camada: **vento**, **isóbaras**, **terremotos** (USGS ao
vivo), **incêndios** (FIRMS), **qualidade do ar** (OpenAQ), **WBGT** e
**hospitais**.

E o **controle de densidade de partículas** — uma régua que reduz a quantidade
de partículas sem mudar a física. Serve para máquinas modestas e para quando
você quer ver a estrutura do escoamento em vez do borrão.

### A sonda

Janela flutuante, arrastável e redimensionável em oito direções. Clique duplo no
cabeçalho minimiza. A posição e o tamanho ficam no `localStorage`.

Cada parâmetro traz o valor, uma conversão secundária (°F, km/h, escala
Beaufort) e uma barra de faixa colorida. Onde a fonte não reportou nada, a
linha diz **"sem dado"** — nunca zero, nunca uma média plausível.

### Análise completa

**Série histórica** — agregados diários do ERA5 em janelas de 1 mês a 10 anos,
com mínimo, máximo, média, desvio-padrão amostral e contagem de ausentes. O
gráfico preserva os extremos ao reduzir pontos, então um pico de um dia não
some no reamostramento.

**Perfil vertical** — temperatura, ponto de orvalho e vento nos níveis de
pressão reais, com gradiente por camada. O ponto de orvalho vem de
Magnus-Tetens na formulação de Alduchov & Eskridge (1996).

**Dispersão entre modelos** — GFS, ICON e ECMWF IFS lado a lado para as
próximas 48 horas, com a amplitude entre eles hora a hora. Onde os três
concordam, a previsão é robusta; onde abrem, é aí que mora a incerteza. Com
menos de dois modelos disponíveis a dispersão é `null`, não zero.

A aba de série histórica exporta **CSV** com preâmbulo de proveniência (fonte,
modelo, ponto, data de extração) e BOM, para abrir direto no Excel sem quebrar
acento. As outras duas abas ainda não têm exportação.

### Terminal LLM

Um modelo de linguagem rodando na sua GPU via WebGPU, com o dossiê meteorológico
do ponto carregado no contexto. Cinco opções:

| Modelo | Download | VRAM |
|---|---|---|
| Llama 3.1 8B | 4,6 GB | ~4,9 GB |
| Hermes 3 (Llama 3.1 8B) | 4,7 GB | ~4,9 GB |
| Qwen 2.5 7B | 4,4 GB | ~4,7 GB |
| Phi 3.5 mini | 2,2 GB | ~2,4 GB |
| Qwen 2.5 1.5B | 1,0 GB | ~1,1 GB |

A detecção de capacidade mede a VRAM disponível e sugere o maior que cabe —
propositalmente por baixo, porque falhar depois de baixar 4,6 GB seria cruel. O
download só acontece quando você clica; abrir o painel não baixa nada.

---

## Atalhos

| Tecla | Ação |
|---|---|
| `Ctrl/Cmd + K` | Paleta de comandos — ações rápidas, cidades, camadas |
| `Esc` | Fecha o diálogo ou painel em foco |
| `Tab` | Navega dentro do diálogo aberto (o foco fica preso nele) |
| Roda do mouse | Zoom |
| Arrastar | Girar o globo |
| Clique | Sondar o ponto |
| Clique duplo no cabeçalho | Minimizar a janela |

---

## A stack

### Frontend

| Peça | Para quê |
|---|---|
| **React 18** + **TypeScript 5.6** | Interface |
| **Vite 6** | Dev server e build |
| **Zustand 5** | Estado global, em oito stores pequenas |
| **globe.gl 2.34** + **three.js 0.185** | O globo e a cena 3D |
| three.js puro (`src/mapa2d.ts`) | O mapa plano: câmera ortográfica, sem globe.gl |
| WebGL2 próprio (`src/windGPU.ts`) | Advecção de partículas na GPU |
| **Radix UI** | Diálogo, popover, tabs, slider, tooltip — primitivos acessíveis |
| **cmdk** | Paleta de comandos |
| **lucide-react** | Ícones |
| **@mlc-ai/web-llm** | LLM no navegador via WebGPU |
| CSS à mão | Sistema de design próprio, sem framework de componentes |

O motor do globo encapsula todo o contato com three.js e globe.gl. A interface
nunca lida com geometria — se um componente React precisa saber o que é uma
matriz de projeção, algo está no lugar errado.

**As partículas de vento** merecem um parágrafo. São dezenas de milhares de
pontos avançados por integração de Runge-Kutta de segunda ordem (ponto médio),
com posições guardadas em textura de meio-float e ping-pong entre dois
framebuffers. O rastro é acumulado numa textura separada que desvanece a cada
quadro. Espessura e opacidade crescem com a velocidade, então calmaria parece
calmaria e ciclone parece ciclone.

**O degrau de qualidade** se ajusta sozinho: acima de 20 ms por quadro o motor
cai um nível; depois de folga sustentada ele volta a subir.

| Degrau | DPR | Partículas | Textura de rastro |
|---|---|---|---|
| Alta | 2,0× | 40.000 | 4096 |
| Equilibrada | 1,5× | 22.500 | 2048 |
| Desempenho | 1,0× | 12.100 | 2048 |

### Backend

| Peça | Para quê |
|---|---|
| **Node 22+** | Runtime (precisa de `node:sqlite`) |
| **Express 4** | Rotas HTTP |
| **SQLite** (`node:sqlite`) | Contador de uso de API, persistido em `data/` |
| Decodificador GRIB2 próprio | `server/grib2.js` — sem dependência externa |
| Leitor de índice `.idx` | `server/gribIndex.js` — baixa só a faixa de bytes que interessa |

O **decodificador GRIB2** foi escrito do zero e cobre os templates de
empacotamento 5.0, 5.2 e 5.3, inteiros em sinal-magnitude e a reorientação de
longitude 0..360 → −180..180. O **leitor de `.idx`** é o que torna o vento
viável: o NOAA publica, junto de cada arquivo GRIB de ~500 MB, um índice em
texto com o deslocamento em bytes de cada registro. Lendo o índice primeiro e
pedindo só as faixas de U e V a 10 m com `Range: bytes=`, o download cai para
uns 3 MB.

### Pipeline Python (opcional, experimental)

`pipeline/` guarda o que não faz parte do app em produção: download do ERA5 via
Copernicus CDS, treino de um operador neural de Fourier, um servidor de
inferência de modelo próprio, ingestão em lote e um servidor TiTiler. Nada disso
é necessário para `npm run dev`.

---

## De onde vem cada número

| Dado | Fonte | Observação |
|---|---|---|
| Imagem de satélite e reanálise | **NASA GIBS** (WMS/WMTS) | Público, sem chave |
| Vento do globo | **NOAA GFS 0.25°**, GRIB2 nativo via NOMADS / S3 / DWD | Com fallback para Open-Meteo |
| Sonda do clique | **Open-Meteo** — previsão, *historical-forecast* (ICON 11 km) ou ERA5, escolhido pela data | |
| Série histórica | **ERA5** via Open-Meteo Archive | Agregados diários |
| Perfil vertical | **Open-Meteo**, níveis de pressão reais | |
| Comparação de modelos | **GFS**, **ICON**, **ECMWF IFS 0.25°** | Uma requisição, três modelos |
| Correntes oceânicas | **Copernicus SMOC** 0,08° via Open-Meteo Marine | Convenção oceanográfica (aponta *para onde* vai) |
| Terremotos | **USGS** | Ao vivo |
| Incêndios | **NASA FIRMS** | Exige chave gratuita |
| Qualidade do ar | **OpenAQ** | |
| Fronteiras | **Natural Earth** via jsDelivr | |

O vento tem **disjuntor**: se o GFS falhar três vezes seguidas, o servidor
desliga aquela fonte por vinte minutos e usa a Open-Meteo, em vez de martelar um
host que está fora do ar.

### Por que a Open-Meteo não serve para a grade global

A Open-Meteo cobra por **localização**, não por requisição. Uma grade de 4 graus
são 4.050 pontos — 4.050 unidades de cota para *um* campo, contra um teto diário
gratuito de 10.000. Estoura em duas camadas e o que sobra na tela são faixas
vazias. Não é ajuste, é aritmética.

Ela continua sendo a fonte certa onde a consulta por ponto é natural: a sonda do
clique, que é literalmente um ponto, e as séries de análise.

---

## O orçamento de API

Regra do projeto: **nunca passar de um quarto do limite gratuito** de qualquer
provedor. O `server/budget.js` implementa isso a sério.

| Provedor | Teto adotado (dia) |
|---|---|
| Open-Meteo | 2.500 (¼ de 10.000) |
| NASA GIBS | 10.000 |
| USGS | 5.000 |
| NASA FIRMS | 1.080 |

E não é só o dia. A Open-Meteo limita em **três janelas** — dia, hora e minuto —
e contar apenas o total diário deixa passar a rajada: percorrer a linha do tempo
depressa cabe folgado no teto diário e mesmo assim leva `429` por minuto. As
janelas curtas zeram sozinhas; o total do dia é **gravado em SQLite**, porque
trinta reinícios num dia de desenvolvimento furavam o teto sem ninguém notar.

As requisições de imagem também são economizadas por **arredondamento de
janela**: mover o globo um pouco cai na mesma célula de grade, que já está em
cache, e só uma mudança real de região ou de zoom gera requisição nova.

---

## Chaves e variáveis de ambiente

Copie `.env.example` para `.env` e preencha só o que for usar. **O `.env` já
está no `.gitignore` — mantenha assim.**

```bash
cp .env.example .env
```

| Variável | Para quê | Necessária? |
|---|---|---|
| `PORT` | Porta do servidor (padrão 3001) | Não |
| `FIRMS_MAP_KEY` | Camada de incêndios | Só para incêndios |
| `EARTHDATA_TOKEN` | Produtos DAAC além do GIBS | Não (roadmap) |
| `CDS_API_KEY` | ERA5 direto do Copernicus, para o pipeline de treino | Não |
| `METEOSTAT_KEY` | Séries de estação | Não |
| `DB_PATH` | Caminho do SQLite (padrão `data/observatorio.db`) | Não |

A chave do FIRMS sai por e-mail na hora, em
`https://firms.modaps.eosdis.nasa.gov/api/map_key/`.

> **Nunca cole uma chave num chat, num issue ou num commit.** Se isso acontecer,
> considere a chave comprometida e emita outra imediatamente.

---

## A API do servidor

Tudo em `http://localhost:3001`. Os principais:

```
GET  /api/health                      estado do servidor
GET  /api/imagery                     camadas GIBS disponíveis (lidas do GetCapabilities)
GET  /api/imagery/:id                 tile/imagem de uma camada
GET  /api/imagery/:id/time            datas disponíveis para a camada
GET  /api/wind?date=&hour=            grade de vento u/v
GET  /api/wind/status                 fonte usada, estado do disjuntor do GFS
GET  /api/wind/verify                 conferência do campo contra ponto conhecido
GET  /api/wind/vortices               centros de vorticidade detectados
GET  /api/fields/:id                  campo escalar (temp2m, prmsl, ...)
GET  /api/isobars                     isóbaras
GET  /api/probe?lat=&lng=&date=&hour= a sonda do clique
GET  /api/dossier?lat=&lng=...        dossiê completo do ponto (contexto do LLM)
GET  /api/analysis/timeseries?range=  série histórica ERA5
GET  /api/analysis/sounding           perfil vertical
GET  /api/analysis/compare?horas=48   dispersão entre modelos
GET  /api/quakes                      terremotos USGS
GET  /api/fires                       focos FIRMS
GET  /api/openaq                      qualidade do ar
GET  /api/store                       uso de cota por provedor
```

Um endpoint que dá erro **devolve erro**. Não existe rota que responda com valor
plausível quando a fonte está fora do ar: `502` com o motivo é mais útil, e
infinitamente mais honesto, do que uma linha reta bonita no gráfico.

---

## Estrutura do repositório

```
server/
  index.js         rotas Express (o arquivo grande; o resto é módulo)
  grib2.js         decodificador GRIB2 próprio
  gribIndex.js     leitura de .idx e download por faixa de bytes
  gfs.js  wind.js  montagem da grade de vento, disjuntor, fallback
  vorticidade.js   vorticidade relativa, circulação, detecção de centros
  arquivo.js       escolha da fonte Open-Meteo conforme a data
  timeseries.js    séries ERA5      sounding.js   perfil vertical
  compare.js       multi-modelo     currents.js   correntes oceânicas
  budget.js        cotas e janelas deslizantes
  store.js         SQLite
  janela.js        bbox e janelas de imagem arredondadas

src/
  globe.ts         motor 3D: three.js, globe.gl, shaders
  mapa2d.ts        motor 2D: equirretangular, câmera ortográfica
  projecao.ts      lat/lng <-> plano, enrolamento de longitude, zoom
  tipos.ts         tipos de dado + a interface MotorGeo que os dois cumprem
  windGPU.ts       advecção de partículas na GPU
  windGrid.ts      leitura da grade no cliente
  arrasto.ts       geometria de arraste das janelas flutuantes
  perf.ts          medição de quadro e degraus de qualidade
  coord.ts         leitura de coordenada em texto livre
  components/      React, por área (globe, dock, probe, chat, analysis…)
  store/           oito stores Zustand
  css/             folhas por componente + index.css (sistema de design)
  llm/engine.ts    carregamento e streaming do modelo local

pipeline/          Python: ERA5, treino de modelo, ingestão (opcional)
test/              suíte, .mjs com o assert nativo do Node
docs/              documentação técnica e notas de renderização
```

Documentos complementares na raiz: `DESIGN-SYSTEM.md` (as regras visuais),
`ESTADO-E-ROADMAP.md`, `AVALIACAO-FONTES-2026-08.md` (por que cada fonte foi
escolhida ou descartada).

---

## Testes

```bash
npm test
```

Cerca de **456 verificações** em 31 arquivos, sem framework: só o `assert`
nativo do Node. Arquivos que importam TypeScript rodam com
`--experimental-strip-types`.

A suíte não é decorativa. Boa parte dela existe porque um bug específico passou
uma vez e ninguém quer que ele volte:

- `wind-longitude.mjs` — a reorientação 0..360 → −180..180 aplicada duas vezes
  espelhava o mundo e punha um furacão do Japão na costa americana
- `arrasto.mjs` — `"mover".includes("e")` é `true`, e o arraste de janela caía
  no ramo de redimensionar
- `projecao.mjs` — `-190 % 360` em JavaScript dá `-190`, não `170`; a versão
  ingênua passa em todo caso positivo e falha em silêncio no Pacífico
- `janela.mjs` — arredondar as quatro bordas em vez do centro gerava onze
  janelas distintas num arrasto de 40°, onze requisições onde cabia uma
- `css-orfas.mjs` — classes usadas no JSX que não existem em nenhuma folha
- `probe-cores.mjs` — contraste e amostragem das rampas de cor
- `rotas-analise.mjs` — que uma rota fora do ar devolva erro, e não série vazia

---

## Limites conhecidos

Coisas que estão faltando ou imperfeitas. Estão aqui para você não descobrir
sozinho no pior momento.

**O globo e a sonda usam modelos diferentes.** As partículas vêm do GFS 0.25°
(GRIB2 nativo); a sonda do clique vem da Open-Meteo, que para datas recentes
serve o ICON a 11 km. Eles vão divergir, e isso é esperado — são dois modelos.
A unificação (ou um aviso explícito na tela) ainda está pendente.

**Os vórtices são detectados mas não desenhados.** `/api/wind/vortices` calcula
vorticidade relativa e devolve os centros ciclônicos, mas nenhum marcador
aparece no globo ainda.

**A imagem por região está só no servidor.** `/api/imagery/janela` existe e
funciona; o cliente ainda pede sempre o mundo inteiro, então aproximar não
aumenta a resolução da textura.

**Qualidade do ar, WBGT e hospitais** estão no painel e no backend, mas são as
camadas menos exercitadas do conjunto.

**O mapa plano ainda não tem três coisas que o globo tem.** Os nomes de países,
estados e cidades; os contornos estaduais que o globo baixa ao aproximar (o
plano desenha só fronteiras nacionais); e as letras **A** e **B** nos centros de
pressão — as isóbaras aparecem, os centros não estão rotulados.

---

## Quando algo dá errado

**A tela abre preta ou o globo não aparece.**
Confirme o WebGL2 em `chrome://gpu` (ou equivalente). Em máquina virtual sem
aceleração, não há o que fazer no código.

**"Cannot find module 'node:sqlite'".**
Node antigo. Precisa de 22+.

**O vento não carrega e o console fala em cooldown.**
O disjuntor do GFS desarmou depois de três falhas e ficará vinte minutos usando
a Open-Meteo. `GET /api/wind/status` mostra o estado e o horário de religar.

**Erro 429 nas camadas.**
Você bateu no teto de cota. `GET /api/store` mostra o consumo por provedor e por
janela. Os limites de hora e minuto zeram sozinhos.

**A sonda nasceu colada num canto estranho.**
A posição vem do `localStorage`. O botão de reset no cabeçalho dela resolve, e
existe também um "organizar janelas" que limpa as posições salvas.

**O console LLM não carrega.**
Sem WebGPU, ele não roda. Chrome ou Edge 113+, ou Safari 18+. Se houver WebGPU
mas a VRAM for pouca, escolha o Qwen 2.5 1.5B (1 GB) em vez do sugerido.

**Os números do gráfico parecem errados.**
Antes de supor bug de interface, chame o endpoint direto no navegador
(`/api/analysis/timeseries?...`) e compare. Se o servidor já devolve o valor
estranho, o problema é de fonte ou de decodificação, não de renderização.
