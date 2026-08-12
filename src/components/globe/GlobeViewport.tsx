// src/components/globe/GlobeViewport.tsx
// -----------------------------------------------------------------------------
// MOTOR DO GLOBO E CONTAINER DE VISUALIZAÇÃO THREE.JS (ZUSTAND & OPEN DATA)
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { useGlobeStore } from "../../store/globeStore";
import { usePerfStore } from "../../store/perfStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useLayerStore } from "../../store/layerStore";
import { useProbeStore, type Probe } from "../../store/probeStore";
import { GlobeEngine } from "../../globe";
import { MapEngine } from "../../mapa2d";
import type { Quake, Fire, IsobarSet, WindGrid, MotorGeo } from "../../tipos";

export interface GlobeViewportRef {
  flyTo: (lat: number, lng: number) => void;
}

function isValidWindGrid(g: unknown): g is WindGrid {
  if (!g || typeof g !== "object") return false;
  const w = g as Record<string, unknown>;
  return (
    typeof w.nx === "number" && w.nx > 0 &&
    typeof w.ny === "number" && w.ny > 0 &&
    Array.isArray(w.u) && w.u.length >= (w.nx as number) * (w.ny as number) &&
    Array.isArray(w.v) && w.v.length >= (w.nx as number) * (w.ny as number)
  );
}

export const GlobeViewport = forwardRef<GlobeViewportRef, {}>((_, ref) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const engRef = useRef<MotorGeo | null>(null);

  const { dayNight, rotate, windDensity, modo } = useGlobeStore();
  // sobe a cada troca de motor; força todas as camadas a se reaplicarem
  const [geracao, setGeracao] = useState(0);
  const { day, hour } = useTimelineStore();
  const {
    kind, layer, opacity,
    wind, isobarsOn, quakesOn, firesOn, openaqOn, wbgtOn,
    hospitalsOn, hycomOn,
    setWindInfo, setIsoInfo, setFireInfo, setOpenaqInfo,
    setHospitalInfo, setHycomInfo, setGeoInfo,
  } = useLayerStore();

  const { setProbe, setProbing } = useProbeStore();

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number) => {
      const eng = engRef.current;
      if (!eng) return;
      // A câmera precisa IR. Isto faltava: a busca e o botão "centralizar em
      // 0°, 0°" marcavam o ponto e pediam a sonda, mas a vista não saía do
      // lugar — o botão prometia no rótulo algo que não acontecia.
      eng.flyTo(lat, lng);
      eng.setClickMarker(lat, lng);
      setProbing(true);
      fetch(`/api/probe?lat=${lat}&lng=${lng}&date=${day}&hour=${hour}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p: Probe | null) => { setProbe(p); setProbing(false); })
        .catch(() => setProbing(false));
    },
  }));

  // ---------------------------------------------------------------------
  // MONTAGEM DO MOTOR — globo ou mapa plano, conforme o modo.
  //
  // `geracao` sobe a cada troca. Todo efeito de camada depende dela: sem isso
  // o motor novo nasceria vazio, porque os efeitos que ligam vento, imagem e
  // marcadores não têm motivo para rodar de novo — as camadas escolhidas não
  // mudaram, só quem as desenha. O sintoma seria uma tela preta que "conserta"
  // sozinha quando o usuário mexe em qualquer coisa.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!boxRef.current) return;
    const caixa = boxRef.current;
    const eng: MotorGeo = modo === "mapa" ? new MapEngine() : new GlobeEngine();
    eng.mount(caixa);
    engRef.current = eng;

    // Falhas internas do globo (contornos que não baixaram, por exemplo) vão
    // para a barra de status. Sem este canal elas eram engolidas por um
    // `catch {}` e o mapa ficava sem estados sem dizer por quê — indistinguível
    // de um mapa onde aquelas fronteiras simplesmente não existem.
    eng.onNotice((msg) => setGeoInfo(msg));

    // Estado real do motor para o painel de diagnóstico, que exibia números
    // cravados em texto — 2x, 131.072 partículas, "anisotrópica 8x" — vindos de
    // lugar nenhum.
    //
    // Isto TEM que morar aqui dentro. Num efeito próprio, declarado antes do de
    // montagem, `engRef.current` ainda é null quando ele roda: o React executa
    // os efeitos na ordem de declaração. Ele retornaria cedo, em silêncio, e o
    // painel ficaria eternamente em "aguardando o primeiro quadro".
    //
    // Amostrado a cada ~500 ms: é leitura de painel, não precisa de 60 Hz, e
    // re-renderizar o cabeçalho a cada quadro custaria mais que o que ele mede.
    let ultimoStat = 0;
    eng.onStats((st) => {
      const agora = performance.now();
      if (agora - ultimoStat < 500) return;
      ultimoStat = agora;
      usePerfStore.getState().setStats(st);
    });

    // NÃO ligar camada nenhuma aqui. Havia um `setWindVisible(true)` fixo, que
    // ignorava o estado da loja: o vento nascia ligado mesmo com o botão
    // desligado, e só apagava se algo mais tarde o desligasse por acaso. Cada
    // camada é ligada pelo seu próprio efeito, a partir do seu próprio estado —
    // é a única forma de o que está na tela corresponder ao que está marcado.

    setGeracao((g) => g + 1);
    return () => {
      eng.dispose();
      engRef.current = null;
      // Container limpo entre motores. Cada um cria a sua própria tela, e o
      // `_destructor` do globe.gl não promete remover o DOM que montou —
      // sem isto, alternar de modo empilharia telas mortas por baixo da viva.
      caixa.replaceChildren();
    };
  }, [modo]);

  // Evento de clique
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    eng.onClick((lat: number, lng: number) => {
      eng.setClickMarker(lat, lng);
      setProbing(true);
      fetch(`/api/probe?lat=${lat}&lng=${lng}&date=${day}&hour=${hour}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p: Probe | null) => { setProbe(p); setProbing(false); })
        .catch(() => setProbing(false));
    });
  }, [day, hour, setProbe, setProbing, geracao]);

  // Vento (Garante setWindVisible(true) e setWind(data))
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!wind) {
      eng.setWindVisible(false);
      setWindInfo(null);
      return;
    }

    let alive = true;
    setWindInfo("Baixando campo de vento…");
    fetch(`/api/wind?date=${day}&hour=${hour}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: WindGrid) => {
        if (!alive) return;
        if (!isValidWindGrid(data)) throw new Error("objeto de vento malformado");
        eng.setWindVisible(true);
        eng.setWind(data, `${day}:${hour}`);

        // -------------------------------------------------------------------
        // A PROCEDÊNCIA VEM DA RESPOSTA, NÃO DE UM LITERAL.
        //
        // Esta linha era `setWindInfo("NOAA GFS 0.25° · 100% medido")` — fixa,
        // sempre, independente do que o servidor tivesse devolvido. E o
        // servidor tem DOIS caminhos:
        //
        //   GFS GRIB2 nativo  ->  0,25°  (1440x721, célula de ~28 km)
        //   Open-Meteo        ->  3,0°   (120x60,  célula de ~333 km)
        //
        // O segundo é 144x mais grosso em área, e entra sozinho em dois casos:
        // data anterior ao que o NOMADS ainda guarda (~10 dias de ciclos), e
        // disjuntor aberto depois de três falhas seguidas do GFS — que derruba
        // TODA data, inclusive hoje, até o período de espera passar.
        //
        // Numa grade de 3° o núcleo de um ciclone tropical (200 a 400 km) cabe
        // em UMA célula: ele é suavizado até sumir. E a rajada local de uma
        // baía vira a média de 333 km de oceano em volta.
        //
        // Com o rótulo cravado, essa troca era invisível. A tela afirmava a
        // procedência de um dado que não estava ali — que é a mesma coisa que
        // um número inventado, só que com nome de agência.
        const passo = typeof data.stepDeg === "number" ? data.stepDeg : null;
        const grosso = passo != null && passo > 0.5;
        const medido = typeof data.measuredPct === "number" ? data.measuredPct : null;

        setWindInfo(
          [
            data.provider ?? "procedência não declarada",
            passo != null ? `${passo.toString().replace(".", ",")}°` : null,
            data.dataset ?? null,
            medido != null ? `${medido}% medido` : null,
            grosso ? "⚠ campo grosso: ciclones e rajadas locais não aparecem nesta grade" : null,
          ].filter(Boolean).join(" · ")
        );
      })
      .catch((err) => {
        if (!alive) return;
        eng.setWindVisible(false);
        setWindInfo(`vento indisponível: ${String(err)}`);
      });
    return () => { alive = false; };
  }, [wind, day, hour, setWindInfo, geracao]);

  // Isóbaras (Garante setIsobarsVisible(true) e setIsobars(data))
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!isobarsOn) {
      eng.setIsobarsVisible(false);
      setIsoInfo(null);
      return;
    }
    let alive = true;
    setIsoInfo("Baixando MSLP...");
    fetch(`/api/isobars?date=${day}&hour=${hour}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: IsobarSet) => {
        if (!alive) return;
        eng.setIsobarsVisible(true);
        eng.setIsobars(data);
        const ptStr = data.points ? ` · ${data.points} pts` : "";
        setIsoInfo(`MSLP ${data.step} hPa (${data.min}~${data.max} hPa${ptStr})`);
      })
      .catch((err) => {
        if (!alive) return;
        eng.setIsobarsVisible(false);
        setIsoInfo(`erro: ${String(err)}`);
      });
    return () => { alive = false; };
  }, [isobarsOn, day, hour, setIsoInfo, geracao]);

  // Sismos
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!quakesOn) { eng.setQuakes([]); return; }
    fetch(`/api/quakes?date=${day}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((qs: Quake[]) => eng.setQuakes(qs))
      .catch(() => eng.setQuakes([]));
  }, [quakesOn, day, geracao]);

  // Focos de Calor
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!firesOn) { eng.setFires([]); setFireInfo(null); return; }
    setFireInfo("Baixando focos FIRMS...");
    fetch(`/api/fires?date=${day}&days=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      // A rota devolve um OBJETO { fires, total, returned, dataset }, não um
      // array. Tratado como array, `setFires` recebia o envelope inteiro (e
      // desenhava zero focos) e o `.reduce` estourava — era o
      // "TypeError: fs.reduce is not a function" na barra de status.
      .then((j: { fires?: Fire[]; total?: number; dataset?: string }) => {
        const fs = Array.isArray(j) ? (j as Fire[]) : j.fires ?? [];
        eng.setFires(fs);
        const sumFrp = fs.reduce((a, f) => a + (f.frp || 0), 0);
        setFireInfo(
          `${(j.total ?? fs.length).toLocaleString("pt-BR")} detectados · ` +
          `${eng.firesDrawn.toLocaleString("pt-BR")} desenhados · ` +
          `${(sumFrp / 1000).toFixed(1)} GW radiativos`
        );
      })
      .catch((err) => { eng.setFires([]); setFireInfo(`erro: ${String(err)}`); });
  }, [firesOn, day, setFireInfo, geracao]);

  // Qualidade do Ar (OpenAQ POIs)
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!openaqOn) {
      eng.setOpenAQ([]);
      setOpenaqInfo(null);
      return;
    }
    setOpenaqInfo("Baixando estações OpenAQ...");
    fetch("/api/openaq")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && res.stations) {
          eng.setOpenAQ(res.stations);
          setOpenaqInfo(`${res.count} estações de qualidade do ar (OpenAQ)`);
        }
      })
      .catch(() => setOpenaqInfo("Falha OpenAQ"));
  }, [openaqOn, setOpenaqInfo, geracao]);

  // Estresse Térmico WBGT MetPy (campo derivado separado)
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!wbgtOn) {
      if (!kind) eng.setImagery(null, new Date());
      return;
    }
    // Ativa camada WBGT derivada com ramp de perigo própria (green→yellow→red→black)
    eng.setImagery(`/api/fields/wbgt?date=${day}&hour=${hour}`, new Date(), opacity);
  }, [wbgtOn, day, hour, opacity, kind, geracao]);

  // Hospitais OSM (Overpass API)
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!hospitalsOn) {
      eng.setHospitals([]);
      setHospitalInfo(null);
      return;
    }
    let alive = true;
    setHospitalInfo("Baixando hospitais OSM...");
    fetch("/api/hospitals")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!alive) return;
        if (res && res.hospitals) {
          eng.setHospitals(res.hospitals);
          const emerg = res.hospitals.filter((h: any) => h.emergency).length;
          setHospitalInfo(`${res.count} hospitais (${emerg} com emergência)`);
        }
      })
      .catch(() => { if (alive) setHospitalInfo("Falha ao carregar hospitais"); });
    return () => { alive = false; };
  }, [hospitalsOn, setHospitalInfo, geracao]);

  // Correntes Oceânicas HYCOM (reutiliza engine de vento GPU)
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    // Desligar precisa DESLIGAR de verdade. Antes este ramo só limpava o texto
    // da barra: a malha continuava composta a cada quadro, e a camada seguia
    // desenhando com o botão apagado.
    if (!hycomOn) {
      eng.setCurrentsVisible(false);
      setHycomInfo(null);
      return;
    }
    let alive = true;
    setHycomInfo("Buscando correntes…");
    fetch("/api/hycom")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // A rota devolve 503 com motivo enquanto não há fonte ligada. Reduzir
        // isso a "HTTP 503" jogaria fora exatamente a explicação — e foi assim
        // que um campo inteiramente gerado por fórmula ficou anos no ar sem
        // ninguém perguntar de onde vinha.
        if (!r.ok || j?.ok === false) {
          throw new Error(j?.error ?? `HTTP ${r.status}`);
        }
        return j;
      })
      .then((data) => {
        if (!alive) return;
        if (!isValidWindGrid(data)) throw new Error("grade de correntes malformada");
        // Sistema PRÓPRIO — não mais `setWind`, que sobrescrevia o campo
        // atmosférico e fazia corrente e vento saírem com o mesmo desenho.
        eng.setCurrents(data);
        eng.setCurrentsVisible(true);
        setHycomInfo([
          (data as { provider?: string }).provider ?? "procedência não declarada",
          (data as { stepDeg?: number }).stepDeg != null
            ? `${(data as { stepDeg?: number }).stepDeg}°` : null,
        ].filter(Boolean).join(" · "));
      })
      .catch((err: Error) => {
        if (!alive) return;
        eng.setCurrentsVisible(false);
        setHycomInfo(err.message);
      });
    return () => { alive = false; };
  }, [hycomOn, setHycomInfo, geracao]);

  useEffect(() => { engRef.current?.setDayNight(dayNight); }, [dayNight, geracao]);
  // A densidade é aplicada tanto na mudança quanto na montagem: o valor vem do
  // localStorage, então precisa alcançar o motor na primeira renderização.
  useEffect(() => { engRef.current?.setWindDensity(windDensity); }, [windDensity, wind, geracao]);
  useEffect(() => { engRef.current?.setAutoRotate(rotate); }, [rotate, geracao]);

  // Camadas ativas
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!kind || !layer) {
      if (!wbgtOn) eng.setImagery(null, new Date());
      return;
    }
    const layerTarget = kind === "field"
      ? `/api/fields/${layer}?date=${day}&hour=${hour}`
      : layer;
    eng.setImagery(layerTarget, new Date(`${day}T12:00:00Z`), opacity);
  }, [kind, layer, opacity, day, hour, wbgtOn, geracao]);

  return <div className="stage" ref={boxRef} />;
});
