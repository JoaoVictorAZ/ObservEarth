import { extrairValores, FIELDS } from "./fields.js";
import { empacotarCampo } from "./campoBin.js";

export function reamostrar(values, ni, nj, passo) {
  const p = Math.max(1, Math.floor(passo));
  if (p === 1) return { values, ni, nj };

  const ox = Math.floor(ni / p);
  const oy = Math.floor((nj - 1) / p) + 1;
  const out = new Float32Array(ox * oy);
  const h = p >> 1;

  for (let j = 0; j < oy; j++) {
    const j0 = Math.min(nj - 1, j * p);
    for (let i = 0; i < ox; i++) {
      const i0 = i * p;
      let soma = 0, k = 0;
      for (let dj = -h; dj <= h; dj++) {
        // Latitude TRAVA nos polos: não há linha acima do polo norte, e
        // enrolar ali faria a média do polo incluir o hemisfério oposto.
        const sj = Math.max(0, Math.min(nj - 1, j0 + dj));
        for (let di = -h; di <= h; di++) {
          const si = (((i0 + di) % ni) + ni) % ni;    // longitude ENROLA
          const v = values[sj * ni + si];
          if (!Number.isFinite(v)) continue;
          soma += v; k++;
        }
      }
      out[j * ox + i] = k ? soma / k : NaN;
    }
  }
  return { values: out, ni: ox, nj: oy };
}

export async function buildCampo(fetchImpl, ids, dateStr, hour, opc = {}) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) {
    throw Object.assign(new Error("nenhum campo pedido"), { code: "SEM_CAMPO", status: 400 });
  }
  for (const id of lista) {
    if (!FIELDS[id]) {
      throw Object.assign(
        new Error(`campo desconhecido: ${id}. Disponíveis: ${Object.keys(FIELDS).join(", ")}`),
        { code: "UNKNOWN_FIELD", status: 400 },
      );
    }
  }

  const passo = Math.max(1, Math.min(16, Math.floor(opc.passo ?? 1)));
  const now = opc.now ?? new Date();
  const brutos = [];
  for (const id of lista) {
    brutos.push({ id, ...(await extrairValores(fetchImpl, id, dateStr, hour, now)) });
  }

  const base = brutos[0];
  for (const b of brutos) {
    if (b.ni !== base.ni || b.nj !== base.nj) {
      throw Object.assign(
        new Error(
          `${b.id} veio em ${b.ni}x${b.nj} e ${base.id} em ${base.ni}x${base.nj}. ` +
          "Campos de grades diferentes não podem ir no mesmo pacote — " +
          "comparar exigiria reamostrar, e reamostrar inflaria a correlação.",
        ),
        { code: "GRADES_DIFERENTES", status: 409 },
      );
    }
  }

  const planos = {};
  const unidades = {};
  const titulos = {};
  let ni = base.ni, nj = base.nj;

  for (const b of brutos) {
    const r = reamostrar(b.values, b.ni, b.nj, passo);
    planos[b.id] = r.values;
    ni = r.ni; nj = r.nj;
    unidades[b.id] = b.spec.unit;
    titulos[b.id] = b.spec.title;
  }
  
  const n = ni * nj;
  const valido = new Uint8Array(n);
  let cobertos = 0;
  for (let k = 0; k < n; k++) {
    let bom = true;
    for (const id of lista) if (!Number.isFinite(planos[id][k])) { bom = false; break; }
    valido[k] = bom ? 1 : 0;
    if (bom) cobertos++;
  }

  return empacotarCampo({
    nx: ni,
    ny: nj,
    planos,
    valido,
    unidades,
    titulos,
    stepDeg: +(360 / ni).toFixed(4),
    passo,
    notaPasso: passo > 1
      ? `reamostrado com janela ${2 * (passo >> 1) + 1}x${2 * (passo >> 1) + 1} e ` +
        `decimação de ${passo}: a média da região é preservada, os EXTREMOS não. ` +
        "Peça passo=1 para procurar recordes."
      : null,
    dataset: base.source,
    cycle: base.cycle,
    forecastHour: base.fhr,
    coberturaPct: +((cobertos / n) * 100).toFixed(2),
    gribBytes: brutos.reduce((s, b) => s + (b.bytes ?? 0), 0),
    builtAt: new Date().toISOString(),
  });
}
