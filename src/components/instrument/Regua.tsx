// src/components/instrument/Regua.tsx
// -----------------------------------------------------------------------------
// A RÉGUA — a escala do instrumento
// -----------------------------------------------------------------------------
// O app pintava o planeta inteiro com rampas de cor e nunca dizia o que as
// cores significam. Dava para ver que uma mancha era diferente da outra, e não
// dava para saber se a diferença eram dois graus ou vinte.
//
// Esta é a peça que faltava, e ela é TRÊS coisas no mesmo objeto — de
// propósito, porque separadas elas seriam três ruídos e juntas são uma leitura:
//
//   1. A ESCALA      o gradiente da camada ativa, com valores e unidade
//   2. O PONTEIRO    o valor sob o cursor, marcado NA PRÓPRIA escala
//   3. A PROCEDÊNCIA de onde veio e quão fresco está (src/dados/estado.ts)
//
// É a mesma ideia da régua da sonda: a barra não é decoração, é onde o número
// cai. A diferença é que ali a régua é a história de um ponto, e aqui é a
// escala de cor do planeta.
//
// QUANDO NÃO HÁ NÚMERO SOB O CURSOR
//
// Nem toda camada tem valores no cliente. As pintadas como textura de imagem
// chegam como pixels, e pixel não é medida — ler a cor de volta e converter em
// número seria inventar precisão a partir de uma rampa comprimida em 8 bits.
// Nesses casos a escala aparece sem ponteiro, e a tela diz que a leitura
// contínua não está disponível para aquela camada. Ficar em branco faria
// parecer defeito; mostrar um número reconstruído da cor seria pior.
// -----------------------------------------------------------------------------

import React from "react";
import {
  gradienteCSS, marcasDe, posicaoDe, formatar, abaixoDoPiso, dominio,
  type Parada, type Modo,
} from "../../legenda/regua.ts";
import { situacaoEfetiva, frase as fraseDaFonte, type Fonte } from "../../dados/estado.ts";

export interface ReguaProps {
  /** título da camada ativa; sem ele a régua não aparece */
  titulo: string | null;
  unidade: string;
  stops: Parada[] | null | undefined;
  modo?: Modo;
  piso?: number | null;
  casas?: number;
  /** valor sob o cursor; `null` quando não há cursor ou não há número */
  valor?: number | null;
  /** a leitura contínua é possível nesta camada? */
  amostravel?: boolean;
  /** coordenada sob o cursor, para a linha de baixo */
  coord?: { lat: number; lng: number } | null;
  fonte?: Fonte | null;
  procedencia?: string | null;
}

const grau = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;

export const Regua: React.FC<ReguaProps> = ({
  titulo, unidade, stops, modo = "rampa", piso = null, casas = 1,
  valor = null, amostravel = true, coord = null, fonte = null, procedencia = null,
}) => {
  const paradas = stops ?? [];
  const gradiente = gradienteCSS(paradas, modo);
  const d = dominio(paradas);

  // Sem título ou sem escala utilizável não há régua. Desenhar uma barra
  // cinza vazia ocuparia o mesmo espaço afirmando que existe uma escala.
  if (!titulo || !gradiente || !d) return null;

  const marcas = marcasDe(paradas, casas === 0 ? 0 : Math.min(1, casas));
  const pos = posicaoDe(valor, paradas);
  const seco = abaixoDoPiso(valor, piso);
  const lido = formatar(valor, unidade, casas);
  const agora = Date.now();
  const sit = fonte ? situacaoEfetiva(fonte, agora) : "pronto";

  return (
    <section className="regua" aria-label={`Escala de ${titulo}`}>
      <header className="regua-topo">
        <h3 className="regua-tit">{titulo}</h3>
        <span className="regua-un">{unidade}</span>

        <span className="regua-leitura">
          {/* A LEITURA É O ELEMENTO MAIS PESADO DA RÉGUA quando existe, e some
              inteira quando não existe. Um traço fixo no lugar dela treinaria
              o olho a ignorar a posição. */}
          {/* TRÊS AUSÊNCIAS DIFERENTES, e a captura de tela provou que eu tinha
              juntado duas. Com o ponteiro fora do planeta a régua dizia
              "indisponível NESTA CAMADA" — acusando a camada de um limite que
              é do cursor. Quem lê isso conclui que o vento não tem leitura
              contínua, quando ele tem. */}
          {coord == null ? (
            <em className="regua-sem">passe o cursor sobre o planeta</em>
          ) : !amostravel ? (
            <em className="regua-sem">esta camada não tem leitura contínua</em>
          ) : seco ? (
            <em className="regua-sem">abaixo de {formatar(piso, unidade, casas)}</em>
          ) : lido ? (
            <strong>{lido}</strong>
          ) : (
            <em className="regua-sem">sem medida neste ponto</em>
          )}
        </span>
      </header>

      <div className="regua-barra">
        <div className="regua-faixa" style={{ background: gradiente }} aria-hidden="true" />

        {/* O ponteiro fica NA escala, e não ao lado dela. É o que transforma
            um número solto em posição — a mesma ideia da régua da sonda. */}
        {pos != null && amostravel && !seco && (
          <span className="regua-ponteiro" style={{ left: `${(pos * 100).toFixed(2)}%` }} aria-hidden="true" />
        )}

        <div className="regua-marcas" aria-hidden="true">
          {marcas.map((m) => (
            <span key={m.valor} className="regua-marca" style={{ left: `${(m.pos * 100).toFixed(2)}%` }}>
              {m.rotulo}
            </span>
          ))}
        </div>
      </div>

      <footer className="regua-pe">
        {coord && <span className="regua-coord">{grau(coord.lat, "N", "S")} {grau(coord.lng, "L", "O")}</span>}
        {procedencia && <span className="regua-fonte">{procedencia}</span>}
        {fonte && sit !== "pronto" && (
          <span className={`regua-estado ${sit === "indisponivel" ? "regua-estado-falha" : ""}`}>
            {fraseDaFonte(fonte, agora)}
          </span>
        )}
      </footer>
    </section>
  );
};
