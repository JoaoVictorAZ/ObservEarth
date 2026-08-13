// src/llm/contexto.ts
// -----------------------------------------------------------------------------
// O DOSSIÊ, ESCRITO PARA SER LIDO POR UM MODELO PEQUENO
// -----------------------------------------------------------------------------
// Até aqui o dossiê ia para o modelo como `JSON.stringify(dados)` inteiro. Um
// 8B recebia cerca de cinco mil caracteres de objeto aninhado — com o `esquema`
// repetindo nome de campo, fonte e descrição, com `nota` explicando decisões de
// implementação, com chaves e aspas ocupando quase metade do espaço — e
// respondia NADA. Nem erro, nem texto: fim de geração no primeiro token.
//
// Não é um bug de biblioteca. É o que modelos pequenos fazem quando a entrada é
// densa demais em estrutura e rala em conteúdo: o custo de atenção vai todo
// para pontuação e o modelo não encontra a pergunta.
//
// Aqui o mesmo dado vira texto tabular. Não se perde nenhum número, nenhuma
// unidade e nenhuma ausência — a regra do projeto continua valendo, `null` vira
// "sem dado" e não some. O que sai é o andaime: aspas, chaves, e metadado que
// descreve o formato em vez de descrever o tempo.
// -----------------------------------------------------------------------------

interface Instante { at?: string; ref?: boolean; valores?: Record<string, number | null>; }
interface Estat {
  n?: number; ausentes?: number;
  min?: number | null; max?: number | null; media?: number | null;
  delta?: number | null; tendencia?: string | null; unidade?: string;
}

/** Só o essencial de cada campo; o resto do `esquema` não ajuda a responder. */
const ROTULO: Record<string, string> = {
  temperatura: "temperatura",
  orvalho: "ponto de orvalho",
  umidade: "umidade",
  pressao: "pressão",
  precipitacao: "precipitação",
  nuvens: "nuvens",
  ventoVel: "vento",
  ventoDir: "direção do vento",
};

const num = (v: unknown): string =>
  v == null || typeof v !== "number" || !Number.isFinite(v) ? "sem dado" : String(v);

/** "2026-08-12T15:00" -> "12/08 15h" */
function hora(at: unknown): string {
  if (typeof at !== "string") return "?";
  const m = at.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}h` : at;
}

export function dossieParaTexto(d: Record<string, unknown> | null): string {
  if (!d) return "SEM DOSSIÊ.";

  const linhas: string[] = [];

  const ponto = d.ponto as { lat?: number; lng?: number; lugar?: string } | undefined;
  const ref = d.referencia as { data?: string; horaUTC?: number; janelaH?: number; passoH?: number } | undefined;

  linhas.push(
    `PONTO: ${ponto?.lugar ?? "sem nome"} (${ponto?.lat ?? "?"}, ${ponto?.lng ?? "?"})`,
  );
  if (ref) {
    linhas.push(`REFERÊNCIA: ${ref.data} ${String(ref.horaUTC ?? "?")}h UTC · janela de ${ref.janelaH}h a cada ${ref.passoH}h`);
  }

  // O campo que move as partículas na tela, quando existe: é o único número que
  // o usuário pode confrontar com o que está vendo.
  const campo = d.campoNoPonto as { ventoVel?: number; ventoDir?: number | null; fonte?: string } | null | undefined;
  if (campo) {
    linhas.push(`VENTO NA GRADE DO MAPA: ${num(campo.ventoVel)} m/s, de ${num(campo.ventoDir)}° (${campo.fonte ?? "?"})`);
  }

  // ---- resumo primeiro -----------------------------------------------------
  // Antes do detalhe, de propósito: é o que responde à maioria das perguntas, e
  // um modelo pequeno presta mais atenção ao começo.
  const resumo = d.resumo as Record<string, Estat> | undefined;
  if (resumo) {
    linhas.push("", "RESUMO DA JANELA (min / máx / média / variação do início ao fim):");
    for (const [k, s] of Object.entries(resumo)) {
      const nome = ROTULO[k] ?? k;
      const u = s.unidade ?? "";
      const falta = s.ausentes ? ` · ${s.ausentes} de ${(s.n ?? 0) + s.ausentes} instantes sem dado` : "";
      linhas.push(
        `- ${nome}: ${num(s.min)} / ${num(s.max)} / ${num(s.media)} ${u} · ` +
        `variou ${num(s.delta)} ${u} (${s.tendencia ?? "sem dado"})${falta}`,
      );
    }
  }

  // ---- série, uma linha por instante ---------------------------------------
  const serie = d.serie as Instante[] | undefined;
  if (Array.isArray(serie) && serie.length) {
    const cols = Object.keys(serie[0]?.valores ?? {});
    linhas.push("", "SÉRIE (temp °C · orvalho °C · umid % · press hPa · chuva mm/h · nuvens % · vento m/s · dir °):");
    for (const p of serie) {
      const vals = cols.map((k) => num(p.valores?.[k])).join(" · ");
      linhas.push(`${hora(p.at)}${p.ref ? " «referência»" : ""}: ${vals}`);
    }
  }

  const lacunas = d.lacunas as string[] | undefined;
  if (Array.isArray(lacunas) && lacunas.length) {
    linhas.push("", "LACUNAS: " + lacunas.join("; "));
  }

  linhas.push("", "Fonte de todos os números: Open-Meteo. 'sem dado' significa ausência real, não zero.");
  return linhas.join("\n");
}

/**
 * Estimativa de tokens, grosseira de propósito.
 *
 * Serve para DIZER ao usuário o tamanho do que foi enviado quando o modelo não
 * responde nada — sem isso, a única informação disponível era "não veio nada",
 * que não ajuda ninguém a decidir o que fazer. Cerca de 3,5 caracteres por
 * token é a média para português com números; não precisa ser exato para
 * cumprir esse papel.
 */
export function tokensAprox(texto: string): number {
  return Math.ceil(texto.length / 3.5);
}
