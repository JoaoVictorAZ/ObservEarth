// server/vorticidade.js
// -----------------------------------------------------------------------------
// DETECÇÃO DE CIRCULAÇÃO — achar o ciclone no campo, em vez de torcer para que
// ele apareça.
//
// O RELATO: "o vento do Rio foi devido a um ciclone na costa e NÃO É POSSÍVEL
// IDENTIFICAR ELE através dos dados de vento que estão no app."
//
// O QUE EU TINHA ERRADO
// Quando o relato anterior foi "calmaria esticada parece furacão", eu achatei o
// brilho do rastro para uniforme e argumentei que a cor carregaria a
// velocidade. Isso consertou o borrão e removeu, junto, a coisa que fazia um
// ciclone REAL saltar aos olhos: o contraste no topo da escala. Troquei um
// defeito por outro.
//
// Mas mesmo desfazendo aquilo, a identificação continuaria frágil, porque
// CICLONE NÃO SE DISTINGUE POR VELOCIDADE. Um jato de altos níveis tem
// 60 m/s e não é ciclone. Um ciclone subtropical na costa do Sudeste tem
// 20-25 m/s e é. O que os separa é a ROTAÇÃO.
//
// A grandeza é a vorticidade relativa:
//
//     ζ = (1/(a·cos φ)) · [ ∂v/∂λ − ∂(u·cos φ)/∂φ ]
//
// Em coordenadas esféricas — o `cos φ` dentro da derivada meridional não é
// detalhe: sem ele, a convergência dos meridianos aparece como vorticidade
// falsa, crescente com a latitude, e o detector encheria os polos de ciclones
// inexistentes.
//
// O SINAL DEPENDE DO HEMISFÉRIO, E ERRAR ISSO INVERTE TUDO
//   Hemisfério NORTE: ciclone gira no sentido anti-horário -> ζ POSITIVO
//   Hemisfério SUL:   ciclone gira no sentido horário      -> ζ NEGATIVO
//
// Ou seja: é ciclônico quando sinal(ζ) = sinal(latitude). Trocar isso faria o
// detector marcar ANTICICLONES como ciclones — e anticiclone é céu limpo. Num
// aplicativo de monitoramento, apontar tempo bom onde há tempestade é o pior
// erro possível, e por isso o caso do ciclone na costa do Rio (hemisfério sul,
// giro horário) é um dos testes.
// -----------------------------------------------------------------------------

const RAIO_TERRA = 6371000;   // metros
const OMEGA = 7.2921e-5;      // rotação da Terra, rad/s

/** parâmetro de Coriolis: f = 2Ω sen φ. Zero no equador, e é por isso que não
 *  existe ciclone organizado sobre a linha. */
export function coriolis(latGraus) {
  return 2 * OMEGA * Math.sin((latGraus * Math.PI) / 180);
}

/**
 * Campo de vorticidade relativa, em s⁻¹.
 *
 * A grade é regular em lat/lng, com a linha 0 no norte (varredura do GFS).
 * `u` é positivo para leste, `v` positivo para norte.
 */
export function vorticidade(grid) {
  const { nx, ny, u, v } = grid;
  const z = new Float32Array(nx * ny);
  const dLat = 180 / (ny - 1);
  const dLng = 360 / nx;
  const dPhi = (dLat * Math.PI) / 180;
  const dLam = (dLng * Math.PI) / 180;

  const lat = (j) => 90 - j * dLat;
  // Longitude dá a volta: a coluna 0 é vizinha da última. Sem o módulo, o
  // antimeridiano vira uma linha de vorticidade falsa de polo a polo.
  const ix = (i) => ((i % nx) + nx) % nx;

  for (let j = 1; j < ny - 1; j++) {
    const phi = (lat(j) * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    // Perto dos polos cos φ → 0 e a divisão explode. Acima de 85° a grade
    // lat/lng não sustenta o cálculo; devolver zero é honesto, inventar não.
    if (Math.abs(cosPhi) < 0.09) continue;

    const cosN = Math.cos((lat(j - 1) * Math.PI) / 180);
    const cosS = Math.cos((lat(j + 1) * Math.PI) / 180);

    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const vL = v[j * nx + ix(i - 1)], vR = v[j * nx + ix(i + 1)];
      // j−1 é ao NORTE (linha 0 = 90°N), então a derivada em φ inverte o sinal
      // da diferença de índice.
      const uN = u[(j - 1) * nx + i], uS = u[(j + 1) * nx + i];

      const dv_dLam = (vR - vL) / (2 * dLam);
      const dUcos_dPhi = (uN * cosN - uS * cosS) / (2 * dPhi);

      z[k] = (dv_dLam - dUcos_dPhi) / (RAIO_TERRA * cosPhi);
    }
  }
  return z;
}

/**
 * É circulação ciclônica?
 *
 * Ciclônico = mesmo sinal do parâmetro de Coriolis. Norte anti-horário (ζ>0),
 * sul horário (ζ<0). Inverter isto marcaria anticiclone — céu limpo — como
 * tempestade.
 */
export function ehCiclonico(zeta, latGraus) {
  if (!Number.isFinite(zeta) || Math.abs(latGraus) < 5) return false;
  return zeta * latGraus > 0;
}

/**
 * Circulação média num disco — a grandeza que realmente localiza o centro.
 *
 * POR QUE NÃO O PICO DE VORTICIDADE (o erro que o teste me apontou)
 *
 * Minha primeira versão procurava máximo local de |ζ|. Ela achou ZERO centros
 * num campo com 86 células ciclônicas acima do limiar — e a razão é física,
 * não numérica:
 *
 *     O MÁXIMO DE VORTICIDADE DE UM CICLONE É UM ANEL, NÃO UM PONTO.
 *
 * O centro é calmo (é o olho). A vorticidade cresce para fora até a parede e
 * cai depois dela. Num anel, todo ponto tem vizinho igual ou maior, então
 * "máximo local" nunca é satisfeito — o critério procurava uma coisa que a
 * estrutura não tem.
 *
 * O que tem centro é a CIRCULAÇÃO. Pelo teorema de Stokes,
 *
 *     Γ = ∮ v·dl = ∫∫ ζ dA  ≈  ζ̄ · A
 *
 * ou seja, a média de ζ num disco é a circulação por unidade de área em volta
 * daquele ponto. Isso É máximo no centro de qualquer vórtice coerente, com
 * anel ou sem anel, e é a definição de "há rotação fechada em volta daqui".
 */
export function circulacaoMedia(z, nx, ny, raioDeg) {
  const dLat = 180 / (ny - 1), dLng = 360 / nx;
  const jr = Math.max(1, Math.round(raioDeg / dLat));
  const ir = Math.max(1, Math.round(raioDeg / dLng));
  const out = new Float32Array(nx * ny);
  const ix = (i) => ((i % nx) + nx) % nx;

  for (let j = jr; j < ny - jr; j++) {
    for (let i = 0; i < nx; i++) {
      let soma = 0, n = 0;
      for (let dj = -jr; dj <= jr; dj++) {
        for (let di = -ir; di <= ir; di++) {
          // Disco, não quadrado: um quadrado dá peso a mais nas diagonais e
          // desloca o centro detectado.
          if (Math.hypot(dj * dLat, di * dLng) > raioDeg) continue;
          const zz = z[(j + dj) * nx + ix(i + di)];
          if (Number.isFinite(zz)) { soma += zz; n++; }
        }
      }
      out[j * nx + i] = n ? soma / n : 0;
    }
  }
  return out;
}

/**
 * Acha centros de circulação organizada.
 *
 * Critérios, cada um descartando um falso positivo diferente:
 *
 *   |ζ̄| acima do limiar  -> há circulação fechada, não ruído
 *   sinal ciclônico       -> é ciclone e não anticiclone (céu limpo)
 *   |lat| ≥ 5°            -> sem Coriolis não há circulação organizada
 *   máximo local de ζ̄     -> um centro por sistema
 *   centro mais calmo     -> é vórtice fechado e não linha de cisalhamento;
 *                            uma frente tem vorticidade alta e NENHUM centro
 *
 * `limiar` em s⁻¹, sobre a média no disco. É naturalmente menor que o pico
 * pontual: 2e-5 já é um sistema organizado de escala sinótica.
 */
export function acharCentros(grid, {
  limiar = 2e-5, raioBuscaDeg = 4, latMin = 5, maxCentros = 40,
} = {}) {
  const { nx, ny, u, v } = grid;
  const z = vorticidade(grid);
  const zbar = circulacaoMedia(z, nx, ny, raioBuscaDeg);

  const dLat = 180 / (ny - 1), dLng = 360 / nx;
  const jr = Math.max(1, Math.round(raioBuscaDeg / dLat));
  const ir = Math.max(1, Math.round(raioBuscaDeg / dLng));
  const ix = (i) => ((i % nx) + nx) % nx;
  const vel = (k) => Math.hypot(u[k] ?? 0, v[k] ?? 0);

  const achados = [];
  for (let j = 2 * jr; j < ny - 2 * jr; j++) {
    const lat = 90 - j * dLat;
    if (Math.abs(lat) < latMin) continue;

    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const zb = zbar[k];
      if (!Number.isFinite(zb) || Math.abs(zb) < limiar) continue;
      if (!ehCiclonico(zb, lat)) continue;

      let ehMax = true;
      for (let dj = -jr; dj <= jr && ehMax; dj++) {
        for (let di = -ir; di <= ir; di++) {
          if (di === 0 && dj === 0) continue;
          const zz = zbar[(j + dj) * nx + ix(i + di)];
          if (Number.isFinite(zz) && Math.abs(zz) > Math.abs(zb)) { ehMax = false; break; }
        }
      }
      if (!ehMax) continue;

      // Vento no ANEL e no MIOLO. O olho é calmo: medir no centro daria o
      // valor mais baixo do sistema inteiro.
      let ventoMax = 0, raioMaxDeg = 0, somaMiolo = 0, nMiolo = 0;
      for (let dj = -jr; dj <= jr; dj++) {
        for (let di = -ir; di <= ir; di++) {
          const r = Math.hypot(dj * dLat, di * dLng);
          if (r > raioBuscaDeg) continue;
          const m = vel((j + dj) * nx + ix(i + di));
          if (r <= raioBuscaDeg * 0.35) { somaMiolo += m; nMiolo++; }
          else if (m > ventoMax) { ventoMax = m; raioMaxDeg = r; }
        }
      }
      const ventoMiolo = nMiolo ? somaMiolo / nMiolo : 0;

      // O centro tem que ser mais calmo que o anel. Uma linha de cisalhamento
      // (frente) tem vorticidade alta e vento que NÃO cai no meio — sem esta
      // verificação, toda frente fria vira um "ciclone".
      if (!(ventoMiolo < ventoMax * 0.85)) continue;

      achados.push({
        lat: +lat.toFixed(2),
        lng: +((grid.lon0 ?? -180) + i * dLng).toFixed(2),
        zeta: +zb.toExponential(2),
        giro: lat >= 0 ? "anti-horário" : "horário",
        ventoMaxMs: +ventoMax.toFixed(1),
        ventoCentroMs: +ventoMiolo.toFixed(1),
        raioDoMaxDeg: +raioMaxDeg.toFixed(1),
        coriolis: +coriolis(lat).toExponential(2),
      });
    }
  }

  achados.sort((a, b) => Math.abs(b.zeta) - Math.abs(a.zeta));
  return achados.slice(0, maxCentros);
}

/**
 * Classificação pelo vento máximo do anel, na escala Saffir-Simpson estendida
 * para baixo com os termos da OMM.
 *
 * É deliberadamente conservadora e diz o que a escala diz — não promete que o
 * sistema É um ciclone tropical, porque um modelo global não distingue
 * tropical de subtropical de baixa frontal só pelo vento.
 */
export function classificar(ventoMs) {
  if (!Number.isFinite(ventoMs)) return null;
  if (ventoMs >= 70) return { nivel: 5, nome: "vento de categoria 5" };
  if (ventoMs >= 58) return { nivel: 4, nome: "vento de categoria 4" };
  if (ventoMs >= 50) return { nivel: 3, nome: "vento de categoria 3" };
  if (ventoMs >= 43) return { nivel: 2, nome: "vento de categoria 2" };
  if (ventoMs >= 33) return { nivel: 1, nome: "vento de categoria 1" };
  if (ventoMs >= 18) return { nivel: 0, nome: "força de tempestade tropical" };
  return { nivel: -1, nome: "circulação fechada, vento abaixo de tempestade" };
}
