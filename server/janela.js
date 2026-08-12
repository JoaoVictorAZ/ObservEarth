// server/janela.js
// -----------------------------------------------------------------------------
// JANELA DE INTERESSE — por que uma textura global nunca serve zoom.
//
// A MEDIÇÃO QUE DECIDE
// A imagem de satélite é uma textura equirretangular única, de 4096 px, esticada
// sobre o planeta inteiro. Isso dá 4096/360 = 11,4 texels por grau, FIXO. Os
// pixels de tela por grau, ao contrário, crescem sem limite conforme se
// aproxima:
//
//   altitude   graus visíveis   texels/grau   px de tela/grau   texel por px
//     2,50          147            11,4             15             0,77
//     1,70          137            11,4             16             0,72
//     0,40           89            11,4             24             0,47
//     0,10           49            11,4             44             0,26
//
// Abaixo de 1,0 a textura está sendo AMPLIADA. Ou seja: mesmo na vista inicial
// já se vê textura esticada, e a 0,10 cada texel cobre quatro pixels de tela.
//
// Aumentar a textura não resolve — só empurra o problema. 8192 px custaria
// 134 MB de memória de vídeo e compraria um fator 2, que some com dois passos
// de zoom.
//
// A SAÍDA é a mesma de qualquer mapa: buscar SÓ A REGIÃO VISÍVEL, na resolução
// que a tela pede. O GIBS é WMS e aceita BBOX arbitrário, então é a mesma
// requisição com uma janela em vez do mundo.
//
// -----------------------------------------------------------------------------
// O QUE PRECISA DE CUIDADO: O ORÇAMENTO
//
// Se cada movimento de câmera virasse uma requisição, arrastar o globo por dois
// segundos gastaria dezenas de chamadas. A regra deste projeto é um quarto do
// limite gratuito.
//
// Por isso a janela é ARREDONDADA para uma grade de passos. Mexer o globo um
// pouco cai na MESMA janela, que já está em cache — e só uma mudança real de
// região ou de zoom gera requisição nova. É o mesmo princípio de um servidor de
// tiles, com uma peça só em vez de uma malha.
// -----------------------------------------------------------------------------

/**
 * Níveis de janela. Cada um cobre um tamanho de região e é arredondado num
 * passo proporcional — janela pequena precisa de grade fina para não "pular".
 *
 * `grausMax` é o tamanho da maior dimensão visível que ainda usa este nível.
 */
export const NIVEIS = [
  { id: 0, grausMax: 361, passo: 360, largura: 4096 },  // mundo inteiro
  { id: 1, grausMax: 120, passo: 30, largura: 2048 },
  { id: 2, grausMax: 60, passo: 15, largura: 2048 },
  { id: 3, grausMax: 30, passo: 8, largura: 2048 },
  { id: 4, grausMax: 15, passo: 4, largura: 2048 },
  { id: 5, grausMax: 8, passo: 2, largura: 2048 },
];

export function nivelPara(grausVisiveis) {
  const g = Number.isFinite(grausVisiveis) ? Math.abs(grausVisiveis) : 361;
  for (let i = NIVEIS.length - 1; i >= 0; i--) {
    if (g <= NIVEIS[i].grausMax) return NIVEIS[i];
  }
  return NIVEIS[0];
}

const trava = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Janela arredondada em volta de um ponto.
 *
 * A largura em longitude é dividida por cos(lat) porque um grau de longitude
 * encolhe com a latitude: sem isso, uma janela sobre a Escandinávia cobriria
 * uma faixa estreita demais de terreno e o zoom "andaria" mais rápido em
 * longitude que em latitude.
 */
export function janelaEm(lat, lng, grausVisiveis) {
  const nivel = nivelPara(grausVisiveis);

  if (nivel.id === 0) {
    return { ...vazia(nivel), bbox: [-90, -180, 90, 180], mundo: true };
  }

  // ---------------------------------------------------------------------
  // ARREDONDA O CENTRO, NÃO AS BORDAS.
  //
  // Minha primeira versão arredondava lat0/lat1/lng0/lng1 separadamente. Como
  // as quatro bordas cruzam a grade em momentos diferentes, um arrasto de 40°
  // produzia ONZE janelas distintas — o teste mediu. Arredondando o centro e
  // construindo a janela com tamanho fixo, o mesmo arrasto dá 40/passo + 1
  // janelas, que é o mínimo possível e é previsível.
  //
  // Tamanho fixo por nível também melhora o cache: duas visitas ao mesmo lugar
  // pedem exatamente o mesmo retângulo.
  // ---------------------------------------------------------------------
  const p = nivel.passo;
  const arred = (v) => Math.round(v / p) * p;

  const meia = nivel.grausMax / 2;

  // O centro sai PRIMEIRO, e o cosseno vem dele — não da latitude crua.
  //
  // Tirando o cosseno de `lat` sem arredondar, a largura da janela mudava
  // continuamente enquanto o globo se movia: duas câmeras dentro da mesma
  // célula da grade pediam retângulos de 32,688° e 32,713°. Chaves diferentes,
  // cache inútil, uma requisição por movimento — exatamente o que o
  // arredondamento existe para evitar.
  const cLat = trava(arred(lat), -90 + meia, 90 - meia);

  // Um grau de longitude encolhe com a latitude: sem dividir por cos, a janela
  // no norte cobriria uma faixa estreita demais de terreno.
  const cos = Math.max(Math.cos((cLat * Math.PI) / 180), 0.2);
  const meiaLng = Math.min(89, meia / cos);
  const cLng = trava(arred(lng), -180 + meiaLng, 180 - meiaLng);

  const bbox = [
    trava(cLat - meia, -90, 90),
    trava(cLng - meiaLng, -180, 180),
    trava(cLat + meia, -90, 90),
    trava(cLng + meiaLng, -180, 180),
  ];

  // Se o recorte cobriria meio mundo, não vale: o mundo inteiro já está em
  // cache e sai mais barato.
  if (bbox[3] - bbox[1] >= 180 || bbox[2] - bbox[0] >= 90) {
    return { ...vazia(nivel), bbox: [-90, -180, 90, 180], mundo: true };
  }

  return { ...vazia(nivel), bbox, mundo: false };
}

function vazia(nivel) {
  return { nivel: nivel.id, passo: nivel.passo, largura: nivel.largura };
}

/**
 * Chave de cache. Duas câmeras próximas têm que produzir a MESMA chave, senão
 * o arredondamento não serviu para nada.
 */
export function chaveDe(janela) {
  return janela.bbox.map((v) => v.toFixed(0)).join(",");
}

/**
 * Valida uma bbox vinda da rede.
 *
 * Devolve null em vez de lançar: a rota trata como "sem janela" e serve o
 * mundo, que é o comportamento antigo. Uma bbox malformada não deve derrubar a
 * camada de imagem.
 */
export function lerBBox(txt) {
  if (typeof txt !== "string") return null;
  const p = txt.split(",").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return null;
  const [lat0, lng0, lat1, lng1] = p;
  if (lat0 >= lat1 || lng0 >= lng1) return null;
  if (lat0 < -90 || lat1 > 90 || lng0 < -180 || lng1 > 180) return null;
  // Área ridícula: o WMS devolveria uma imagem de um pixel esticada.
  if (lat1 - lat0 < 0.05 || lng1 - lng0 < 0.05) return null;
  return [lat0, lng0, lat1, lng1];
}

/**
 * Altura em pixels que mantém o pixel quadrado na projeção.
 *
 * Pedir sempre `largura/2` produziria uma imagem esticada em qualquer janela
 * que não fosse 2:1 — e a janela quase nunca é.
 */
export function alturaDe(bbox, largura) {
  const [lat0, lng0, lat1, lng1] = bbox;
  const razao = (lat1 - lat0) / (lng1 - lng0);
  return Math.max(64, Math.min(4096, Math.round(largura * razao)));
}
