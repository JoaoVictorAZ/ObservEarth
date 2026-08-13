// src/llm/falhas.ts
// -----------------------------------------------------------------------------
// FALHAS DE GPU, TRADUZIDAS
// -----------------------------------------------------------------------------
// O que o navegador entrega é isto:
//
//   Failed to execute 'requestDevice' on 'GPUAdapter': D3D12 create command
//   queue failed with DXGI_ERROR_DEVICE_REMOVED (0x887A0005) at
//   CheckHRESULTImpl (..\..\third_party\dawn\src\dawn\native\d3d\D3DError.cpp:119)
//
// Um caminho de arquivo do Dawn e um código hexadecimal não dizem a ninguém o
// que fazer. Pior: mostrados dentro de um seletor de modelos, sugerem que o
// problema é o modelo — e a pessoa desce a lista inteira sem sair do lugar, que
// foi exatamente o que aconteceu aqui.
//
// Cada entrada abaixo é uma falha que vimos de verdade, com a ação que resolve.
// Nenhuma foi inventada para completar a tabela.
// -----------------------------------------------------------------------------

export interface Explicacao {
  /** o que aconteceu, em uma frase */
  causa: string;
  /** o que fazer, na ordem */
  acao: string;
  /** false quando trocar de modelo não adianta — e aí o seletor diz isso */
  trocarModeloAjuda: boolean;
}

export function explicarFalhaGpu(mensagem: string): Explicacao | null {
  const m = (mensagem ?? "").toLowerCase();

  // ---------------------------------------------------------------------
  // DISPOSITIVO REMOVIDO, na CRIAÇÃO do dispositivo.
  //
  // Acontece ANTES de qualquer peso ser carregado, então não tem relação com o
  // tamanho do modelo. O driver derrubou a GPU — normalmente por um travamento
  // anterior (o TDR do Windows reinicia a placa depois de ~2 s sem resposta) —
  // e o processo gráfico do navegador ficou preso a um adaptador morto.
  //
  // Recarregar a aba NÃO resolve: o processo de GPU sobrevive à aba. É preciso
  // fechar o navegador inteiro.
  // ---------------------------------------------------------------------
  if (m.includes("device_removed") || m.includes("device removed")
      || (m.includes("requestdevice") && m.includes("failed"))) {
    return {
      causa:
        "O driver removeu a GPU e o navegador ficou preso a um adaptador morto. " +
        "Isto acontece antes de qualquer peso ser carregado — não tem relação " +
        "com o tamanho do modelo.",
      acao:
        "Feche o navegador POR COMPLETO (recarregar a aba não basta: o processo " +
        "de GPU sobrevive a ela) e abra de novo. Se voltar a acontecer sem usar " +
        "o terminal, é a placa ou o driver, não este app.",
      trocarModeloAjuda: false,
    };
  }

  // ---------------------------------------------------------------------
  // DISPOSITIVO PERDIDO, durante o uso.
  //
  // Aqui sim o tamanho importa: os pesos não couberam e a alocação derrubou o
  // dispositivo no meio da geração.
  // ---------------------------------------------------------------------
  if (m.includes("device was lost") || m.includes("device is lost") || m.includes("devicelost")) {
    return {
      causa: "A GPU perdeu o dispositivo durante o uso, quase sempre por falta de VRAM.",
      acao: "Desça um degrau na lista de modelos. Se já estiver no menor, feche o navegador e tente de novo.",
      trocarModeloAjuda: true,
    };
  }

  if (m.includes("out of memory") || m.includes("oom")) {
    return {
      causa: "A memória da GPU acabou ao alocar os pesos.",
      acao: "Escolha um modelo menor, e feche outras abas que usem vídeo ou 3D.",
      trocarModeloAjuda: true,
    };
  }

  if (m.includes("webgpu") && (m.includes("not supported") || m.includes("undefined"))) {
    return {
      causa: "Este navegador não expõe WebGPU.",
      acao: "Use Chrome ou Edge 113+, ou Safari 18+. O resto do app funciona sem isto.",
      trocarModeloAjuda: false,
    };
  }

  return null;
}
