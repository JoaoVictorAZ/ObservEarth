# Redesign 2.0 — auditoria e plano

Conduzido com a metodologia da skill `design:design-system`. Agosto de 2026.
Todos os números abaixo foram **medidos**, não estimados.

---

## Auditoria

**Componentes revistos:** 22 · **Problemas encontrados:** 5 · **Nota: 41/100**

### 1. Dois sistemas de estado convivendo *(crítico)*

A migração para zustand ficou pela metade. O `AppShell` monta as versões novas,
mas continuavam no repositório:

| Arquivo morto | Linhas |
|---|---|
| `components/layout/LeftDock.tsx` | 150 |
| `components/layout/StatusBar.tsx` | 53 |
| `components/layout/TopBar.tsx` | 83 |
| `components/navigation/TopBar.tsx` | 91 |
| `context/ObservatoryContext.tsx` | 206 |
| **Total** | **583** |

Uma ilha fechada: só importavam entre si. Nenhum redesign sobrevive a duas
fontes de verdade para a mesma tela — a próxima pessoa a mexer editaria o
arquivo errado e não veria efeito nenhum.

**Resolvido.** Movidos para `.lixo-redesign/`, `tsc` limpo.

### 2. Duas paletas competindo

| Onde | Sistema |
|---|---|
| `index.css` | paleta "Instrumento" própria, em tokens |
| `LeftDock.tsx`, `globe.ts` | paleta padrão do **Tailwind**, em hexadecimal cravado |

`#3b82f6` é `blue-500`. `#f59e0b` é `amber-500`. `#fbbf24` é `amber-400`. Nenhuma
das duas paletas sabia da existência da outra.

### 3. Cobertura de tokens

| Categoria | Definidos antes | Valores cravados encontrados |
|---|---|---|
| Cor | 14 | 30 hex em CSS (19 distintos) + 27 rgba + ~45 hex em TSX |
| Espaço | **1** (`--gut`) | **221 px, 45 distintos** |
| Tipografia | 2 famílias, **0 tamanhos** | 9 tamanhos entre 9 e 13 px |
| Movimento | 1 curva, **0 durações** | espalhadas |
| Elevação | **0** | sombras à mão |

45 valores de espaçamento distintos não é liberdade — é ausência de decisão.
9 px e 10 px não se distinguem na tela, mas impedem qualquer ajuste global.

**Resolvido.** Escalas completas: espaço (7 passos, razão 1,5), tipografia
(5 tamanhos, 3 pesos), movimento (3 durações, 2 curvas), elevação (3 níveis).

### 4. Acessibilidade — uma reprovação real

Contraste medido contra `--void` (#04060a), WCAG 2.1:

| Token | Antes | Veredito | Depois |
|---|---|---|---|
| `--ink-4` | **2,44:1** | **REPROVA** (mínimo 3,0 para elemento) | **3,17:1** |
| `--ink-3` | 4,46:1 | falha por 0,04 para texto | **4,52:1** |

`--ink-4` era usado em rodapé de procedência e legenda de camada. Num
instrumento onde a origem do dado faz parte da leitura, esconder a fonte por
contraste insuficiente é perder informação, não economizar atenção.

Também reforçado `prefers-reduced-motion`: zerar transição de CSS não bastava,
porque o que de fato incomoda quem tem sensibilidade vestibular é o movimento
**contínuo** — partículas, anéis pulsantes, rotação automática. Nada disso é
CSS.

### 5. Taxonomia — a raiz de "tudo parece igual"

O painel agrupava por **procedência**: campos GFS, satélite, modelo,
sobreposições. Essa é a pergunta de quem construiu o sistema. Quem lê o mapa
pergunta outra coisa:

> *o que posso ver ao mesmo tempo, e por que isto parece com aquilo?*

Agrupada por procedência, temperatura (raster contínuo) fica ao lado de chuva
(raster em classes) e de vento (partículas) como se fossem a mesma coisa — e
nada na tela explica por que ligar uma **apaga** a outra.

---

## O eixo do redesign: agrupar pela NATUREZA do dado

`src/design/taxonomy.ts`. A natureza determina três coisas de uma vez:

1. a **codificação** visual (já implementada em `server/fields.js`)
2. se as camadas **podem coexistir**
3. que **controle** é honesto — rádio ou interruptor

| Família | Natureza | Codificação | Slot | Controle |
|---|---|---|---|---|
| **Campo contínuo** | varia suavemente em todo ponto | preenchimento suave | raster | **rádio** |
| **Campo em classes** | células com borda, ou limiar de decisão | faixas | raster | **rádio** |
| **Escoamento** | direção que persiste no tempo | partículas | flow | interruptor |
| **Estrutura** | informação está na forma da curva | linhas | vector | interruptor |
| **Ocorrências** | eventos e estações em pontos | símbolos | marks | interruptor |

### O que isso resolve de concreto

Só existe **um plano de imagem** no globo. Oferecer temperatura, chuva e WBGT
como interruptores independentes é prometer o que não se cumpre: ligar a segunda
apaga a primeira em silêncio. Foi exatamente o defeito encontrado em
`wbgtOn` — `if (!wbgtOn) { if (!kind) eng.setImagery(null) }`, que só limpa
quando nenhuma outra camada está selecionada.

**Rádio não promete.** A restrição passa a ser visível na forma do controle, em
vez de ser descoberta pelo erro. Interface que só revela sua regra quando falha
é interface que culpa quem a usa.

E cada grupo carrega a regra escrita sob o título — *"um por vez — dividem o
mesmo plano de imagem"* — antes de o usuário precisar testar.

---

## O que já está feito

- [x] 583 linhas de shell morto removidas; `tsc` limpo
- [x] Escalas de espaço, tipografia, movimento e elevação
- [x] Cinco cores de família, uma por natureza de dado
- [x] Contraste: zero reprovações WCAG AA (era 1)
- [x] `prefers-reduced-motion` cobrindo movimento contínuo
- [x] `src/design/taxonomy.ts` como fonte única
- [x] 156 verificações passando

## O que falta

1. **Reescrever `LeftDock` sobre a taxonomia** — rádio para raster, interruptor
   para o resto, regra visível por grupo. É a mudança que o usuário sente.
2. **Purgar os ~45 hexadecimais do Tailwind** em `LeftDock.tsx` e `globe.ts`,
   trocando pelos tokens de família.
3. **Substituir os 221 `px`** pelas escalas — mecânico, mas precisa ser feito de
   uma vez para não voltar a divergir.
4. **Legenda contextual**: hoje a rampa aparece solta. Deveria estar presa à
   camada ativa, com unidade e faixa observada — os dados já vêm de
   `/api/fields/:id/meta`.

---

## Uma ressalva que não é de design

Nada acima conserta o vento. O campo ainda sai do decodificador GRIB2 com
valores fisicamente impossíveis — o guarda `LIMITE_FISICO = 150` em
`server/wind.js` existe para recusá-los, e o clamp de ±40 m/s no cliente é o que
os transformava em listras diagonais convincentes.

Interface boa sobre dado errado é um instrumento bonito que mente. `/api/wind/grib-debug`
continua sendo o próximo passo.
