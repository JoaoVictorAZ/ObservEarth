// src/globo/sol.ts
// -----------------------------------------------------------------------------
// ONDE O SOL ESTÁ A PINO
// -----------------------------------------------------------------------------
// O ponto subsolar — a latitude e a longitude onde o Sol está exatamente no
// zênite — define o terminador, que é a única linha do globo que não é dado
// medido e mesmo assim é informação: ela diz onde é noite AGORA.
//
// Isto estava embutido em `globe.ts`, dentro do método que posiciona a luz, e
// por isso nunca foi verificado contra uma efeméride. Está aqui fora e puro
// justamente para poder ser: nos equinócios a declinação tem que passar perto
// de zero, nos solstícios perto de ±23,44°, e ao meio-dia UTC a longitude
// subsolar tem que cair perto de Greenwich.
//
// A PRECISÃO DECLARADA
//
// É a fórmula de baixa precisão: declinação por cosseno do dia do ano e ângulo
// horário médio, sem equação do tempo. O erro fica em torno de 0,5° na
// declinação e chega a ~4° de longitude perto de novembro, onde a equação do
// tempo é máxima (±16 minutos). Para desenhar um terminador de milhares de
// quilômetros de largura aparente isso é irrelevante — para calcular nascer do
// sol em um lugar, não seria, e por isso nada aqui deve ser usado para isso.
// -----------------------------------------------------------------------------

/** Obliquidade da eclíptica, em graus. */
export const OBLIQUIDADE = 23.44;

export interface Subsolar { lat: number; lng: number; }

/** Dia do ano, 1 a 366, em UTC. */
export function diaDoAno(d: Date): number {
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  const hoje = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((hoje - inicio) / 86400e3) + 1;
}

/**
 * Declinação solar aproximada, em graus.
 *
 * O deslocamento de 10 dias ancora o mínimo no solstício de dezembro (por volta
 * do dia 21/22) em vez de em 1º de janeiro. Sem ele a curva inteira fica
 * defasada em uma semana e meia, o que no equinócio — onde a declinação varia
 * mais rápido — vale quase 4° de latitude no terminador.
 */
export function declinacao(d: Date): number {
  const doy = diaDoAno(d);
  return -OBLIQUIDADE * Math.cos((2 * Math.PI / 365) * (doy + 10));
}

/**
 * Ponto subsolar.
 *
 * A longitude vem do ângulo horário: ao meio-dia UTC o Sol está sobre
 * Greenwich, e cada hora o desloca 15° para oeste. O resultado é normalizado
 * para (−180, 180] porque é assim que o resto do projeto trata longitude — sem
 * isso, à meia-noite UTC sai 180 ou −180 conforme o arredondamento, e uma
 * comparação de intervalo dá a volta no mundo.
 */
export function pontoSubsolar(d: Date): Subsolar {
  const horas = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  // A conta bruta cai em [−180, 180) e à meia-noite UTC dá exatamente −180.
  // É o mesmo meridiano que +180, mas o sinal muda o lado em toda comparação de
  // intervalo — o antimeridiano é a emenda, e é ali que ele passa uma vez por
  // dia. Dobrando para (−180, 180], a emenda deixa de coincidir com o valor.
  const bruto = ((-15 * (horas - 12) + 180) % 360 + 360) % 360;
  const lng = bruto === 0 ? 180 : bruto - 180;
  return { lat: declinacao(d), lng };
}

/**
 * O mesmo ponto como vetor unitário, no referencial em que o eixo Y é o polo
 * norte e a longitude 0 aponta para +Z — a convenção do three-globe.
 *
 * Devolver o vetor pronto evita que cada chamador refaça a trigonometria com
 * uma convenção ligeiramente diferente, que é como um terminador acaba espelhado.
 */
export function vetorSolar(d: Date): [number, number, number] {
  const { lat, lng } = pontoSubsolar(d);
  const fi = (lat * Math.PI) / 180;
  const lb = (lng * Math.PI) / 180;
  return [Math.cos(fi) * Math.sin(lb), Math.sin(fi), Math.cos(fi) * Math.cos(lb)];
}
