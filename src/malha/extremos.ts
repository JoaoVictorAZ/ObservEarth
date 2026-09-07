// src/malha/extremos.ts
// -----------------------------------------------------------------------------
// PONTOS CRÍTICOS: onde o campo para de mudar, e o que ele é ali.
// -----------------------------------------------------------------------------
// A pergunta "onde está o mínimo" tem duas respostas muito diferentes, e este
// módulo dá as duas porque elas servem a coisas diferentes:
//
//   O EXTREMO GLOBAL da janela — um número e um lugar. É `momentos()`, em
//   `./estatistica`. Responde "qual foi a pressão mais baixa da região".
//
//   OS EXTREMOS LOCAIS — quantos houver. É este arquivo. Responde "quantos
//   centros de baixa existem sobre o Atlântico Sul, onde estão, e qual deles é
//   fundo de verdade e qual é ondulação".
//
// -----------------------------------------------------------------------------
// A LIÇÃO QUE ESTE ARQUIVO PAGOU
// -----------------------------------------------------------------------------
// A primeira versão classificava pelo teste da segunda derivada: montava a
// Hessiana e olhava o sinal do determinante e do traço. Contra o campo de
// pressão real do GFS, ela devolveu
//
//     184 máximos − 94 selas + 222 mínimos = 312
//
// e a característica de Euler de uma esfera é 2. Não 312. O erro não estava na
// Hessiana — estava em usar a Hessiana para uma pergunta que não é dela.
//
// A Hessiana é um objeto LOCAL e CONTÍNUO: ela descreve a curvatura de uma
// função suave num ponto. Uma grade não é suave, e a segunda derivada por
// diferenças finitas de um campo com ruído de quantização diz pouco sobre a
// vizinhança inteira. Pior: o teste da Hessiana não tem como enxergar uma sela
// de macaco, e enxerga selas onde há ruído — daí 94 quando deviam ser 404.
//
// A pergunta "que tipo de ponto crítico é este" é TOPOLÓGICA, e a resposta
// topológica é combinatória. Ao redor de um vértice, ande pelo elo de vizinhos
// e conte quantas vezes o campo cruza o valor do centro. Pelo teorema de
// Banchoff, o índice desse vértice é
//
//     índice = 1 − (mudanças de sinal) / 2
//
// e a soma dos índices sobre TODOS os vértices de uma superfície fechada é a
// característica de Euler dela, exatamente:
//
//     0 mudanças, todos abaixo  →  MÁXIMO          índice +1
//     0 mudanças, todos acima   →  MÍNIMO          índice +1
//     2 mudanças                →  ponto regular   índice  0
//     4 mudanças                →  SELA simples    índice −1
//     6 mudanças                →  sela de macaco  índice −2
//
// Isto não é aproximação: é contagem. Com o desempate simbólico descrito abaixo
// e o elo correto, a soma fecha em 2 sobre a esfera inteira. É essa a diferença
// entre um diagnóstico que acusa e um número que consola.
//
// A HESSIANA CONTINUA AQUI, e faz o que ela sabe fazer: dá a ANISOTROPIA (a
// diferença entre uma cúpula e uma crista), a ORIENTAÇÃO do eixo maior, e o
// refino sub-célula por um passo de Newton. Geometria, não topologia.
//
// -----------------------------------------------------------------------------
// O ELO É DE SEIS VIZINHOS, E É O MESMO DA MALHA QUE SE VÊ NA TELA
// -----------------------------------------------------------------------------
// A tentação é usar os oito vizinhos. Oito vizinhos correspondem a um quadrado
// com as DUAS diagonais, e isso não é triangulação de superfície nenhuma — os
// dois triângulos se sobrepõem e a conta de Euler perde o sentido.
//
// `src/malha/malha3d.ts` corta cada quadrilátero da grade pela diagonal que vai
// de (i,j) a (i+1,j+1). Nessa triangulação, o elo de um vértice é um ciclo de
// SEIS, e não de oito:
//
//     (i+1,j) → (i+1,j+1) → (i,j+1) → (i−1,j) → (i−1,j−1) → (i,j−1) →
//
// Os dois que ficam de fora — (i+1,j−1) e (i−1,j+1) — são vizinhos na grade e
// NÃO são vizinhos na superfície: nenhum triângulo os liga ao centro.
//
// Usar o mesmo elo que a malha desenhada tem uma consequência que vale dizer:
// os extremos que a lista aponta são os extremos DAQUELA superfície, a mesma
// que está na tela. Não são dois modelos de mundo com resultados parecidos.
//
// -----------------------------------------------------------------------------
// O AVISO QUE `server/vorticidade.js` JÁ PAGOU CARO
// -----------------------------------------------------------------------------
// Aquele módulo conta que procurar máximo local de VORTICIDADE não acha ciclone
// nenhum, porque o máximo de vorticidade de um ciclone é um ANEL e não um
// ponto. Vale repetir a fronteira: este arquivo serve a campos ESCALARES cujo
// extremo é pontual — pressão, temperatura, geopotencial. Um centro de baixa É
// um mínimo local de PRMSL, e por isso a busca funciona.
// -----------------------------------------------------------------------------

import {
  type CampoEscalar, type Janela, MUNDO,
  latDaLinha, lngDaColuna, linhaDaLat, colunaDaLng, indice, medido, amostrar, RAIO_TERRA,
} from "./campo.ts";
import { gradienteEm, hessianaEm, COS_MIN } from "./derivadas.ts";

export type Tipo = "maximo" | "minimo" | "sela";

/**
 * O ELO do interior, em ordem cíclica. Ver o cabeçalho: seis, não oito.
 * `dj` positivo é para o SUL, porque a linha 0 é o polo norte.
 */
const ELO: ReadonlyArray<readonly [number, number]> = [
  [+1, 0], [+1, +1], [0, +1], [-1, 0], [-1, -1], [0, -1],
];

// -----------------------------------------------------------------------------
// OS POLOS SÃO UM VÉRTICE CADA, E A GRADE GUARDA `nx` CÓPIAS DELES
// -----------------------------------------------------------------------------
// A linha 0 tem 1.440 células que ocupam exatamente o mesmo ponto do espaço: o
// polo norte. O GRIB repete o valor em todas. Se cada uma contasse como um
// vértice, a superfície teria 1.440 pontos empilhados num só lugar, os
// triângulos que os ligam teriam área zero, e a soma de Euler não teria sobre
// o que fechar.
//
// A superfície de verdade é a grade das linhas 1..ny−2 mais DOIS vértices, um
// por polo, cada um ligado por um leque a toda a primeira linha vizinha. Isso
// muda o elo de três famílias de vértices:
//
//   o POLO           elo = a linha vizinha inteira, nx vizinhos em ciclo
//   a linha 1        elo = 5 vizinhos, com o polo norte fechando o ciclo
//   a linha ny−2     elo = 5 vizinhos, com o polo sul fechando o ciclo
//   o resto          elo = os 6 do ELO
//
// Sem esse tratamento a soma dá 0 em vez de 2 — e a diferença é exatamente os
// dois polos que ficaram de fora. Um diagnóstico que erra por dois num campo
// perfeito ensina a ignorar diagnóstico.
// -----------------------------------------------------------------------------

/** o vértice canônico de cada polo: a coluna 0 da linha polar */
const POLO_N = 0;
const poloS = (nx: number, ny: number) => (ny - 1) * nx;

/**
 * O elo de um vértice da superfície, em ordem cíclica, como índices lineares.
 * Devolve `null` para as cópias redundantes das linhas polares.
 */
function eloDe(i: number, j: number, nx: number, ny: number): number[] | null {
  const ix = (a: number, b: number) => indice(a, b, nx, ny);

  // Grade rasa demais para ter interior: sem leque polar, sem conta de Euler.
  if (ny < 5) {
    if (j <= 0 || j >= ny - 1) return null;
    return ELO.map(([di, dj]) => ix(i + di, j + dj));
  }

  if (j === 0) {
    if (i !== 0) return null;                       // cópia do polo norte
    const elo: number[] = [];
    for (let m = 0; m < nx; m++) elo.push(ix(m, 1));
    return elo;
  }
  if (j === ny - 1) {
    if (i !== 0) return null;                       // cópia do polo sul
    const elo: number[] = [];
    for (let m = nx - 1; m >= 0; m--) elo.push(ix(m, ny - 2));
    return elo;
  }
  if (j === 1) {
    // (i+1,1) → (i+1,2) → (i,2) → (i−1,1) → POLO NORTE
    return [ix(i + 1, 1), ix(i + 1, 2), ix(i, 2), ix(i - 1, 1), POLO_N];
  }
  if (j === ny - 2) {
    // (i+1,ny−2) → POLO SUL → (i−1,ny−2) → (i−1,ny−3) → (i,ny−3)
    return [
      ix(i + 1, ny - 2), poloS(nx, ny), ix(i - 1, ny - 2),
      ix(i - 1, ny - 3), ix(i, ny - 3),
    ];
  }
  return ELO.map(([di, dj]) => ix(i + di, j + dj));
}

export interface PontoCritico {
  tipo: Tipo;
  /**
   * Índice de Morse do vértice: +1 para extremo, −1 para sela simples, −2 para
   * sela de macaco. É ele que soma χ — ver `eulerPoincare`.
   */
  indice: number;
  /** posição REFINADA, entre células — ver `refinar` */
  lat: number;
  lng: number;
  /** valor no ponto refinado; no centro da célula quando o refino foi recusado */
  valor: number;
  /** célula onde o ponto foi encontrado */
  i: number; j: number;
  /** deslocamento do refino, em metros */
  deslocamentoM: number;
  /** autovalores da Hessiana, em [unidade]/m². NaN onde ela não pôde ser montada */
  lambda1: number; lambda2: number;
  /**
   * |λ₁/λ₂| — quão ALONGADO é o extremo. Perto de 1 é uma cúpula redonda;
   * acima de ~4 é uma crista ou um cavado, que é outra coisa meteorológica.
   */
  anisotropia: number;
  /** orientação do eixo maior, em graus a partir do norte */
  direcaoGraus: number;
  /**
   * A Hessiana ficou quase singular — a curvatura não decide nada aqui. O TIPO
   * continua válido, porque ele veio da contagem e não da curvatura; o que fica
   * sem valor é a anisotropia. Declarado em vez de escondido.
   */
  hessianaDegenerada: boolean;
  /** ver `proeminenciaLocal` — o critério que separa centro de ondulação */
  proeminencia: number;
  /** raio do anel de proeminência, em km — a MEDIDA, não a contagem de células */
  raioKm: number;
}

/**
 * COMPARAÇÃO ESTRITA TOTAL — o desempate simbólico.
 *
 * A contagem de mudanças de sinal exige que nenhum vizinho EMPATE com o centro:
 * com empates, "acima" e "abaixo" deixam de particionar o elo e o índice deixa
 * de existir. E empate é comuníssimo — a pressão do GFS chega quantizada, e um
 * platô de duas células com o mesmo valor aparece em qualquer campo.
 *
 * A saída é a mesma da geometria computacional: perturbar simbolicamente. Onde
 * os valores empatam, desempata o ÍNDICE na grade. É equivalente a somar ε·k a
 * cada célula com ε infinitesimal — não muda nenhuma desigualdade estrita, e
 * torna todas as comparações decidíveis. O resultado é determinístico e a
 * conta de Euler volta a fechar.
 */
const acima = (f: ArrayLike<number>, ku: number, kv: number) =>
  f[ku] > f[kv] || (f[ku] === f[kv] && ku > kv);

/**
 * PROEMINÊNCIA LOCAL — e o que ela NÃO é.
 *
 * A proeminência topográfica clássica de um pico é a altura da queda até a sela
 * mais baixa que o separa de um pico mais alto. Ela é global: exige percorrer o
 * campo por curvas de nível, e custa muito mais que tudo o mais aqui.
 *
 * O que se calcula aqui é a variante LOCAL: quanto o campo cai (ou sobe) até um
 * anel de raio `raioKm` em volta do ponto. É mais barata e responde à pergunta
 * que interessa na tela — "este mínimo é um poço ou uma marola?" — mas NÃO é
 * intercambiável com a definição topográfica, e não deve ser rotulada como se
 * fosse.
 *
 * -----------------------------------------------------------------------------
 * O ANEL É EM QUILÔMETROS, E ISSO CORRIGE UM DEFEITO GRAVE
 * -----------------------------------------------------------------------------
 * A primeira versão media um anel de `r` CÉLULAS. Numa grade regular em grau
 * isso não é um anel: é uma elipse que se achata com a latitude. A 85° de
 * latitude, quatro células valem 444 km em latitude e 39 km em longitude —
 * onze vezes mais estreita numa direção que na outra.
 *
 * O efeito no campo de temperatura do GFS foi exatamente o que se esperaria:
 * a lista de extremos voltava com todos os pontos entre 85°S e 89°S, com
 * valores quase idênticos e proeminência de ~40 °C. Não eram quarenta
 * máximos: era UM — o degrau térmico entre a costa antártica e o planalto —
 * medido de novo a cada coluna da grade, porque ali as colunas estão a 9 km
 * uma da outra e o campo é praticamente constante ao longo do paralelo.
 *
 * `src/malha/derivadas.ts` abre dizendo que a grade é regular em GRAU e o
 * planeta não é regular em METRO. Esta função era a única do diretório que
 * ainda trabalhava em célula, e pagou o preço.
 *
 * A amostragem é por AZIMUTE — `nAzimutes` pontos igualmente espaçados sobre o
 * círculo de raio `raioKm`, pela fórmula do ponto de destino geodésico. Custo
 * fixo, independente da latitude, e o polo deixa de ser caso especial: um
 * círculo de 450 km em volta do polo é um círculo, não a grade inteira.
 */
export function proeminenciaLocal(
  c: CampoEscalar, lat: number, lng: number,
  tipo: "maximo" | "minimo", raioKm: number, nAzimutes = 16,
): number {
  const centro = amostrar(c, lat, lng);
  if (centro == null) return 0;

  const rad = Math.PI / 180;
  const delta = (raioKm * 1000) / RAIO_TERRA;      // distância angular
  const sinD = Math.sin(delta), cosD = Math.cos(delta);
  const phi1 = lat * rad, lam1 = lng * rad;
  const sinP1 = Math.sin(phi1), cosP1 = Math.cos(phi1);

  let extremo: number | null = null;
  for (let a = 0; a < nAzimutes; a++) {
    const theta = (2 * Math.PI * a) / nAzimutes;
    // Ponto de destino sobre a esfera, a `delta` radianos no azimute `theta`.
    const sinP2 = sinP1 * cosD + cosP1 * sinD * Math.cos(theta);
    const phi2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
    const lam2 = lam1 + Math.atan2(
      Math.sin(theta) * sinD * cosP1,
      cosD - sinP1 * sinP2,
    );
    const v = amostrar(c, phi2 / rad, lam2 / rad);
    if (v == null) continue;
    if (extremo == null) extremo = v;
    else if (tipo === "maximo") extremo = Math.min(extremo, v);
    else extremo = Math.max(extremo, v);
  }
  if (extremo == null) return 0;
  return tipo === "maximo" ? centro - extremo : extremo - centro;
}

/**
 * Distância de grande círculo entre dois pontos, em quilômetros.
 * Haversine — estável para distâncias pequenas, que é o caso de uso aqui.
 */
export function distanciaKm(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const rad = Math.PI / 180;
  const dPhi = (lat2 - lat1) * rad;
  const dLam = (lng2 - lng1) * rad;
  const a = Math.sin(dPhi / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLam / 2) ** 2;
  return (RAIO_TERRA / 1000) * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * REFINO SUB-CÉLULA por um passo de Newton.
 *
 * Perto de um extremo o campo é bem aproximado pela expansão de Taylor de
 * segunda ordem:
 *
 *     f(x₀ + δ) ≈ f(x₀) + ∇f·δ + ½ δᵀ H δ
 *
 * O ponto crítico dessa quadrática é onde a derivada zera, e isso é um sistema
 * linear 2×2:
 *
 *     H δ = −∇f
 *
 * resolvido em forma fechada pela regra de Cramer. Vale a pena porque a grade
 * do GFS tem 27,8 km de passo: sem refino, todo centro de baixa aparece preso
 * ao vértice mais próximo, e o erro de posição é sistemático, não aleatório.
 *
 * O RESULTADO É RECUSADO quando δ sai da célula. Newton só converge onde a
 * quadrática descreve o campo; num ponto degenerado H fica quase singular e δ
 * dispara. Devolver esse δ apontaria um centro a centenas de quilômetros de
 * onde o dado o coloca. Recusado, fica valendo o centro da célula — menos
 * preciso e honesto.
 */
function refinar(
  c: CampoEscalar, i: number, j: number,
): { dLat: number; dLng: number; dValor: number; deslocamentoM: number } | null {
  const g = gradienteEm(c, i, j);
  const H = hessianaEm(c, i, j);
  if (!g || !H) return null;
  if (!(Math.abs(H.determinante) > 0)) return null;

  // Cramer em [[fxx, fxy], [fxy, fyy]] · δ = [−dx, −dy]
  const dxM = (-g.dx * H.fyy + g.dy * H.fxy) / H.determinante;
  const dyM = (-g.dy * H.fxx + g.dx * H.fxy) / H.determinante;

  const lat = latDaLinha(j, c.ny);
  const cosPhi = Math.cos((lat * Math.PI) / 180);
  if (Math.abs(cosPhi) < COS_MIN) return null;

  const passoLatM = (Math.PI / (c.ny - 1)) * RAIO_TERRA;
  const passoLngM = ((2 * Math.PI) / c.nx) * RAIO_TERRA * cosPhi;
  const deslocamentoM = Math.hypot(dxM, dyM);

  // O LIMITE É POR EIXO, e não sobre o módulo contra o maior dos dois passos.
  //
  // A célula não é quadrada em metro: a 80° de latitude o passo em longitude
  // vale 1/6 do passo em latitude. Um módulo comparado ao MAIOR dos dois
  // deixaria passar um δ inteiramente em longitude com seis células de
  // comprimento — precisamente a fuga que este guarda existe para barrar, e ela
  // passaria despercebida porque o número em metro parece razoável.
  if (Math.abs(dxM) > passoLngM || Math.abs(dyM) > passoLatM) return null;

  return {
    dLat: (dyM / passoLatM) * (180 / (c.ny - 1)),
    dLng: (dxM / passoLngM) * (360 / c.nx),
    // Valor da quadrática no ponto crítico: f₀ + ½ ∇f·δ. O ½ vem de substituir
    // Hδ = −∇f na expansão — não é aproximação extra.
    dValor: 0.5 * (g.dx * dxM + g.dy * dyM),
    deslocamentoM,
  };
}

export interface Opcoes {
  /**
   * Raio do anel de proeminência, em QUILÔMETROS.
   *
   * Era em células, e o cabeçalho de `proeminenciaLocal` conta o estrago: numa
   * grade regular em grau, um raio em células é uma elipse que se achata com a
   * latitude, e a lista de extremos voltava inteira da Antártida.
   *
   * 450 km é a escala sinótica — o tamanho de um centro de pressão de
   * latitude média. Menor que isso e cada ondulação vira centro; muito maior e
   * dois sistemas vizinhos se apagam mutuamente.
   */
  raioKm?: number;
  /**
   * Incluir selas na lista. Elas são metade da estrutura do campo — o colo
   * entre duas altas é onde a deformação organiza as frentes — mas são MUITAS,
   * e numa lista de leitura costumam atrapalhar. Fora da lista, a soma de Euler
   * deixa de fechar, e `eulerPoincare` avisa.
   */
  incluirSelas?: boolean;
}

/**
 * TODOS os pontos críticos de um campo, sem filtro nenhum.
 *
 * Sem filtro é essencial: a soma dos índices só fecha em χ se NADA foi
 * descartado. A seleção do que mostrar é outra operação, e está em
 * `filtrarPorProeminencia` — detecção e escolha são passos distintos, e
 * misturá-los foi o que produziu o χ = 312 que este arquivo documenta.
 *
 * O custo é O(n) com seis comparações por célula: 22 ms numa grade de 1°.
 */
export function pontosCriticos(
  c: CampoEscalar, jan: Janela = MUNDO, opc: Opcoes = {},
): PontoCritico[] {
  const { nx, ny } = c;
  const f = c.valores;
  const raioKm = Math.max(20, opc.raioKm ?? 450);
  const incluirSelas = opc.incluirSelas ?? false;

  const achados: PontoCritico[] = [];

  const j0 = Math.max(0, Math.floor(linhaDaLat(Math.min(90, jan.latNorte), ny)));
  const j1 = Math.min(ny - 1, Math.ceil(linhaDaLat(Math.max(-90, jan.latSul), ny)));
  const c0 = colunaDaLng(jan.lngOeste, nx);
  let c1 = colunaDaLng(jan.lngLeste, nx);
  if (c1 <= c0) c1 += nx;

  const visitar = (i: number, j: number) => {
    const k = indice(i, j, nx, ny);
    if (!medido(c, k)) return;

    const elo = eloDe(i, j, nx, ny);
    if (!elo) return;                    // cópia redundante de linha polar

    // O elo tem que estar COMPLETO. Um vértice na borda de um buraco de dado
    // não tem índice definido — e chutar um deslocaria a soma de Euler sem
    // deixar rastro.
    for (const ku of elo) if (!medido(c, ku)) return;

    let mudancas = 0;
    const n = elo.length;
    let anterior = acima(f, elo[n - 1], k);
    for (let m = 0; m < n; m++) {
      const atual = acima(f, elo[m], k);
      if (atual !== anterior) mudancas++;
      anterior = atual;
    }
    if (mudancas === 2) return;                 // ponto regular: a maioria

    const indiceMorse = 1 - mudancas / 2;
    const tipo: Tipo = mudancas === 0
      ? (acima(f, elo[0], k) ? "minimo" : "maximo")
      : "sela";
    if (tipo === "sela" && !incluirSelas) return;

    const paraProeminencia: "maximo" | "minimo" = tipo === "minimo" ? "minimo" : "maximo";
    const latC = latDaLinha(j, ny), lngC = lngDaColuna(i, nx);
    const proeminencia = proeminenciaLocal(c, latC, lngC, paraProeminencia, raioKm);

    // A Hessiana é OPCIONAL aqui, e é por isso que ela deixou de mandar. Ela
    // não existe nas linhas polares nem em cima de um buraco — e o ponto
    // crítico existe do mesmo jeito, porque quem o define é a contagem.
    const H = hessianaEm(c, i, j);
    const escala = H ? Math.max(Math.abs(H.fxx * H.fyy), H.fxy * H.fxy, 1e-300) : 1;
    const degenerada = !H || Math.abs(H.determinante) < 1e-6 * escala;

    const ref = refinar(c, i, j);
    achados.push({
      tipo,
      indice: indiceMorse,
      lat: latDaLinha(j, ny) + (ref?.dLat ?? 0),
      lng: lngDaColuna(i, nx) + (ref?.dLng ?? 0),
      valor: f[k] + (ref?.dValor ?? 0),
      i, j,
      deslocamentoM: ref?.deslocamentoM ?? 0,
      lambda1: H?.lambda1 ?? NaN,
      lambda2: H?.lambda2 ?? NaN,
      anisotropia: H && Math.abs(H.lambda2) > 0 ? Math.abs(H.lambda1 / H.lambda2) : NaN,
      direcaoGraus: H?.direcaoGraus ?? NaN,
      hessianaDegenerada: degenerada,
      proeminencia,
      raioKm,
    });
  };

  for (let j = j0; j <= j1; j++) {
    // Nas linhas polares só a coluna 0 é vértice de verdade; `eloDe` recusa as
    // outras, mas percorrer 1.440 delas para recusar seria trabalho à toa.
    if (j === 0 || j === ny - 1) { visitar(0, j); continue; }
    for (let ii = Math.floor(c0); ii < Math.ceil(c1); ii++) {
      visitar(((ii % nx) + nx) % nx, j);
    }
  }
  return achados;
}

/**
 * A SELEÇÃO do que vale mostrar — separada da detecção, de propósito.
 *
 * Um campo de pressão a 1° tem cerca de duzentos mínimos locais, e isso não é
 * defeito: é o que uma grade discreta de um campo com ruído tem. Dez deles são
 * centros sinóticos e o resto é ondulação de meio hectopascal.
 *
 * Filtrar aqui, e não lá, tem uma consequência que importa: a lista filtrada
 * NÃO satisfaz mais a conta de Euler, e não deveria. Quem quiser o diagnóstico
 * topológico usa a lista bruta; quem quiser ler a tela usa esta.
 *
 * -----------------------------------------------------------------------------
 * SEPARAÇÃO MÍNIMA: um fenômeno, uma linha
 * -----------------------------------------------------------------------------
 * A proeminência sozinha não basta. Um mesmo fenômeno — o degrau térmico da
 * costa antártica, a parede de um ciclone, uma frente — cruza dezenas de
 * células, e cada uma delas pode satisfazer o teste de extremo local. A lista
 * volta com quinze linhas de "máximo, −17,3 °C" a poucos quilômetros umas das
 * outras, todas descrevendo a mesma coisa, e as ocupam todas as vagas.
 *
 * O remédio é o de qualquer detector de feição: supressão do não-máximo. Ordena
 * por proeminência e, ao aceitar um ponto, descarta os do MESMO TIPO que
 * estiverem a menos de `separacaoKm` dele. O mais proeminente representa o
 * grupo — que é a definição operacional de "onde está o centro".
 *
 * Do mesmo tipo, e não de qualquer tipo: um máximo e um mínimo separados por
 * 200 km são um gradiente forte, e os dois são informação. Dois máximos a 200
 * km um do outro são um máximo.
 */
export function filtrarPorProeminencia(
  pontos: PontoCritico[], minima = 0, teto = 200, separacaoKm = 400,
): PontoCritico[] {
  const ordenados = pontos
    .filter((p) => p.proeminencia >= minima && p.proeminencia > 0)
    .sort((a, b) => b.proeminencia - a.proeminencia);

  if (!(separacaoKm > 0)) return ordenados.slice(0, teto);

  const aceitos: PontoCritico[] = [];
  for (const p of ordenados) {
    if (aceitos.length >= teto) break;
    let perto = false;
    for (const q of aceitos) {
      if (q.tipo !== p.tipo) continue;
      if (distanciaKm(p.lat, p.lng, q.lat, q.lng) < separacaoKm) { perto = true; break; }
    }
    if (!perto) aceitos.push(p);
  }
  return aceitos;
}

export interface Diagnostico {
  maximos: number;
  minimos: number;
  selas: number;
  /** soma dos índices de Morse: é ISTO que tem de dar 2 numa esfera */
  caracteristica: number;
  /** quantos pontos críticos têm curvatura indecidível */
  degenerados: number;
  consistente: boolean;
  explicacao: string;
}

/**
 * DIAGNÓSTICO DE EULER–POINCARÉ.
 *
 * Para um campo sobre uma esfera, a teoria de Morse impõe
 *
 *     Σ índices = #máximos − #selas simples − 2·#selas de macaco + #mínimos = χ(S²) = 2
 *
 * e isso não é opinião: é topologia. Vale para QUALQUER campo escalar sobre a
 * esfera, sem depender de meteorologia nenhuma.
 *
 * O número não conserta a detecção. Ele DIZ se a detecção está completa, que é
 * o papel de um diagnóstico — e é a única verificação disponível quando não há
 * gabarito, que é sempre o caso com dado real.
 *
 * SÓ FECHA COM TUDO INCLUÍDO: esfera inteira, selas na conta, nenhum filtro de
 * proeminência, e as linhas polares presentes. Com qualquer uma dessas
 * condições quebrada o resultado é outro, e não é erro — é outra pergunta. A
 * `explicacao` diz qual das duas está sendo respondida.
 */
export function eulerPoincare(
  pontos: PontoCritico[], contexto: { global?: boolean; comSelas?: boolean; filtrado?: boolean } = {},
): Diagnostico {
  let maximos = 0, minimos = 0, selas = 0, degenerados = 0, soma = 0;
  for (const p of pontos) {
    if (p.tipo === "maximo") maximos++;
    else if (p.tipo === "minimo") minimos++;
    else selas++;
    if (p.hessianaDegenerada) degenerados++;
    soma += p.indice;
  }

  const completo = contexto.global !== false
    && contexto.comSelas !== false
    && contexto.filtrado !== true;
  const consistente = completo && soma === 2;

  return {
    maximos, minimos, selas, degenerados,
    caracteristica: soma,
    consistente,
    explicacao: !completo
      ? "soma parcial — χ(S²) = 2 só vale com a esfera inteira, selas incluídas e sem filtro"
      : consistente
        ? "consistente com χ(S²) = 2"
        : `soma ${soma}, e a esfera exige 2 — a detecção está incompleta ou o campo tem buracos`,
  };
}
