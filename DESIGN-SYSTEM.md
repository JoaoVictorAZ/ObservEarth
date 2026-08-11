# Sistema de design — "Instrumento"

Linguagem visual do Observatório. Existe para que qualquer tela nova nasça
coerente sem precisar de julgamento estético a cada decisão.

**Princípio único:** a Terra é a imagem. A interface é instrumento, não decoração.
Se um elemento não transporta dado ou não conduz a uma ação, ele não existe.

Referências: cartas náuticas e topográficas, Ordnance Survey, earth.nullschool,
painéis de instrumentação científica. **Não** é vidro difuso, gradiente
decorativo, sombra colorida ou brilho neon.

---

## As quatro regras

| # | Regra | O que significa na prática |
|---|---|---|
| 1 | **Vácuo** | O fundo é o espaço (`#04060a`). Painéis são recortes delimitados por fio, não blocos flutuantes empilhados. |
| 2 | **Fio** | Hierarquia por linha e espaçamento, nunca por peso de sombra. Toda borda é 1px de branco a 6–22%. |
| 3 | **Sinal** | Um único acento (`--signal`, aurora `#5de0b0`). Qualquer outra cor é **dado**. Se está colorido, significa algo. |
| 4 | **Censo** | Todo número é monoespaçado e tabular. Dado se lê em coluna, alinhado e comparável. |

A regra 3 é a que mais se quebra sozinha. Antes de introduzir uma cor, a pergunta
é: *isto é dado?* Se não for, é cinza.

---

## Tokens

Todos vivem em `:root` (`src/index.css`). Nunca escreva hex direto num componente.

### Superfície
```
--void       #04060a    vácuo absoluto
--surface    branco 2.8%   preenchimento sutil (hover, campo)
--surface-hi branco 5.5%   preenchimento ativo
--scrim      #04060a 82%   fundo de painel sobre o globo
```

### Fios
```
--rule       branco 10%   borda padrão do sistema
--rule-soft  branco 6%    divisória interna
--rule-hi    branco 22%   borda em hover / ênfase
```

### Tinta — escada de contraste
```
--ink    #f4f7fa   valor, título          (contraste máximo)
--ink-2  #a8b4c2   corpo, rótulo de linha
--ink-3  #6b7787   micro-rótulo, metadado
--ink-4  #454f5c   marca d'água, desabilitado
```

### Sinal e estado
```
--signal      #5de0b0   acento único: seleção, ação primária, vivo
--signal-dim  12%       fundo de item selecionado
--signal-line 42%       borda de foco
--warn        #ffb454   atenção  (só para estado real)
--alert       #ff6b57   erro     (só para estado real)
```

### Tipografia
```
--sans  IBM Plex Sans   interface
--mono  IBM Plex Mono   todo número, coordenada, unidade, timestamp
```

IBM Plex foi escolhida por ser desenhada para contexto técnico-científico: tem
tabular numerals reais, distingue `1 l I` e `0 O`, e não carrega a assinatura de
tendência que fontes geométricas da moda carregam.

### Métrica
```
--r        2px    raio quase reto. Instrumento, não cápsula.
--panel-w  296px
--head-h   50px
--gut      14px
```

O raio de 2px é deliberado. Cantos muito arredondados leem como "app de
consumo"; canto reto lê como instrumento.

---

## Padrões

### Micro-rótulo (`.label`)
Caixa alta, `letter-spacing: 0.16em`, 9.5px, seguido de um fio que preenche a
linha. É a assinatura tipográfica do sistema e o principal separador de seção.

### Linha de leitura (`.prow`)
Rótulo à esquerda, valor à direita, **pontilhado** entre os dois. Padrão de
tabela de instrumento: mantém o olho na horizontal e torna a coluna de valores
imediatamente escaneável.

### Item de camada (`.layer`)
Linha de leitura, não cartão. Seleção marcada por **trilho vertical** de 2px à
esquerda que cresce por animação — sem preencher o fundo inteiro de cor.

### Marca de canto (`.probe::before`)
Dois fios de 14px no canto superior esquerdo, na cor do acento. Cita a mira de
instrumento e ancora o painel visualmente sem precisar de sombra.

### Caixa de seleção (`.chk input`)
Desenhada em CSS (`appearance: none` + `::after` rotacionado). Nunca um glifo
tipográfico — glifo muda de forma entre sistemas operacionais.

---

## Regras de uso

**Uma ação primária por vista.** `.primary-h-btn` é preenchido com o acento.
Duas delas competem e nenhuma vence.

**Emoji não é ícone.** Emoji renderiza diferente em cada sistema, não herda cor e
não escala com a tipografia. Onde precisar de símbolo, use SVG em traço herdando
`currentColor`.

**Movimento é feedback, não espetáculo.** Transições ficam em 130–180 ms com
`--ease`. O único movimento contínuo é o pulso lento do marcador de sessão. Tudo
respeita `prefers-reduced-motion`.

**Contraste.** Texto de valor usa `--ink` sobre `--void` (razão ≈ 17:1). Nada de
informação viva abaixo de `--ink-3`.

---

## O que este sistema recusa

- Vidro difuso empilhado em várias camadas (`backdrop-filter` pesado em tudo)
- Gradiente colorido como fundo de painel
- Sombra colorida ou `glow` como hierarquia
- Mais de um acento
- Cor sem significado de dado
- Cantos muito arredondados em superfície de dado
