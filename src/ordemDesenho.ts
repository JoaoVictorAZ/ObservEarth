// src/ordemDesenho.ts
// -----------------------------------------------------------------------------
// A PILHA DE DESENHO DO GLOBO, num lugar só.
// -----------------------------------------------------------------------------
// Quase todas as camadas do globo desenham sobre a MESMA esfera, com
// `depthTest: false`. Isso é deliberado — elas são cascas concêntricas a
// milésimos de raio de distância, e deixar o teste de profundidade decidir
// produziria cintilação (z-fighting) em vez de sobreposição. O preço é que a
// ORDEM DE DESENHO passa a ser a única coisa que decide quem fica na frente.
//
// Com os números espalhados por três arquivos, a ordem virou acidente. Aqui
// eles ficam juntos, e `test/ordem-desenho.mjs` afirma as relações que
// importam — não os valores, que podem mudar, mas o fato de imagem ficar
// abaixo de vento e vento abaixo da análise.
//
// -----------------------------------------------------------------------------
// A ARMADILHA DO `renderOrder` NUM `Group`
// -----------------------------------------------------------------------------
// `renderOrder` num objeto comum ordena aquele objeto. `renderOrder` num
// `Group` NÃO é herdado pelos filhos: ele vira `groupOrder`, e o comparador do
// three.js é
//
//     groupOrder primeiro; só em caso de empate, renderOrder
//
// Ou seja, um grupo com `renderOrder = 3` põe TUDO que está dentro dele acima
// de TUDO que está fora e não pertence a grupo nenhum — inclusive de um objeto
// solto com `renderOrder = 5`.
//
// Foi exatamente o que aconteceu quando a pirâmide de tiles nasceu: o grupo
// dela ficou com 3, e os tiles de satélite passaram a ser desenhados POR CIMA
// das partículas de vento, que estão soltas na cena com 5. O vento sumia atrás
// da imagem ao ligar as duas camadas — e nada no código parecia errado, porque
// 5 é maior que 3.
//
// A regra que segue daqui: GRUPO só recebe ordem quando a intenção é
// justamente "tudo isto acima de tudo aquilo". Para a malha 3D é o caso, e por
// isso `MALHA` é declarado como ordem de GRUPO. Para a pirâmide não é: os
// tiles precisam se ordenar ENTRE SI e ficar no mesmo balde que as outras
// cascas, então o grupo dela fica em zero e quem carrega a ordem é cada tile.
// -----------------------------------------------------------------------------

export const ORDEM = {
  /** a esfera do globe.gl, com teste de profundidade de verdade */
  BASE: 0,

  /** a textura única do mundo inteiro — o piso da imagem */
  IMAGEM: 2,

  /**
   * Os tiles da pirâmide, empilhados por nível: o mais fino desenha por cima
   * do mais grosso. O passo é pequeno de propósito, para os sete níveis
   * caberem inteiros entre IMAGEM e ISOBARAS.
   */
  TILE_BASE: 2.1,
  TILE_PASSO: 0.05,

  /**
   * FRONTEIRAS: costa, limites internacionais e divisas estaduais.
   *
   * Acima de todos os tiles de imagem e abaixo das isóbaras. A camada anterior
   * não tinha lugar nesta pilha — ela era desenhada pelo three-globe como
   * polígono, fora do controle deste arquivo. Ver src/fronteiras.ts.
   */
  FRONTEIRAS: 2.6,

  /** linhas de contorno: acima da imagem, abaixo do que se move */
  ISOBARAS: 3,

  CORRENTES: 4,
  VENTO: 5,

  /**
   * A MALHA 3D é ordem de GRUPO, e é a única que é.
   *
   * Ela não é uma casca sobre a esfera: é uma superfície levantada acima dela,
   * e desenha com teste de profundidade LIGADO. Tem que vir depois de todo o
   * resto — se uma casca com `depthTest: false` for desenhada depois, ela pinta
   * por cima de um relevo que está fisicamente na frente.
   */
  MALHA: 6,
} as const;

/** Ordem de um tile do nível `z`. Mais fino, mais na frente. */
export function ordemDoTile(z: number): number {
  return ORDEM.TILE_BASE + Math.max(0, z) * ORDEM.TILE_PASSO;
}
