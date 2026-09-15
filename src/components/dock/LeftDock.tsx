// src/components/dock/LeftDock.tsx
// -----------------------------------------------------------------------------
// O PAINEL DE CAMADAS — redesenhado
// -----------------------------------------------------------------------------
// O QUE ESTAVA ERRADO, visto numa captura de tela e não deduzido:
//
// 1. O painel abria oferecendo um CATÁLOGO — 39 campos contínuos, um por linha,
//    todos com o mesmo peso visual. Para descobrir o que estava ligado era
//    preciso rolar a lista inteira procurando o círculo preenchido.
// 2. Cada linha tinha duas alturas: título e uma segunda linha de metadado
//    cinza minúsculo. Multiplicado por 39, o metadado virava textura.
// 3. O cabeçalho de família carregava a REGRA de uso como subtítulo permanente
//    ("um por vez — dividem o mesmo plano de imagem"). É a resposta a uma
//    pergunta que ninguém fez ainda: tooltip, não cabeçalho.
// 4. Nada dizia se a camada ligada tinha dado fresco, velho ou nenhum — e essa
//    informação já existia em `src/dados/estado.ts`.
//
// O PRINCÍPIO DO REDESENHO
//
//   O painel abre dizendo O ESTADO, não oferecendo o catálogo.
//
// Primeiro "no ar": o que está desenhando agora, com procedência e frescor, e
// um X para desligar. Depois, colapsado, o acervo. A família que contém a
// camada ativa abre sozinha; as outras ficam fechadas até serem pedidas.
//
// Nada foi acrescentado para embelezar. O que mudou foi o que aparece
// primeiro, quanto peso cada coisa tem, e o que só aparece quando é pedido.
// -----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import {
  useLayerStore,
  type FieldLayer, type ModelLayer, type SatLayer,
} from "../../store/layerStore";
import { useGlobeStore } from "../../store/globeStore";
import { useUIStore } from "../../store/uiStore";
import { useFontesStore } from "../../store/fontesStore.ts";
import { situacaoEfetiva } from "../../dados/estado.ts";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { FAMILIES, ruleOf, OVERLAY_LAYERS, FIELD_FAMILY, type Family } from "../../design/taxonomy";
import { DensidadeVento } from "./DensidadeVento";
import { MalhaPainel } from "./MalhaPainel";
import { useMalhaStore } from "../../store/malhaStore";

interface ItemRaster {
  id: string;
  titulo: string;
  detalhe?: string;
  kind: "field" | "model" | "sat";
  familia: string;
}

const acentoDa = (id: string) => FAMILIES.find((f) => f.id === id)?.accent ?? "var(--rule-hi)";

export const LeftDock: React.FC = () => {
  const {
    kind, layer, selectLayer, clearLayer,
    fields, sats, models, setFields, setSats, setModels,
    wind, setWind,
    isobarsOn, setIsobarsOn,
    quakesOn, setQuakesOn,
    firesOn, setFiresOn,
    openaqOn, setOpenaqOn,
    hospitalsOn, setHospitalsOn,
    estacoesOn, setEstacoesOn,
    relevoOn, setRelevoOn,
    hycomOn, setHycomOn,
    windInfo, isoInfo, fireInfo, geoInfo,
    openaqInfo, hospitalInfo, hycomInfo, estacoesInfo,
  } = useLayerStore();
  const { modo } = useGlobeStore();
  const malhaAtiva = useMalhaStore((m) => m.ativa);
  const setMalhaAtiva = useMalhaStore((m) => m.setAtiva);
  const malhaErro = useMalhaStore((m) => m.erro);
  const fontes = useFontesStore((s) => s.fontes);

  const { sidebarOpen } = useUIStore();
  const [busca, setBusca] = useState("");
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/imagery").then((r) => r.json())
      .then((d: SatLayer[]) => Array.isArray(d) && d.length > 0 && setSats(d)).catch(() => {});
    fetch("/api/models").then((r) => r.json())
      .then((d: ModelLayer[]) => Array.isArray(d) && d.length > 0 && setModels(d)).catch(() => {});
    fetch("/api/fields").then((r) => r.json())
      .then((d: FieldLayer[]) => Array.isArray(d) && d.length > 0 && setFields(d)).catch(() => {});
  }, [setFields, setSats, setModels]);

  const rasters: ItemRaster[] = useMemo(() => {
    const lista: ItemRaster[] = [
      ...fields.map((f: FieldLayer) => ({
        id: f.id, titulo: f.title,
        detalhe: [f.unit, "GFS 0,25°"].filter(Boolean).join(" · "),
        kind: "field" as const,
        familia: FIELD_FAMILY[f.id] ?? "campo",
      })),
      ...models.map((m: ModelLayer) => ({
        id: m.id, titulo: m.title,
        detalhe: [m.detail, m.coverage?.last && `até ${m.coverage.last.slice(0, 7)}`]
          .filter(Boolean).join(" · "),
        kind: "model" as const, familia: "campo",
      })),
      ...sats.map((s: SatLayer) => ({
        id: s.id, titulo: s.title, detalhe: s.group,
        kind: "sat" as const, familia: "campo",
      })),
    ];
    // Dois títulos iguais de fontes diferentes ficam indistinguíveis na lista.
    const contagem = new Map<string, number>();
    for (const r of lista) contagem.set(r.titulo, (contagem.get(r.titulo) ?? 0) + 1);
    for (const r of lista) {
      if ((contagem.get(r.titulo) ?? 0) > 1) {
        r.titulo = `${r.titulo} — ${r.detalhe?.split("·")[0]?.trim() || r.id}`;
      }
    }
    return lista;
  }, [fields, models, sats]);

  if (!sidebarOpen) return null;

  const q = busca.trim().toLowerCase();
  const filtra = (r: ItemRaster) =>
    !q || (r.titulo + " " + (r.detalhe ?? "") + " " + r.id).toLowerCase().includes(q);

  const overlayEstado: Record<string, [boolean, (v: boolean) => void, string | null]> = {
    wind: [wind, setWind, windInfo],
    // TRÊS CANAIS DE PROCEDÊNCIA JÁ ESTIVERAM MORTOS AQUI: o viewport calculava
    // o texto a cada carga e esta tabela passava `null` no lugar. Foi assim que
    // um campo de correntes com 5,9% de cobertura ficou na tela sem ninguém
    // saber.
    hycom: [hycomOn, setHycomOn, hycomInfo],
    isobars: [isobarsOn, setIsobarsOn, isoInfo],
    quakes: [quakesOn, setQuakesOn, null],
    fires: [firesOn, setFiresOn, fireInfo],
    openaq: [openaqOn, setOpenaqOn, openaqInfo],
    hospitals: [hospitalsOn, setHospitalsOn, hospitalInfo],
    estacoes: [estacoesOn, setEstacoesOn, estacoesInfo],
    relevo: [relevoOn, setRelevoOn, modo === "mapa" ? null : "disponível no modo mapa plano"],
    malha: [malhaAtiva, setMalhaAtiva, modo === "mapa" ? "disponível no modo globo" : malhaErro],
  };

  const rasterAtivo = kind && layer ? rasters.find((r) => r.kind === kind && r.id === layer) ?? null : null;

  /**
   * A família com a camada ativa ABRE SOZINHA, e as outras ficam fechadas.
   *
   * É a diferença entre um painel que mostra onde você está e um que exige que
   * você se localize. Buscar também abre tudo: filtrar e depois ter que expandir
   * grupo por grupo para ver o resultado seria filtrar duas vezes.
   */
  const aberta = (id: string) =>
    abertas[id] ?? (!!q || (rasterAtivo?.familia === id));
  const alterna = (id: string) => setAbertas((a) => ({ ...a, [id]: !aberta(id) }));

  /** O ponto de estado de uma fonte: verde, âmbar, vermelho — ou nada. */
  const Ponto = ({ id }: { id: string }) => {
    const f = fontes[id];
    if (!f) return null;
    const s = situacaoEfetiva(f, Date.now());
    if (s === "ocioso" || s === "carregando") return null;
    return (
      <span
        className={`noar-ponto ${s === "degradado" ? "noar-ponto-velho" : s === "indisponivel" ? "noar-ponto-sem" : ""}`}
        title={f.motivo ?? "atualizado"}
        aria-hidden="true"
      />
    );
  };

  // ---- o que está no ar ----------------------------------------------------
  const noAr: { chave: string; nome: string; meta: string; familia: string; desligar: () => void }[] = [];
  if (rasterAtivo) {
    noAr.push({
      chave: `r:${rasterAtivo.id}`, nome: rasterAtivo.titulo,
      meta: rasterAtivo.detalhe ?? "", familia: rasterAtivo.familia,
      desligar: clearLayer,
    });
  }
  for (const o of OVERLAY_LAYERS) {
    const [on, set] = overlayEstado[o.id] ?? [false, () => {}];
    if (!on) continue;
    noAr.push({
      chave: `o:${o.id}`, nome: o.label,
      meta: [o.unit, o.source].filter(Boolean).join(" · "),
      familia: o.family, desligar: () => set(false),
    });
  }

  const Cabecalho = ({ fam, n, aceso }: { fam: Family; n: number; aceso: boolean }) => (
    <button
      className={`fm-head ${aceso ? "fm-aceso" : ""}`}
      style={{ ["--fam" as string]: fam.accent }}
      onClick={() => alterna(fam.id)}
      aria-expanded={aberta(fam.id)}
      aria-controls={`fm-${fam.id}`}
      // A REGRA DE USO VIRA TOOLTIP. Como subtítulo permanente ela ocupava
      // duas linhas em cada um dos seis grupos respondendo a uma pergunta que
      // ninguém tinha feito ainda.
      title={ruleOf(fam)}
    >
      <span className="fm-fio" aria-hidden="true" />
      <span className="fm-nome">{fam.title}</span>
      <span className="fm-cont">{n}</span>
      {aberta(fam.id)
        ? <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
        : <ChevronRight size={12} strokeWidth={1.6} aria-hidden="true" />}
    </button>
  );

  return (
    <aside className="panel" aria-label="Camadas">
      <div className="dk-busca">
        <input
          type="search" value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar camada, fenômeno ou unidade…"
          aria-label="Buscar camada"
        />
        {q && (
          <span className="dk-achados">
            {rasters.filter(filtra).length} de {rasters.length} camadas
          </span>
        )}
      </div>

      {/* ---- NO AR: o painel abre dizendo o estado ------------------------- */}
      {!q && (
        <section className="noar" aria-label="Camadas no ar">
          <h3 className="noar-tit">No ar</h3>
          {noAr.length === 0 ? (
            <p className="noar-vazio">
              Nenhuma camada ligada. O planeta está sozinho na tela.
            </p>
          ) : (
            <div className="noar-lista">
              {noAr.map((a) => (
                <div key={a.chave} className="noar-item" style={{ ["--fam" as string]: acentoDa(a.familia) }}>
                  <span className="noar-fio" aria-hidden="true" />
                  <Ponto id={a.chave.startsWith("o:") ? a.chave.slice(2) : a.chave.slice(2)} />
                  <span className="noar-txt">
                    <span className="noar-nome">{a.nome}</span>
                    {a.meta && <span className="noar-meta">{a.meta}</span>}
                  </span>
                  <button type="button" className="noar-x" onClick={a.desligar} aria-label={`Desligar ${a.nome}`}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="dock-corpo">
        {/* ---- famílias de RASTER: rádio, porque só cabe uma --------------- */}
        {FAMILIES.filter((f) => f.slot === "raster").map((fam) => {
          const itens = rasters.filter((r) => r.familia === fam.id).filter(filtra);
          if (!itens.length) return null;
          const aceso = rasterAtivo?.familia === fam.id;
          return (
            <section key={fam.id} className="fm">
              <Cabecalho fam={fam} n={itens.length} aceso={aceso} />
              {aberta(fam.id) && (
                <div
                  id={`fm-${fam.id}`} className="fm-itens"
                  role="radiogroup" aria-label={fam.title}
                  style={{ ["--fam" as string]: fam.accent }}
                >
                  {itens.map((r) => {
                    const on = kind === r.kind && layer === r.id;
                    return (
                      <button
                        key={`${r.kind}:${r.id}`} role="radio" aria-checked={on}
                        className={`cm ${on ? "cm-on" : ""}`}
                        onClick={() => (on ? clearLayer() : selectLayer(r.kind, r.id))}
                        title={r.detalhe ? `${r.titulo} · ${r.detalhe}` : r.titulo}
                      >
                        <span className="cm-fio" aria-hidden="true" />
                        <span className="cm-nome">{r.titulo}</span>
                        {r.detalhe && <span className="cm-meta">{r.detalhe.split("·")[0].trim()}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {/* ---- famílias que COMPÕEM: interruptor --------------------------- */}
        {FAMILIES.filter((f) => f.slot !== "raster").map((fam) => {
          const itens = OVERLAY_LAYERS
            .filter((o) => o.family === fam.id)
            .filter((o) => !q || (o.label + " " + (o.source ?? "")).toLowerCase().includes(q));
          if (!itens.length) return null;
          const aceso = itens.some((o) => overlayEstado[o.id]?.[0]);
          return (
            <section key={fam.id} className="fm">
              <Cabecalho fam={fam} n={itens.length} aceso={aceso} />
              {aberta(fam.id) && (
                <div id={`fm-${fam.id}`} className="fm-itens" style={{ ["--fam" as string]: fam.accent }}>
                  {itens.map((o) => {
                    const [on, set, info] = overlayEstado[o.id] ?? [false, () => {}, null];
                    return (
                      <div key={o.id} className="cm-linha">
                        <label className={`cm ${on ? "cm-on" : ""}`} title={o.source ?? o.label}>
                          <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
                          <span className="cm-fio" aria-hidden="true" />
                          <span className="cm-nome">{o.label}</span>
                          {o.unit && <span className="cm-meta">{o.unit}</span>}
                        </label>
                        {/* Procedência, controles e avisos só com a camada
                            ligada: metadado de coisa desligada é ruído, e
                            controle de coisa desligada sugere que faz algo. */}
                        {on && info && <p className="cm-nota">{info}</p>}
                        {on && o.id === "wind" && <DensidadeVento />}
                        {on && o.id === "malha" && modo !== "mapa" && <MalhaPainel />}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {geoInfo && <p className="cm-nota cm-nota-aviso">{geoInfo}</p>}

        {q && rasters.filter(filtra).length === 0 && (
          <p className="dk-vazio">Nenhuma camada casa com “{busca}”.</p>
        )}
      </div>
    </aside>
  );
};
