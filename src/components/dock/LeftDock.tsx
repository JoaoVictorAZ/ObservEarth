// src/components/dock/LeftDock.tsx
// -----------------------------------------------------------------------------
// EXPLORADOR DE CAMADAS — organizado pela NATUREZA do dado.
//
// O QUE MUDOU, E POR QUÊ
//
// A versão anterior agrupava por PROCEDÊNCIA: campos GFS, satélite, modelo,
// sobreposições. Essa é a pergunta de quem construiu o sistema. Quem lê o mapa
// pergunta outra: "o que posso ver ao mesmo tempo, e por que isto parece com
// aquilo?"
//
// Agora o eixo é `src/design/taxonomy.ts`, e a natureza do dado determina três
// coisas de uma vez: a codificação visual, se as camadas coexistem, e qual
// controle é honesto.
//
// O CONTROLE COMO PROMESSA
// Só existe UM plano de imagem no globo. Oferecer temperatura, chuva e WBGT
// como interruptores independentes promete o que não se cumpre: ligar a segunda
// apaga a primeira em silêncio. Rádio não promete — a restrição fica visível na
// FORMA do controle, antes do erro.
//
// E o arquivo perdeu 54 blocos de `style={{}}` e as cores da paleta do Tailwind
// cravadas em hexadecimal (#3b82f6, #60a5fa, #93c5fd), que conviviam com o
// sistema "Instrumento" sem saber dele.
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import {
  useLayerStore,
  type FieldLayer, type ModelLayer, type SatLayer,
} from "../../store/layerStore";
import { useUIStore } from "../../store/uiStore";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FAMILIES, ruleOf, OVERLAY_LAYERS, FIELD_FAMILY, type Family } from "../../design/taxonomy";

/** um item de raster: campo do GFS, camada de modelo ou de satélite */
interface ItemRaster {
  id: string;
  titulo: string;
  detalhe?: string;
  kind: "field" | "model" | "sat";
  familia: string;
}

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
    hycomOn, setHycomOn,
    windInfo, isoInfo, fireInfo, geoInfo,
  } = useLayerStore();

  const { sidebarOpen } = useUIStore();
  const [busca, setBusca] = useState("");
  const [fechadas, setFechadas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Catálogos vêm do servidor; falha deixa a lista padrão do store, que já
    // existe. Uma barra lateral vazia por causa de rede caída seria pior que
    // uma lista incompleta e rotulada.
    fetch("/api/imagery").then((r) => r.json())
      .then((d: SatLayer[]) => Array.isArray(d) && d.length > 0 && setSats(d)).catch(() => {});
    fetch("/api/models").then((r) => r.json())
      .then((d: ModelLayer[]) => Array.isArray(d) && d.length > 0 && setModels(d)).catch(() => {});
    fetch("/api/fields").then((r) => r.json())
      .then((d: FieldLayer[]) => Array.isArray(d) && d.length > 0 && setFields(d)).catch(() => {});
  }, [setFields, setSats, setModels]);

  if (!sidebarOpen) return null;

  // ---- distribui o que existe pelas famílias -----------------------------
  const rasters: ItemRaster[] = [
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
      kind: "model" as const,
      familia: "campo",
    })),
    ...sats.map((s: SatLayer) => ({
      id: s.id, titulo: s.title, detalhe: s.group,
      kind: "sat" as const,
      familia: "campo",
    })),
  ];

  // -------------------------------------------------------------------------
  // TÍTULOS DUPLICADOS.
  //
  // O catálogo da MERRA-2 traz três camadas chamadas exatamente "Poeira" e
  // duas "Evaporação". Três linhas idênticas numa lista de 39 não são uma
  // escolha: são um impasse. A pessoa clica em uma, não é o que queria, e não
  // tem como saber qual das outras é.
  //
  // Quando o título se repete, o detalhe entra no rótulo para desempatar.
  const contagem = new Map<string, number>();
  for (const r of rasters) contagem.set(r.titulo, (contagem.get(r.titulo) ?? 0) + 1);
  for (const r of rasters) {
    if ((contagem.get(r.titulo) ?? 0) > 1) {
      const marca = r.detalhe?.split("·")[0]?.trim() || r.id;
      r.titulo = `${r.titulo} — ${marca}`;
    }
  }

  const q = busca.trim().toLowerCase();
  const filtra = (r: ItemRaster) =>
    !q || (r.titulo + " " + (r.detalhe ?? "") + " " + r.id).toLowerCase().includes(q);

  const overlayEstado: Record<string, [boolean, (v: boolean) => void, string | null]> = {
    wind: [wind, setWind, windInfo],
    hycom: [hycomOn, setHycomOn, null],
    isobars: [isobarsOn, setIsobarsOn, isoInfo],
    quakes: [quakesOn, setQuakesOn, null],
    fires: [firesOn, setFiresOn, fireInfo],
    openaq: [openaqOn, setOpenaqOn, null],
    hospitals: [hospitalsOn, setHospitalsOn, null],
  };

  const alterna = (id: string) => setFechadas((f) => ({ ...f, [id]: !f[id] }));

  const Cabecalho = ({ fam, n }: { fam: Family; n: number }) => (
    <button
      className="fam-head"
      style={{ ["--fam" as string]: fam.accent }}
      onClick={() => alterna(fam.id)}
      aria-expanded={!fechadas[fam.id]}
      aria-controls={`fam-${fam.id}`}
    >
      <span className="fam-fio" aria-hidden="true" />
      <span className="fam-nome">
        {fam.title}
        <small>{ruleOf(fam)}</small>
      </span>
      <span className="fam-cont">{n}</span>
      {fechadas[fam.id]
        ? <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
        : <ChevronDown size={13} strokeWidth={1.5} aria-hidden="true" />}
    </button>
  );

  return (
    <aside className="panel" aria-label="Camadas">
      <div className="dock-busca">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar camada, fenômeno ou unidade…"
          aria-label="Buscar camada"
        />
      </div>

      <div className="dock-corpo">
      {/* ---- famílias de RASTER: rádio, porque só cabe uma ----------------- */}
      {FAMILIES.filter((f) => f.slot === "raster").map((fam) => {
        const itens = rasters.filter((r) => r.familia === fam.id).filter(filtra);
        if (!itens.length) return null;
        return (
          <section key={fam.id} className="fam">
            <Cabecalho fam={fam} n={itens.length} />
            {!fechadas[fam.id] && (
              <div
                id={`fam-${fam.id}`}
                className="fam-itens"
                role="radiogroup"
                aria-label={fam.title}
                style={{ ["--fam" as string]: fam.accent }}
              >
                {itens.map((r) => {
                  const ativo = kind === r.kind && layer === r.id;
                  return (
                    <button
                      key={`${r.kind}:${r.id}`}
                      role="radio"
                      aria-checked={ativo}
                      className={`cam ${ativo ? "cam-on" : ""}`}
                      onClick={() => (ativo ? clearLayer() : selectLayer(r.kind, r.id))}
                      title={r.id}
                    >
                      <span className="cam-marca" aria-hidden="true" />
                      <span className="cam-txt">
                        <span className="cam-titulo">{r.titulo}</span>
                        {r.detalhe && <small>{r.detalhe}</small>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* ---- famílias que COMPÕEM: interruptor ---------------------------- */}
      {FAMILIES.filter((f) => f.slot !== "raster").map((fam) => {
        const itens = OVERLAY_LAYERS
          .filter((o) => o.family === fam.id)
          .filter((o) => !q || (o.label + " " + (o.source ?? "")).toLowerCase().includes(q));
        if (!itens.length) return null;
        return (
          <section key={fam.id} className="fam">
            <Cabecalho fam={fam} n={itens.length} />
            {!fechadas[fam.id] && (
              <div
                id={`fam-${fam.id}`}
                className="fam-itens"
                style={{ ["--fam" as string]: fam.accent }}
              >
                {itens.map((o) => {
                  const [on, set, info] = overlayEstado[o.id] ?? [false, () => {}, null];
                  return (
                    <div key={o.id} className="cam-linha">
                      <label className={`cam cam-sw ${on ? "cam-on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => set(e.target.checked)}
                        />
                        <span className="cam-marca" aria-hidden="true" />
                        <span className="cam-txt">
                          <span className="cam-titulo">{o.label}</span>
                          <small>{[o.unit, o.source].filter(Boolean).join(" · ")}</small>
                        </span>
                      </label>
                      {/* Procedência e cobertura só aparecem quando a camada está
                          ligada: metadado de coisa desligada é ruído. */}
                      {on && info && <p className="cam-info">{info}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {geoInfo && <p className="cam-info cam-aviso">{geoInfo}</p>}

      {q && rasters.filter(filtra).length === 0 && (
        <p className="dock-vazio">Nenhuma camada casa com “{busca}”.</p>
      )}

      </div>

      <p className="dock-rodape">
        Clique em qualquer ponto do globo para abrir a sonda e o terminal.
      </p>
    </aside>
  );
};
