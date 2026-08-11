// src/components/globe/GlobeViewport.tsx
// -----------------------------------------------------------------------------
// MOTOR DO GLOBO E CONTAINER DE VISUALIZAÇÃO THREE.JS (ZUSTAND & OPEN DATA)
// -----------------------------------------------------------------------------

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { useGlobeStore } from "../../store/globeStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useLayerStore } from "../../store/layerStore";
import { useProbeStore, type Probe } from "../../store/probeStore";
import { GlobeEngine, type Quake, type Fire, type IsobarSet, type WindGrid } from "../../globe";

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
  const engRef = useRef<GlobeEngine | null>(null);

  const { dayNight, rotate } = useGlobeStore();
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
      eng.setClickMarker(lat, lng);
      setProbing(true);
      fetch(`/api/probe?lat=${lat}&lng=${lng}&date=${day}&hour=${hour}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p: Probe | null) => { setProbe(p); setProbing(false); })
        .catch(() => setProbing(false));
    },
  }));

  // Inicialização do GlobeEngine
  useEffect(() => {
    if (!boxRef.current) return;
    const eng = new GlobeEngine();
    eng.mount(boxRef.current);
    engRef.current = eng;

    // Falhas internas do globo (contornos que não baixaram, por exemplo) vão
    // para a barra de status. Sem este canal elas eram engolidas por um
    // `catch {}` e o mapa ficava sem estados sem dizer por quê — indistinguível
    // de um mapa onde aquelas fronteiras simplesmente não existem.
    eng.onNotice((msg) => setGeoInfo(msg));

    // NÃO ligar camada nenhuma aqui. Havia um `setWindVisible(true)` fixo, que
    // ignorava o estado da loja: o vento nascia ligado mesmo com o botão
    // desligado, e só apagava se algo mais tarde o desligasse por acaso. Cada
    // camada é ligada pelo seu próprio efeito, a partir do seu próprio estado —
    // é a única forma de o que está na tela corresponder ao que está marcado.

    return () => { eng.dispose(); engRef.current = null; };
  }, []);

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
  }, [day, hour, setProbe, setProbing]);

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
    setWindInfo("Baixando Vento GFS 0.25°...");
    fetch(`/api/wind?date=${day}&hour=${hour}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: WindGrid) => {
        if (!alive) return;
        if (!isValidWindGrid(data)) throw new Error("objeto de vento malformado");
        eng.setWindVisible(true);
        eng.setWind(data, `${day}:${hour}`);
        setWindInfo("NOAA GFS 0.25° · 100% medido");
      })
      .catch((err) => {
        if (!alive) return;
        eng.setWindVisible(false);
        setWindInfo(`vento indisponível: ${String(err)}`);
      });
    return () => { alive = false; };
  }, [wind, day, hour, setWindInfo]);

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
  }, [isobarsOn, day, hour, setIsoInfo]);

  // Sismos
  useEffect(() => {
    const eng = engRef.current;
    if (!eng) return;
    if (!quakesOn) { eng.setQuakes([]); return; }
    fetch(`/api/quakes?date=${day}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((qs: Quake[]) => eng.setQuakes(qs))
      .catch(() => eng.setQuakes([]));
  }, [quakesOn, day]);

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
  }, [firesOn, day, setFireInfo]);

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
  }, [openaqOn, setOpenaqInfo]);

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
  }, [wbgtOn, day, hour, opacity, kind]);

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
  }, [hospitalsOn, setHospitalInfo]);

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
    setHycomInfo("Baixando correntes HYCOM...");
    fetch("/api/hycom")
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data) => {
        if (!alive) return;
        if (!isValidWindGrid(data)) throw new Error("grade de correntes malformada");
        // Sistema PRÓPRIO — não mais `setWind`, que sobrescrevia o campo
        // atmosférico e fazia corrente e vento saírem com o mesmo desenho.
        eng.setCurrents(data);
        eng.setCurrentsVisible(true);
        setHycomInfo(`Correntes oceânicas · ${(data as any).source ?? "HYCOM"}`);
      })
      .catch((err) => {
        if (!alive) return;
        eng.setCurrentsVisible(false);
        setHycomInfo(`erro: ${String(err)}`);
      });
    return () => { alive = false; };
  }, [hycomOn, setHycomInfo]);

  useEffect(() => { engRef.current?.setDayNight(dayNight); }, [dayNight]);
  useEffect(() => { engRef.current?.setAutoRotate(rotate); }, [rotate]);

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
  }, [kind, layer, opacity, day, hour, wbgtOn]);

  return <div className="stage" ref={boxRef} />;
});
