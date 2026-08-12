// src/coord.ts
// -----------------------------------------------------------------------------
// LEITURA DE COORDENADA EM FORMATO LIVRE.
//
// Mora fora do componente para poder ser testado: o Node não processa JSX, e
// um parser de coordenada é exatamente o tipo de código que precisa de teste —
// erra em silêncio e leva a câmera para o lugar errado sem nada quebrar.
//
// A busca anterior não usava parser nenhum além de um regex decimal: era uma
// escada de `if (q.includes("são paulo"))` com cinco cidades. Qualquer outra
// coisa não fazia NADA — sem mensagem, sem erro, sem limpar o campo.
// -----------------------------------------------------------------------------

/**
 * Lê uma coordenada em formato livre.
 *
 * Aceita "-23.55, -46.63", "-23.55 -46.63", "23.55S 46.63W" e "23°33'S".
 * Recusa o que estiver fora da faixa: latitude 91 não é um lugar, e aceitar
 * silenciosamente poria a câmera num ponto que não existe.
 */
export function lerCoordenada(txt: string): { lat: number; lng: number } | null {
  const s = txt.trim().toUpperCase().replace(/,/g, " ").replace(/\s+/g, " ");

  // graus/minutos/segundos com hemisfério
  const dms = /^(\d+(?:\.\d+)?)[°º ]\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([NS])\s+(\d+(?:\.\d+)?)[°º ]\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([EWLO])$/;
  const m1 = dms.exec(s);
  if (m1) {
    const g = (d: string, mi?: string, se?: string) =>
      Number(d) + (mi ? Number(mi) / 60 : 0) + (se ? Number(se) / 3600 : 0);
    const lat = g(m1[1], m1[2], m1[3]) * (m1[4] === "S" ? -1 : 1);
    const lng = g(m1[5], m1[6], m1[7]) * (m1[8] === "W" || m1[8] === "O" ? -1 : 1);
    return dentro(lat, lng);
  }

  // decimal com sufixo de hemisfério
  const suf = /^(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EWLO])$/.exec(s);
  if (suf) {
    return dentro(
      Number(suf[1]) * (suf[2] === "S" ? -1 : 1),
      Number(suf[3]) * (suf[4] === "W" || suf[4] === "O" ? -1 : 1)
    );
  }

  // decimal com sinal
  const dec = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(s);
  if (dec) return dentro(Number(dec[1]), Number(dec[2]));

  return null;
}

function dentro(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
