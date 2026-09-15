// src/malha/picking.ts
// -----------------------------------------------------------------------------
// CLICAR NO RELEVO, E NÃO NO PLANETA ATRÁS DELE
// -----------------------------------------------------------------------------
// Com a malha 3D levantada, o clique mentia. O raio do ponteiro atravessava o
// pico que a pessoa estava mirando e ia bater na ESFERA lá atrás — e a esfera,
// naquela direção, é outro lugar. Mirando uma alta sobre a Argentina em vista
// oblíqua, a sonda abria no Atlântico. Quanto mais inclinada a vista e mais
// alto o relevo, maior o erro.
//
// ---------------------------------------------------------------------------
// POR QUE NÃO É UM `Raycaster` NA MALHA
// ---------------------------------------------------------------------------
// Seria a resposta óbvia, e ela não cabe no orçamento. A grade de 0,25° tem
// 1440 × 721 vértices, ou seja mais de dois milhões de triângulos. O
// `Raycaster` do three.js faz um teste de esfera envolvente e depois percorre
// TODOS os triângulos: são milhões de interseções raio–triângulo por consulta.
// Para um clique isolado talvez passasse; para a leitura contínua sob o
// cursor, a 60 Hz, não passa nem perto. E acrescentar uma árvore BVH é uma
// dependência nova para resolver um problema que a geometria já resolve.
//
// ---------------------------------------------------------------------------
// O QUE ISTO FAZ: MARCHA NO RAIO CONTRA UM CAMPO DE ALTURA
// ---------------------------------------------------------------------------
// A malha não é uma geometria arbitrária: é uma FUNÇÃO da esfera, h(lat, lng).
// Isso permite uma solução que não depende da resolução da grade:
//
//   1. O relevo mora inteiro na casca entre R e R·(1+exagero). O trecho do raio
//      fora dessa casca não pode conter interseção, e é descartado por álgebra
//      — duas equações de segundo grau, sem laço nenhum.
//   2. Dentro da casca, marcha-se em passos. Em cada amostra compara-se a
//      distância ao centro com a altura da superfície NAQUELA direção.
//   3. Onde o sinal vira — o raio deixou de estar acima da superfície e passou
//      a estar abaixo — bisecciona-se para achar a travessia com precisão.
//
// São ~64 amostras e ~12 refinos: 76 consultas ao campo, contra dois milhões
// de triângulos. E o custo não muda se a grade dobrar de resolução.
//
// ---------------------------------------------------------------------------
// O QUE ELE ERRA, E É ACEITÁVEL
// ---------------------------------------------------------------------------
// A marcha pode PULAR uma agulha: um pico isolado mais estreito que um passo
// fica entre duas amostras e não é visto. O passo é o comprimento da casca
// dividido por `passos`; com a casca em 20% do raio e 64 passos, cada passo
// mede ~0,3% do raio — bem menos que a largura de qualquer estrutura
// meteorológica, que é o que este relevo desenha. Para um terreno com paredes
// verticais a escolha seria outra.
// -----------------------------------------------------------------------------

export interface Raio {
  /** origem, em coordenadas de cena (centro do planeta na origem) */
  o: [number, number, number];
  /** direção UNITÁRIA */
  d: [number, number, number];
}

export interface OpcoesRelevo {
  /** raio do planeta */
  raio: number;
  /** altura máxima do relevo, em fração do raio */
  exagero: number;
  /**
   * Altura normalizada (0 a 1) naquela direção, ou `null` onde não há dado.
   *
   * `null` NÃO é zero: onde a fonte não mediu, não existe superfície — o raio
   * atravessa o buraco, como atravessa na tela. Tratar como zero criaria um
   * chão invisível no nível da esfera e o clique pousaria num lugar onde não
   * há malha desenhada.
   */
  alturaEm(lat: number, lng: number): number | null;
  passos?: number;
  refinos?: number;
}

export interface Acerto {
  lat: number;
  lng: number;
  /** distância ao longo do raio */
  t: number;
  /** altura normalizada no ponto de acerto */
  altura: number;
}

/** Convenção do globe.gl: Y é o polo norte, +Z é a longitude zero. */
export function geoDe(p: [number, number, number]): { lat: number; lng: number; r: number } {
  const r = Math.hypot(p[0], p[1], p[2]);
  if (!(r > 0)) return { lat: 0, lng: 0, r: 0 };
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, p[1] / r))) * 180) / Math.PI,
    lng: (Math.atan2(p[0], p[2]) * 180) / Math.PI,
    r,
  };
}

/**
 * Raízes de |o + t·d|² = R², com `d` unitário. Devolve `null` sem interseção.
 *
 * Sempre em ordem crescente: quem chama depende de `perto` ser a entrada.
 */
export function raizesEsfera(r: Raio, R: number): { perto: number; longe: number } | null {
  const [ox, oy, oz] = r.o, [dx, dy, dz] = r.d;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const raiz = Math.sqrt(disc);
  return { perto: -b - raiz, longe: -b + raiz };
}

const ponto = (r: Raio, t: number): [number, number, number] =>
  [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];

/**
 * Onde o raio encontra o relevo. `null` quando não encontra.
 *
 * Devolver `null` é a resposta certa em três casos diferentes, e todos os três
 * têm que cair no plano B de quem chama (a esfera lisa): o raio passa longe do
 * planeta, o raio passa pela casca mas por cima de todo o relevo, ou o trecho
 * que ele atravessa não tem dado nenhum.
 */
export function intersectarRelevo(r: Raio, o: OpcoesRelevo): Acerto | null {
  const R = o.raio;
  const Ro = R * (1 + Math.max(0, o.exagero));
  if (!(R > 0) || !(Ro > R)) return null;

  const fora = raizesEsfera(r, Ro);
  if (!fora || fora.longe < 0) return null;

  // A casca começa onde o raio entra na esfera externa (ou já dentro dela) e
  // acaba onde ele bate no planeta — abaixo da superfície não há o que achar.
  const dentro = raizesEsfera(r, R);
  const t0 = Math.max(0, fora.perto);
  const t1 = dentro && dentro.perto > t0 ? dentro.perto : fora.longe;
  if (!(t1 > t0)) return null;

  const passos = Math.max(8, o.passos ?? 64);
  const refinos = Math.max(1, o.refinos ?? 12);
  const dt = (t1 - t0) / passos;

  /** distância do ponto à superfície: >0 acima do relevo, <0 dentro dele */
  const folga = (t: number): number | null => {
    const p = ponto(r, t);
    const g = geoDe(p);
    const h = o.alturaEm(g.lat, g.lng);
    if (h == null || !Number.isFinite(h)) return null;
    return g.r - R * (1 + Math.max(0, Math.min(1, h)) * o.exagero);
  };

  let tAnt = t0;
  let fAnt = folga(t0);

  for (let i = 1; i <= passos; i++) {
    const t = t0 + dt * i;
    const f = folga(t);

    // Buraco no dado: não há superfície aqui. O raio segue, e o trecho é
    // esquecido — não se interpola por cima de ausência.
    if (f == null) { tAnt = t; fAnt = null; continue; }

    if (fAnt != null && fAnt > 0 && f <= 0) {
      // A travessia está entre tAnt e t. Bissecção: cada refino corta o
      // intervalo pela metade, então 12 refinos dão 1/4096 do passo.
      let a = tAnt, b = t;
      for (let k = 0; k < refinos; k++) {
        const m = (a + b) / 2;
        const fm = folga(m);
        if (fm == null) break;
        if (fm > 0) a = m; else b = m;
      }
      const tf = (a + b) / 2;
      const g = geoDe(ponto(r, tf));
      const h = o.alturaEm(g.lat, g.lng);
      return { lat: g.lat, lng: g.lng, t: tf, altura: h ?? 0 };
    }

    // Começar JÁ DENTRO do relevo também é um acerto: acontece quando a câmera
    // se aproxima o bastante para entrar na casca, e ignorar isso faria o
    // clique voltar a cair na esfera justamente no zoom em que o relevo é
    // maior na tela.
    if (i === 1 && fAnt != null && fAnt <= 0) {
      const g = geoDe(ponto(r, t0));
      const h = o.alturaEm(g.lat, g.lng);
      return { lat: g.lat, lng: g.lng, t: t0, altura: h ?? 0 };
    }

    tAnt = t; fAnt = f;
  }

  return null;
}
