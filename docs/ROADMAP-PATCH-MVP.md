# Patch MVP — Roadmap

**ObservEarth × Pipeline de Dados na Nuvem**
Documento de planejamento · 07/09/2026 · João Victor

---

## 0. O que este documento é

Este é o plano para construir **um subsistema que falta no ObservEarth**, e usar essa construção como entrega do MVP acadêmico. Não são dois projetos. É um.

### A correção que originou este documento

A primeira versão deste roadmap dizia que eram duas trilhas separadas — app de tempo real de um lado, pipeline de lote do outro, unidos só por um Parquet. **Isso estava errado, e o erro veio de eu não ter olhado o repositório antes de opinar.** O ObservEarth já tem:

```
pipeline/
  era5_download.py       ← download em lote do ERA5 (Copernicus CDS)
  ingest_open_data.py    ← ingestão de camadas open data
  grib2_threejs.py
  train_fno_model.py
data/
```

…e um `npm run ingest` no `package.json`. **A trilha de lote já existe.** Ela é subdesenvolvida: roda na máquina, não tem camadas, não persiste em formato tabular, não tem catálogo e não tem teste. O MVP é exatamente o trabalho de amadurecê-la.

Reformulado, então:

> **O ObservEarth tem hoje um subsistema de tempo real maduro e um subsistema de lote embrionário. O MVP é o segundo saindo do embrião — com runtime de nuvem, arquitetura em camadas, catálogo de dados e persistência.** A entrega acadêmica é a documentação desse trabalho.

### O que de fato fica separado — e é só isto

**O runtime.** PySpark executa nas máquinas do Databricks; o Node e o navegador executam na sua. Isso é assim em qualquer empresa que tenha os dois subsistemas, e não é uma bifurcação do projeto: é a diferença entre `npm run server` e `npm run ingest`, que já existe no `package.json` hoje.

Fora isso: **um repositório, um histórico de commits, um vocabulário, uma suíte de testes.**

### Convenção de honestidade deste documento

Cada marco declara o que ele **não** entrega ao usuário final do app. Dois deles não colocam nada na tela — mas colocam código no repositório, e esse código é seu. Um roadmap em que toda etapa "agrega valor visível" é um roadmap que não foi pensado.

---

## 0.1 O mapa do acoplamento

| Peça | Onde mora | Executa em | Quem consome |
|---|---|---|---|
| Notebooks PySpark | `pipeline/databricks/` **no repo do ObservEarth** | Databricks (serverless) | o próprio pipeline |
| Contrato de esquema | `pipeline/contrato/` | — | os dois lados |
| Tabelas Bronze/Silver/Gold | Unity Catalog | Databricks | notebooks e SQL |
| Export Gold (Parquet) | `data/gold/` | — | `server/estacoes.js` |
| Rotas e camadas novas | `server/`, `src/` | Node + navegador | o app |
| Teste do contrato | `test/contrato.mjs` | `npm test` | **guarda a saída do pipeline** |
| Documento da entrega | `docs/MVP.md` | — | a correção |

O `test/contrato.mjs` é o acoplamento mais forte da lista, e é o mais barato: a suíte de testes do app passa a reprovar um Parquet que o pipeline gerou com nome de campo errado. Os dois subsistemas ficam amarrados por um teste, não por boa intenção.

---

## 1. Restrições medidas (não supostas)

Tudo abaixo foi verificado em 07/09/2026, não estimado.

| # | Restrição | Consequência no plano |
|---|---|---|
| R1 | Databricks Free Edition **restringe internet de saída** a um conjunto de domínios confiáveis. | `requests.get()` para o INMET **falha** dentro do notebook. |
| R2 | **Verificação por LinkedIn libera** outbound internet access. | Primeira tarefa do M1. Se destravar, a coleta vira script versionado; se não, vira upload manual + screenshots. |
| R3 | Free Edition é **serverless-only**, 1 SQL warehouse `2X-Small`, 5 tarefas de job simultâneas, 1 workspace, 1 metastore. | Nada de cluster customizado; jobs em série. |
| R4 | **Sem R e sem Scala.** | PySpark e SQL. Já era o plano. |
| R5 | **Sem custom workspace storage locations.** | Montar S3 próprio está fora. O caminho é **Volumes do Unity Catalog**. |
| R6 | INMET automáticas: ZIPs anuais de **2000 a 2026**, `portal.inmet.gov.br/uploads/dadoshistoricos/{ANO}.zip`, CSV por estação, separador `;`, cabeçalho de metadados antes da tabela. | A série útil e densa começa por volta de **2008**, não em 1991. |
| R6b | **Medido em 08/09/2026** (`node tools/medir-fontes.mjs`): URL confirmada, HTTP 200, `application/zip`. Tamanhos: **2000 = 0,50 MB · 2010 = 85,99 MB · 2020 = 98,85 MB · 2024 = 98,01 MB**. | O ano 2000 tem **1/180** do volume de 2010: a rede automática praticamente não existia. Recorte adotado: **2010–2024**, ~1,3 GB de Bronze. São 15 anos, e 15 anos **não é normal climatológica** — sai com `referencia: "2010-2024"`. |
| R6c | `coastwatch.pfeg.noaa.gov` (ERDDAP do Coral Reef Watch): **DNS resolve, TCP expira em IPv4 E em IPv6**, sem proxy no ambiente, enquanto `nomads`, `cpc` e `open-meteo` respondem em centenas de ms. | Não é IPv6 quebrado nem proxy: é o host, filtrado ou fora do ar neste caminho de rede. |
| R6d | **Os três espelhos respondem** (medido 08/09/2026): `pae-paha.pacioos.hawaii.edu` 490 ms · `oceanwatch.pifsc.noaa.gov` 703 ms · `erddap.aoml.noaa.gov` 351 ms. O PacIOOS é o **publisher declarado** no `.das` do próprio coastwatch. | A camada de TSM sai por espelho. O identificador do dataset **vem da API de busca do ERDDAP**, não de palpite: cada espelho batiza o mesmo dado de um jeito (`NOAA_DHW`, `dhw_5km`, `CRW_sst_anom_v1_0`) e um palpite errado devolve 404 que parece "não tem". |
| R7 | As **Normais Climatológicas 1991–2020 do INMET são MENSAIS** e vêm das estações **convencionais** (rede diferente das automáticas). | A pergunta "quantos *dias* saíram da faixa" **não** pode ser respondida contra a normal oficial. Ver §3, decisão D2. |
| R8 | O INMET **não publica licença explícita** (CC-BY ou equivalente) na página de download. | Declarar o regime de dados abertos/LAI com atribuição, e **reconhecer a ambiguidade**. Ter uma segunda fonte com licença inequívoca (GHCN, CC0-1.0). |
| R9 | Orçamento próprio do projeto: **máximo ¼ do free tier** de qualquer API. | O pareamento com ERA5 (M4) gasta ~600 chamadas **uma vez**. Cabe. |

---

## 2. As três decisões que sustentam tudo

### D1 — Um repositório só: o do ObservEarth

**Esta decisão foi invertida em relação à primeira versão deste documento.** Eu havia recomendado um repositório separado, com o argumento de que um subdiretório confundiria a correção. Olhando o repositório, o argumento não se sustenta: o `pipeline/` já existe, e o que confundiria de verdade é um segundo repositório com metade do assunto.

**O desenho:**

- Os notebooks vivem em `pipeline/databricks/` **dentro do repo do ObservEarth**.
- O **Databricks Repos** conecta nesse mesmo repositório e trabalha nessa pasta. Você edita no Databricks, comita no mesmo histórico. Não há cópia, não há sincronização manual, não há divergência.
- O documento da entrega é `docs/MVP.md`, com os sete títulos exatos do item 5, linkado do `README.md` principal.
- O enunciado pede "todo código construído em um repositório público do GitHub". Um repositório público que contém o pipeline **e** o produto que consome o pipeline satisfaz isso com folga — e mostra o ciclo completo, que é justamente o que o trabalho diz querer avaliar.

**O ganho de capricho é maior assim, não menor.** Quem corrige abre um repositório onde o pipeline entrega um dado que uma aplicação real consome e desenha. Isso é raro num trabalho de faculdade.

**A única regra de higiene:** o `docs/MVP.md` tem que ser autossuficiente. Quem corrige não pode precisar entender o app para achar as sete seções. Título explícito, na ordem do enunciado, com os screenshots junto.

### D2 — Duas referências, e a diferença entre elas é conteúdo

Por R7, não existe uma normal diária oficial de 1991–2020 para as estações automáticas. Em vez de fingir que existe:

- **Referência A (oficial, mensal):** média mensal observada × normal mensal 1991–2020 do INMET. Citável, defensável, e é o que um meteorologista brasileiro reconheceria.
- **Referência B (calculada, diária):** percentis por dia do ano computados da própria série automática, com a janela de ±7 dias. **Declarada como "período de referência curto", nunca como "Normal"** — a OMM exige 30 anos e a série dá ~17 úteis.

Comparar as duas, e explicar por que B não pode se chamar normal, vale mais em *Análise* e *Autoavaliação* do que qualquer gráfico adicional. O próprio código do app já recusa referência com menos de 20 anos (`normalUtil` em `src/anomalia.ts`) — essa recusa vira parágrafo de autoavaliação.

### D3 — O contrato de esquema é escrito ANTES de qualquer notebook

Se o catálogo do MVP usar os mesmos nomes de campo que `server/climatologia.js`, o export cai no app sem adaptador. Se não usar, alguém escreve um tradutor depois — e tradutor entre esquemas é onde nasce discordância silenciosa entre o que o rótulo diz e o que o número é.

---

## 3. O contrato de esquema (o que o M0 congela)

**Regra de nomes:** as chaves técnicas usam os nomes que o app já fala (herdados da Open-Meteo). Os nomes em português vivem no campo `rotulo`, exatamente como `VARIAVEIS` já faz hoje. Isso não é preguiça — é o que faz o Parquet cair direto em `montarPainel()`.

### 3.1 `dim_estacao`

| Campo | Tipo | Domínio | Origem |
|---|---|---|---|
| `estacao_id` | string | código INMET, ex. `A001` | cabeçalho do CSV |
| `nome` | string | — | cabeçalho |
| `uf` | string(2) | 27 unidades federativas | cabeçalho |
| `regiao` | string | N, NE, CO, SE, S | cabeçalho |
| `lat` | double | −34 a 6 | cabeçalho |
| `lng` | double | −74 a −34 | cabeçalho |
| `altitude_m` | double | 0 a 1600 | cabeçalho |
| `fundacao` | date | ≥ 2000 | cabeçalho |
| `rede` | string | `automatica` \| `convencional` | derivado |
| `primeiro_dado`, `ultimo_dado` | date | — | derivado do fato |
| `anos_uteis` | int | 0 a 26 | derivado — anos com ≥ 80% de dias válidos |

### 3.2 `fato_observacao_diaria`

| Campo | Tipo | Nota |
|---|---|---|
| `estacao_id` | string | FK |
| `data` | date | UTC |
| `dia_do_ano` | int | 1 a 366 |
| `temperature_2m_max` | double | °C |
| `temperature_2m_min` | double | °C |
| `temperature_2m_mean` | double | °C — média das horas válidas |
| `precipitation_sum` | double | mm |
| `wind_speed_10m_max` | double | m/s |
| `horas_validas` | int | 0 a 24 — **completude do dia** |
| `ingestao_em` | timestamp | linhagem |
| `fonte` | string | `INMET/automatica/{ano}.zip` |

`horas_validas` é o campo que impede a mentira mais fácil deste dataset: uma máxima calculada com 3 horas do dia não é a máxima do dia. Abaixo de um limiar declarado, o agregado vira `null`.

### 3.3 `gold_normal`

Mapeia 1:1 em `EnvelopeVar` (`src/analysis/normalSerie.ts`) e `NormalDaRota` (`src/probe/comparacao.ts`).

| Campo | Tipo | Nota |
|---|---|---|
| `estacao_id` | string | |
| `variavel` | string | uma das chaves de `VARIAVEIS` |
| `dia_do_ano` | int | 1 a 366 |
| `p10`, `p50`, `p90`, `media` | double | `null` onde não há amostra — **nunca 0** |
| `n_amostras`, `anos` | int | |
| `referencia` | string | `1991-2020` \| `2008-2024` |
| `feitio` | string | `simetrica` \| `assimetrica` |
| `unidade`, `rotulo` | string | |

### 3.4 `gold_vies`

| Campo | Tipo | Nota |
|---|---|---|
| `estacao_id`, `modelo`, `variavel`, `mes` | | `modelo` ∈ {`ERA5`, `GFS`} |
| `vies_medio` | double | modelo − observação |
| `erro_absoluto_medio`, `rmse` | double | |
| `n_pares` | int | |
| `delta_altitude_m` | double | altitude da estação − altitude média da célula |
| `vies_residual` | double | viés após remover o efeito de altitude |

`delta_altitude_m` e `vies_residual` existem por causa da armadilha descrita em §6/RK2.

### 3.5 Regras invioláveis do contrato

1. **Ausência é `null`.** Nunca `0`, nunca `-9999`, nunca string vazia.
2. **Toda tabela Gold carrega `referencia`, `fonte` e `unidade`.** Um número que chega ao app sem procedência não pode ser desenhado.
3. **`feitio` decide o que a tela pode afirmar.** `simetrica` autoriza "+3,4 °C acima da média"; `assimetrica` só autoriza percentil.
4. Mudança de nome de campo é **mudança de contrato** e exige atualizar o teste do lado do app.

---

## 4. Os marcos

Sequência em semanas relativas. **Mapeie para a sua data de entrega real** — eu não a conheço, e a única regra rígida é que **M6 é um portão: nada de M7 em diante começa antes de M6 estar entregue.**

---

### M0 · Contrato de esquema
**Semana 0 · 2–4 h**

**Objetivo.** Congelar nomes, tipos, domínios e regras de ausência antes de escrever uma linha de PySpark.

**Entregáveis.**
- `pipeline/contrato/esquema.md` — a §3 deste documento, versionada.
- `pipeline/contrato/esquema.json` — os mesmos campos em formato legível por máquina, importado pelos dois lados.
- `test/contrato.mjs` — entra em `npm test`. Valida qualquer Parquet/JSON de entrada contra o contrato e reprova nome errado, tipo errado e ausência codificada como zero.

**Por que este é o marco que costura os dois subsistemas.** Depois dele, a suíte de testes do app é quem diz se a saída do pipeline está correta. Não é documentação pedindo que os dois lados concordem — é um teste que quebra quando eles discordam.

**Benefício para o ObservEarth.** Indireto, e é o maior de todos por unidade de esforço: elimina o adaptador. Sem M0, o Parquet chega com `temp_max` e o app espera `temperature_2m_max`, e alguém escreve um `de/para` que ninguém mantém.

**Cobertura da rubrica.** Adianta boa parte de *Modelagem — Catálogo de Dados* (1,0 pt). O catálogo praticamente já está escrito quando o M0 fecha.

**O que NÃO entrega.** Nenhum dado. Nenhuma tela.

**Pronto quando.** O teste do ObservEarth existe, roda em `npm test`, e reprova um arquivo com nome de campo errado.

---

### M1 · Coleta e camada Bronze
**Semana 1 · 6–10 h**

**Objetivo.** O dado bruto do INMET dentro do Lakehouse, sem nenhuma alteração de conteúdo.

**Tarefas, nesta ordem.**
1. **Verificação por LinkedIn** na conta Databricks (R2). É o desbloqueio mais barato do projeto inteiro — faça antes de tudo.
2. Criar o Volume do Unity Catalog e a estrutura de catálogos `bronze` / `silver` / `gold`.
3. Ingerir os ZIPs anuais. Se R2 destravou: script `01_coleta.py` que baixa e descompacta. Se não: download local + upload no Volume + screenshots.
4. Ler os CSV **em duas passadas** — o cabeçalho de metadados da estação (nome, código, lat, lng, altitude, fundação) e a tabela horária são coisas diferentes no mesmo arquivo, e viram tabelas diferentes.
5. Gravar `bronze.observacao_horaria_bruta` e `bronze.estacao_bruta`, ambas com `ingestao_em` e `arquivo_origem`.

**Escopo sugerido.** Comece com **3 anos e ~20 estações** (uma por capital de interesse). Amplie depois. MVP significa versão mínima que já funciona — pipeline que não roda porque está processando 26 anos é pipeline não entregue.

**Benefício para o ObservEarth.** **Nada aparece na tela** — bronze é cofre de evidência, e o app não consome bronze nem vai consumir. Mas o que fica no repositório é seu e é reaproveitável: o `pipeline/databricks/01_coleta.py` passa a ser o irmão maduro do `pipeline/ingest_open_data.py` que já está lá. Da próxima vez que você quiser uma fonte nova em lote, o molde existe.

**Cobertura da rubrica.** *Coleta* (0,5 pt) inteira; parte de *Carga e Pipeline* (1,0 pt).

**Risco.** R2 não destravar. Mitigação já descrita — o upload manual é explicitamente aceito pelo enunciado.

**Pronto quando.** `SELECT count(*) FROM bronze.observacao_horaria_bruta` devolve número e há screenshot da tabela persistida.

---

### M2 · Camada Silver — limpeza e a dimensão estação
**Semana 2 · 8–14 h**

**Objetivo.** A série confiável, e o catálogo dos problemas que ela tinha.

**Tratamentos previstos** (a confirmar abrindo o arquivo — nenhum destes está verificado ainda):
- sentinela de ausência (provavelmente `-9999`) → `null`;
- vírgula decimal → ponto;
- encoding do arquivo → UTF-8;
- variação de nome de coluna entre anos → nome canônico do contrato;
- duplicatas de `(estacao_id, timestamp)`;
- fuso: confirmar que a coluna de hora é UTC e não local;
- valores fisicamente impossíveis: umidade > 100%, temperatura < −20 °C ou > 50 °C no Brasil, pressão fora de 850–1080 hPa;
- estações que mudaram de posição — `lat`/`lng` diferentes para o mesmo código ao longo dos anos.

**Entregáveis.** `silver.observacao_horaria`, `silver.estacao`, e um `silver.relatorio_qualidade` com contagem de cada problema por estação e por ano.

**Benefício para o ObservEarth.** Ainda **nada na tela**. Mas duas coisas ficam:

1. `silver.relatorio_qualidade` é o que, dois marcos adiante, permite o app dizer *"esta estação tem 12% de falha em 2019"* em vez de desenhar uma linha inteira como se fosse contínua. Sem essa contagem, a camada de estações mentiria por omissão.
2. O parser do CSV do INMET — sentinela, encoding, vírgula decimal, coluna que muda de nome — é código de manutenção permanente do projeto. Toda vez que sair um ano novo, ele roda de novo.

**Cobertura da rubrica.** *Qualidade de Dados* (1,0 pt) é essencialmente este marco. É também o marco em que o dado sujo de verdade do INMET paga: problemas reais rendem análise real.

**O que NÃO entrega.** Nenhuma tela, nenhuma resposta de negócio.

**Pronto quando.** Cada tratamento tem: contagem antes, contagem depois, e uma frase dizendo por que foi feito.

---

### M3 · Gold A — diário, normais e percentis · **primeiro export**
**Semana 3 · 8–12 h**

**Objetivo.** A primeira tabela que responde pergunta, e o primeiro arquivo que o app consome.

**Trabalho.**
1. Agregar horário → diário, respeitando `horas_validas`.
2. Carregar as planilhas de Normais 1991–2020 do INMET (`.xlsx`, mensais, estações convencionais) → `gold_normal_mensal_oficial`.
3. **O JOIN difícil:** parear estação automática com convencional. Redes diferentes, códigos diferentes. Critério a definir e documentar — por proximidade com teto de distância e de diferença de altitude, provavelmente. Registrar quantas estações ficaram **sem par**, porque essa contagem é resultado.
4. Calcular a Referência B: percentis por dia do ano, janela de ±7 dias — a tradução direta de `envelopeDe()` em `server/envelope.js` para PySpark.
5. Exportar `estacoes.parquet` e `normais.parquet`.

**Benefício para o ObservEarth — o primeiro real.**
- **Camada de estações no globo.** Pontos com medição de verdade, e não saída de modelo. Hoje o app não tem um termômetro sequer: GFS é modelo, ERA5 é reanálise, Open-Meteo histórico é modelo.
- **Recorde observado.** *"O dia mais quente já registrado nesta estação"* — frase que o app hoje não consegue dizer de jeito nenhum, porque reanálise suaviza extremo.
- **Custo zero para pontos brasileiros.** `/api/climatologia` deixa de gastar chamada da Open-Meteo onde há estação próxima.

**Cobertura da rubrica.** *Modelagem* (1,0 pt) e boa parte de *Análise* (2,0 pt).

**Pronto quando.** Os dois Parquet passam no `test/contrato.mjs` do ObservEarth.

---

### M4 · Gold B — viés modelo × observação · **segundo export**
**Semana 4 · 10–16 h**

**Objetivo.** Medir o quanto o modelo erra em cada ponto. É a análise que diferencia o trabalho.

**Trabalho.**
1. Buscar a série ERA5 das coordenadas de cada estação (Open-Meteo Archive). **~600 chamadas, uma única vez** — 6% do free tier diário, dentro do teto de ¼ do projeto.
2. Parear observação × modelo por `(estacao_id, data)`.
3. Calcular viés médio, erro absoluto médio e RMSE **por mês** — o viés é sazonal e a média anual esconde isso.
4. **Corrigir por altitude.** Ver RK2 em §6: sem isso, o "viés" é em boa parte um mapa de relevo.

**Benefício para o ObservEarth — o maior de todos.**
- O app passa a poder afirmar *"neste ponto o modelo erra sistematicamente +2,1 °C em setembro"*. É uma afirmação **sobre a confiabilidade de todas as outras** que o app faz.
- E ela compõe: a previsão pode ser apresentada já com o viés conhecido — *"o modelo diz 31 °C; aqui ele costuma errar +2 °C nesta época"*. Nenhum site de consumo faz isso.

**Cobertura da rubrica.** *Análise* (2,0 pt) — é aqui que a discussão fica rica, porque separar viés de modelo de erro de representatividade **é** a análise.

**Risco.** Alto. É o marco mais fácil de fazer errado de um jeito que parece certo. Se o tempo apertar, **corte este e mantenha M3 e M5** — o enunciado diz expressamente que não responder todas as perguntas não afeta a nota, desde que discutido.

**Pronto quando.** Existe um número de viés por estação/mês/variável **e** um parágrafo explicando quanto dele é altitude.

---

### M5 · Gold C — cobertura e confiança · **terceiro export**
**Semana 5 · 4–6 h**

**Objetivo.** Mapear onde o app **não** sabe de nada.

**Trabalho.** Por célula de grade: distância à estação mais próxima, número de estações num raio, anos de série disponíveis, completude média. Um índice de confiança declarado — com a fórmula escrita, não uma nota mágica de 0 a 100.

**Benefício para o ObservEarth.** Uma camada que mostra a própria ignorância do app. Na Amazônia quase não há estação, e isso deveria ser visível. É a mesma ética que o código já segue — ausência é `null`, nunca zero — promovida a camada de mapa.

**Cobertura da rubrica.** *Análise* + *Capricho*. É barato e rende muito.

**Pronto quando.** `cobertura.parquet` existe e a fórmula do índice está escrita no catálogo.

---

### M6 · Entrega acadêmica — **PORTÃO**
**Semana 6 · 8–12 h**

**Objetivo.** O documento avaliado.

**Entregáveis.** `docs/MVP.md` no repositório do ObservEarth, autossuficiente, com **os sete tópicos do item 5 do enunciado, com os títulos exatos**:

1. Contexto de Negócios e Perguntas (Etapa 2 e 4.1) — incluindo a discussão de licença de R8, com a ambiguidade reconhecida.
2. Carga dos Dados (Etapa 4.2)
3. Modelagem e Catálogo de Dados (Etapa 4.3) — §3 deste documento + screenshots do Unity Catalog.
4. Pipeline de Dados (Etapa 4.4) — como os notebooks foram ramificados + screenshots das tabelas persistidas.
5. Qualidade de Dados (Etapa 4.5) — M2, com contagens antes/depois.
6. Análise de Dados (Etapa 4.5) — M3, M4, M5 respondendo às perguntas.
7. Autoavaliação — o que não foi atingido e por quê. **As perguntas originais ficam intactas**, mesmo as não respondidas.

**Benefício para o ObservEarth.** O README principal ganha a seção do subsistema de lote — que hoje não existe, apesar de o `pipeline/` estar lá desde o começo. O projeto passa a ter procedência documentada dos dois lados.

**Sobre a etapa de Análise (4.5), uma escolha deliberada:** ela é feita **duas vezes**. Em SQL/notebook no Databricks, que é o caminho seguro e o que a rubrica espera ver em screenshot; **e** renderizada no ObservEarth. O enunciado permite expressamente combinar a plataforma com outras ferramentas. A versão do notebook garante a nota; a versão no app é o diferencial. Não é uma no lugar da outra — trocar o gráfico do notebook por um print do globo é apostar a nota num julgamento subjetivo de quem corrige.

**Pronto quando.** Repositório público, todos os sete títulos presentes, screenshots de cada passo feito por interface, e `docs/MVP.md` legível por quem nunca abriu o app.

---

### M7 · Patch no ObservEarth — a camada de estações
**Pós-entrega · 6–10 h**

**Trabalho.**
- `server/estacoes.js` — carrega os Parquet uma vez na subida, serve `/api/estacoes` e `/api/estacoes/:id`.
- Camada nova na taxonomia (`src/design/taxonomy.ts`), família *ocorrência* ou família própria: são pontos de medição, não campo contínuo.
- Marcadores no globo e no mapa 2D, com a estação mais próxima destacada ao abrir a sonda.

**Benefício.** O app deixa de ser um visualizador de modelos e passa a mostrar medição. É a mudança de patamar.

---

### M8 · Patch — a sonda com viés e recorde
**Pós-entrega · 4–8 h**

**Trabalho.** No bloco "Hoje contra a normal" que já existe em `ProbePanel.tsx`, acrescentar duas linhas quando há estação próxima: o **recorde observado** e a **leitura corrigida pelo viés**, ambas com a distância até a estação declarada.

**Benefício.** Sobe de 2 para ~5 as categorias de afirmação inferencial da sonda. E uma delas é meta: diz o quanto acreditar nas outras.

**Cuidado.** Estação a 60 km não descreve o seu quintal. A distância tem que aparecer na tela, sempre, e acima de um limiar a linha não aparece.

---

### M9 · Camada de cobertura e fechamento
**Pós-entrega · 3–5 h**

Camada de confiança (M5) no mapa; `README.md` atualizado com a procedência das estações; `docs/MVP.md` ganha um adendo com os screenshots do app renderizando o Gold — que é o fecho do ciclo e não estava disponível na data da entrega.

---

## 5. O que este plano recusa construir

| Recusa | Motivo |
|---|---|
| **Interpolar as estações num campo contínuo** | Algumas centenas de pontos não sustentam um campo sobre o Brasil. Reanálise já faz isso, com física, melhor. Sairia um mapa lindo e quase todo inventado. |
| **Afirmar tendência climática a partir de série de estação** | Contaminada por urbanização, troca de instrumento e mudança de local. Fazer certo exige homogeneização, que é área de pesquisa. Mostrar a linha **com a ressalva** é aceitável; afirmar aquecimento não é. |
| **O app consultar o Databricks em tempo real** | Free Edition não serve isso, e mesmo que servisse, autenticação e latência estariam errados. O app lê arquivo. |
| **Streaming / medalhão dentro do ObservEarth** | Cargo cult. O app é tempo real por natureza e não tem dado em repouso para camadas. |
| **Chamar a Referência B de "Normal Climatológica"** | A OMM exige 30 anos. A série automática dá ~17 úteis. |

---

## 6. Registro de riscos

| ID | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| RK1 | LinkedIn não destrava internet de saída | Média | Baixo | Upload manual no Volume; o enunciado aceita e pede screenshots |
| RK2 | **"Viés" que na verdade é altitude** | **Alta** | **Alto** | Calcular `delta_altitude_m`; reportar viés bruto e residual separados; declarar o gradiente adiabático usado |
| RK3 | JOIN automática × convencional sem par para muitas estações | Alta | Médio | É resultado, não falha: reportar a contagem. Referência B cobre quem ficou sem par |
| RK4 | Volume de dados estoura o serverless gratuito | Média | Alto | Começar com 3 anos e 20 estações; ampliar só depois de M3 fechar |
| RK5 | Formato do CSV muda entre anos | Alta | Médio | Nome canônico no contrato; teste que reprova coluna desconhecida |
| RK6 | Escopo do app invade o prazo do MVP | **Alta** | **Alto** | M6 é portão. Nenhuma linha de M7+ antes da entrega. Repositório único **não** significa trabalhar nos dois ao mesmo tempo — significa que o trabalho fica no mesmo lugar |
| RK8 | Repositório único confunde a correção | Baixa | Médio | `docs/MVP.md` autossuficiente, linkado do topo do `README.md`, com os sete títulos na ordem do enunciado |
| RK7 | Licença do INMET questionada na correção | Baixa | Baixo | Declarar o regime e a ambiguidade; ter GHCN (CC0) no pipeline |

---

## 7. Cobertura da rubrica

| Critério | Pontos | Marcos |
|---|---|---|
| Objetivo | 1,0 | M0, M6 |
| Coleta | 0,5 | M1 |
| Modelagem (tabelas 1,0 + catálogo 1,0) | 2,0 | M0, M3 |
| Carga e Pipeline | 1,0 | M1, M2, M3 |
| Qualidade de Dados | 1,0 | M2 |
| Análise (correção 1,0 + discussão 1,0) | 2,0 | M3, M4, M5 |
| Autoavaliação | 0,5 | M6 |
| Capricho | 2,0 | transversal — M0 e M5 são os que mais rendem por hora |

**Nota sobre risco de nota:** M4 é o marco de maior valor para o app e de maior risco técnico. Se ele cair, a rubrica ainda fecha em ~8,5 com M3 e M5 bem feitos. **Não é o marco que sustenta a nota** — é o que sustenta o diferencial. Priorize nessa ordem.

---

## 8. Perguntas em aberto

1. **Qual a data real da entrega?** Todo o §4 está em semanas relativas.
2. **Quantas estações e quantos anos?** Sugestão: 20 estações / 3 anos para o M1, ampliando após M3.
3. **A verificação por LinkedIn destravou a internet de saída?** Muda a Etapa 4.2 inteira — script versionado ou upload com screenshots.
4. **Confirmar abrindo o arquivo:** sentinela de ausência, encoding, fuso da coluna de hora. Nada disso está verificado — são as três primeiras coisas a medir no M1.

---

## 9. Próximo passo

Escrever o M0: `contrato/esquema.md`, `contrato/esquema.json` e `test/contrato.mjs`. São 2–4 horas e é o único marco cujo custo de pular só aparece três semanas depois, quando o adaptador já foi escrito.

---

### Fontes das restrições medidas

- [Dados Históricos — INMET](https://portal.inmet.gov.br/dadoshistoricos)
- [Normais Climatológicas — INMET](https://portal.inmet.gov.br/normais)
- [BDMEP — INMET](https://portal.inmet.gov.br/servicos/bdmep-dados-hist%C3%B3ricos)
- [Databricks Free Edition limitations](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)
- [NOAA GHCN-Daily — Registry of Open Data on AWS](https://registry.opendata.aws/noaa-ghcn/)
