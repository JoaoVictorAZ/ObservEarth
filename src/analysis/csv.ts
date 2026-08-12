// src/analysis/csv.ts
// -----------------------------------------------------------------------------
// Exportação de séries temporais diárias para CSV (RFC 4180).
// -----------------------------------------------------------------------------

export interface SerieDiaria {
  intervalo: { start: string; end: string; dias: number };
  variaveis: string[];
  unidades: Record<string, string>;
  rotulos: Record<string, string>;
  serie: Record<string, unknown> & { time: string[] };
  fonte: string;
  obtidoEm: string;
  lacunas?: string[];
}

/** RFC 4180: só cita quando precisa, e duplica a aspa interna */
export function celula(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Ausência é célula VAZIA.
 *
 * Zero é um valor: "0 mm" significa que não choveu, e é diferente de "não
 * sabemos se choveu". Numa planilha esses dois viram a mesma coisa se o
 * exportador escrever 0 — e a média da coluna muda.
 */
function num(v: unknown): string {
  return v == null || typeof v !== "number" || !Number.isFinite(v) ? "" : String(v);
}

export function paraCSV(d: SerieDiaria, contexto: { place: string; lat: number; lng: number }): string {
  const hemi = (x: number, pos: string, neg: string) =>
    `${Math.abs(x).toFixed(4)}${x >= 0 ? pos : neg}`;

  // Preâmbulo comentado: quem abrir o arquivo daqui a um ano precisa saber de
  // onde ele veio sem ter o aplicativo à mão.
  const preambulo = [
    `# ObservEarth — série histórica diária`,
    `# Local: ${contexto.place}`,
    `# Coordenadas: ${hemi(contexto.lat, "N", "S")} ${hemi(contexto.lng, "L", "O")}`,
    `# Intervalo: ${d.intervalo.start} a ${d.intervalo.end} (${d.intervalo.dias} dias)`,
    `# Fonte: ${d.fonte}`,
    `# Obtido em: ${d.obtidoEm}`,
    `# Célula vazia = sem dado na fonte. Nunca estimado, nunca zero por omissão.`,
    ...(d.lacunas?.length ? d.lacunas.map((l) => `# Lacuna: ${l}`) : []),
  ].join("\n");

  const cabecalho = ["Data (UTC)", ...d.variaveis.map((v) => `${d.rotulos[v]} (${d.unidades[v]})`)]
    .map(celula).join(",");

  const linhas = d.serie.time.map((t, i) =>
    [t, ...d.variaveis.map((v) => num((d.serie[v] as (number | null)[] | undefined)?.[i]))]
      .map(celula).join(","));

  // Fim de linha CRLF e BOM ficam a cargo de quem grava o Blob; aqui só o texto.
  return `${preambulo}\n${cabecalho}\n${linhas.join("\n")}\n`;
}

export function baixar(texto: string, nome: string) {
  // BOM para o Excel abrir os acentos e o grau corretamente. Sem ele,
  // "Temperatura média (°C)" vira "TemperaturaÂ mÃ©dia".
  const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
