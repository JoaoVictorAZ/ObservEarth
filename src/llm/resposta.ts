// src/llm/resposta.ts
// -----------------------------------------------------------------------------
// O FECHAMENTO DE UMA RESPOSTA
// -----------------------------------------------------------------------------
// Existe porque a bolha vazia era o sintoma mais confuso do terminal: a
// pergunta aparecia, o modelo respondia nada, e ficava na tela uma faixa
// escura sem uma palavra — indistinguível de uma resposta que sumiu.
//
// Três finais diferentes chegavam ao mesmo retângulo em branco:
//   - o usuário apertou "parar" antes do primeiro token
//   - o modelo terminou sem emitir texto
//   - a geração morreu no meio, já com algum texto na tela
//
// Nenhum deles é "sem resposta". Cada um merece dizer o que aconteceu, pela
// mesma razão que um campo sem dado escreve "sem dado" em vez de zero.
// -----------------------------------------------------------------------------

export interface Fecho {
  /** o que fica na bolha */
  texto: string;
  /** true quando o texto é um aviso nosso, não saída do modelo */
  aviso: boolean;
}

/** O que se sabe sobre a geração, para o aviso não ser um chute. */
export interface Diagnostico {
  /** tokens estimados do que foi enviado */
  tokensEnviados?: number;
  /** `finish_reason` do modelo: "stop", "length", "abort"… */
  motivo?: string | null;
}

export function fecharResposta(
  acumulado: string, abortado: boolean, diag: Diagnostico = {},
): Fecho {
  const t = acumulado.trim();

  if (t) {
    // Interrompido no meio: o que veio vale, mas não pode passar por resposta
    // completa — alguém leria uma frase cortada como conclusão do modelo.
    return abortado
      ? { texto: `${acumulado}\n\n— interrompido —`, aviso: false }
      : { texto: acumulado, aviso: false };
  }

  if (abortado) return { texto: "Interrompido antes da primeira palavra.", aviso: true };

  // O AVISO DIZ O QUE SE SABE, E SÓ ISSO.
  //
  // A primeira versão daqui afirmava "costuma ser contexto grande demais —
  // tente um modelo maior". As duas metades estavam erradas: o usuário já
  // estava no maior modelo da lista, e o dossiê medido dava cerca de 1.100
  // tokens numa janela de 4.096. Foi um palpite vestido de diagnóstico, que é
  // pior que não dizer nada — manda a pessoa perseguir a causa errada.
  const partes = ["O modelo terminou sem escrever nada."];
  if (diag.motivo) partes.push(`Motivo relatado pelo modelo: "${diag.motivo}".`);
  if (diag.tokensEnviados) partes.push(`Foram enviados ~${diag.tokensEnviados} tokens.`);
  // O caso mais comum, e o que nos custou várias rodadas para identificar: a
  // GPU perdeu o dispositivo por falta de VRAM. Do nosso lado isso chega como
  // silêncio, não como erro — então o aviso precisa apontar o console, onde a
  // mensagem existe, e o botão que resolve.
  partes.push(
    "Se o console do navegador mostrar \"Device was lost\", a GPU não aguentou " +
    "este modelo: use o botão de trocar modelo, no topo, e desça um degrau. " +
    "Fora isso, reformular a pergunta costuma destravar.",
  );

  return { texto: partes.join(" "), aviso: true };
}
