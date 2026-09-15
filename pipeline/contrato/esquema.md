# Contrato de esquema — Patch MVP

**Versão 1.0.0 · congelado em 2026-09-08**

Fonte de verdade legível por máquina: [`esquema.json`](./esquema.json).
Validador: [`validar.mjs`](./validar.mjs). Teste: [`../../test/contrato.mjs`](../../test/contrato.mjs), dentro de `npm test`.

---

## 0. Por que existe um contrato

O pipeline PySpark e o ObservEarth são dois subsistemas que trocam arquivos. Sem um contrato executável, a discordância entre eles é **silenciosa**: o Parquet sai com `temp_max`, o app espera `temperature_2m_max`, e a tela mostra um campo vazio que parece *"não tem dado para este ponto"*. Ninguém investiga um vazio.

Este documento não pede que os dois lados concordem. Ele descreve um teste que **quebra quando eles discordam** — e esse teste lê `VARIAVEIS` de `server/climatologia.js`, o objeto que a rota `/api/climatologia` usa de verdade. Documentação concorda com o código no dia em que é escrita; um teste concorda todo dia.

---

## 1. Regra de nomes

**Chave técnica em inglês, rótulo em português.**

As chaves são as que o app já fala, herdadas da Open-Meteo. Os nomes em português vivem no campo `rotulo`, exatamente como `VARIAVEIS` faz hoje. Isso não é anglicismo por preguiça: é o que faz o Parquet cair direto em `montarPainel()` sem tradutor. Tradutor entre esquemas é onde nasce discordância entre o que o rótulo diz e o que o número é.

O teste reprova qualquer campo com nome de grandeza em português — um `temperatura_maxima` no contrato seria o adaptador nascendo.

---

## 2. As cinco variáveis

| Chave | Unidade | Feitio | Rótulo |
|---|---|---|---|
| `temperature_2m_mean` | °C | simétrica | temperatura média |
| `temperature_2m_max` | °C | simétrica | temperatura máxima |
| `temperature_2m_min` | °C | simétrica | temperatura mínima |
| `precipitation_sum` | mm | **assimétrica** | precipitação diária |
| `wind_speed_10m_max` | m/s | **assimétrica** | vento máximo |

**`feitio` decide o que a tela pode afirmar.** `simetrica` autoriza *"+3,4 °C acima da média"*; `assimetrica` autoriza **só percentil**, porque em chuva a mediana costuma ser 0 e a média não descreve nada. Trocar o feitio de uma variável muda o que o aplicativo tem permissão de dizer sobre ela — por isso é campo de contrato, não configuração.

---

## 3. As tabelas

### 3.1 `dim_estacao` · silver · chave `estacao_id`

| Campo | Tipo | Domínio |
|---|---|---|
| `estacao_id` | string | padrão `^[A-Z]\d{3}$` |
| `nome` | string | — |
| `uf` | string | exatamente 2 caracteres |
| `regiao` | string | `N` `NE` `CO` `SE` `S` |
| `lat` | double | −34 a 6 |
| `lng` | double | −74 a −34 |
| `altitude_m` | double | −10 a 1600 |
| `fundacao` | date | ≥ 2000-01-01 |
| `rede` | string | `automatica` \| `convencional` |
| `primeiro_dado`, `ultimo_dado` | date | derivados do fato |
| `anos_uteis` | int | 0 a 30 — anos com ≥ 80% de dias válidos |

O retângulo de `lat`/`lng` é o do Brasil. Não é purismo: uma estação com coordenada trocada de sinal, ou com lat e lng invertidas, cai no Atlântico ou na Europa e o teste pega.

### 3.2 `fato_observacao_diaria` · silver · chave `estacao_id` + `data`

| Campo | Tipo | Faixa |
|---|---|---|
| `estacao_id` | string | FK |
| `data` | date | UTC |
| `dia_do_ano` | int | 1 a 366 |
| `temperature_2m_max` | double | −30 a 55 |
| `temperature_2m_min` | double | −30 a 45 |
| `temperature_2m_mean` | double | −30 a 50 |
| `precipitation_sum` | double | 0 a 600 |
| `wind_speed_10m_max` | double | 0 a 100 |
| `horas_validas` | int | 0 a 24 |
| `ingestao_em` | timestamp | linhagem |
| `fonte` | string | ex. `INMET/automatica/2026.zip` |

**Invariantes**

- `temperature_2m_min ≤ temperature_2m_max`.
- **`horas_validas` abaixo de 18 obriga todos os agregados a `null`.** Uma máxima calculada com 3 horas do dia não é a máxima do dia, e sai com exatamente a mesma cara de um dia completo. Este é o campo que impede a mentira mais fácil deste dataset.

### 3.3 `gold_normal` · gold · chave `estacao_id` + `variavel` + `dia_do_ano`

Mapeia 1:1 em `EnvelopeVar` (`src/analysis/normalSerie.ts`) e `NormalDaRota` (`src/probe/comparacao.ts`).

| Campo | Tipo | Nota |
|---|---|---|
| `estacao_id` | string | |
| `variavel` | string | uma das cinco chaves |
| `dia_do_ano` | int | 1 a 366 |
| `p10`, `p50`, `p90`, `media` | double | `null` onde não há amostra |
| `n_amostras`, `anos` | int | |
| `referencia` | string | padrão `^\d{4}-\d{4}$` |
| `feitio` | string | `simetrica` \| `assimetrica` |
| `unidade`, `rotulo` | string | |

**Invariantes**

- `p10 ≤ p50 ≤ p90`. Fora de ordem não quebra nada: a régua desenha a faixa invertida e o ponto cai do lado errado da mediana, com toda a aparência de normalidade.
- `n_amostras = 0` obriga `p10`, `p50`, `p90` e `media` a `null`. Percentil de conjunto vazio não é zero — não existe.

### 3.4 `gold_vies` · gold · chave `estacao_id` + `modelo` + `variavel` + `mes`

| Campo | Tipo | Nota |
|---|---|---|
| `modelo` | string | `ERA5` \| `GFS` |
| `mes` | int | 1 a 12 |
| `vies_medio` | double | modelo − observação |
| `erro_absoluto_medio`, `rmse` | double | ≥ 0 |
| `n_pares` | int | |
| `delta_altitude_m` | double | altitude da estação − altitude média da célula |
| `vies_residual` | double | viés após remover o efeito de altitude |

**Invariante:** `erro_absoluto_medio ≤ rmse`, sempre, por Jensen. Violado, há erro de agregação — não há dado que produza o contrário.

`delta_altitude_m` e `vies_residual` existem porque uma célula de modelo com 28 km de lado tem uma altitude média que pode estar centenas de metros longe da estação. Sem separar isso, o "viés do modelo" seria em boa parte a diferença de altura, e a conclusão sairia atribuída ao modelo.

### 3.5 `gold_cobertura` · gold · chave `estacao_id` + `ano`

| Campo | Tipo | Nota |
|---|---|---|
| `dias_esperados` | int | 365 ou 366 |
| `dias_com_dado` | int | 0 a 366 |
| `dias_completos` | int | dias com `horas_validas` ≥ 18 |
| `cobertura` | double | 0 a 1 |
| `confiavel` | bool | decisão declarada, não inferida na tela |

**Invariante:** `dias_completos ≤ dias_com_dado`.

---

## 4. As regras invioláveis

1. **Ausência é `null`.** Nunca `0`, nunca `-9999`, nunca `-999`, nunca `-327.68`, nunca string vazia.

   Esta é a regra mais importante do documento. Zero é uma medida: 0 mm de chuva é um dia seco, 0 m/s é calmaria. Uma sentinela numérica entra na média e no percentil sem levantar erro nenhum e desloca a distribuição inteira — a normal de 30 anos fica errada, e o app desenha essa normal com toda a confiança do mundo. O validador checa sentinela **antes** de checar faixa, senão o erro sairia como "abaixo do mínimo": verdadeiro, inútil, e escondendo o defeito real.

2. **Toda tabela `gold_normal` carrega `referencia` e `unidade`.** Um número que chega ao app sem procedência não pode ser desenhado — a tela afirma coisas diferentes conforme a referência seja `1991-2020` ou `2008-2024`.

3. **`feitio` decide o que a tela pode afirmar.** Ver §2.

4. **Mudança de nome de campo é mudança de contrato.** Exige subir a versão e atualizar `test/contrato.mjs`.

---

## 5. Como usar

No app e nos testes:

```js
import { validar, conferirComOApp } from "./pipeline/contrato/validar.mjs";
const problemas = validar(contrato, "gold_normal", linhas);
```

No notebook, antes de gravar o Parquet: exportar uma amostra em JSON e rodar o mesmo validador. A regra é a mesma dos dois lados porque é o mesmo arquivo — duas implementações da mesma regra é como elas passam a discordar.

---

## 6. O que este contrato NÃO resolve

Ele valida **forma**, não **verdade**. Uma temperatura de 31,4 °C num dia em que fez 19 °C passa por todas as checagens: está no tipo certo, na faixa certa, com `horas_validas` cheio. Detectar isso é trabalho da camada de qualidade (M5), com comparação contra vizinhas e contra a própria climatologia da estação.

Ele também não valida **cobertura temporal**: uma tabela `gold_normal` com só 3 dias do ano passa limpa. Quem cobra isso é o teste de completude do M3.
