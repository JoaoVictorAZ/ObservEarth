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

export function fecharResposta(acumulado: string, abortado: boolean): Fecho {
  const t = acumulado.trim();

  if (t) {
    // Interrompido no meio: o que veio vale, mas não pode passar por resposta
    // completa — alguém leria uma frase cortada como conclusão do modelo.
    return abortado
      ? { texto: `${acumulado}\n\n— interrompido —`, aviso: false }
      : { texto: acumulado, aviso: false };
  }

  return abortado
    ? { texto: "Interrompido antes da primeira palavra.", aviso: true }
    : {
        texto:
          "O modelo terminou sem escrever nada. Costuma ser contexto grande " +
          "demais para a janela dele — tente uma pergunta mais direta, ou um " +
          "modelo maior.",
        aviso: true,
      };
}
