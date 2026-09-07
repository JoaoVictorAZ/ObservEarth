// src/calota.ts
// -----------------------------------------------------------------------------
// O QUE A CÂMERA REALMENTE ENXERGA DE UM PLANETA.
// -----------------------------------------------------------------------------
// Este arquivo é só trigonometria, e mora sozinho por isso: é a decisão que
// diz quantos tiles serão pedidos, e decisão que gasta cota precisa ser
// testável sem subir uma GPU. É a mesma razão pela qual `planoDeTiles` mora em
// `src/tiles.ts` e não dentro do motor.
// -----------------------------------------------------------------------------

/** A janela em graus que a câmera enxerga, já como caixa lat/lng. */
export interface JanelaVista {
  latSul: number; latNorte: number;
  lngOeste: number; lngLeste: number;
  /** largura angular em graus, para escolher o nível da pirâmide */
  larguraGraus: number;
}

/**
 * A CALOTA VISÍVEL de uma câmera que olha para o centro do planeta.
 *
 * A câmera está a uma distância d = R(1 + alt) do centro. Um raio que sai dela
 * com ângulo θ em relação ao eixo óptico encontra a esfera num ponto P, e o
 * que queremos é o ângulo desse ponto visto DO CENTRO — porque é ele que se
 * traduz em graus de latitude e longitude.
 *
 * No triângulo centro-câmera-ponto, pela lei dos senos,
 *
 *     sen(∠OPC) / d = sen θ / R      →     ∠OPC = π − asen((d/R) sen θ)
 *
 * (obtuso, porque P está na face voltada para a câmera), e o ângulo no centro
 * fecha a soma:
 *
 *     α = asen((d/R) sen θ) − θ
 *
 * QUANDO O RAIO ERRA A ESFERA — que é o caso comum, porque a câmera enquadra o
 * planeta inteiro com folga — o argumento do arco-seno passa de 1 e a conta
 * deixa de existir. O limite então é o HORIZONTE, o raio tangente:
 *
 *     α = acos(R / d)
 *
 * Aqui está o detalhe que se erra sem perceber: o horizonte NÃO é 90°. De uma
 * altitude de 1,7 raios se enxerga uma calota de 68,3°, e não de um hemisfério.
 * Supor 90° pediria tiles de uma faixa que a curvatura esconde — no zoom
 * afastado, dezenas deles, todos jogados fora.
 */
export function calotaVisivel(
  lat: number, lng: number, altitude: number,
  fovGraus: number, aspecto: number,
): JanelaVista {
  const rad = Math.PI / 180;
  const d = 1 + Math.max(0.001, altitude);          // em raios terrestres
  const horizonte = Math.acos(Math.min(1, 1 / d));

  const meia = (thetaMeio: number) => {
    const s = d * Math.sin(thetaMeio);
    return s >= 1 ? horizonte : Math.min(horizonte, Math.asin(s) - thetaMeio);
  };

  const thetaV = (fovGraus * rad) / 2;
  // O FOV do three.js é VERTICAL. A meia-abertura horizontal sai da relação de
  // aspecto no plano da imagem, e é a tangente que escala — não o ângulo.
  const thetaH = Math.atan(Math.tan(thetaV) * Math.max(0.1, aspecto));

  const aV = meia(thetaV);
  const aH = meia(thetaH);

  const latNorte = Math.min(90, lat + (aV * 180) / Math.PI);
  const latSul = Math.max(-90, lat - (aV * 180) / Math.PI);

  // MEIA-LARGURA EM LONGITUDE de uma calota de raio angular aH centrada em
  // `lat`. Os meridianos convergem, então a mesma distância angular cobre mais
  // graus de longitude quanto maior a latitude — e a partir de certo ponto a
  // calota engole o polo e a longitude deixa de ter limite.
  const cosLat = Math.cos(lat * rad);
  const razao = Math.sin(aH) / Math.max(1e-6, cosLat);
  const meiaLng = razao >= 1 ? 180 : (Math.asin(razao) * 180) / Math.PI;

  return {
    latSul, latNorte,
    lngOeste: lng - meiaLng,
    lngLeste: lng + meiaLng,
    larguraGraus: Math.min(360, 2 * meiaLng),
  };
}
