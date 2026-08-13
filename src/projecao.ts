// src/projecao.ts
// -----------------------------------------------------------------------------
// PROJEÇÃO EQUIRRETANGULAR — o mapa plano.
// -----------------------------------------------------------------------------
// POR QUE EQUIRRETANGULAR E NÃO MERCATOR
//
// Não é gosto: é o espaço em que os dados já estão. O GFS entrega uma grade de
// 1440×721 células igualmente espaçadas em grau; o NASA GIBS serve as imagens
// em `epsg4326`, que é exatamente isto; e a simulação de partículas do
// `windGPU.ts` avança as posições em UV normalizado, tirando a latitude de
// `(0.5 - p.y) * 180`.
//
// Ou seja: a textura de rastro do vento JÁ É um mapa equirretangular. No globo
// ela precisa ser reprojetada na esfera pelo shader; aqui ela é colada num
// plano sem transformação nenhuma. Mercator obrigaria a reprojetar tudo isso e
// ainda inflaria a Groenlândia ao tamanho da África — num app que se lê por
// área de fenômeno, isso é uma mentira visual.
//
// O custo é conhecido e aceito: os polos aparecem esticados na horizontal.
// -----------------------------------------------------------------------------

/** Meio-mundo em unidades de mundo. O plano vai de -180 a 180 em x. */
export const MUNDO_W = 360;
/** e de -90 a 90 em y. Um grau é uma unidade nos dois eixos. */
export const MUNDO_H = 180;

export interface Ponto { x: number; y: number; }
export interface Geo { lat: number; lng: number; }

/**
 * Geográfico → mundo plano.
 *
 * y é invertido porque em coordenadas de tela e de textura o norte fica em
 * cima, mas no espaço do three.js o y cresce para cima também — então aqui a
 * latitude vai direto. Quem inverte é a UV da textura, não isto.
 */
export function paraMundo(lat: number, lng: number): Ponto {
  return { x: lng, y: lat };
}

/** Mundo plano → geográfico, já com a longitude trazida para a volta certa. */
export function paraGeo(x: number, y: number): Geo {
  return { lat: travarLat(y), lng: enrolarLng(x) };
}

/**
 * Traz qualquer longitude para [-180, 180).
 *
 * Precisa existir porque o mapa PODE ser arrastado indefinidamente para o lado:
 * dar a volta no mundo é o gesto natural num mapa plano, e sem isso o Japão
 * ficaria partido na borda direita para sempre — que é justamente onde os
 * tufões aparecem.
 *
 * O módulo de JavaScript devolve negativo para entrada negativa (`-190 % 360`
 * é `-190`, não `170`), por isso o `+ 540` antes em vez de um `% 360` direto.
 */
export function enrolarLng(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  return ((lng + 540) % 360 + 360) % 360 - 180;
}

/** Latitude não dá a volta: passar do polo não leva ao outro lado. */
export function travarLat(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.min(90, Math.max(-90, lat));
}

/**
 * A menor diferença de longitude entre dois pontos, com sinal.
 *
 * De 179° para -179° são DOIS graus para leste, não 358 para oeste. Sem isto,
 * uma linha de costa que cruza o antimeridiano é desenhada atravessando o mapa
 * inteiro — o risco horizontal clássico dos mapas mal costurados.
 */
export function deltaLng(de: number, para: number): number {
  return enrolarLng(para - de);
}

/** Um segmento que salta mais de meio mundo cruzou a emenda. */
export function cruzaEmenda(lng1: number, lng2: number): boolean {
  return Math.abs(lng2 - lng1) > 180;
}

// -----------------------------------------------------------------------------
// CÂMERA
// -----------------------------------------------------------------------------

export interface Vista {
  /** centro da vista, em graus */
  lng: number;
  lat: number;
  /** graus de latitude visíveis na vertical; menor = mais perto */
  alturaGraus: number;
}

/** Mundo inteiro na vertical. Abaixo disto não faz sentido afastar mais. */
export const ALTURA_MAX = 180;
/** ~200 km de norte a sul. Além disso a imagem do GIBS não tem o que mostrar. */
export const ALTURA_MIN = 1.8;

export function travarVista(v: Vista, aspecto: number): Vista {
  const alturaGraus = Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, v.alturaGraus));

  // Latitude é presa para o mapa nunca mostrar vazio acima do polo. Quando a
  // vista é mais alta que o mundo, o centro é fixado no equador: não há folga
  // para escolher.
  const meia = alturaGraus / 2;
  const folga = Math.max(0, 90 - meia);
  const lat = Math.min(folga, Math.max(-folga, v.lat));

  // Longitude NÃO é presa: ela enrola. É o que permite seguir um ciclone
  // atravessando o antimeridiano sem que ele se parta na borda.
  const lng = enrolarLng(v.lng);

  void aspecto;
  return { lng, lat, alturaGraus };
}

/** Largura visível em graus de longitude, dada a proporção da tela. */
export function larguraGraus(alturaGraus: number, aspecto: number): number {
  return alturaGraus * (Number.isFinite(aspecto) && aspecto > 0 ? aspecto : 1);
}

/**
 * Fator de zoom por passo de roda.
 *
 * Multiplicativo, não aditivo: aproximar tem que custar o mesmo gesto perto e
 * longe. Um passo aditivo de 10 graus é imperceptível vendo o mundo inteiro e
 * violento vendo uma cidade.
 */
export function aplicarZoom(alturaGraus: number, passos: number): number {
  const f = Math.pow(1.18, passos);
  return Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, alturaGraus * f));
}

/**
 * Ponto da tela → geográfico.
 *
 * `px`/`py` em pixels de canvas, origem no canto superior esquerdo.
 */
export function daTela(
  px: number, py: number,
  larguraPx: number, alturaPx: number,
  v: Vista,
): Geo {
  const aspecto = larguraPx / Math.max(1, alturaPx);
  const gw = larguraGraus(v.alturaGraus, aspecto);

  const fx = px / Math.max(1, larguraPx) - 0.5;   // -0.5 .. 0.5
  const fy = py / Math.max(1, alturaPx) - 0.5;

  return {
    lng: enrolarLng(v.lng + fx * gw),
    // y da tela cresce para baixo; latitude cresce para cima
    lat: travarLat(v.lat - fy * v.alturaGraus),
  };
}
// -----------------------------------------------------------------------------
// JANELA DA SIMULAÇÃO DE VENTO
// -----------------------------------------------------------------------------

/** Recorte do mundo em UV global: x0/y0 no canto noroeste, largura e altura. */
export interface Janela { x: number; y: number; w: number; h: number; }

/** Folga em volta da vista, para partícula não nascer visivelmente na borda. */
const FOLGA = 1.15;

/**
 * A janela de simulação que corresponde a uma vista.
 *
 * Devolve o mundo inteiro quando a vista já cobre quase tudo — abaixo disso o
 * recorte só acrescentaria conta.
 */
export function janelaDaVista(v: Vista, aspecto: number): Janela {
  const gw = Math.min(360, larguraGraus(v.alturaGraus, aspecto) * FOLGA);
  const gh = Math.min(180, v.alturaGraus * FOLGA);

  if (gw >= 359 && gh >= 179) return { x: 0, y: 0, w: 1, h: 1 };

  const oeste = (enrolarLng(v.lng - gw / 2) + 180) / 360;
  // y global cresce para o SUL: o topo da vista é a menor coordenada
  const norte = (90 - v.lat - gh / 2) / 180;

  return {
    x: ((oeste % 1) + 1) % 1,
    y: Math.max(0, Math.min(1 - gh / 180, norte)),
    w: gw / 360,
    h: gh / 180,
  };
}

/**
 * Vale a pena trocar a janela?
 *
 * Trocar APAGA o rastro acumulado — ele pertence a uma região, e mantê-lo
 * arrastaria os riscos do lugar antigo por cima do novo. Como o plano do vento
 * está ancorado em coordenada de mundo, um ajuste pequeno de câmera não torna a
 * janela atual errada, só levemente fora de centro. Sem este limiar, cada
 * passo de roda limparia o rastro e a tela piscaria durante todo o zoom.
 *
 * Os números: 25% de mudança de escala, ou um deslocamento de mais de 35% da
 * própria janela.
 */
export function mudouBastante(a: Janela, b: Janela): boolean {
  const mundo = (j: Janela) => j.w >= 0.999 && j.h >= 0.999;
  if (mundo(a) !== mundo(b)) return true;
  if (mundo(a) && mundo(b)) return false;

  const escala = Math.max(b.w / a.w, a.w / b.w, b.h / a.h, a.h / b.h);
  if (escala > 1.25) return true;

  // deslocamento do canto, com a volta do mundo em x
  const dx = Math.abs(((b.x - a.x + 1.5) % 1) - 0.5);
  const dy = Math.abs(b.y - a.y);
  return dx > a.w * 0.35 || dy > a.h * 0.35;
}

/**
 * Deslocamentos em x das cópias do mundo, em unidades de mundo.
 *
 * O mapa é desenhado três vezes lado a lado. Sem isso, arrastar para o lado
 * revelaria o vazio do fundo em vez da continuação do planeta, e um ciclone
 * sobre o antimeridiano ficaria partido na borda — que é exatamente onde os
 * tufões do Pacífico vivem.
 *
 * As três cópias compartilham geometria e material: custam chamada de desenho,
 * não memória. As que saem da vista são descartadas pelo próprio three.js.
 */
export const COPIAS = [-MUNDO_W, 0, MUNDO_W] as const;
