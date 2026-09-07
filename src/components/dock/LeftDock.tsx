import React, { useEffect, useState } from "react";
import {
  useLayerStore,
  type FieldLayer, type ModelLayer, type SatLayer,
} from "../../store/layerStore";
import { useGlobeStore } from "../../store/globeStore";
import { useUIStore } from "../../store/uiStore";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FAMILIES, ruleOf, OVERLAY_LAYERS, FIELD_FAMILY, type Family } from "../../design/taxonomy";
import { DensidadeVento } from "./DensidadeVento";
import { MalhaPainel } from "./MalhaPainel";
import { useMalhaStore } from "../../store/malhaStore";

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
    relevoOn, setRelevoOn,
    hycomOn, setHycomOn,
    windInfo, isoInfo, fireInfo, geoInfo,
    openaqInfo, hospitalInfo, hycomInfo,
  } = useLayerStore();
  const { modo } = useGlobeStore();
  const malhaAtiva = useMalhaStore((m) => m.ativa);
  const setMalhaAtiva = useMalhaStore((m) => m.setAtiva);
  const malhaErro = useMalhaStore((m) => m.erro);

  const { sidebarOpen } = useUIStore();
  const [busca, setBusca] = useState("");
  const [fechadas, setFechadas] = useState<Record<string, boolean>>({});

  useEffect(() => {
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
    // TRÊS CANAIS DE PROCEDÊNCIA ESTAVAM MORTOS AQUI.
    //
    // `setHycomInfo`, `setOpenaqInfo` e `setHospitalInfo` eram chamados pelo
    // viewport a cada carga, e esta tabela passava `null` no lugar deles. O
    // texto era calculado e jogado fora.
    //
    // Não é detalhe cosmético: foi assim que um campo de correntes com 5,9% de
    // cobertura ficou na tela sem ninguém saber. O painel do vento avisa
    // quando a grade cai para 3°; o das correntes não avisava de nada.
    hycom: [hycomOn, setHycomOn, hycomInfo],
    isobars: [isobarsOn, setIsobarsOn, isoInfo],
    quakes: [quakesOn, setQuakesOn, null],
    fires: [firesOn, setFiresOn, fireInfo],
    openaq: [openaqOn, setOpenaqOn, openaqInfo],
    hospitals: [hospitalsOn, setHospitalsOn, hospitalInfo],
    // O relevo é a única camada que ainda depende do modo: o atlas de
    // elevação é reprojetado num plano, e o globo não tem onde recebê-lo.
    // Dizer isso na linha da camada é melhor que um interruptor que liga e
    // não faz nada.
    relevo: [relevoOn, setRelevoOn,
      modo === "mapa" ? null : "disponível no modo mapa plano"],
    // Simétrico ao relevo: a malha de campo escalar existe no GLOBO e não no
    // plano. Ver a nota sobre capacidades opcionais em src/tipos.ts.
    malha: [malhaAtiva, setMalhaAtiva,
      modo === "mapa" ? "disponível no modo globo" : malhaErro],
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
                      {/* O controle de densidade pertence à camada de vento e
                          só aparece com ela ligada: controle de coisa desligada
                          é ruído, e pior, sugere que faz algo agora. */}
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
