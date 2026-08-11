// src/analysis/csv.ts
// -----------------------------------------------------------------------------
// EXPORTAÇÃO EM CSV.
//
// Por que este arquivo tem teste próprio: o botão gera
// `observatorio_historico_10y_<lat>_<lng>.csv`. É o tipo de arquivo que sai da
// tela, entra numa planilha, vira gráfico de tese e nunca mais é conferido
// contra a origem. Depois que sai daqui, ninguém sabe de onde veio.
//
// O QUE A VERSÃO ANTERIOR FAZIA DE ERRADO
//
//   Cabeçalho: "Data,TempMédia(C),...,VentoMáx(km/h),Pressão(hPa)"
//
//   - `Pressão(hPa)` não existia. A coluna vinha de `surface_pressure_mean`,
//     que a API não publica como agregado diário: saía vazia em toda linha,
//     com um cabeçalho prometendo o dado.
//   - `VentoMáx(km/h)` estava em m/s. Fator 3,6, mesmo erro que a sonda tinha.
//   - Sem procedência, sem intervalo, sem unidade padronizada, sem data de
//     obtenção. Uma planilha anônima.
//   - `(C)` em vez de `(°C)`, e vírgula decimal impossível num arquivo separado
//     por vírgula.
//
// AQUI: cabeçalho preambulado com origem e janela, unidade em toda coluna,
// ausência como célula vazia (nunca zero), ponto decimal, e RFC 4180 para as
// aspas.
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
    `# Observatório da Terra — série histórica diária`,
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
