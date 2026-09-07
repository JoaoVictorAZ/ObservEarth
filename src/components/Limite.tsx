// src/components/Limite.tsx
// -----------------------------------------------------------------------------
// O PAINEL QUE QUEBRA NÃO LEVA O RESTO JUNTO.
// -----------------------------------------------------------------------------
// O React tem uma regra dura: erro lançado durante render ou durante um efeito
// e não capturado DESMONTA A ÁRVORE INTEIRA a partir da raiz. Não é uma tela
// vermelha, não é um aviso — a página fica em branco, ou, quando a raiz é um
// pedaço da interface, o pedaço some sem deixar rastro.
//
// Foi assim que "clicar em Recorte 3D da região não faz nada" chegou até aqui.
// A criação da cena WebGL falhava dentro de um efeito, o React desmontava o
// painel, e o clique não produzia janela nenhuma nem mensagem nenhuma. Do lado
// de fora era indistinguível de um botão desligado.
//
// A causa raiz daquele caso está corrigida no próprio painel, que agora prende
// a falha e a escreve no palco. Este componente é a rede POR BAIXO disso: cobre
// o erro que ainda não foi previsto, no painel que ainda não foi escrito.
//
// A escolha de projeto é a mesma do resto do ObservEarth: se a coisa não
// existe, a tela DIZ que não existe. Um painel quebrado que se anuncia é
// infinitamente mais útil que um painel quebrado que desaparece.
// -----------------------------------------------------------------------------

import React from "react";

type Props = {
  /** nome legível do painel, usado na mensagem */
  nome: string;
  children: React.ReactNode;
};

type Estado = { erro: Error | null };

export class Limite extends React.Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: React.ErrorInfo) {
    // O console continua recebendo o rastro completo. A tela recebe a frase
    // curta; quem for depurar precisa da pilha, e ela não cabe num painel.
    console.error(`[${this.props.nome}] quebrou e foi isolado:`, erro, info.componentStack);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="limite-quebrou" role="alert">
        <strong>{this.props.nome} parou de funcionar.</strong>
        <p>{erro.message || String(erro)}</p>
        <p className="limite-nota">
          O restante da tela continua funcionando. O rastro completo está no console
          do navegador.
        </p>
        <button type="button" onClick={() => this.setState({ erro: null })}>
          Tentar montar de novo
        </button>
      </div>
    );
  }
}
