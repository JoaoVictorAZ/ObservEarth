// src/captura.ts
// -----------------------------------------------------------------------------
// SALVAR A VISTA EM PNG, E POR QUE A FORMA ÓBVIA DEVOLVE UMA IMAGEM VAZIA.
// -----------------------------------------------------------------------------
// A versão anterior fazia o que todo mundo faz primeiro:
//
//     const canvas = document.querySelector("canvas");
//     a.href = canvas.toDataURL("image/png");
//
// E salvava um PNG em branco. Dois defeitos empilhados.
//
// -----------------------------------------------------------------------------
// 1. O BUFFER DE DESENHO É DESCARTADO DEPOIS DE CADA QUADRO
// -----------------------------------------------------------------------------
// Por padrão o WebGL cria o contexto com `preserveDrawingBuffer: false`. Isso
// não é um detalhe de configuração: é o que permite ao navegador entregar o
// buffer direto ao compositor em vez de copiá-lo. O preço é que, assim que o
// quadro é composto, **o conteúdo do buffer passa a ser indefinido** — na
// prática, limpo.
//
// O clique no botão acontece num evento de usuário, muito depois do último
// quadro ter sido composto. `toDataURL` ali lê um buffer que já não tem nada.
//
// E o modo de falha é cruel: não há erro, não há aviso, não há exceção. O
// download acontece, o arquivo existe, tem o tamanho de um PNG de verdade, e
// está vazio. A pessoa só descobre ao abrir.
//
// **A saída não é ligar `preserveDrawingBuffer`.** Isso obrigaria o navegador a
// manter uma cópia do buffer a CADA quadro, dos 60 por segundo, para servir a
// uma captura que acontece uma vez por sessão — e num app que já mede quadros
// por segundo e degrau de qualidade, pagar isso o tempo todo é o negócio errado.
//
// A saída é DESENHAR DE NOVO, de propósito, e ler no mesmo instante. Dentro de
// um `requestAnimationFrame` o motor renderiza e a leitura acontece antes de o
// quadro ser composto — portanto antes de o buffer ser descartado. Custo: um
// quadro extra, no momento em que alguém pede a foto.
//
// -----------------------------------------------------------------------------
// 2. `querySelector("canvas")` PEGA O PRIMEIRO, NÃO O CERTO
// -----------------------------------------------------------------------------
// Existe mais de um canvas no documento: o motor do globo ou do mapa, e o do
// Recorte 3D quando o painel está aberto. `querySelector` devolve o primeiro em
// ordem de documento, que não é necessariamente o que a pessoa está olhando.
//
// Por isso quem sabe capturar é o MOTOR, que conhece o próprio renderer, a
// própria cena e a própria câmera. Este módulo é só o registro que liga o botão
// da barra ao motor montado — os dois vivem em ramos distantes da árvore, e
// atravessar isso com propriedades seria arrastar o motor por seis componentes
// que não têm nada a ver com ele.
// -----------------------------------------------------------------------------

export interface Capturavel {
  /**
   * Redesenha AGORA e devolve o PNG em data URL.
   *
   * Devolve `null` quando não há o que capturar — motor desmontado, contexto
   * perdido, contêiner de tamanho zero. `null` é resposta, não falha: o
   * chamador avisa em vez de baixar um arquivo vazio.
   */
  capturar(): string | null;
}

let atual: Capturavel | null = null;

/** O motor montado se anuncia. Devolve a função que desfaz o registro. */
export function registrarCapturavel(m: Capturavel): () => void {
  atual = m;
  return () => { if (atual === m) atual = null; };
}

/**
 * O PNG da vista atual, ou `null`.
 *
 * O `requestAnimationFrame` não é enfeite — ver a nota longa acima. Fora dele o
 * desenho e a leitura caem em quadros diferentes, e a leitura encontra o buffer
 * já descartado.
 */
export function capturarVista(): Promise<string | null> {
  const m = atual;
  if (!m) return Promise.resolve(null);
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      try { resolve(m.capturar()); }
      catch { resolve(null); }
    });
  });
}

/** Nome de arquivo com a data e a hora locais, em formato que ordena. */
export function nomeDoArquivo(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `observearth-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
       + `-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

/**
 * Um data URL de PNG que de fato tem pixels.
 *
 * Um canvas vazio produz um PNG válido e curto — a assinatura, o cabeçalho e
 * uma área transparente comprimem para muito pouco. É exatamente o arquivo que
 * o defeito antigo salvava, e ele passa por qualquer verificação de "é um PNG?".
 *
 * O limiar é grosseiro de propósito: não decide se a imagem está BONITA, só
 * separa "tem conteúdo" de "está vazia". Uma vista real do planeta, mesmo
 * pequena, passa de longe.
 */
export function pareceVazio(dataUrl: string | null, minimoBytes = 3000): boolean {
  if (!dataUrl) return true;
  const i = dataUrl.indexOf(",");
  if (i < 0) return true;
  const base64 = dataUrl.slice(i + 1);
  // 4 caracteres de base64 = 3 bytes; o `=` do fim não conta.
  const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  return bytes < minimoBytes;
}
