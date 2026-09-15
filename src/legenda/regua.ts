// src/legenda/regua.ts
// -----------------------------------------------------------------------------
// A RÉGUA — o que as cores do mapa significam
// -----------------------------------------------------------------------------
// O app pinta o planeta inteiro com rampas de cor — temperatura, orvalho,
// umidade, pressão, chuva, WBGT — e NUNCA diz o que as cores querem dizer. Não
// existe legenda em lugar nenhum da tela principal. O painel da malha chega a
// declarar isso numa linha de comentário: "A LISTA É NAVEGAÇÃO, não legenda."
//
// O resultado é um mapa bonito e mudo: dá para ver que aquela mancha é
// diferente daquela outra, e não dá para saber se a diferença são dois graus ou
// vinte. Um instrumento que mostra um ponteiro sem escala não é um instrumento.
//
// O DADO JÁ ATRAVESSA A REDE. `server/fields.js` já manda `stops`, `unit`,
// `render` e até um `legend` pronto com pares [cor, rótulo]. Ninguém desenhava.
//
// ---------------------------------------------------------------------------
// A DISTINÇÃO QUE FAZ ESTE ARQUIVO EXISTIR: RAMPA × FAIXAS
// ---------------------------------------------------------------------------
// Duas escalas do catálogo são `render: "faixas"` — chuva e nuvem. Nelas a cor
// NÃO interpola: cada parada vale de si até a próxima, em degrau. Desenhar uma
// escala em degraus como um gradiente suave é uma mentira específica e cara:
// sugere que existe leitura contínua onde há CLASSIFICAÇÃO, e faz a pessoa ler
// "uns 12 mm" numa faixa que diz apenas "entre 10 e 20".
//
// Por isso o gerador de gradiente aqui recebe o modo e produz coisas
// diferentes, e o teste reprova se as duas saírem iguais.
// -----------------------------------------------------------------------------

/** Parada como o servidor manda: valor + RGB em 0–255. */
export type Parada = [valor: number, cor: [number, number, number]];
export type Modo = "rampa" | "faixas";

export interface Escala {
  id: string;
  titulo: string;
  unidade: string;
  stops: Parada[];
  modo: Modo;
  /** abaixo deste valor o campo não é pintado (ex.: chuva < 0,2 mm) */
  piso?: number | null;
  casas?: number;
}

const hex = ([r, g, b]: [number, number, number]) =>
  "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

/** Menor e maior valor da escala. `null` quando ela é degenerada. */
export function dominio(stops: Parada[] | null | undefined): { min: number; max: number } | null {
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const vs = stops.map((s) => s[0]).filter((v) => Number.isFinite(v));
  if (vs.length < 2) return null;
  const min = Math.min(...vs), max = Math.max(...vs);
  // Escala de largura zero não tem régua possível, e dividir por ela produziria
  // um marcador em NaN% — que o navegador ignora, deixando o ponto grudado na
  // borda esquerda como se todo valor fosse o mínimo.
  return max > min ? { min, max } : null;
}

/** Onde um valor cai na régua, 0 a 1. Fora da escala, gruda na ponta. */
export function posicaoDe(valor: number | null | undefined, stops: Parada[]): number | null {
  const d = dominio(stops);
  if (d == null || valor == null || !Number.isFinite(valor)) return null;
  return Math.max(0, Math.min(1, (valor - d.min) / (d.max - d.min)));
}

/**
 * O gradiente CSS da escala.
 *
 * `rampa` produz transição contínua entre paradas. `faixas` repete cada cor até
 * a parada seguinte, produzindo degraus duros — ver o cabeçalho deste arquivo
 * para o porquê de a diferença não ser cosmética.
 */
export function gradienteCSS(stops: Parada[], modo: Modo = "rampa"): string | null {
  const d = dominio(stops);
  if (d == null) return null;

  const ordenadas = [...stops].sort((a, b) => a[0] - b[0]);
  const pct = (v: number) => (((v - d.min) / (d.max - d.min)) * 100).toFixed(2) + "%";
  const partes: string[] = [];

  if (modo === "faixas") {
    for (let i = 0; i < ordenadas.length; i++) {
      const [v, c] = ordenadas[i];
      const fim = i + 1 < ordenadas.length ? ordenadas[i + 1][0] : d.max;
      partes.push(`${hex(c)} ${pct(v)}`, `${hex(c)} ${pct(fim)}`);
    }
  } else {
    for (const [v, c] of ordenadas) partes.push(`${hex(c)} ${pct(v)}`);
  }

  return `linear-gradient(90deg, ${partes.join(", ")})`;
}

export interface Marca { pos: number; rotulo: string; valor: number; }

/**
 * As marcas do eixo.
 *
 * Saem das próprias paradas da escala, e não de uma divisão bonita em partes
 * iguais: as paradas foram escolhidas em valores que significam algo naquela
 * grandeza — 0 °C, 1013 hPa, 100% de umidade. Substituí-las por uma régua
 * regular jogaria fora essa escolha.
 *
 * `limite` existe porque uma escala com doze paradas viraria doze rótulos
 * empilhados em 300 px. Quando há paradas demais, ficam a primeira, a última e
 * as intermediárias mais espaçadas possível.
 */
export function marcasDe(stops: Parada[], casas = 0, limite = 6): Marca[] {
  const d = dominio(stops);
  if (d == null) return [];

  const ordenadas = [...stops].sort((a, b) => a[0] - b[0]);
  let escolhidas = ordenadas;

  if (ordenadas.length > limite) {
    const passo = (ordenadas.length - 1) / (limite - 1);
    escolhidas = Array.from({ length: limite }, (_, i) => ordenadas[Math.round(i * passo)]);
  }

  const vistas = new Set<number>();
  const brutas: Marca[] = [];
  for (const [v] of escolhidas) {
    if (vistas.has(v)) continue;
    vistas.add(v);
    brutas.push({
      valor: v,
      pos: (v - d.min) / (d.max - d.min),
      rotulo: v.toFixed(casas),
    });
  }

  // SEPARAÇÃO MÍNIMA — o defeito estava na tela e não na conta.
  //
  // As paradas da escala não são igualmente espaçadas em VALOR: a do WBGT
  // termina em 31, 34, 35, e os dois últimos rótulos caíam a 6% de distância
  // um do outro, colados na ponta direita da barra. Escolher as paradas é
  // certo — elas significam algo —, mas duas paradas próximas viram um rótulo
  // ilegível, e um rótulo ilegível não significa nada.
  //
  // As PONTAS são intocáveis: elas dizem onde a escala começa e acaba. Quem sai
  // é a vizinha de dentro.
  const MIN = 0.09;
  const mantidas: Marca[] = [];
  for (const m of brutas) {
    const ant = mantidas[mantidas.length - 1];
    if (ant && m.pos - ant.pos < MIN && m.pos < 1) continue;
    // A última parada entra sempre; se ela esbarrar na anterior, a anterior sai.
    if (ant && m.pos - ant.pos < MIN && m.pos >= 1 && mantidas.length > 1) mantidas.pop();
    mantidas.push(m);
  }
  return mantidas;
}

/**
 * O valor formatado para a leitura sob o cursor.
 *
 * Devolve `null` e nunca "—" ou "0": quem decide como desenhar a ausência é a
 * tela, e uma string de espaço reservado vinda daqui viraria um número falso no
 * primeiro lugar que a concatenasse.
 */
export function formatar(valor: number | null | undefined, unidade: string, casas = 1): string | null {
  if (valor == null || !Number.isFinite(valor)) return null;
  return `${valor.toFixed(casas)}${unidade ? " " + unidade : ""}`;
}

/**
 * O valor está abaixo do piso da escala?
 *
 * Campos como chuva têm um piso: abaixo dele o servidor não pinta nada. A régua
 * precisa saber disso para dizer "sem chuva" em vez de marcar o valor na ponta
 * esquerda, que sugeriria a menor classe de chuva onde não há chuva nenhuma.
 */
export function abaixoDoPiso(valor: number | null | undefined, piso: number | null | undefined): boolean {
  return piso != null && Number.isFinite(piso) && valor != null && Number.isFinite(valor) && valor < piso;
}
