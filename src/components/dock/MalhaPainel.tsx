// src/components/dock/MalhaPainel.tsx
// -----------------------------------------------------------------------------
// O PAINEL DA CAMADA DE ANÁLISE.
// -----------------------------------------------------------------------------
// Ele mostra três coisas, e a separação entre elas é o ponto:
//
//   O QUE FOI MEDIDO — a procedência, a rodada, a cobertura. Vem do servidor.
//   O QUE FOI CALCULADO — média, desvio, extremos. Vem de `src/malha/`.
//   O QUE FOI ESCOLHIDO — exagero, detalhe, limiar. Vem de quem está olhando.
//
// Misturar os três é como um mapa fica mentindo sem nenhuma linha de código
// errada. Um "exagero de altura" de 0,3 apresentado ao lado de "1.032 hPa" com
// a mesma tipografia sugere que os dois são propriedades do dado.
// -----------------------------------------------------------------------------

import React from "react";
import { useMalhaStore } from "../../store/malhaStore";
import { useLayerStore } from "../../store/layerStore";
import { useUIStore } from "../../store/uiStore";
import type { PontoCritico } from "../../malha/extremos";

const ROTULO_TIPO: Record<string, string> = {
  maximo: "máximo",
  minimo: "mínimo",
  sela: "sela",
};

/** coordenada em grau com hemisfério, como o resto do aplicativo escreve */
function coord(lat: number, lng: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "L" : "O"}`;
  return `${la} ${lo}`;
}

const num = (v: number | null | undefined, casas = 1) =>
  v == null || !Number.isFinite(v)
    ? "sem dado"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const MalhaPainel: React.FC = () => {
  const {
    campoId, setCampoId, passo, setPasso,
    exagero, setExagero, arame, setArame,
    mostrarExtremos, setMostrarExtremos,
    incluirSelas, setIncluirSelas,
    proeminenciaSigma, setProeminenciaSigma,
    campo, escala, resumo, criticos, euler, proveniencia, notaPasso, carregando, erro,
  } = useMalhaStore();

  const { fields } = useLayerStore();
  const unidade = resumo?.unidade ?? "";
  const nota = fields.find((f) => f.id === campoId)?.nota ?? null;
  const focar = useUIStore((u) => u.focar);

  return (
    <div className="mlh">
      <label className="mlh-lin">
        <span className="mlh-rot">Campo</span>
        <select
          className="mlh-sel"
          value={campoId}
          onChange={(e) => setCampoId(e.target.value)}
          aria-label="Campo escalar da malha"
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.title}</option>
          ))}
        </select>
      </label>

      {/* DETALHE. O número não é só desempenho: acima de 1 a grade é
          suavizada, e um recorde de temperatura pode desaparecer no bloco.
          Por isso a nota do servidor é repetida aqui embaixo. */}
      <div className="mlh-lin">
        <span className="mlh-rot">Detalhe</span>
        <div className="mlh-seg" role="radiogroup" aria-label="Resolução da malha">
          {[1, 2, 4, 8].map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={passo === p}
              className={`mlh-seg-btn ${passo === p ? "mlh-seg-on" : ""}`}
              onClick={() => setPasso(p)}
              title={p === 1 ? "resolução nativa do modelo" : `${p}× mais grosso`}
            >
              {p === 1 ? "0,25°" : `${(0.25 * p).toString().replace(".", ",")}°`}
            </button>
          ))}
        </div>
      </div>

      <label className="mlh-lin" htmlFor="mlh-exagero">
        <span className="mlh-rot">
          Relevo
          <output htmlFor="mlh-exagero">{Math.round(exagero * 100)}%</output>
        </span>
        <input
          id="mlh-exagero"
          type="range" min={0} max={0.3} step={0.005}
          value={exagero}
          onChange={(e) => setExagero(Number(e.target.value))}
          aria-label="Exagero vertical da malha"
        />
      </label>

      <label className="mlh-sw">
        <input type="checkbox" checked={arame} onChange={(e) => setArame(e.target.checked)} />
        <span>Mostrar a malha (arame)</span>
      </label>

      <label className="mlh-sw">
        <input
          type="checkbox" checked={mostrarExtremos}
          onChange={(e) => setMostrarExtremos(e.target.checked)}
        />
        <span>Pontos críticos</span>
      </label>

      {mostrarExtremos && (
        <>
          <label className="mlh-sw">
            <input
              type="checkbox" checked={incluirSelas}
              onChange={(e) => setIncluirSelas(e.target.checked)}
            />
            <span>Incluir selas (zonas de deformação)</span>
          </label>

          <label className="mlh-lin" htmlFor="mlh-prom">
            <span className="mlh-rot">
              Proeminência mínima
              {/* O controle é em desvios padrão para funcionar em qualquer
                  campo; a tradução para a unidade fica ao lado porque é ela
                  que a pessoa reconhece. */}
              <output htmlFor="mlh-prom">
                {proeminenciaSigma.toFixed(2)} σ
                {resumo ? ` · ${num(proeminenciaSigma * resumo.desvio, 1)} ${unidade}` : ""}
              </output>
            </span>
            <input
              id="mlh-prom"
              type="range" min={0} max={1.5} step={0.05}
              value={proeminenciaSigma}
              onChange={(e) => setProeminenciaSigma(Number(e.target.value))}
              aria-label="Proeminência mínima em desvios padrão"
            />
          </label>
        </>
      )}

      {/* A RESSALVA DO CAMPO fica ACIMA dos números, e não no rodapé.
          Ela muda o que se pode concluir do que vem a seguir — a pressão ao
          nível do mar sobre a Antártida produz os maiores extremos do planeta
          e nenhum deles é real. Uma nota depois da lista chega tarde. */}
      {nota && <p className="mlh-ressalva">{nota}</p>}

      {/* SEM ESCALA, SEM RELEVO — e agora a tela diz isso.
          A malha se recusa a desenhar sem as paradas da rampa, porque sem elas
          ela pintaria numa cor que não é a do PNG do mesmo campo. Estava certo;
          o que faltava era o aviso. Os números abaixo continuavam aparecendo
          normalmente e só o relevo sumia, sem explicação em lugar nenhum. */}
      {campo && !escala && (
        <p className="mlh-ressalva">
          O relevo não é desenhado sem a escala de cor do campo, que vem do
          catálogo em <code>/api/fields</code>. Os números aqui embaixo valem;
          a superfície no globo, não.
        </p>
      )}

      {carregando && <p className="mlh-nota">carregando a grade de valores…</p>}
      {erro && <p className="mlh-erro">{erro}</p>}

      {resumo && (
        <div className="mlh-res">
          <div className="mlh-num">
            <span className="mlh-num-r">Média (por área)</span>
            <span className="mlh-num-v">{num(resumo.media, 2)} {unidade}</span>
          </div>
          <div className="mlh-num">
            <span className="mlh-num-r">Desvio no espaço</span>
            <span className="mlh-num-v">{num(resumo.desvio, 2)} {unidade}</span>
          </div>
          <div className="mlh-num">
            <span className="mlh-num-r">Máximo global</span>
            <span className="mlh-num-v">
              {num(resumo.maximo.valor, 1)} {unidade}
              <small>{coord(resumo.maximo.lat, resumo.maximo.lng)}</small>
            </span>
          </div>
          <div className="mlh-num">
            <span className="mlh-num-r">Mínimo global</span>
            <span className="mlh-num-v">
              {num(resumo.minimo.valor, 1)} {unidade}
              <small>{coord(resumo.minimo.lat, resumo.minimo.lng)}</small>
            </span>
          </div>
          {resumo.cobertura < 1 && (
            <div className="mlh-num">
              <span className="mlh-num-r">Cobertura</span>
              <span className="mlh-num-v">
                {(resumo.cobertura * 100).toFixed(1)}%
                <small>{resumo.ausentes.toLocaleString("pt-BR")} células sem dado</small>
              </span>
            </div>
          )}
        </div>
      )}

      {mostrarExtremos && criticos.length > 0 && (
        <ul className="mlh-lista">
          {/* A LISTA É NAVEGAÇÃO, não legenda.
              Um mínimo de pressão a 62°S, 143°L é um número que ninguém
              localiza de cabeça. Clicar leva a câmera até lá, e aí a
              anisotropia e a proeminência que a linha declara passam a ser
              coisas que se VÊ no relevo, em vez de adjetivos. */}
          {criticos.slice(0, 12).map((p: PontoCritico, i) => (
            <li key={`${p.i}-${p.j}-${i}`}>
              <button
                type="button"
                className="mlh-pt"
                onClick={() => focar(p.lat, p.lng, 0.55)}
                title={`Ir para ${coord(p.lat, p.lng)}`}
              >
              <span className={`mlh-pt-tipo mlh-pt-${p.tipo}`}>{ROTULO_TIPO[p.tipo]}</span>
              <span className="mlh-pt-val">{num(p.valor, 1)} {unidade}</span>
              <span className="mlh-pt-loc">{coord(p.lat, p.lng)}</span>
              {/* A anisotropia separa cúpula de crista, e é a informação que
                  a lista tem e o pino no globo não consegue mostrar. Onde a
                  Hessiana é indecidível — nos polos, onde 1/cos φ explode — a
                  forma sai como "curvatura indefinida" em vez de um rótulo
                  chutado. O TIPO continua valendo: ele veio da contagem
                  topológica, que não usa curvatura nenhuma. */}
              <span className="mlh-pt-forma">
                {p.hessianaDegenerada || !Number.isFinite(p.anisotropia)
                  ? "curvatura indefinida"
                  : p.anisotropia > 4 ? "alongado" : "isotrópico"}
                {" · Δ"}{num(p.proeminencia, 1)}
              </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* O DIAGNÓSTICO TOPOLÓGICO.
          Não corrige nada: DIZ se a detecção está completa. É a única
          verificação disponível quando não há gabarito — que é sempre o caso
          com dado real. Ver o cabeçalho de src/malha/extremos.ts.

          Os números são os da detecção INTEIRA, sem filtro: é a única forma em
          que a soma pode fechar em 2. A lista acima é a seleção do que vale
          olhar, e é outra coisa. */}
      {euler && (
        <p className={`mlh-euler ${euler.consistente ? "mlh-euler-ok" : "mlh-euler-nao"}`}>
          Σ índices = {euler.caracteristica} · {euler.explicacao}
          <small>
            {euler.maximos.toLocaleString("pt-BR")} máx ·{" "}
            {euler.minimos.toLocaleString("pt-BR")} mín ·{" "}
            {euler.selas.toLocaleString("pt-BR")} selas detectadas na esfera inteira
          </small>
        </p>
      )}

      {notaPasso && <p className="mlh-nota">{notaPasso}</p>}
      {proveniencia && <p className="mlh-nota">{proveniencia}</p>}
    </div>
  );
};
