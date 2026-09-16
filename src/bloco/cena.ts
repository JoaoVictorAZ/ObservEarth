// src/bloco/cena.ts
// -----------------------------------------------------------------------------
// O BLOCO: um pedaço do planeta arrancado e posto sobre a mesa.
// -----------------------------------------------------------------------------
// POR QUE UM BLOCO, E NÃO MAIS UMA CAMADA NO GLOBO
//
// O globo é ótimo para ver ONDE, e ruim para ver QUANTO em vertical. Ele
// mostra o planeta de fora, a câmera orbita o centro da Terra, e a única coisa
// que se pode fazer com o relevo ali é levantá-lo alguns milésimos de raio —
// invisível — ou exagerá-lo até o planeta virar uma bola de espinhos.
//
// A vertical é a dimensão que a meteorologia usa mais e que o globo dá pior. O
// bloco resolve trocando a pergunta: em vez de "onde no planeta", passa a ser
// "como é a coluna de atmosfera sobre ESTE lugar".
//
// É o diagrama de bloco da geologia, que existe há um século e meio pela mesma
// razão: quando o eixo vertical importa, recorta-se um paralelepípedo do
// terreno, levanta-se ele, e as paredes do corte passam a mostrar o que a
// vista de cima escondia.
//
// -----------------------------------------------------------------------------
// AS DUAS VERTICAIS, E POR QUE ELAS NÃO PODEM SER A MESMA
// -----------------------------------------------------------------------------
// O bloco carrega DOIS eixos verticais, e confundi-los seria mentir:
//
//   O TERRENO está em METROS, e é altitude de verdade. O único ajuste é o
//   exagero, que é uma escolha de visualização e aparece declarado na tela —
//   como em qualquer diagrama de bloco desde o século XIX.
//
//   A MALHA DO CAMPO está em unidade do campo — hPa, °C, mm — e a altura dela
//   é o VALOR normalizado, não altitude. Uma superfície de pressão desenhada a
//   "3 km" não está a três quilômetros de nada.
//
// Por isso a malha flutua numa faixa própria, separada do terreno por um vão
// visível, e a interface nomeia as duas coisas de formas diferentes. Encostar
// uma na outra faria parecer que a superfície de pressão é uma nuvem pousada
// no morro.
//
// -----------------------------------------------------------------------------
// UMA MEDIDA SÓ, EM QUATRO LUGARES
// -----------------------------------------------------------------------------
// A primeira versão deste arquivo afirmava que "as paredes são a escala" e que
// contar estratos dava a altura sem eixo nem legenda. **Não dá.** Contar faixas
// em perspectiva, com o bloco girando, é estimar com passos a mais — e foi
// justamente essa premissa que produziu um recorte que ninguém conseguia ler.
//
// O que funciona não é uma leitura melhor: são leituras REDUNDANTES, todas na
// mesma medida. O intervalo de estrato aparece em quatro lugares ao mesmo
// tempo:
//
//   a parede      faixas horizontais no corte
//   o terreno     curvas de nível sobre a superfície, mestra a cada cinco
//   a cor         faixas hipsométricas alinhadas às curvas
//   a régua       traços numa aresta, longo na mestra
//
// Nenhuma delas sozinha é uma escala; juntas, dispensam contar. Basta ver onde
// o morro cruza o traço comprido.
//
// E o nível do mar é a exceção que confirma a regra: ele não vem de intervalo
// nenhum, tem cor própria em todas as quatro, e é a única altura do bloco que
// não é escolha nossa.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type CampoEscalar, medido } from "../malha/campo.ts";
import { corDaRampa, corDoValor, sRGBparaLinear, type Parada, type ModoRampa } from "../malha/rampa.ts";
import {
  type RelevoPronto,
  latDaLinhaDoBloco, lngDaColunaDoBloco, tamanhoKm,
} from "./relevo.ts";
import {
  malhaDoTerreno, saiaDoBloco, aguaDoBloco, faixaDoCampo, estratoPara,
  kmDeMetros, metricaDa,
  type MalhaBruta,
} from "./geometria.ts";
import { tomarRenderizador, devolverRenderizador } from "./renderizador.ts";

/**
 * RAMPA HIPSOMÉTRICA — a convenção cartográfica, não uma paleta inventada.
 *
 * Azul de profundidade abaixo do zero, verde de planície logo acima, ocre de
 * planalto, marrom de montanha, branco de neve permanente. É a mesma leitura
 * de qualquer atlas físico, e por isso não precisa de legenda para funcionar.
 *
 * O salto no zero é DELIBERADO e brusco: −1 m e +1 m são lados opostos da
 * linha d'água, e suavizar ali apagaria a costa, que é a feição mais
 * importante de um bloco costeiro.
 */
const HIPSO: Parada[] = [
  [-8000, [8, 20, 48]],
  [-3000, [16, 46, 92]],
  [-600, [30, 84, 140]],
  [-60, [70, 132, 180]],
  [-1, [140, 190, 214]],
  [0, [92, 138, 84]],
  [200, [126, 158, 88]],
  [700, [186, 176, 98]],
  [1600, [166, 130, 78]],
  [2800, [140, 106, 84]],
  [4200, [186, 178, 172]],
  [6000, [246, 248, 250]],
];

/** As duas metades da rampa, separadas no zero — ver `rampaDoRecorte`. */
const MAR = HIPSO.filter(([v]) => v < 0);
const TERRA = HIPSO.filter(([v]) => v >= 0);

/**
 * A RAMPA ESTICADA PARA O RECORTE, E POR QUE ISSO NÃO É TRAPAÇA.
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTAVA ERRADO
 * -----------------------------------------------------------------------------
 * `HIPSO` é uma rampa ABSOLUTA: de −8.000 a +6.000 m, como um atlas. Ela tem a
 * virtude de ser comparável entre lugares — o mesmo verde significa a mesma
 * altitude em qualquer bloco.
 *
 * E tem um defeito que aparece assim que o recorte é estreito. Medido em
 * 16/09/2026, bloco de 500 km em 13,6°S / 175,7°L: altitudes de −4.695 a 165 m,
 * quase tudo entre −4.000 e −4.700. Nessa faixa a rampa absoluta interpola
 * entre [8,20,48] e [16,46,92] — dois azuis quase idênticos e quase pretos.
 *
 * **Setenta por cento da paleta não era usada, e os 30% usados eram o trecho de
 * menor contraste que ela tem.** O fundo do mar aparecia como uma mancha azul
 * uniforme, e a pessoa concluía, corretamente para o que estava vendo, que "não
 * há diversificação no relevo".
 *
 * -----------------------------------------------------------------------------
 * O QUE MUDA, E O QUE NÃO PODE MUDAR
 * -----------------------------------------------------------------------------
 * A rampa passa a ser esticada sobre a faixa REAL do recorte. Mas o zero
 * continua no zero: a metade submarina é reescalada dentro de [mínimo, 0] e a
 * emersa dentro de [0, máximo], **cada uma por conta própria**.
 *
 * Isso preserva a única coisa que a rampa afirma e que não pode ser negociada:
 * **onde a água começa**. Esticar as duas metades juntas moveria a linha d'água
 * para o meio da faixa de valores, e um bloco sem nenhuma terra exposta
 * ganharia verde de planície no ponto mais raso — inventando uma costa.
 *
 * -----------------------------------------------------------------------------
 * O PREÇO, QUE É DECLARADO
 * -----------------------------------------------------------------------------
 * Cor deixa de ser comparável ENTRE blocos. O mesmo azul significa −4.600 m
 * num recorte oceânico e −80 m num recorte costeiro.
 *
 * Isso é aceitável aqui, e não seria no globo, porque o bloco é um instrumento
 * LOCAL: ele existe para responder "como é a coluna sobre ESTE lugar". Mas
 * precisa estar dito na tela, e está — o painel declara a faixa que a rampa
 * cobre, e as paredes continuam com estratos em metros absolutos, que é a
 * referência que não se move.
 */
export function rampaDoRecorte(minimoM: number, maximoM: number): Parada[] {
  const lo = Number.isFinite(minimoM) ? minimoM : -8000;
  const hi = Number.isFinite(maximoM) ? maximoM : 6000;
  if (!(hi > lo)) return HIPSO;

  /**
   * Espalha as CORES de `orig` uniformemente sobre `[b0, b1]`.
   *
   * UNIFORMEMENTE, e não em proporção às posições originais — e esta foi a
   * primeira tentativa, que não resolveu nada.
   *
   * As paradas de `MAR` estão concentradas perto do zero: −8000, −3000, −600,
   * −60, −1. É a distribuição certa para um atlas, onde a plataforma
   * continental merece mais cores que a planície abissal. Reescalar as posições
   * proporcionalmente **preserva essa concentração**: num bloco de −4.695 a 0,
   * a parada de −3000 cai em −1.761, e os dois azuis mais escuros continuam
   * cobrindo 63% da faixa. O fundo seguia sendo uma mancha preta.
   *
   * Espalhar por igual descarta a posição original e fica só com a SEQUÊNCIA de
   * cores. É o que garante que a paleta inteira apareça, que era o objetivo.
   */
  const espalhar = (orig: Parada[], b0: number, b1: number): Parada[] => {
    if (!(b1 > b0) || orig.length === 0) return [];
    if (orig.length === 1) return [[b0, orig[0][1]] as Parada];
    return orig.map(([, c], i) =>
      [b0 + (i / (orig.length - 1)) * (b1 - b0), c] as Parada);
  };

  const saida: Parada[] = [];

  if (lo < 0) {
    // O fundo do bloco ocupa toda a metade submarina da paleta.
    saida.push(...espalhar(MAR, lo, Math.min(0, hi)));
  }
  if (hi > 0) {
    saida.push(...espalhar(TERRA, Math.max(0, lo), hi));
  }
  // Um bloco INTEIRAMENTE submerso não ganha verde nenhum, e um inteiramente
  // emerso não ganha azul. É o que mantém a linha d'água honesta.
  return saida.length >= 2 ? saida : HIPSO;
}

/**
 * AS DUAS CONVENÇÕES DE COR QUE CONVIVIAM NESTE PROJETO, E A QUE ESTAVA ERRADA.
 *
 * `sRGBparaLinear` converte as paradas das rampas (escolhidas olhando uma tela,
 * logo em sRGB) para o espaço LINEAR em que se deve iluminar e interpolar. Isso
 * está certo — misturar cor em sRGB produz meio-tom sujo.
 *
 * O que faltava é a volta. O framebuffer é sRGB, e quem converte linear→sRGB na
 * saída é o chunk `<colorspace_fragment>`. Materiais embutidos do three o
 * recebem automaticamente; **ShaderMaterial não**. `src/globo/terra.ts` e
 * `src/globo/atmosfera.ts` incluem o chunk à mão. Os quatro shaders deste
 * arquivo não incluíam.
 *
 * Efeito: todo o terreno saía com o valor linear escrito como se fosse sRGB —
 * verde de planície `[92,138,84]` virava `[0.10,0.26,0.09]` e aparecia como
 * `[27,66,22]`. Quase preto.
 *
 * E as PAREDES escapavam, porque as cores delas são constantes escritas dentro
 * do shader que nunca passaram pela ida. Resultado visível: parede clara,
 * terreno na sombra — e o bloco inteiro lido como cinza espinhoso, com a rampa
 * hipsométrica invisível.
 *
 * A correção tem dois lados, e os dois são necessários:
 *   1. incluir o chunk nos shaders que produzem cor;
 *   2. levar as constantes da parede para linear ANTES, senão elas passam a ser
 *      clareadas uma vez a mais e o problema só troca de lado.
 */
const PARA_LINEAR = /* glsl */ `
  vec3 paraLinear(vec3 c) {
    return mix(c / 12.92,
               pow((c + 0.055) / 1.055, vec3(2.4)),
               step(vec3(0.04045), c));
  }
`;

const TERRENO_VERT = /* glsl */ `
  varying vec3 vN;
  varying float vAlt;
  attribute float alt;          // altitude em METROS, para a parede e os estratos
  void main() {
    vN = normalize(normalMatrix * normal);
    vAlt = alt;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Luz de estúdio, presa à cena e não ao Sol.
 *
 * O bloco é um instrumento sobre a mesa, não uma fotografia do planeta: a
 * sombra aqui serve para revelar FORMA do terreno, e uma luz na posição solar
 * real deixaria metade dos blocos do mundo ilegíveis por serem de madrugada.
 *
 * A direção vem do noroeste alto, que é a convenção do sombreamento de relevo
 * desde o mapa impresso — o olho lê vale como vale só quando a luz vem de cima
 * e da esquerda. Com a luz do outro lado o cérebro inverte, e a montanha vira
 * cratera.
 */
const TERRENO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying float vAlt;
  uniform sampler2D uRampa;    // a rampa hipsometrica como textura 1D
  uniform float uLo;           // altitude do inicio da rampa
  uniform float uHi;           // altitude do fim da rampa
  uniform float uPassoFaixa;   // metros por faixa de cor; 0 = rampa continua
  uniform float uOpacidade;
  uniform float uPasso;        // intervalo entre curvas de nivel, em metros
  uniform float uCurvas;       // 0 desliga
  uniform float uBaixo;        // altitude do piso do bloco, em metros
  uniform float uAlto;         // altitude do topo do terreno, em metros
${PARA_LINEAR}
  void main() {
    // A FACE DE BAIXO É ROCHA, E NÃO UM BURACO.
    //
    // O terreno e' uma casca fina, e a saia so' fecha as QUATRO BORDAS do
    // recorte. Por dentro o bloco e' oco. Com FrontSide as faces viradas para
    // baixo eram descartadas, entao bastava a camera descer um pouco para
    // olhar por baixo de uma crista e enxergar ATRAVES da casca -- direto para
    // o interior vazio, que e' escuro porque a parede nao tem iluminacao.
    //
    // O efeito era um recorte cheio de rasgos pretos entre os morros, e ele
    // aparecia justamente na vista rasante, que e' a mais util para ler relevo.
    //
    // Desenhar a face de tras como rocha fecha o solido: o que se ve por baixo
    // de um morro passa a ser o interior dele, com o mesmo gradiente da parede.
    // O bloco deixa de ser uma casca e vira um bloco.
    // ATENCAO AO SINAL: este ramo e' o INTERIOR do bloco, visto por baixo de um
    // morro. Se a malha for gerada com a orientacao trocada, ele passa a
    // pintar o TOPO -- e a rampa, as curvas e as faixas nunca executam. Foi o
    // que aconteceu: o bloco inteiro saiu marrom uniforme, sem erro nenhum.
    // test/bloco-normais.mjs mede a orientacao para isso nao voltar.
    if (!gl_FrontFacing) {
      float fx = max(1.0, uAlto - uBaixo);
      float tr = clamp((vAlt - uBaixo) / fx, 0.0, 1.0);
      vec3 rocha = mix(vec3(0.13, 0.14, 0.17), vec3(0.42, 0.38, 0.34), tr);
      // Mais escura que a parede externa: e' interior, esta' na sombra do
      // proprio morro, e a diferenca ajuda a ler o que e' dentro e o que e' fora.
      gl_FragColor = vec4(paraLinear(rocha * 0.72), uOpacidade);
      #include <colorspace_fragment>
      return;
    }

    // A COR SAI DA RAMPA AQUI, NO FRAGMENTO -- e nao mais interpolada entre
    // vertices.
    //
    // Com cor por vertice, dois vertices vizinhos em altitudes parecidas dao
    // cores parecidas, e a interpolacao entre elas apaga qualquer degrau. Num
    // relevo suave o resultado e' uma superficie de UMA cor -- exatamente o
    // marrom uniforme que aparecia num planalto.
    //
    // Com a rampa como textura e a busca no fragmento, cada pixel recebe a cor
    // da SUA altitude. E fica possivel QUANTIZAR: uNiveis > 0 arredonda para
    // faixas discretas, que e' a hipsometria de atlas -- a mesma que faz um
    // mapa de relevo suave ser legivel quando o sombreado sozinho nao seria.
    // A QUANTIZACAO E' EM METROS: cada faixa de cor comeca numa altitude
    // redonda, a mesma das curvas de nivel e dos estratos da parede. Quantizar
    // a fracao normalizada poria as bordas onde calhasse, e a cor deixaria de
    // concordar com as outras leituras.
    //
    // E o ZERO vira borda de graca: todos os passos de estrato (25, 100, 500,
    // 1.000) dividem zero, entao a ultima faixa submersa acaba exatamente na
    // linha d'agua.
    float alt = vAlt;
    if (uPassoFaixa > 0.5) alt = (floor(vAlt / uPassoFaixa) + 0.5) * uPassoFaixa;
    float t = clamp((alt - uLo) / max(1.0, uHi - uLo), 0.0, 1.0);
    vec3 base = texture2D(uRampa, vec2(t, 0.5)).rgb;

    vec3 luz = normalize(vec3(-0.55, 0.78, 0.30));
    float d = max(dot(normalize(vN), luz), 0.0);
    float amb = 0.42;
    // A textura ja vem LINEAR (montada com sRGBparaLinear no lado do JS), entao
    // iluminar aqui e' correto. A volta para sRGB e' do chunk no fim.
    vec3 cor = base * (amb + 0.72 * d);

    // CURVAS DE NIVEL, NO MESMO INTERVALO DOS ESTRATOS DA PAREDE.
    //
    // Nao sao enfeite: sao o que amarra a superficie a' escala. A parede diz
    // "cada faixa vale 500 m"; a curva poe essa mesma medida em cima do
    // terreno, onde a pessoa esta olhando. Duas leituras da mesma regua.
    //
    // E resolvem de brinde o que a rampa sozinha nao resolve: num fundo
    // oceanico quase plano, a cor varia pouco e a forma some. A curva aparece
    // justamente onde ha declive, porque ela e' densa onde o gradiente e' alto.
    //
    // fwidth mantem a espessura constante em qualquer zoom -- sem ele a linha
    // engorda ao aproximar e desaparece ao afastar. E acima de certa densidade
    // a curva vira ruido: o segundo smoothstep apaga a linha onde ela ficaria
    // mais fina que um pixel, em vez de produzir moire.
    if (uCurvas > 0.5) {
      float f = fract(vAlt / uPasso);
      float larg = fwidth(vAlt / uPasso);
      // A ESPESSURA TEM UM PISO. O larg sozinho produz uma linha de
      // sub-pixel quando a encosta e' suave, e sub-pixel nao e' visivel: e' um
      // clareamento de alguns por cento que o sombreado engole.
      float esp = max(larg * 1.2, 0.035);
      float linha = (1.0 - smoothstep(0.0, esp, min(f, 1.0 - f)))
                  * (1.0 - smoothstep(0.22, 0.48, larg));
      // Escurece em vez de clarear: o traco lido como sombra nao compete com a
      // rampa hipsometrica, que e' quem carrega o valor. Mas escurece DE
      // VERDADE -- 30% sumia sobre um terreno ja sombreado.
      cor = mix(cor, cor * 0.28, linha * 0.9);

      // CURVA MESTRA a cada cinco -- a convencao de qualquer carta topografica.
      //
      // Ela existe porque contar curvas finas numa encosta densa e' impossivel:
      // o olho perde a conta em quatro ou cinco. A mestra da' ancoras, e o
      // intervalo entre duas delas e' 5 x uPasso, que e' um numero redondo e
      // facil de somar de cabeca.
      float fm = fract(vAlt / (uPasso * 5.0));
      float largm = fwidth(vAlt / (uPasso * 5.0));
      float espm = max(largm * 1.6, 0.012);
      float mestra = (1.0 - smoothstep(0.0, espm, min(fm, 1.0 - fm)))
                   * (1.0 - smoothstep(0.22, 0.48, largm));
      cor = mix(cor, cor * 0.12, mestra * 0.95);
    }

    // A ABSORCAO DA AGUA NAO MORA MAIS AQUI.
    //
    // Houve um trecho que escurecia o terreno submerso pela profundidade. Era a
    // conta certa no lugar errado: quem tem espessura e' a COLUNA D'AGUA, e ela
    // agora existe como geometria propria (ver aguaDoBloco). Manter as duas
    // somaria as absorcoes e o fundo ficaria preto duas vezes.
    //
    // Com a agua desligada, o terreno mostra a cor hipsometrica limpa -- que e'
    // o que se quer para ler batimetria direto, sem nada por cima.

    // A LINHA D'AGUA, sobre a propria superficie.
    //
    // A parede ja marca o zero, mas so' na borda do corte. Num bloco com ilha,
    // a costa e' a feicao mais informativa que existe, e ela esta no MEIO da
    // superficie -- onde nenhuma parede alcanca.
    float dz = abs(vAlt);
    float costa = 1.0 - smoothstep(0.0, fwidth(vAlt) * 2.0 + 6.0, dz);
    cor = mix(cor, paraLinear(vec3(0.42, 0.78, 0.94)), costa * 0.8);

    gl_FragColor = vec4(cor, uOpacidade);
    #include <colorspace_fragment>
  }
`;

const PAREDE_VERT = /* glsl */ `
  varying float vAlt;
  attribute float alt;
  void main() {
    vAlt = alt;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A PAREDE DO CORTE, com estratos legíveis.
 *
 * Uma faixa a cada `uPasso` metros e uma linha forte no nível do mar. Contar
 * faixas dá a altura sem eixo nem legenda — que é a razão de a parede existir.
 */
const PAREDE_FRAG = /* glsl */ `
  precision highp float;
  varying float vAlt;
  uniform float uPasso;
  uniform float uOpacidade;
  uniform float uBaixo;   // altitude do piso do bloco, em metros
  uniform float uAlto;    // altitude do topo do terreno, em metros
${PARA_LINEAR}
  void main() {
    // ROCHA MAIS CLARA PERTO DO TOPO — mas relativa ao BLOCO, e não a uma
    // faixa fixa.
    //
    // A versao anterior era clamp((vAlt + 2000) / 8000): ela supunha que o
    // terreno vivesse acima de −2.000 m. Num recorte oceânico a −4.700 m o
    // termo satura em ZERO na parede inteira, e ela vira um bloco de uma cor
    // só — a mais escura do shader. Medido em 16/09/2026: parede preta ocupando
    // metade da tela, sem nenhuma informação de profundidade.
    //
    // uBaixo e uAlto vêm do recorte, então a parede sempre usa a variação
    // toda que tem — como a rampa hipsométrica passou a fazer.
    float faixa = max(1.0, uAlto - uBaixo);
    float t = clamp((vAlt - uBaixo) / faixa, 0.0, 1.0);
    vec3 base = mix(vec3(0.13, 0.14, 0.17), vec3(0.42, 0.38, 0.34), t);

    // Estratos. fwidth mantem a linha com a mesma espessura em qualquer
    // zoom; sem ele a faixa some ao afastar e engorda ao aproximar.
    float f = fract(vAlt / uPasso);
    float largura = fwidth(vAlt / uPasso) * 1.2;
    float linha = 1.0 - smoothstep(0.0, largura, min(f, 1.0 - f));
    base = mix(base, base * 1.9 + 0.05, linha * 0.55);

    // O NÍVEL DO MAR é outra coisa, e tem que se distinguir de um estrato
    // qualquer: a batimetria entra no mesmo raster, e sem esta linha não se
    // sabe onde a água começa.
    float dz = abs(vAlt);
    float mar = 1.0 - smoothstep(0.0, fwidth(vAlt) * 2.0 + 8.0, dz);
    base = mix(base, vec3(0.36, 0.72, 0.92), mar * 0.85);

    // As constantes acima foram escolhidas olhando a tela, entao sao sRGB. A
    // conversao para linear acontece AQUI, no fim, para que os mix de estrato
    // e de nivel do mar continuem sendo feitos nos valores que foram
    // escolhidos -- e para que o chunk abaixo tenha o que converter de volta.
    gl_FragColor = vec4(paraLinear(base), uOpacidade);
    #include <colorspace_fragment>
  }
`;

/**
 * A LÂMINA D'ÁGUA.
 *
 * Um plano no zero, translúcido, cobrindo o recorte inteiro. Ele não carrega
 * dado nenhum — a altitude já está no terreno — e existe por uma razão de
 * leitura: **o nível do mar é a única referência absoluta que um bloco tem.**
 *
 * Toda outra altura no recorte é relativa a alguma escolha nossa: o exagero, a
 * profundidade da parede, o vão da faixa de análise. O zero não é escolha
 * nossa. Pôr a lâmina ali dá ao olho um plano de comparação, e a linha em que
 * ela encontra o terreno é a costa — que passa a ser desenhada pela GEOMETRIA,
 * e não por um traço que alguém pinta por cima.
 *
 * O brilho de borda (fresnel) não é enfeite: visto de raso, um plano
 * perfeitamente transparente some, e o bloco volta a parecer não ter água.
 */
const AGUA_VERT = /* glsl */ `
  varying vec3 vP;
  varying float vProf;
  varying float vSup;
  attribute float prof;        // coluna d'agua acima deste vertice, em metros
  attribute float superficie;  // 1 = topo no zero, 0 = secao na parede
  void main() {
    vProf = prof;
    vSup = superficie;
    vP = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AGUA_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vP;
  varying float vProf;
  varying float vSup;
  uniform float uOpacidade;
  uniform float uEscalaProf;   // profundidade em que a agua fecha, em metros
${PARA_LINEAR}
  void main() {
    // BEER-LAMBERT, ou a razao pela qual agua funda e' outra cor.
    //
    // A opacidade nao e' uma constante: ela cresce com a COLUNA acima do ponto.
    // Meio metro sobre um banco de areia e quarenta metros sobre um canal sao
    // a mesma agua, e so' a espessura os distingue -- exatamente como na foto
    // aerea de qualquer litoral.
    //
    // Sem isto o corpo d'agua vira uma tinta chapada e a batimetria, que o
    // bloco acabou de desenhar com tanto cuidado, some por baixo dela.
    float t = 1.0 - exp(-vProf / max(1.0, uEscalaProf));

    vec3 raso = vec3(0.38, 0.76, 0.86);
    vec3 fundo = vec3(0.03, 0.13, 0.30);
    vec3 cor = mix(raso, fundo, t);

    float a = uOpacidade * mix(0.18, 0.94, t);

    // A SUPERFICIE fecha na vista rasante e abre na vista de cima.
    //
    // Um plano perfeitamente transparente SOME quando visto de raso, e o bloco
    // volta a parecer nao ter agua. De cima, ao contrario, precisa abrir para
    // deixar ler o fundo. E' o comportamento da agua de verdade, e resolve os
    // dois problemas com o mesmo termo.
    if (vSup > 0.5) {
      float f = 1.0 - abs(normalize(vP).y);
      a = mix(a, min(0.96, a + 0.42), pow(clamp(f, 0.0, 1.0), 2.4));
      cor = mix(cor, vec3(0.55, 0.86, 0.98), pow(f, 4.0) * 0.5);
    }

    gl_FragColor = vec4(paraLinear(cor), a);
    #include <colorspace_fragment>
  }
`;

const CAMPO_VERT = /* glsl */ `
  varying vec3 vCor;
  varying vec3 vN;
  varying float vT;           // valor normalizado 0..1, para as isolinhas
  attribute float t;
  void main() {
    vCor = color;
    vT = t;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAMPO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCor;
  varying vec3 vN;
  varying float vT;
  uniform float uOpacidade;
  uniform float uIsolinhas;    // quantas isolinhas; 0 desliga
  void main() {
    vec3 luz = normalize(vec3(-0.55, 0.78, 0.30));
    float d = max(dot(normalize(vN), luz), 0.0);
    // A malha do campo é translúcida e vista dos dois lados: o piso de luz é
    // mais alto que o do terreno para ela não sumir vista por baixo.
    vec3 cor = vCor * (0.58 + 0.5 * d);
    float a = uOpacidade;

    // ISOLINHAS DO VALOR -- o equivalente da curva de nivel, para o campo.
    //
    // Sao o que transforma a superficie de uma laje colorida num INSTRUMENTO:
    // a densidade delas e' o gradiente. Onde as linhas se apertam, a grandeza
    // muda depressa naquele trecho do recorte -- e e' essa leitura, e nao a
    // cor, que responde "o que esta' acontecendo aqui".
    //
    // Mesma tecnica da curva de nivel do terreno, e de proposito: quem aprendeu
    // a ler uma ja sabe ler a outra.
    if (uIsolinhas > 0.5) {
      float f = fract(vT * uIsolinhas);
      float larg = fwidth(vT * uIsolinhas);
      float linha = (1.0 - smoothstep(0.0, larg * 1.2, min(f, 1.0 - f)))
                  * (1.0 - smoothstep(0.20, 0.45, larg));
      cor = mix(cor, cor * 1.9 + 0.06, linha * 0.65);
      // A linha e' MENOS transparente que a superficie: ela continua legivel
      // quando a opacidade e' baixa, que e' quando se quer ver o terreno por
      // baixo sem perder a leitura do campo.
      a = mix(a, min(1.0, a + 0.35), linha);
    }

    gl_FragColor = vec4(cor, a);
    #include <colorspace_fragment>
  }
`;

export interface EscalaCampo {
  lo: number; hi: number; stops: Parada[]; modo: ModoRampa;
}

export interface EstadoBloco {
  /** altitude mínima e máxima do recorte, em metros */
  minimoM: number | null;
  maximoM: number | null;
  larguraKm: number;
  alturaKm: number;
  /** intervalo entre estratos da parede E entre curvas de nível, em metros */
  estratoM: number;
  /** a rampa cobre esta faixa — declarado porque ela se move com o recorte */
  rampaDe: number | null;
  rampaAte: number | null;
  rampaAdaptativa: boolean;
  /** a cor cobre p2–p98 em vez de mínimo–máximo */
  percentis: boolean;
  saturadoPct: number;
  curvas: boolean;
  /** cor em faixas discretas de altitude */
  faixas: boolean;
  /** quantas faixas, quando ligadas */
  niveis: number;
  /** metros por faixa de cor */
  passoFaixaM: number;
  /** o campo está normalizado pela faixa do recorte? */
  campoLocal: boolean;
  /** a faixa de valor que a superfície do campo cobre, na unidade do campo */
  campoDe: number | null;
  campoAte: number | null;
  /** há profundidade no recorte? (geografia, não preferência) */
  temAgua: boolean;
  /** piso de profundidade para contar como mar, em metros */
  limiarMarM: number;
}

const CORES = {
  fundo: 0x070a10,
  grade: 0x1b2430,
  agulha: 0x5de0b0,
  /** o zero, e tudo que o marca — a mesma cor da lâmina d'água */
  agua: 0x6cc8ec,
  regua: 0x8fa6b8,
};

export class BlocoCena {
  private cena = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controles: OrbitControls;
  private raf = 0;
  private descartada = false;

  private grupo = new THREE.Group();
  private terreno: THREE.Mesh | null = null;
  private paredes: THREE.Mesh | null = null;
  private campoMesh: THREE.Mesh | null = null;
  private agua: THREE.Mesh | null = null;
  private agulha: THREE.Group | null = null;
  private regua: THREE.Group | null = null;

  private matTerreno: THREE.ShaderMaterial;
  private matParede: THREE.ShaderMaterial;
  private matCampo: THREE.ShaderMaterial;
  private matAgua: THREE.ShaderMaterial;

  private relevo: RelevoPronto | null = null;
  private campo: CampoEscalar | null = null;
  private escala: EscalaCampo | null = null;

  private exagero = 12;
  private alturaCampoKm = 0;
  private mostrarCampo = true;
  private mostrarParedes = true;
  private estratoM = 500;
  private pisoY = 0;
  /** a rampa em vigor — adaptada ao recorte, ou a absoluta do atlas */
  private rampa: Parada[] = HIPSO;
  private adaptarRampa = true;
  private curvas = true;
  /** cor em faixas discretas de altitude, como num atlas */
  private faixas = true;
  /** a cor usa a faixa dos percentis (p2–p98) em vez de mínimo–máximo */
  private percentis = true;
  /** multiplicador da equidistância automática: ¼, ½, 1, 2 ou 4 */
  private multiploCurvas = 1;
  /** o passo de cor em vigor, em metros — pode ser maior que o estrato */
  private passoFaixaM = 0;
  private aguaLigada = true;
  private reguaLigada = true;
  /**
   * Piso de profundidade para uma célula contar como mar, em metros.
   *
   * Dois por padrão. Não é gosto: é o ruído do SRTM, cuja acurácia vertical
   * relativa é da ordem de metros. Com zero cru, toda restinga e toda baixada
   * costeira oscilam em torno do nível do mar e a cidade aparece alagada.
   */
  private limiarMarM = 2;
  /** normaliza o campo pela faixa DO RECORTE, e não pela mundial */
  private campoLocal = true;
  private faixaCampo: { lo: number; hi: number } | null = null;

  /**
   * A RAMPA COMO TEXTURA 1D.
   *
   * 256 texels em `LinearFilter`: a busca no fragmento sai contínua de graça, e
   * o degrau, quando se quer degrau, vem da quantização de `t` e não da
   * resolução da textura — assim a faixa fica exatamente onde a curva de nível
   * está, e não onde um texel calhou de cair.
   */
  private texRampa = (() => {
    // RGBA, e NÃO RGB. `THREE.RGBFormat` foi removido do three há várias
    // versões — passá-lo entrega `undefined` como formato, e a textura
    // simplesmente não funciona. O terreno saía de uma cor só, e a causa não
    // aparecia em lugar nenhum: sem erro, sem aviso, sem cor.
    const t = new THREE.DataTexture(
      new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();

  /**
   * Escreve a rampa na textura, cobrindo a faixa DO RECORTE.
   *
   * `lo` e `hi` são do bloco, e não das paradas. A diferença era um defeito:
   * com a rampa absoluta, a textura cobria −8.000 a 6.000 m e a quantização em
   * N faixas repartia esses 14 km. Um recorte do Rio, que vai de −3.000 a
   * 2.800, caía dentro de DUAS faixas de 2.800 m — e saía de uma cor só.
   *
   * Cobrindo a faixa do bloco, as faixas de cor caem sempre onde há terreno,
   * seja a rampa adaptativa ou absoluta. O que a rampa absoluta preserva é a
   * COR de cada altitude; o que ela não precisa preservar é o desperdício de
   * textura em altitudes que o recorte não tem.
   */
  private escreverRampa(paradas: Parada[], lo: number, hi: number) {
    const d = this.texRampa.image.data as Uint8Array;
    const faixa = hi > lo ? hi - lo : 1;
    for (let i = 0; i < 256; i++) {
      const v = lo + (i / 255) * faixa;
      const [r, g, b] = corDaRampa(paradas, v);
      // A textura guarda LINEAR: é o espaço em que o shader ilumina. Guardar
      // sRGB aqui repetiria o erro que escureceu o bloco inteiro ontem.
      d[i * 4] = Math.round(sRGBparaLinear(r) * 255);
      d[i * 4 + 1] = Math.round(sRGBparaLinear(g) * 255);
      d[i * 4 + 2] = Math.round(sRGBparaLinear(b) * 255);
      d[i * 4 + 3] = 255;
    }
    this.texRampa.needsUpdate = true;
    this.matTerreno.uniforms.uLo.value = lo;
    this.matTerreno.uniforms.uHi.value = hi;
  }

  constructor(private caixa: HTMLElement) {
    this.cena.background = new THREE.Color(CORES.fundo);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 20000);
    // O renderizador é EMPRESTADO, não criado. Ver src/bloco/renderizador.ts:
    // criar um por abertura estourava o teto de contextos WebGL do navegador,
    // e a mensagem que sobrava — "Cannot read properties of null (reading
    // 'precision')" — não menciona WebGL em lugar nenhum.
    this.renderer = tomarRenderizador(this);
    const canvas = this.renderer.domElement;
    canvas.className = "bloco-canvas";
    caixa.appendChild(canvas);

    this.controles = new OrbitControls(this.camera, canvas);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    // O bloco tem um "chão": deixar a câmera passar por baixo dele mostra a
    // face inferior, que não carrega informação nenhuma e desorienta.
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.minDistance = 2;
    this.controles.screenSpacePanning = false;

    this.matTerreno = new THREE.ShaderMaterial({
      vertexShader: TERRENO_VERT, fragmentShader: TERRENO_FRAG,
      uniforms: {
        uOpacidade: { value: 1 },
        uPasso: { value: this.estratoM },
        uCurvas: { value: 1 },
        uBaixo: { value: -8000 }, uAlto: { value: 2000 },
        uRampa: { value: this.texRampa },
        uLo: { value: -8000 }, uHi: { value: 6000 },
        uPassoFaixa: { value: 0 },
      },
      // DoubleSide é o que fecha o sólido — ver a nota em TERRENO_FRAG. Sem
      // isto a vista rasante atravessa a casca.
      side: THREE.DoubleSide,
    });
    this.matParede = new THREE.ShaderMaterial({
      vertexShader: PAREDE_VERT, fragmentShader: PAREDE_FRAG,
      uniforms: {
        uPasso: { value: this.estratoM }, uOpacidade: { value: 1 },
        uBaixo: { value: -8000 }, uAlto: { value: 2000 },
      },
      side: THREE.DoubleSide,
    });
    this.matCampo = new THREE.ShaderMaterial({
      vertexShader: CAMPO_VERT, fragmentShader: CAMPO_FRAG,
      uniforms: { uOpacidade: { value: 0.78 }, uIsolinhas: { value: 12 } },
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.matAgua = new THREE.ShaderMaterial({
      vertexShader: AGUA_VERT, fragmentShader: AGUA_FRAG,
      uniforms: { uOpacidade: { value: 0.92 }, uEscalaProf: { value: 30 } },
      transparent: true, side: THREE.DoubleSide,
      // `depthWrite: false` é o que deixa a batimetria aparecer POR BAIXO da
      // lâmina. Com escrita de profundidade, o plano do zero apagaria todo o
      // fundo do mar — e o bloco costeiro perderia justamente a metade que
      // ninguém mais mostra.
      depthWrite: false,
    });

    this.cena.add(this.grupo);
    this.laco();
  }

  // --------------------------------------------------------------- geometria

  private alturaKm(metros: number) { return kmDeMetros(metros, this.exagero); }

  definirRelevo(relevo: RelevoPronto) {
    if (this.descartada) return;
    this.relevo = relevo;
    // O passo de estrato acompanha a amplitude: 500 m num bloco alpino é
    // legível, e num bloco de planície seria uma faixa só.
    // O intervalo definitivo é calculado em `reconstruir`, sobre a faixa dos
    // percentis — ver a nota longa lá. Aqui fica só um valor de partida para o
    // caso de alguém ler `estado` antes da primeira reconstrução.
    this.estratoM = estratoPara((relevo.maximo ?? 0) - (relevo.minimo ?? 0));
    this.reconstruir();
    this.enquadrar();
  }

  definirCampo(campo: CampoEscalar | null, escala: EscalaCampo | null) {
    if (this.descartada) return;
    this.campo = campo;
    this.escala = escala;
    this.reconstruirCampo();
  }

  private reconstruir() {
    this.limparMalhas();
    const r = this.relevo;
    if (!r) return;

    const { nx, ny } = r.campo;
    // A GEOMETRIA MORA FORA DO MOTOR — ver src/bloco/geometria.ts. Aqui só se
    // pinta o que ela devolve e se entrega à GPU.
    const bruta = malhaDoTerreno(r.campo, r.caixa, this.exagero, r.minimo ?? 0);

    // A rampa é montada para ESTE recorte, e não a absoluta do atlas. Ver a
    // nota longa em `rampaDoRecorte`: com a absoluta, um bloco oceânico usa 30%
    // da paleta, e justamente o trecho de menor contraste que ela tem.
    // A FAIXA DE COR É A DOS PERCENTIS, e não a do mínimo ao máximo.
    //
    // Terceira vez que este mesmo defeito aparece neste projeto, em três
    // grandezas: a rampa absoluta desperdiçava paleta, a escala mundial do
    // campo achatava a superfície, e aqui os extremos do relevo roubam a faixa
    // do terreno que a pessoa está olhando.
    //
    // Num recorte de 500 km sobre o Rio, o mínimo é uma fossa a −3.114 e o
    // máximo é Itatiaia a 2.224, mas a Baixada, a baía e a serra litorânea
    // vivem entre 0 e 800. Com min–max, esses 800 m ocupam 15% da escala de
    // cor — e o relevo sai plano, que foi exatamente o que apareceu na tela.
    //
    // O que passa dos percentis satura na cor da ponta, que é a leitura certa
    // para um extremo: "mais fundo que o resto", "mais alto que o resto".
    const rLo = (this.percentis ? r.p2 : r.minimo) ?? r.minimo ?? -8000;
    const rHi = (this.percentis ? r.p98 : r.maximo) ?? r.maximo ?? 6000;

    // O INTERVALO DAS CURVAS SAI DA MESMA FAIXA QUE A COR, e não da amplitude
    // total. **Era este o motivo de as curvas não aparecerem.**
    //
    // `estratoPara` recebia máximo − mínimo. Num recorte de 500 km sobre o Rio
    // isso dá 5.338 m, que cai na regra dos 1.000 m de intervalo. Só que a
    // terra emersa ali vai de 0 a ~800: **uma única curva na área inteira**, e
    // nenhuma curva mestra, que seria a cada 5.000.
    //
    // O intervalo era calculado sobre a fossa e o pico e desenhado sobre a
    // encosta. É o mesmo defeito da cor, mais uma vez, noutra grandeza — e o
    // sintoma foi idêntico: parecia que o recurso não funcionava.
    //
    // `multiploCurvas` deixa a pessoa afinar: cartografia chama isso de
    // equidistância, e ela é uma escolha, não uma constante.
    this.estratoM = Math.max(1, estratoPara(rHi - rLo) * this.multiploCurvas);
    this.matParede.uniforms.uPasso.value = this.estratoM;
    this.matTerreno.uniforms.uPasso.value = this.estratoM;
    this.rampa = this.adaptarRampa ? rampaDoRecorte(rLo, rHi) : HIPSO;
    // A textura cobre a faixa DO BLOCO nos dois casos — ver `escreverRampa`.
    this.escreverRampa(this.rampa, rLo, rHi);

    // A QUANTIZAÇÃO ACONTECE EM METROS, e não na faixa normalizada.
    //
    // Quantizar `t` reparte a faixa da textura em N pedaços iguais, e as bordas
    // caem onde calhar. Quantizar a ALTITUDE pelo passo de estrato faz cada
    // borda de cor cair exatamente sobre uma curva de nível — e faz o ZERO ser
    // uma borda, porque todos os passos (25, 100, 500, 1.000) dividem zero.
    //
    // É isso que amarra a cor às outras três leituras em vez de deixá-la
    // parecida com elas.

    // Teto e PISO de faixas.
    //
    // Acima de ~24 elas ficam mais finas que o sombreado e a hipsometria vira
    // ruído listrado; o passo dobra até caber. Abaixo de ~4 o bloco fica com
    // duas ou três cores e a cor deixa de medir coisa nenhuma — foi o que
    // aconteceu num recorte do Rio com estrato de 1.000 m: a amplitude inteira
    // cabia em cinco faixas, e o sombreado apagava a diferença entre elas.
    // Nesse caso o passo CAI, e a cor passa a ser mais fina que a curva.
    let passo = this.estratoM;
    const amp = rHi - rLo;
    while (amp / passo > 24) passo *= 2;
    while (passo > 1 && amp / passo < 8) passo /= 2;
    this.matTerreno.uniforms.uPassoFaixa.value = this.faixas ? passo : 0;
    this.passoFaixaM = this.faixas ? passo : 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(bruta.posicao, 3));
    geo.setAttribute("alt", new THREE.BufferAttribute(bruta.altitude, 1));
    geo.setIndex(new THREE.BufferAttribute(bruta.indice, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.terreno = new THREE.Mesh(geo, this.matTerreno);
    this.terreno.frustumCulled = false;
    this.grupo.add(this.terreno);

    this.construirParedes(bruta, nx, ny);
    this.construirAgua(bruta, nx, ny);
    this.reconstruirCampo();
    this.construirRegua();
    this.construirAgulha();
  }

  /**
   * A SAIA DO BLOCO: cada vértice da borda desce até o piso.
   *
   * Sem ela o terreno é uma casca fina e o recorte parece um tapete flutuando,
   * não um pedaço de planeta. Com ela o bloco ganha volume — e, mais
   * importante, ganha a superfície onde a escala vertical pode ser lida.
   */
  private construirParedes(bruta: MalhaBruta, nx: number, ny: number) {
    const r = this.relevo;
    if (!r) return;
    const { largura } = tamanhoKm(r.caixa);
    const saia = saiaDoBloco(
      bruta, nx, ny, r.minimo ?? 0, this.exagero, largura, r.maximo ?? 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(saia.posicao, 3));
    geo.setAttribute("alt", new THREE.BufferAttribute(saia.altitude, 1));
    geo.computeBoundingSphere();

    // A parede aprende a faixa do bloco: o piso e o topo do terreno. Sem isto
    // o gradiente de rocha satura e a parede vira uma cor só.
    this.matParede.uniforms.uBaixo.value = saia.pisoM;
    this.matParede.uniforms.uAlto.value = r.maximo ?? 0;
    // O MESMO gradiente na face de baixo do terreno: o interior do morro tem
    // que ser contínuo com a parede que o corta, senão a junção fica visível.
    this.matTerreno.uniforms.uBaixo.value = saia.pisoM;
    this.matTerreno.uniforms.uAlto.value = r.maximo ?? 0;

    this.paredes = new THREE.Mesh(geo, this.matParede);
    this.paredes.frustumCulled = false;
    this.paredes.visible = this.mostrarParedes;
    this.grupo.add(this.paredes);
    this.pisoY = saia.pisoY;
  }

  /**
   * A LÂMINA D'ÁGUA no zero — só quando existe água no recorte.
   *
   * A condição é `minimo < 0`, e ela importa: um bloco inteiramente acima do
   * nível do mar não ganha plano nenhum. Desenhar uma lâmina num planalto a
   * 800 m afirmaria que há mar ali, e a única coisa que o bloco não pode fazer
   * é inventar geografia.
   *
   * O plano vai até as bordas do recorte, e não até onde a água "chega": onde o
   * terreno é mais alto que zero, ele simplesmente atravessa a lâmina e emerge.
   * A costa aparece sozinha, como interseção — que é o que ela é.
   */
  private construirAgua(bruta: MalhaBruta, nx: number, ny: number) {
    if (this.agua) {
      this.grupo.remove(this.agua);
      this.agua.geometry.dispose();
      this.agua = null;
    }
    const r = this.relevo;
    if (!r || (r.minimo ?? 0) >= 0) return;

    const ag = aguaDoBloco(
      bruta, nx, ny, this.exagero, this.limiarMarM, r.campo.valido);
    if (ag.triangulos === 0) return;

    // A ESCALA DE ABSORÇÃO SAI DO RECORTE.
    //
    // Fixá-la faria uma enseada de 8 m parecer límpida do começo ao fim e uma
    // fossa de 6.000 m parecer tinta preta uniforme — nos dois casos a
    // batimetria desaparece. Um terço da profundidade máxima põe a transição
    // onde há dado para mostrar.
    this.matAgua.uniforms.uEscalaProf.value = Math.max(2, -(r.minimo ?? 0) / 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(ag.posicao, 3));
    geo.setAttribute("prof", new THREE.BufferAttribute(ag.profundidade, 1));
    geo.setAttribute("superficie", new THREE.BufferAttribute(ag.superficie, 1));
    geo.computeBoundingSphere();

    const malha = new THREE.Mesh(geo, this.matAgua);
    malha.frustumCulled = false;
    // Depois do terreno e antes do campo: a água tinge o que está submerso e
    // não pode tingir a superfície de análise, que flutua acima de tudo.
    malha.renderOrder = 1;
    malha.visible = this.aguaLigada;
    this.agua = malha;
    this.grupo.add(malha);
  }

  /**
   * A MALHA DO CAMPO, flutuando acima do terreno.
   *
   * A altura aqui é VALOR, não altitude — ver o cabeçalho deste arquivo. Ela
   * ocupa uma faixa própria, acima do pico mais alto do recorte, para que o vão
   * entre as duas superfícies deixe claro que são coisas diferentes.
   */
  private reconstruirCampo() {
    if (this.campoMesh) {
      this.grupo.remove(this.campoMesh);
      this.campoMesh.geometry.dispose();
      this.campoMesh = null;
    }
    const r = this.relevo, c = this.campo, e = this.escala;
    if (!r || !c || !e || c.nx < 2 || c.ny < 2) return;

    const m = metricaDa(r.caixa);
    const { largura } = tamanhoKm(r.caixa);
    const { base, espessura } = faixaDoCampo(
      r.maximo ?? 0, this.exagero, largura, this.alturaCampoKm, r.minimo ?? 0);

    const { nx, ny } = c;
    const n = nx * ny;
    const pos = new Float32Array(n * 3);
    const cor = new Float32Array(n * 3);
    const norm = new Float32Array(n);

    // A ESCALA DO CAMPO É A DO RECORTE, E NÃO A DO MUNDO.
    //
    // Este é o motivo de a superfície sair PLANA, e é o mesmo defeito da rampa
    // hipsométrica, noutra grandeza. A escala global de pressão cobre ~100 hPa;
    // num recorte de 60 km a pressão varia meio hectopascal. Normalizada pela
    // global, a superfície ocupa 0,5% da espessura da faixa — uma laje.
    //
    // Medido em 16/09/2026: MSLP sobre um bloco de 60 km, superfície
    // visualmente indistinguível de um plano.
    //
    // Com a faixa local, a mesma meia unidade ocupa a espessura inteira e a
    // estrutura aparece. O preço é o mesmo da rampa: a ALTURA deixa de ser
    // comparável entre blocos, e o painel tem que dizer isso — está dito.
    let lo = e.lo, hi = e.hi;
    if (this.campoLocal) {
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < n; k++) {
        if (!medido(c, k)) continue;
        const v = c.valores[k];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      // Faixa degenerada — campo constante no recorte — volta para a global.
      // Esticar um valor único produziria uma superfície de ruído numérico.
      if (Number.isFinite(mn) && mx - mn > 1e-9) { lo = mn; hi = mx; }
    }
    this.faixaCampo = { lo, hi };

    const faixa = hi - lo;
    const inv = Math.abs(faixa) > 0 ? 1 / faixa : 0;

    for (let j = 0; j < ny; j++) {
      const lat = latDaLinhaDoBloco(j, ny, r.caixa);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const lng = lngDaColunaDoBloco(i, nx, r.caixa);
        const tem = medido(c, k);
        const v = tem ? c.valores[k] : lo;
        const t = Math.max(0, Math.min(1, (v - lo) * inv));
        pos[k * 3] = (lng - m.lngC) * m.kmPorLng;
        pos[k * 3 + 1] = base + t * espessura;
        pos[k * 3 + 2] = (m.latC - lat) * m.kmPorLat;
        norm[k] = t;
        const [cr, cg, cb] = tem ? corDoValor(e.stops, v, e.modo) : [90, 96, 104];
        cor[k * 3] = sRGBparaLinear(cr);
        cor[k * 3 + 1] = sRGBparaLinear(cg);
        cor[k * 3 + 2] = sRGBparaLinear(cb);
      }
    }

    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = j * nx + i + 1;
        const cc = (j + 1) * nx + i + 1, d = (j + 1) * nx + i;
        if (!medido(c, a) || !medido(c, b) || !medido(c, cc) || !medido(c, d)) continue;
        idx.push(a, b, cc, a, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cor, 3));
    geo.setAttribute("t", new THREE.BufferAttribute(norm, 1));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.campoMesh = new THREE.Mesh(geo, this.matCampo);
    this.campoMesh.frustumCulled = false;
    this.campoMesh.renderOrder = 2;
    this.campoMesh.visible = this.mostrarCampo;
    this.grupo.add(this.campoMesh);
  }

  /**
   * A AGULHA do ponto escolhido.
   *
   * Um bloco sem âncora é bonito e não responde "onde eu cliquei". A agulha
   * sobe do piso, atravessa o terreno e chega à malha do campo — é ela que
   * amarra as duas superfícies à MESMA coluna vertical, que é a leitura que o
   * bloco existe para permitir.
   */
  private construirAgulha() {
    if (this.agulha) { this.grupo.remove(this.agulha); this.agulha = null; }
    const r = this.relevo;
    if (!r) return;

    const { largura } = tamanhoKm(r.caixa);
    const faixa = faixaDoCampo(
      r.maximo ?? 0, this.exagero, largura, this.alturaCampoKm, r.minimo ?? 0);
    const topo = faixa.base + faixa.espessura;
    const piso = this.pisoY;
    const raio = Math.max(0.12, largura * 0.006);

    const g = new THREE.Group();
    const material = (op: number) => new THREE.LineBasicMaterial({
      color: CORES.agulha, transparent: true, opacity: op,
    });

    // -------------------------------------------------------------------------
    // A AGULHA NÃO É UM TRAÇO: É A COSTURA ENTRE AS CAMADAS.
    // -------------------------------------------------------------------------
    // Ela era uma linha contínua com uma bola no terreno, e dizia só "cliquei
    // aqui". Mas a pergunta que o bloco existe para responder tem três alturas
    // na MESMA coluna, e elas significam coisas diferentes:
    //
    //   o terreno   altitude, em metros de verdade
    //   a água      onde a coluna d'água começa, se começa
    //   o campo     VALOR, e não altitude — a superfície flutua de propósito
    //
    // Marcar as três, e desenhar de forma DIFERENTE o trecho entre o terreno e
    // o campo, é o que impede a leitura errada mais fácil de cometer aqui: a de
    // que a distância até a superfície de análise é uma distância física.
    // -------------------------------------------------------------------------
    const alturaTerreno = this.alturaDoCentro();
    const y0 = this.alturaKm(0);
    const submerso = (r.minimo ?? 0) < 0 && alturaTerreno < y0;

    // Trecho SÓLIDO, do piso ao terreno: aqui a linha atravessa rocha, e a
    // altura ao longo dela é altitude de verdade.
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, piso, 0), new THREE.Vector3(0, alturaTerreno, 0),
    ]), material(0.65)));

    // Trecho PONTILHADO, do terreno ao campo: aqui a altura já não é altitude.
    // O tracejado é a marca de que a régua mudou de significado no meio do
    // caminho — é a mesma convenção de um gráfico que troca de eixo.
    const tracos = 26;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < tracos; i++) {
      const a = alturaTerreno + ((topo * 1.04 - alturaTerreno) * i) / tracos;
      const b = alturaTerreno + ((topo * 1.04 - alturaTerreno) * (i + 0.55)) / tracos;
      pts.push(new THREE.Vector3(0, a, 0), new THREE.Vector3(0, b, 0));
    }
    g.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts), material(0.42)));

    /** Um anel horizontal marcando um cruzamento da coluna. */
    const anel = (y: number, rr: number, cor: number, op: number) => {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        p.push(new THREE.Vector3(Math.cos(t) * rr, y, Math.sin(t) * rr));
      }
      const m = new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: op });
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), m));
    };

    // No TERRENO: a bola cheia, porque é o único dos três que é um lugar.
    const bola = new THREE.Mesh(
      new THREE.SphereGeometry(raio, 14, 12),
      new THREE.MeshBasicMaterial({ color: CORES.agulha }),
    );
    bola.position.set(0, alturaTerreno, 0);
    g.add(bola);
    anel(alturaTerreno, raio * 3.2, CORES.agulha, 0.5);

    // No NÍVEL DO MAR, quando a coluna está submersa: é a leitura "há tantos
    // metros de água sobre este ponto", e ela só existe se houver água.
    if (submerso) anel(y0, raio * 4.6, CORES.agua, 0.75);

    // No CAMPO: anel vazado, e não bola. A diferença de forma é deliberada —
    // ali não há lugar nenhum, há um valor desenhado numa altura escolhida.
    anel(topo * 1.04, raio * 2.4, CORES.agulha, 0.6);

    this.agulha = g;
    this.grupo.add(g);
  }

  /**
   * A RÉGUA VERTICAL, numa aresta do bloco.
   *
   * O cabeçalho deste arquivo afirmava que as paredes eram a escala, e que
   * contar estratos dava a altura. Não dá: contar faixas em perspectiva, com o
   * bloco girando, é estimar com passos a mais.
   *
   * A régua não substitui os estratos — ela os ANCORA. Os traços caem nas
   * mesmas altitudes das faixas da parede e das curvas do terreno, e o traço
   * longo marca a curva mestra. Com três leituras na mesma medida, contar deixa
   * de ser necessário: basta olhar onde o morro cruza o traço comprido.
   *
   * Sem rótulo em 3D, de propósito. Texto em perspectiva é ilegível, e o
   * intervalo já está escrito no painel, em número.
   */
  private construirRegua() {
    if (this.regua) { this.grupo.remove(this.regua); this.regua = null; }
    const r = this.relevo;
    if (!r || this.estratoM <= 0) return;

    const { largura, altura } = tamanhoKm(r.caixa);
    const x = largura / 2, z = altura / 2;      // a aresta sudeste, de frente
    const curto = Math.max(0.25, largura * 0.012);
    const longo = curto * 2.6;

    const lo = Math.ceil((r.minimo ?? 0) / this.estratoM) * this.estratoM;
    const hi = r.maximo ?? 0;
    // Teto de traços: numa amplitude grande com estrato fino a régua vira uma
    // mancha, e mancha não é escala.
    if ((hi - lo) / this.estratoM > 400) return;

    const pts: THREE.Vector3[] = [];
    const ptsM: THREE.Vector3[] = [];
    for (let m = lo; m <= hi; m += this.estratoM) {
      const y = this.alturaKm(m);
      const mestre = Math.abs(m / (this.estratoM * 5) - Math.round(m / (this.estratoM * 5))) < 1e-6;
      const c = mestre ? longo : curto;
      (mestre ? ptsM : pts).push(
        new THREE.Vector3(x, y, z), new THREE.Vector3(x + c, y, z + c * 0.35));
    }

    const g = new THREE.Group();
    if (pts.length) {
      g.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: CORES.regua, transparent: true, opacity: 0.30 })));
    }
    if (ptsM.length) {
      g.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(ptsM),
        new THREE.LineBasicMaterial({ color: CORES.regua, transparent: true, opacity: 0.62 })));
    }
    // O eixo da régua, do piso ao topo do terreno.
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, this.pisoY, z),
      new THREE.Vector3(x, this.alturaKm(hi), z),
    ]), new THREE.LineBasicMaterial({ color: CORES.regua, transparent: true, opacity: 0.35 })));

    // O ZERO ganha cor própria, como em toda parte do bloco: é a única altura
    // que não é escolha nossa.
    if ((r.minimo ?? 0) < 0 && hi > 0) {
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, this.alturaKm(0), z),
        new THREE.Vector3(x + longo * 1.5, this.alturaKm(0), z + longo * 0.5),
      ]), new THREE.LineBasicMaterial({ color: CORES.agua, transparent: true, opacity: 0.8 })));
    }

    g.visible = this.reguaLigada;
    this.regua = g;
    this.grupo.add(g);
  }

  private alturaDoCentro(): number {
    const r = this.relevo;
    if (!r) return 0;
    const { nx, ny } = r.campo;
    const k = Math.floor(ny / 2) * nx + Math.floor(nx / 2);
    return this.alturaKm(medido(r.campo, k) ? r.campo.valores[k] : (r.minimo ?? 0));
  }

  // ------------------------------------------------------------------ câmera

  /** Põe a câmera numa vista de três quartos que mostra topo e parede. */
  enquadrar() {
    const r = this.relevo;
    if (!r) return;
    const { largura, altura } = tamanhoKm(r.caixa);
    const d = Math.max(largura, altura);

    // O ALVO FICA NO MEIO DO QUE ESTÁ DESENHADO, e não a 40% do pico.
    //
    // `maximo * 0.4` ignora o mínimo, e isso quebra em qualquer recorte que
    // desça muito. Num bloco oceânico de −4.695 a 165 m o alvo caía perto de
    // ZERO, enquanto o terreno inteiro vivia 112 km abaixo: a câmera orbitava
    // um ponto muito acima da cena e o bloco aparecia espremido no rodapé.
    const topo = this.alturaKm(r.maximo ?? 0);
    const base = this.alturaKm(r.minimo ?? 0);
    this.controles.target.set(0, (topo + base) / 2, 0);

    // Do sudeste e de cima: mostra a parede sul e a leste ao mesmo tempo, que
    // é o enquadramento clássico do diagrama de bloco.
    const alcance = Math.max(d, Math.abs(topo - base));
    this.camera.position.set(alcance * 0.78, (topo + base) / 2 + alcance * 0.62, alcance * 0.95);

    // PRECISÃO DE PROFUNDIDADE. `near` fixo em 0,05 com `far` em 20.000 dá uma
    // razão de 400.000 — o buffer de profundidade perde resolução e superfícies
    // próximas começam a brigar por pixel, que aparece como cintilação nas
    // encostas. Atrelar os dois ao tamanho da cena mantém a razão em ~20.000.
    this.camera.near = Math.max(0.01, alcance * 0.002);
    this.camera.far = alcance * 40;
    this.camera.updateProjectionMatrix();

    this.controles.maxDistance = alcance * 6;
    this.controles.update();
  }

  redimensionar() {
    if (this.descartada) return;
    // A medida vem da CAIXA, e não do canvas. O canvas é compartilhado e o
    // `setSize` do três escreve o `style` dele — medir o próprio canvas faria
    // o tamanho realimentar a si mesmo e nunca acompanhar a janela.
    const l = Math.max(1, this.caixa.clientWidth);
    const a = Math.max(1, this.caixa.clientHeight);
    this.renderer.setSize(l, a, false);
    this.camera.aspect = l / a;
    this.camera.updateProjectionMatrix();
  }

  private laco() {
    const passo = () => {
      if (this.descartada) return;
      this.controles.update();
      this.renderer.render(this.cena, this.camera);
      this.raf = requestAnimationFrame(passo);
    };
    this.raf = requestAnimationFrame(passo);
  }

  // ---------------------------------------------------------------- controles

  definirExagero(x: number) {
    this.exagero = Math.max(1, Math.min(60, x));
    this.reconstruir();
  }
  definirAlturaCampo(km: number) {
    this.alturaCampoKm = Math.max(0, km);
    this.reconstruirCampo();
    this.construirAgulha();
  }

  /** A régua vertical, ancorada aos mesmos estratos da parede. */
  definirRegua(on: boolean) {
    this.reguaLigada = on;
    if (this.regua) this.regua.visible = on;
  }
  definirMostrarCampo(on: boolean) {
    this.mostrarCampo = on;
    if (this.campoMesh) this.campoMesh.visible = on;
  }
  definirMostrarParedes(on: boolean) {
    this.mostrarParedes = on;
    if (this.paredes) this.paredes.visible = on;
  }
  definirOpacidadeCampo(o: number) {
    this.matCampo.uniforms.uOpacidade.value = Math.max(0.1, Math.min(1, o));
  }

  /** Curvas de nível sobre o terreno, no intervalo dos estratos da parede. */
  definirCurvas(on: boolean) {
    this.curvas = on;
    this.matTerreno.uniforms.uCurvas.value = on ? 1 : 0;
  }

  /**
   * Afina a equidistância em torno do valor automático.
   *
   * Cartografia chama de equidistância, e ela é uma ESCOLHA: 1.000 m para um
   * país, 5 m para um município. O automático acerta a ordem de grandeza; quem
   * está lendo uma encosta específica quer mais fino, e quem está olhando a
   * forma geral quer mais grosso.
   */
  definirMultiploCurvas(m: number) {
    this.multiploCurvas = Math.max(0.125, Math.min(8, m));
    this.reconstruir();
  }

  /**
   * Rampa esticada para a faixa do recorte, ou a absoluta do atlas.
   *
   * Vale a pena poder desligar: a absoluta é a única em que a mesma cor
   * significa a mesma altitude em blocos diferentes. Quem estiver comparando
   * dois lugares precisa dela; quem estiver lendo um lugar quer a adaptada.
   */
  definirRampaAdaptativa(on: boolean) {
    this.adaptarRampa = on;
    this.reconstruir();
  }

  /** Cor em faixas discretas de altitude, alinhadas às curvas de nível. */
  definirFaixas(on: boolean) {
    this.faixas = on;
    this.reconstruir();
  }

  /**
   * A cor cobre a faixa dos percentis, ou a do mínimo ao máximo.
   *
   * Desligado, os extremos voltam a ter cor exata — útil quando o extremo é
   * justamente o que se quer medir. Ligado, é o terreno do meio que rende.
   */
  definirPercentis(on: boolean) {
    this.percentis = on;
    this.reconstruir();
  }

  /** A lâmina d'água no zero. Só aparece se houver profundidade no recorte. */
  definirAgua(on: boolean) {
    if (this.agua) this.agua.visible = on;
    this.aguaLigada = on;
  }

  /**
   * O piso de profundidade para uma célula contar como mar.
   *
   * Zero é o valor "cru" e produz alagamento falso em qualquer costa baixa —
   * o SRTM não distingue −1 m de +1 m. Subir o limiar recolhe a água para onde
   * ela é inequívoca; baixá-lo revela lâmina rasa às custas de ruído.
   */
  definirLimiarMar(m: number) {
    this.limiarMarM = Math.max(0, Math.min(30, m));
    this.reconstruir();
  }

  /**
   * Normaliza o campo pela faixa DO RECORTE.
   *
   * Desligado, a superfície volta a usar a escala mundial — o que a torna
   * comparável entre blocos e, na maioria dos recortes, plana.
   */
  definirCampoLocal(on: boolean) {
    this.campoLocal = on;
    this.reconstruirCampo();
  }

  get estado(): EstadoBloco {
    const r = this.relevo;
    const t = r ? tamanhoKm(r.caixa) : { largura: 0, altura: 0 };
    const p = this.rampa;
    return {
      minimoM: r?.minimo ?? null,
      maximoM: r?.maximo ?? null,
      larguraKm: t.largura,
      alturaKm: t.altura,
      estratoM: this.estratoM,
      // A faixa que a rampa cobre SAI para a tela. Com a rampa adaptativa a cor
      // deixa de ser comparável entre blocos, e isso não pode ficar implícito.
      rampaDe: p.length ? p[0][0] : null,
      rampaAte: p.length ? p[p.length - 1][0] : null,
      percentis: this.percentis,
      /** quanto do recorte satura fora da faixa de cor, em pontos percentuais */
      saturadoPct: this.percentis ? 4 : 0,
      rampaAdaptativa: this.adaptarRampa,
      curvas: this.curvas,
      faixas: this.faixas,
      /** metros por faixa de cor — pode ser múltiplo do estrato, se couber mal */
      passoFaixaM: this.passoFaixaM,
      niveis: this.passoFaixaM > 0 && r
        ? Math.round(((r.maximo ?? 0) - (r.minimo ?? 0)) / this.passoFaixaM)
        : 0,
      campoLocal: this.campoLocal,
      campoDe: this.faixaCampo?.lo ?? null,
      campoAte: this.faixaCampo?.hi ?? null,
      // `temAgua` é sobre a GEOGRAFIA, não sobre o interruptor: diz se há
      // profundidade no recorte. O painel usa isto para não oferecer um
      // controle de água num bloco que não tem mar nenhum.
      temAgua: (r?.minimo ?? 0) < 0,
      limiarMarM: this.limiarMarM,
    };
  }

  // ------------------------------------------------------------------ limpeza

  private limparMalhas() {
    for (const o of [this.terreno, this.paredes, this.campoMesh, this.agua]) {
      if (!o) continue;
      this.grupo.remove(o);
      o.geometry.dispose();
    }
    this.terreno = null; this.paredes = null; this.campoMesh = null;
    this.agua = null;
    if (this.regua) {
      for (const f of this.regua.children) {
        const m = f as THREE.Line;
        m.geometry?.dispose?.();
        (m.material as THREE.Material)?.dispose?.();
      }
      this.grupo.remove(this.regua);
      this.regua = null;
    }
    if (this.agulha) {
      for (const f of this.agulha.children) {
        const m = f as THREE.Mesh | THREE.Line;
        m.geometry?.dispose?.();
        (m.material as THREE.Material)?.dispose?.();
      }
      this.grupo.remove(this.agulha);
      this.agulha = null;
    }
  }

  dispose() {
    this.descartada = true;
    cancelAnimationFrame(this.raf);
    this.limparMalhas();
    this.matTerreno.dispose();
    this.matParede.dispose();
    this.matCampo.dispose();
    this.matAgua.dispose();
    this.texRampa.dispose();
    this.controles.dispose();
    // O RENDERIZADOR NÃO É DESCARTADO, e é isso que conserta o defeito.
    //
    // Geometria, material e cena são baratos de criar e destruir. Um contexto
    // WebGL não é: é recurso do sistema, contado pelo navegador, e devolvê-lo
    // não é síncrono. Abrir e fechar o painel meia dúzia de vezes criava
    // contextos mais rápido do que o navegador os recolhia.
    devolverRenderizador(this);
  }

  // A NOTA QUE EXPLICA POR QUE `forceContextLoss` SAIU DAQUI.
  //
  // Havia aqui um `forceContextLoss()` + `dispose()` no renderer, com a
  // observação — correta — de que `dispose()` sozinho não devolve o contexto ao
  // navegador: ele só é recolhido quando o coletor de lixo chega no canvas.
  //
  // O que a nota não percebia é que `forceContextLoss` também não devolve na
  // hora. Ele marca o contexto como perdido; a devolução continua dependendo
  // do coletor. Com o painel abrindo e fechando — e o modo estrito do React
  // montando duas vezes por montagem — os contextos ainda se acumulavam, e o
  // sintoma mudou de "o painel não abre" para
  //
  //     Cannot read properties of null (reading 'precision')
  //
  // que é o three lendo capacidades de um contexto que o navegador recusou
  // criar. O conserto anterior atacou a velocidade do vazamento; este ataca a
  // existência dele.
}
