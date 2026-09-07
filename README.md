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


## Instalação em três minutos

```bash
npm install
npm run dev
```

O comando `dev` sobe duas coisas ao mesmo tempo, com saídas coloridas
separadas: o **servidor** na porta 3001 (azul) e o **frontend** Vite na 5173
(verde). Se preferir dois terminais:

```bash
npm run server   
npm run web     
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
| `npm test` | Roda a suíte inteira (~788 verificações) |
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
direto — o motor de partículas é o mesmo arquivo.

**As partículas são simuladas só na região visível.** Antes, o rastro era uma
textura do mundo inteiro: aproximar em 10° a ampliava 17 vezes e cada partícula
virava um quadrado parado na tela. Agora a simulação é recortada pela vista, a
textura de rastro tem sempre a resolução do que se está vendo, e o tamanho do
ponto ainda encolhe um pouco com o zoom. De brinde, as partículas ficam mais
densas ao aproximar em vez de rarearem — as mesmas N partículas passam a cobrir
uma área menor.

Mercator teria sido a escolha familiar, e foi descartada por duas razões: exige
reprojetar a textura de rastro e pedir as imagens noutro esquema, e infla a
Groenlândia ao tamanho da África. Num app em que se lê a extensão de um
fenômeno, isso é uma mentira visual.

**A resolução acompanha o zoom.** As imagens do GIBS chegam em tiles, e o nível
é escolhido pela resolução da tela. Antes era uma imagem só, do mundo inteiro,
com 4096 px de largura — 9,8 km por pixel, fixo, por mais que se aproximasse.

| Vista | Nível | Tiles | Resolução |
|---|---|---|---|
| 180° | 2 | 32 | 9,8 km/px |
| 90° | 3 | 32 | 4,9 km/px |
| 40° | 4 | 32 | 2,4 km/px |
| 10° | 6 | 32 | 0,61 km/px |
| 3° | 7 | 16 | 0,30 km/px |

Trinta e duas vezes mais fino no zoom fechado, com teto de 40 tiles por vista
para o orçamento continuar de pé.

**O globo agora usa a mesma pirâmide.** Ela ficou um tempo só no mapa plano, e
isso era estranho: o globo é o modo padrão, e servia 32 vezes menos detalhe que
o modo secundário. A matemática de `src/tiles.ts` não sabe se quem chama desenha
num plano ou numa esfera, então o globo só precisou de duas coisas próprias.
Um tile deixa de ser um retângulo e vira um **setor de casca esférica** —
`SphereGeometry` com `phiStart`/`thetaStart`, e a imagem equirretangular cola
nele sem reprojeção, porque os dois estão no mesmo espaço de coordenada. E a
janela visível deixa de ser um retângulo de tela e vira uma **calota**:

> Da altitude inicial de 1,7 raios, o que se enxerga do planeta é uma calota de
> **68,3°** — não um hemisfério. O limite é a tangente que sai da câmera,
> `acos(R/d)`, e supor 90° pediria quase o dobro da área em tiles, todos
> jogados fora atrás da curvatura.

A textura única de 4096 px continua carregada como **piso**: ela cobre o mundo
inteiro de uma vez e segura a imagem enquanto os tiles do nível novo chegam.

A pirâmide vale para satélite e **não** para campo do modelo, e a distinção é
de dado. O MODIS tem 250 m nativos e o VIIRS 375 m: uma textura global de 4096
px joga fora quase todo esse detalhe. Um campo do GFS tem 0,25°, ou seja 1.440
colunas — a textura de 4096 já o amostra quase três vezes acima da resolução
que ele tem. Pedir tiles ali seria ampliar pixel inventado e gastar cota
para isso.

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

### Fronteiras: costa, países e divisas

Desenhadas como **linhas**, numa pirâmide de tiles com resolução que acompanha
o zoom — a mesma grade da imagem de satélite, com geometria em vez de pixel.

**O que havia antes.** A coleção de polígonos inteira ia para o `polygonsData`
do three-globe, com o preenchimento e as laterais pintados de transparente:

```js
.polygonCapColor(()  => "rgba(0,0,0,0)")      // invisível
.polygonSideColor(() => "rgba(0,0,0,0)")      // invisível
.polygonStrokeColor(() => "rgba(255,255,255,0.30)")
```

O motor triangulava e extrudava 470 feições — 1.132 anéis, 44.652 vértices,
1.044 kB — para que se visse **apenas o contorno delas**. Cada triângulo gerado
era invisível por construção. E o nível de detalhe reenviava tudo a *cada*
movimento de câmera com zoom, remontando a geometria por quadro.

**E o detalhe era fixo.** A fonte de países era a de 110m — escala
1:110.000.000, feita para ver o planeta numa página — e sobre ela ainda se
aplicava Douglas-Peucker com tolerância cravada em 0,05°, que são 5,5 km.
Aproximar não melhorava nada: a mesma linha grosseira era esticada, e uma
península de 20 km simplesmente não existia no dado.

#### A pirâmide

| Nível | Fonte | Tolerância | Estados |
|---|---|---|---|
| 0–2 | Natural Earth 110m | 0,18° a 0,04° | não |
| 3–4 | 50m | 0,022° a 0,011° | sim |
| 5–7 | 10m | 0,0055° a 0,0014° (≈150 m) | sim |

A tolerância não é escolhida, é **derivada**: um tile do nível z cobre
360/2^(z+1) graus em 512 px, e meio pixel disso é o limite abaixo do qual dois
vértices caem no mesmo pixel. Guardar mais é pagar banda por nada.

O que trafega, medido contra o dado real:

| Vista | Antes | Agora |
|---|---|---|
| Planeta inteiro | 1.044 kB | **44 kB** |
| Continente | 1.044 kB | 9,9 kB |
| País | 1.044 kB | 10,8 kB |
| Região | 1.044 kB | **1,6 kB** — e a 10m, não a 110m |

#### Simplificar antes de recortar, e nunca o contrário

A ordem importa e não é intuitiva. Recortar primeiro e simplificar depois faz
cada tile decidir sozinho quais vértices manter — e dois tiles vizinhos tomam
decisões diferentes para a *mesma* linha. O resultado é uma fenda na costura,
que aparece como um risco branco no litoral e que ninguém associa a um
algoritmo de simplificação.

Simplificando o conjunto inteiro uma vez por nível e recortando depois, a
geometria é idêntica dos dois lados da emenda. O recorte também **não inventa
vértice**: descarta segmentos inteiros em vez de calcular a interseção com a
borda, porque vértice novo numa borda de tile é a outra origem clássica da
fenda.

#### O que isso responde sobre tiles vetoriais

É exatamente a técnica, aplicada ao caso: **geometria servida por tile, por
nível de zoom**, em vez de imagem. Não usa MVT nem depende de provedor externo
— o formato binário é o mesmo padrão do vento e dos campos (cabeçalho,
metadados alinhados, `Float32Array` sem cópia), e a fonte continua sendo a
Natural Earth que o projeto já usava.

O custo em desenho também caiu: todas as linhas de um tile cabem num único
`LineSegments`, então é **uma chamada de desenho por tile** contra as milhares
de malhas de antes. A hierarquia entre costa, limite internacional e divisa
estadual é feita com cor no vértice — `linewidth` é ignorado por praticamente
todo WebGL, e desenhar linha grossa exigiria gerar geometria de faixa.

### Relevo e batimetria

Camada opcional, no painel esquerdo, disponível no modo mapa. Não é uma imagem
de relevo sombreado: são tiles `terrarium` da Mapzen, em que **cada pixel
carrega a altitude real em metros** codificada em RGB —

```
metros = (R·256 + G + B/256) − 32768
```

O deslocamento de 32.768 é o que permite guardar **profundidade** junto com
altitude no mesmo raster: a fossa das Marianas fica em −11.000 m e continua
sendo um número positivo dentro do PNG. Por isso o oceano é pintado por
profundidade e a terra por altitude a partir da mesma fonte, e por isso o mapa
consegue responder "−4.128 m" quando se pergunta a profundidade de um ponto do
Atlântico. Uma imagem bonita de relevo não responde nada.

Duas consequências técnicas que valem registro:

- **Estes tiles só existem em Web Mercator**, e o mapa é equirretangular. A
  reprojeção é feita por pixel no shader, não na CPU — reprojetar antes e deixar
  a GPU interpolar depois borraria detalhe que custou requisição.
- **A textura usa filtro NEAREST, obrigatoriamente.** A altitude está em três
  canais, e o vermelho vale 256 m por unidade. Interpolar linearmente entre dois
  texels inventa uma rampa de 256 m numa borda onde o vermelho passa de 137 para
  138.

### Malha 3D — a camada de análise

Ligue *Malha 3D do campo* no painel esquerdo e o globo ganha relevo: o campo
escalar escolhido deixa de ser só uma pintura e vira uma superfície, com
altura proporcional ao valor. Ao lado, uma lista dos pontos onde esse relevo
tem cume, fundo ou colo.

**Por que altura, se a cor já diz o valor.** Porque as duas falham em coisas
diferentes. A cor é um canal ruim para ordem: o olho compara cores vizinhas
bem e cores distantes mal, e não diz se a diferença é grande sem voltar à
legenda — e cerca de 8% dos homens não separam vermelho de verde, que é o eixo
em que quase toda rampa meteorológica põe a informação principal. A altura é
boa para ordem e péssima para valor absoluto: ninguém lê "1.032 hPa" de uma
elevação, mas todo mundo vê num relance onde estão as cristas e os cavados,
quantos são, e qual é mais fundo.

A cor da malha é **exatamente** a mesma do PNG do mesmo campo — as paradas da
rampa viajam do servidor junto com o catálogo, e um teste compara as duas
implementações valor a valor. Se elas divergissem, o mesmo dado teria duas
cores conforme fosse desenhado como textura ou como relevo, e não haveria como
saber em qual acreditar.

**O que a malha não é:** terreno. A altura é uma variável meteorológica
esticada por um fator que você escolhe no painel, e o painel separa
tipograficamente o que foi medido, o que foi calculado e o que foi escolhido.
O relevo real, esse em metros, continua sendo outra camada.

**Buraco continua buraco.** Um vértice sem dado não vira zero nem nível médio:
os triângulos que o tocariam não são gerados, e a malha fica vazada ali.

#### Os valores viajam como valores

Para isto existir foi preciso uma rota nova. `/api/fields/:id` devolve um PNG —
o campo já pintado. De uma cor não se tira derivada: a rampa é sobrejetora e
não injetora, o alfa mistura o campo com o que está embaixo, e o PNG é
quantizado a 8 bits por canal. Ler o valor de volta do pixel seria estimativa
apresentada como medida.

`/api/campo/:id` devolve os números, no mesmo formato binário que o vento já
usava: cabeçalho, metadados em JSON alinhados a múltiplo de quatro, e os planos
em `Float32Array` que o navegador aponta para dentro do próprio buffer
recebido, sem cópia. Vários campos cabem no mesmo pacote — pedir
`temp2m,dew2m` garante que os dois vieram da **mesma rodada** e da **mesma
grade**, que é o que torna a comparação entre eles legítima.

Os dois caminhos saem da mesma leitura do GRIB2. Se fossem leituras separadas,
bastaria alguém corrigir a conversão de kelvin de um deles para a tela e a
análise passarem a discordar sem nenhum teste perceber.

#### Mínimos, máximos e selas

O painel lista os pontos críticos com o valor, o lugar e a forma. Três decisões
merecem registro.

**A posição é refinada abaixo da célula.** A grade do GFS tem 27,8 km de passo;
sem refino, todo centro de baixa aparece grudado no vértice mais próximo, e o
erro é sistemático, não aleatório. Perto de um extremo o campo é bem descrito
pela sua expansão de Taylor de segunda ordem, e o ponto crítico da quadrática
é a solução de `H δ = −∇f` — um sistema 2×2, resolvido por Cramer. Quando δ sai
da célula, o refino é recusado e vale o centro: Newton só converge onde a
quadrática descreve o campo.

**A classificação é topológica, não de curvatura.** A primeira versão usava o
teste da segunda derivada — sinal do determinante e do traço da Hessiana. Ela
devolveu, contra o campo de pressão real do GFS, 184 máximos − 94 selas + 222
mínimos = **312**. A característica de Euler de uma esfera é 2. O erro não
estava na Hessiana: estava em pedir a ela uma pergunta que não é dela. A
resposta certa é combinatória — andar pelo elo de vizinhos e contar quantas
vezes o campo cruza o valor do centro. Pelo teorema de Banchoff, o índice do
vértice é `1 − mudanças/2`, e a soma dos índices sobre a esfera fecha em 2
exatamente. Depois da reescrita, o mesmo campo devolve 663 máximos, 673 mínimos
e 1.325 selas, **e a soma dá 2**.

A Hessiana continua no arquivo, fazendo o que ela sabe: a **anisotropia** (a
diferença entre uma cúpula e um cavado alongado), a orientação do eixo maior, e
o refino. Geometria, não topologia.

**A conta de Euler fica na tela.** Ela não conserta nada — ela diz se a
detecção está completa, e é a única verificação disponível quando não há
gabarito, que é sempre o caso com dado real. Quando o campo tem buracos ela
deixa de fechar, e o painel diz que deixou.

**O filtro é separado da detecção.** Um campo de pressão a 1° tem centenas de
mínimos locais; uns dez são centros sinóticos e o resto é ondulação de meio
hectopascal. O controle de *proeminência mínima* é em desvios padrão do próprio
campo — "2 hPa" é razoável para pressão e sem sentido para umidade — com a
tradução para a unidade ao lado.

#### A conta que quase todo mundo erra

A média espacial é ponderada pela **área** de cada célula, e não pelo número
delas. A diferença não é sutil: uma célula de 0,25° tem 773 km² no equador e
27 km² a 88°, vinte e oito vezes menos. Sem a ponderação, a grade dá aos polos
— o lugar mais frio do planeta — um voto que a Terra não dá. Medido no campo
de pressão de hoje, a correção vale **1,9 hPa**; num campo de temperatura, são
vários graus.

E o peso não é `cos φ`: é a integral exata do elemento de área sobre a faixa de
latitude da célula, `sen φₙ − sen φₛ`, com as linhas polares valendo meia
célula. A soma de todos os pesos fecha em 2 para qualquer `ny`, e é esse
invariante que o teste confere.

O desvio padrão espacial divide por `n`, e não por `n−1`. É o contrário do que
`server/timeseries.js` faz, e os dois estão certos: a série de dez anos é uma
*amostra* do clima, mas a grade não é uma amostra da região — é a região
inteira, célula por célula.

#### O cálculo, na esfera

Gradiente, laplaciano e Hessiana são calculados com a métrica esférica, não
como se a grade fosse papel quadriculado. Um passo de 0,25° em longitude vale
27,8 km no equador e 1,0 km a 88°; dividir pelo passo angular faria um campo
perfeitamente suave parecer ter uma frente meteorológica em toda latitude alta.

O laplaciano é o de Laplace–Beltrami, com o termo `−tan φ · ∂f/∂φ` que vem da
convergência dos meridianos. Ele é a diferença entre o operador certo e "somar
as duas segundas derivadas", e não desaparece com refinamento — é modelo
errado, não discretização grossa. O teste confere contra harmônicos esféricos,
que são as autofunções do operador: `Δ Yₗᵐ = −l(l+1)/R² · Yₗᵐ`, para l = 1, 2 e
3. Um sinal trocado ou um `R` esquecido não sobrevive a uma autofunção.

Onde `cos φ → 0` a conta deixa de existir e a resposta é **"sem dado"**, nunca
zero — zero afirmaria campo plano no lugar exato onde a grade lat/lng deixa de
sustentar a derivada, e é justamente ali que fica o vórtice polar.

### Recorte 3D — o bloco da região

No rodapé da sonda, *Recorte 3D da região* arranca um paralelepípedo do planeta
em volta do ponto e o põe sobre a mesa, com câmera livre.

**Por que um bloco, e não mais uma camada no globo.** O globo é ótimo para ver
*onde* e ruim para ver *quanto* em vertical: a câmera orbita o centro da Terra,
e o relevo cabe em milésimos de raio. Levantá-lo até ficar visível transforma o
planeta numa bola de espinhos. O bloco troca a pergunta — em vez de "onde no
planeta", passa a ser "como é a coluna sobre **este** lugar". É o diagrama de
bloco da geologia, que existe há um século e meio exatamente por isso.

O que aparece, de baixo para cima:

- **As paredes do corte**, com estratos a cada intervalo redondo de altitude e
  uma linha distinta no nível do mar. Elas não são enfeite: são o único lugar
  do bloco onde a escala vertical pode ser *lida* em vez de estimada — contar
  faixas dá a altura sem eixo, sem rótulo e sem legenda. E a linha de zero
  precisa mesmo se distinguir, porque a batimetria entra no mesmo raster: um
  bloco de cidade costeira mostra o fundo do mar.
- **O terreno**, em metros de verdade, tingido com a rampa hipsométrica de
  qualquer atlas físico — azul de profundidade, verde de planície, ocre de
  planalto, branco de neve. O salto no zero é brusco de propósito: −1 m e +1 m
  são lados opostos da linha d'água.
- **A malha do campo**, flutuando acima, com a mesma cor e a mesma escala do
  globo.
- **A agulha do ponto**, que sobe do piso até a malha e amarra as duas
  superfícies à mesma coluna vertical.

#### As duas verticais, e por que elas não podem ser a mesma

O bloco carrega **dois** eixos verticais, e confundi-los seria mentir:

| | está em | a altura é |
|---|---|---|
| **Terreno** | metros | altitude, com exagero declarado |
| **Malha do campo** | hPa, °C, mm | **valor**, não altitude |

Uma superfície de pressão desenhada "a 3 km" não está a três quilômetros de
nada. Por isso a malha flutua numa faixa própria, separada por um vão visível,
e os dois controles ficam em blocos distintos do painel. Encostar uma na outra
faria parecer que a superfície de pressão é uma nuvem pousada no morro.

O **exagero vertical** fica sempre visível ao lado do terreno, e o painel diz a
razão real do recorte — num bloco de 60 km com 800 m de morro é 1:75, e sem
exagero o relevo ocuparia menos de um pixel. Todo diagrama de bloco desde o
século XIX declara esse número.

#### De onde vem a altitude

Dos mesmos tiles `terrarium` que o mapa plano já usa, com uma diferença que
importa: ali a altitude nunca sai da GPU, porque o shader reprojeta e pinta. Um
bloco precisa do número na CPU — cada vértice tem que saber a que altura fica.

Dois cuidados no caminho, os dois testados:

- **A reprojeção.** Os tiles só existem em Mercator Web e o bloco é construído
  em lat/lng. Um erro aqui desloca o relevo em relação à imagem, e o
  deslocamento *cresce* com a latitude — perfeito no equador, quilômetros fora
  na Escandinávia.
- **A ordem da decodificação.** O canal vermelho vale 256 m por unidade.
  Interpolar os *pixels* e decodificar depois inventaria uma rampa de 256 m em
  toda borda onde o vermelho troca de valor. Decodifica-se primeiro cada texel
  para metros, e só então se interpola — metro é contínuo, byte não é.

Conferido contra o mundo real, com o pipeline inteiro ligado:

| Lugar | Lido | Referência |
|---|---|---|
| Everest | 8.673 m | 8.849 m (o cume suaviza a 150 m de amostra) |
| Mar Morto | −415 m | ~−430 m |
| Vale da Morte | −81 m | −86 m |
| Fossa das Marianas | −10.584 m | ~−10.900 m |

Cobertura ausente continua ausente: a malha fica vazada ali, sem platô
inventado ao nível do mar.

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

E uma família à parte, **Análise**, que não mostra dado: mostra conta feita
sobre dado. Hoje ela tem a **malha 3D do campo**, com os mínimos, máximos e
selas — ver [Malha 3D](#malha-3d--a-camada-de-análise). Ela é um grupo próprio
porque a regra de leitura é outra: a altura da malha é uma escolha de
visualização, e não uma grandeza medida, ao contrário de tudo que está nas
outras famílias.

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
| Pirâmide de tiles própria | `src/tiles.ts` + `server/tiles.js`, sem biblioteca de mapa |
| `src/tiles.ts` + `src/calota.ts` | A decisão que gasta cota, fora do motor e testável sem GPU |
| `src/piramideGlobo.ts` | Os tiles como setores de casca esférica |
| `src/malha/` | Cálculo, estatística e topologia sobre a grade — sem dependência externa |
| `src/bloco/` | O recorte 3D: relevo em metros, geometria do bloco, cena com câmera livre |
| `src/fronteiras.ts` + `server/fronteiras.js` | Fronteiras como linhas, em pirâmide de tiles vetoriais |
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
| `server/campo.js` + `campoBin.js` | Os valores do campo em binário, para a análise |

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

## Onde o desempenho foi ganho

Três medidas, feitas antes de mexer em qualquer coisa.

**A grade de vento virou binária.** São 1440×721 pontos por componente, e ia em
JSON:

| | JSON | binário |
|---|---|---|
| tamanho | 41,6 MB | **9,3 MB** |
| serializar (servidor) | 454 ms | 10 ms |
| ler (navegador) | 287 ms | **0,3 ms** |

Os 287 ms eram o thread principal do navegador *parado* — sem responder ao mouse
e sem desenhar quadro — uma vez a cada troca de hora na linha do tempo. No
binário, `u` e `v` viram `Float32Array` apontando para dentro do próprio buffer
recebido: sem cópia, sem laço, sem `JSON.parse`. O `forecastPlayer` já convertia
para `Float32Array` logo depois de receber, então montar um milhão de objetos
`number` e desmontá-los era trabalho puro de descarte.

O JSON continua sendo servido para quem não pedir `?fmt=bin`: cliente antigo com
servidor novo deve degradar, não quebrar.

**O dossiê deixou de esperar em fila.** Previsão, amostra do campo de vento e
topônimo são três idas à rede independentes, encadeadas só pela ordem em que
foram escritas. Agora vão juntas, com `allSettled` em vez de `all` — o topônimo
é opcional, e um geocodificador lento não pode derrubar o dossiê inteiro.

**A GPU deixou de ser disputada.** Enquanto o modelo de linguagem baixa ou gera,
a simulação de partículas para e o desenho cai para ~8 quadros por segundo.

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
| Relevo e batimetria | **Mapzen Terrain Tiles** (SRTM, GEBCO e outros) via AWS Open Data | Elevação em metros, Web Mercator. Atribuição exigida |
| Terremotos | **USGS** | Ao vivo |
| Incêndios | **NASA FIRMS** | Exige chave gratuita |
| Qualidade do ar | **OpenAQ** | |
| Fronteiras | **Natural Earth** via jsDelivr | |
| Malha 3D e pontos críticos | **NOAA GFS 0.25°**, valores brutos via `/api/campo` | Cálculo no navegador, sem serviço externo |

O vento tem **disjuntor**: se o GFS falhar três vezes seguidas, o servidor
desliga aquela fonte por vinte minutos e usa a Open-Meteo, em vez de martelar um
host que está fora do ar.
