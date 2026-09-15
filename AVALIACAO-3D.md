# Avaliação — Three.js, interação e exibição de dados

**ObservEarth** · auditoria de 07/09/2026 · lida do código, não de memória

---

## 0. Veredito, antes dos detalhes

**O Three.js não é o problema, e trocar de renderizador não resolveria nada.** A pilha está bem escolhida: `three` 0.185, `globe.gl` sobre `three-globe`, advecção de partículas na GPU, pirâmide de tiles, monitor de quadro com três degraus de qualidade e degradação automática. Isso é mais infraestrutura 3D do que a maioria dos apps de clima tem.

O problema é outro, e é de **vocabulário de interação**:

> O globo tem **um único verbo**: clicar. Não há hover, não há seleção persistente, não há foco, não há teclado, não há menu de contexto, não há arrasto de região. Toda informação exige compromisso — você clica sem saber o que vai encontrar, e depois de clicar o globo esquece onde você clicou.

E há **uma omissão de uma linha** no pipeline de render que vale mais, visualmente, do que qualquer efeito novo: não existe *tone mapping*.

---

## 1. O que foi medido

### 1.1 Entrada e eventos

| Superfície | O que existe | Onde |
|---|---|---|
| Globo | `onGlobeClick` → abre a sonda. `OrbitControls` (`change`/`start`/`end`) só para acordar o laço e ajustar DPR. | `src/globe.ts:314`, `:359–372` |
| Mapa 2D | `pointerdown` / `pointermove` / `pointerup` / `pointercancel` / `wheel` + clique | `src/mapa2d.ts:592–630` |
| Marcadores | `pointLabel` ligado (tooltip nativo do globe.gl). **`onPointClick` não está ligado.** | `src/globe.ts:304` |
| Teclado | nada no globo | — |

O mapa 2D tem **mais** tratamento bruto de ponteiro que o globo, e mesmo assim os dois têm o mesmo vocabulário semântico: arrastar, dar zoom, clicar.

### 1.2 Rótulos

Overlay HTML pelo `htmlElementsData` do globe.gl. Um `<div>` por rótulo, posição reescrita a cada quadro.

- **Teto duro de 90 elementos no DOM** (`src/globe.ts`, no laço de `applyLOD`). O teto existe porque overlay HTML custa caro.
- O *declutter* é bom: separação angular gulosa por produto escalar, com `sepDeg` proporcional à altitude, e opacidade caindo em direção à borda do cone de visão.
- `pointer-events: none` já está no CSS — rótulo não rouba clique. Verificado, não é problema.

### 1.3 Pipeline de render

```
sortObjects = true
logarithmicDepthBuffer = true
setPixelRatio(min(devicePixelRatio, tier.dpr))
anisotropy = min(8, max)
```

**Não há `toneMapping`. Não há `EffectComposer`. Não há passe de pós-processamento nenhum.** Verificado por busca em todo o `src/`.

### 1.4 Orçamento de quadro

| Degrau | DPR | Partículas | Rastro | Focos |
|---|---|---|---|---|
| 0 · Alta | 2,0 | 40.000 | 4096 | 4.000 |
| 1 · Equilibrada | 1,5 | 22.500 | 2048 | 2.000 |
| 2 · Desempenho | 1,0 | 12.100 | 2048 | 900 |

Degrada acima de 20 ms/quadro, imediatamente acima de 33 ms, volta a subir abaixo de 13 ms. **Qualquer padrão novo precisa caber nesta tabela** — é o contrato que impede o app de ficar bonito e travado.

### 1.5 Um bug que eu suspeitei e NÃO existe

Achei que `pointOfView` interpolasse longitude linearmente e que um voo de Tóquio a Nova York desse a volta pelo lado errado. Fui ler o `globe.gl`: ele normaliza a diferença para nunca girar mais de 180°. **Não há bug.** Fica registrado porque quase virou "correção" de um problema inexistente.

---

## 2. As lacunas, por tamanho

| # | Lacuna | Evidência | Impacto |
|---|---|---|---|
| 1 | **Sem hover em nada** | só `onGlobeClick` | Toda leitura exige compromisso. Não dá para varrer o mapa com o olho e o cursor. |
| 2 | **Sem estado de seleção no 3D** | o clique abre janela e o globo não marca nada | A janela diz "−15,7 / −47,9" e o planeta não mostra onde é isso. |
| 3 | **Sem tone mapping** | nenhuma ocorrência em `src/` | Glint do mar e luzes de cidade estouram para branco puro. É o degrau visual mais barato que existe. |
| 4 | **Teto de 90 rótulos** | constante no `applyLOD` | Em zoom regional o mapa fica mudo de topônimos. |
| 5 | **`onPointClick` desligado** | `pointLabel` ligado, clique não | Sismo e foco de calor têm tooltip e não têm ação. |
| 6 | **Sem seleção de região** | `/api/imagery/janela` existe só no servidor | O recorte por área não tem cliente. |
| 7 | **Sem teclado** | nada | Inacessível por teclado; sem atalho de navegação. |

---

## 3. Padrões aplicáveis

Cada um com o que resolve **aqui**, o custo real e o risco. Ordenados por valor dividido por esforço, não por sofisticação.

---

### P1 · Leitura contínua sob o cursor
**O padrão do earth.nullschool. Custo quase zero, e o app já tem tudo que precisa.**

Enquanto o ponteiro se move, a barra superior mostra o valor do campo ativo naquela coordenada — sem clique, sem janela, sem requisição.

**Por que é quase de graça aqui:** a grade de vento já está no cliente como `Float32Array` (`src/windBin.ts`), e `src/coord.ts` já converte tela → lat/lng. Amostrar a grade no cursor é aritmética sobre memória local.

- **Custo:** uma amostragem bilinear por quadro de ponteiro. Desprezível.
- **Risco:** nenhum de desempenho. O cuidado é editorial — o valor tem que vir com a unidade e a procedência, senão vira número solto.
- **Ganho:** transforma o globo de "clique para saber" em "passe o olho e leia". É a mudança de sensação mais barata da lista.

---

### P2 · Tone mapping ACES + exposição
**Uma linha. O maior salto visual por caractere digitado.**

```
rnd.toneMapping = THREE.ACESFilmicToneMapping;
rnd.toneMappingExposure = 1.0;
```

**Por que importa agora, e não antes:** o material novo da superfície soma glint especular e luzes de cidade sobre a textura. Sem *tone mapping* esses valores passam de 1.0 e são **cortados** — o reflexo do sol no mar vira um borrão branco chapado e as luzes de cidade saturam. O ACES faz o ombro da curva, e o brilho fica com forma em vez de virar recorte.

- **Custo:** zero de desempenho (uma função no shader de saída).
- **Risco:** muda a aparência de **tudo**, inclusive as rampas de cor das camadas de dado. Uma rampa que era calibrada no espaço linear passa a ser exibida com outra curva. Precisa de uma passada de olho nas escalas — e, se alguma rampa for calibrada por contraste medido, refazer a medição.
- **Nota honesta:** este é o item em que "melhorou muito" e "as cores dos dados mudaram" acontecem juntos. É por isso que ele é P2 e não P1.

---

### P3 · Marcador de seleção persistente com linha-guia
**O globo tem que lembrar onde você clicou.**

Um marcador fica cravado no ponto sondado — anel fino, escala compensada pela distância — e uma linha em espaço de tela liga esse ponto à janela flutuante correspondente.

- **Custo:** um `Mesh` e uma linha SVG por sonda aberta.
- **Risco:** baixo. Atenção ao `ORDEM` (`src/ordemDesenho.ts`): o marcador precisa ficar acima das cascas de dado e abaixo da malha 3D.
- **Ganho:** resolve a lacuna 2 e, junto com as janelas múltiplas que já existem, permite **comparar dois pontos** sem perder qual é qual.

---

### P4 · Semântica completa de ponteiro
**Um verbo só é pouco.**

| Gesto | Ação |
|---|---|
| hover | realce + cursor + leitura contínua (P1) |
| clique | sonda o ponto |
| clique duplo | aproxima até o ponto |
| botão direito | menu: sondar · recorte 3D · análise completa · copiar coordenada |
| `Shift` + arrasto | seleção de região (P7) |
| setas / `+` `−` | navegação por teclado |

- **Custo:** baixo, e quase todo em React e não em Three.
- **Risco:** conflito com o `OrbitControls`, que já consome arrasto e roda. `Shift` + arrasto e botão direito precisam ser interceptados antes dele.
- **Ganho:** resolve as lacunas 1, 5 e 7 de uma vez, e é pré-requisito de quase tudo o mais.

---

### P5 · Picking por cor na GPU
**Para hover em camadas densas, quando o raycast não der conta.**

Renderiza os marcadores num alvo fora de tela com uma cor única por elemento e lê **um pixel** sob o cursor. Custo independente da quantidade — 4.000 focos de calor custam o mesmo que 40.

- **Custo real, e ele não é zero:** `readPixels` força sincronização GPU→CPU e custa tipicamente 1–3 ms. Num orçamento de 20 ms isso é 5–15% do quadro.
- **Mitigação:** só amostrar quando o ponteiro estiver **parado** por ~40 ms, com `scissor` de 1×1 pixel. Ninguém precisa de hover no meio de um arrasto.
- **Quando NÃO usar:** enquanto as camadas de ocorrência estiverem na casa das centenas, o raycast nativo do `three` resolve e é mais simples. **Este padrão é para quando a camada de estações do MVP entrar** e a contagem subir.

---

### P6 · Marcadores em `InstancedMesh` com atributos por instância
**Uma chamada de desenho para milhares de pontos, com cor e tamanho vindos do dado.**

Hoje os focos e sismos passam por `pointsData` do globe.gl. Com `InstancedMesh` e atributos de instância (`instanceColor`, escala por matriz), a cor deixa de ser uma propriedade de JavaScript e vira um buffer — que é o que permite animar mil marcadores sem tocar em objeto nenhum.

- **Custo:** um refatoramento de camada, não do motor.
- **Risco:** perde-se o `pointLabel` nativo do globe.gl, então **P5 ou P4 precisa vir antes** — senão a camada fica sem hover nenhum.
- **Ganho:** teto de contagem sobe uma ordem de grandeza. Pré-requisito real para a camada de estações.

---

### P7 · Pincel de região
**Arrastar uma caixa no globo e obter estatística da área.**

`Shift` + arrasto desenha um retângulo em espaço de tela, projetado como uma calota/caixa geográfica. Ao soltar, a área vira: histograma do campo ativo, extremos, contagem de ocorrências dentro dela.

**Por que agora:** `/api/imagery/janela` já existe **só no servidor**. Ele não tem cliente. E `src/calota.ts` já resolve a geometria de qual pedaço do globo está visível.

- **Custo:** médio. O desenho é trivial; a estatística sobre a grade é onde está o trabalho.
- **Risco:** um retângulo em espaço de tela **não é** um retângulo geográfico. Perto dos polos a distorção é enorme, e um "quadrado" desenhado sobre a Groenlândia cobre uma área muito diferente da que parece. A caixa desenhada precisa ser a **projeção da caixa geográfica**, e não o inverso — senão a estatística é sobre uma região que ninguém selecionou.

---

### P8 · Callout ancorado ao ponto
**A janela flutuante é boa para análise. Ruim para "o que é isso aqui".**

Um cartão pequeno, em espaço de tela, ancorado à coordenada e seguindo o globo enquanto ele gira — com três a cinco números e um botão "abrir sonda". É o padrão do windy e do nullschool, e convive com as janelas: o callout é para olhar, a janela é para estudar.

- **Custo:** baixo. Reaproveita a projeção que os rótulos já usam.
- **Risco:** um a mais para o teto de 90 elementos do DOM. Deve ser um só por vez.

---

### P9 · Rótulos em atlas SDF instanciado
**Remove o teto de 90.**

Texto renderizado como quads instanciados com fonte em *signed distance field*: milhares de rótulos, uma chamada de desenho, escala sem serrilhar.

- **Custo:** **alto.** É o item mais caro da lista. Exige gerar o atlas, tratar acentuação do português, e reimplementar o *declutter* em espaço de tela.
- **Risco:** texto em SDF é levemente menos nítido que texto do navegador em tamanhos pequenos. Num app cujo sistema de design se chama "Instrumento" e trata legibilidade como dado, isso não é detalhe.
- **Caminho do meio, que eu recomendaria:** manter DOM para país e estado (poucos, precisam ser nítidos) e usar SDF só para a camada densa — estações, focos. Assim o teto de 90 continua valendo para o que ele foi feito.

---

### P10 · Pós-processamento seletivo
**O "espetáculo" que você pediu — e o mais fácil de errar.**

`EffectComposer` com *bloom* seletivo: só as trilhas de vento e as luzes de cidade entram numa máscara de brilho; a superfície e as camadas de dado ficam de fora.

- **Custo:** alto e **proporcional à resolução**. Um bloom decente são 5–6 passes em meia resolução. Num monitor com DPR 2,0 e o degrau "Alta" já em 40.000 partículas, isso pode comer o orçamento inteiro.
- **Obrigatório:** ligar por degrau de qualidade. Bloom no degrau 0, nada nos degraus 1 e 2. E respeitar `prefers-reduced-motion` no que for pulsante.
- **Aviso editorial:** *bloom* global sobre um mapa de dado é o caminho mais curto para o "AI slop" — tudo brilha, nada significa. Se entrar, entra com máscara: brilha o que **se move** e o que é **luz de verdade**, nunca o que é medida.

---

## 4. O que eu não faria

| Ideia | Por quê |
|---|---|
| Trocar globe.gl por Three puro | O que ele dá — projeção, tween de câmera, tiles, overlay HTML — levaria semanas para reescrever, e nenhuma das lacunas listadas vem dele. |
| Migrar para react-three-fiber | Reescrita do motor inteiro para ganhar ergonomia de JSX num arquivo que já está encapsulado numa classe. |
| Sombras dinâmicas | Sombra projetada num planeta iluminado por uma fonte a 150 milhões de km não acrescenta informação e custa um passe de depth map. |
| Bloom global sem máscara | Ver P10. |
| Raycast a cada `pointermove` sobre milhares de pontos | É o problema que o P5 existe para resolver. |

---

## 5. Ordem que eu seguiria

1. **P2** — tone mapping. Uma linha, e revisar as rampas em seguida.
2. **P1** — leitura contínua sob o cursor. Baratíssimo e muda a sensação do app.
3. **P4** — semântica de ponteiro. Destrava P3, P5 e P7.
4. **P3** — marcador de seleção com linha-guia.
5. **P8** — callout ancorado.
6. **P7** — pincel de região, com o cuidado da distorção polar.
7. **P6 + P5** — instâncias e picking, **quando a camada de estações do MVP entrar**. Antes disso é otimização sem gargalo.
8. **P10** — pós-processamento, com máscara e travado por degrau.
9. **P9** — SDF, e só a meia-porta: DOM para topônimo, SDF para camada densa.

**A regra que atravessa todos:** nenhum padrão entra sem passar pela tabela de degraus do §1.4. O app hoje degrada sozinho quando o quadro passa de 20 ms — e essa é a razão de ele nunca ter ficado bonito e travado.
