import { useEffect, useRef } from "react";
import { compileTle, propagateSats, type LiveSat } from "@/lib/intel/propagate";
import { getFlightsFn, getLaunchesFn, getQuakesFn, getTleFn } from "@/lib/intel/server";
import type { Contact, LaunchPad, SensorMode } from "@/lib/geo/types";
import {
  createEarthViewer,
  flyCamera,
  loadCesium,
  loadGoogleTiles,
  upsertEntity,
} from "@/lib/geo/cesium";
import { useOps } from "@/store/ops";
import { cn } from "@/lib/utils";

export function GlobeScene() {
  const layers = useOps((s) => s.layers);
  const sensor = useOps((s) => s.sensor);
  const cameraMode = useOps((s) => s.cameraMode);
  const target = useOps((s) => s.target);
  const flyTo = useOps((s) => s.flyTo);
  const setTarget = useOps((s) => s.setTarget);
  const setCounts = useOps((s) => s.setCounts);
  const setStatus = useOps((s) => s.setStatus);
  const setClock = useOps((s) => s.setClock);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const dsRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const flightsRef = useRef<Contact[]>([]);
  const quakesRef = useRef<Contact[]>([]);
  const satsRef = useRef<Contact[]>([]);
  const launchesRef = useRef<Contact[]>([]);
  const satRecs = useRef<LiveSat[]>([]);
  const targetRef = useRef(target);
  const modeRef = useRef(cameraMode);
  const layersRef = useRef(layers);
  const syncRef = useRef<() => void>(() => {});
  targetRef.current = target;
  modeRef.current = cameraMode;
  layersRef.current = layers;

  useEffect(() => {
    let dead = false;
    let removeTick: (() => void) | undefined;
    const host = hostRef.current;
    if (!host) return;
    void (async () => {
      try {
        const Cesium = await loadCesium();
        if (dead || !hostRef.current) return;
        cesiumRef.current = Cesium;
        const viewer = createEarthViewer(Cesium, hostRef.current);
        const ds = new Cesium.CustomDataSource("mesh");
        await viewer.dataSources.add(ds);
        viewerRef.current = viewer;
        dsRef.current = ds;
        syncRef.current();
        viewer.selectedEntityChanged.addEventListener(() => {
          const e = viewer.selectedEntity;
          const c = e?.god as Contact | undefined;
          if (c) setTarget(c);
          else if (modeRef.current !== "cockpit") setTarget(null);
        });
        const key = window.localStorage.getItem("god-eye-google-tiles-key");
        if (key) void loadGoogleTiles(Cesium, viewer, key).catch(() => undefined);
        removeTick = viewer.scene.preUpdate.addEventListener(() => {
          const t = targetRef.current;
          const mode = modeRef.current;
          if (!t || mode === "free") return;
          const e = ds.entities.getById(t.id);
          if (!e) return;
          if (mode === "track") {
            viewer.trackedEntity = e;
            return;
          }
          viewer.trackedEntity = undefined;
          const pos = e.position?.getValue(viewer.clock.currentTime);
          if (!pos) return;
          const heading = Cesium.Math.toRadians(t.heading || 0);
          const pitch = Cesium.Math.toRadians(-18);
          const range = 70 + Math.max(t.altKm, 0.2) * 4;
          viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(heading, pitch, range));
        });
      } catch {
        if (!dead) setStatus("GLOBE FAIL");
      }
    })();
    return () => {
      dead = true;
      removeTick?.();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [setTarget, setStatus]);

  useEffect(() => {
    let cancel = false;
    const pullFlights = async () => {
      try {
        setStatus("SYNC FLIGHTS");
        const data = await getFlightsFn();
        if (cancel) return;
        flightsRef.current = data.flights;
        setCounts({ flights: data.flights.length, source: data.source });
        setStatus(data.source === "live" ? "LIVE MESH" : "SIMULATED AIR");
        syncEntities();
      } catch {
        if (!cancel) setStatus("FLIGHT FEED FAIL");
      }
    };
    const pullRest = async () => {
      try {
        const [q, t, l] = await Promise.all([
          getQuakesFn().catch(() => [] as Contact[]),
          getTleFn().catch(() => []),
          getLaunchesFn().catch(() => [] as LaunchPad[]),
        ]);
        if (cancel) return;
        quakesRef.current = q;
        satRecs.current = compileTle(t);
        satsRef.current = propagateSats(satRecs.current, new Date());
        launchesRef.current = l.map((x) => ({
          id: x.id,
          kind: "launch" as const,
          name: x.name,
          lat: x.lat,
          lng: x.lng,
          altKm: 0.04,
          heading: 0,
          speedMs: 0,
          meta: `${x.pad} · ${x.status} · ${new Date(x.when).toUTCString().slice(0, 22)}`,
          source: "live" as const,
        }));
        setCounts({ sats: satsRef.current.length, quakes: q.length });
        syncEntities();
      } catch {
        if (!cancel) setStatus("LAYER PARTIAL");
      }
    };
    void pullFlights();
    void pullRest();
    const fa = window.setInterval(() => void pullFlights(), 28_000);
    const sa = window.setInterval(() => {
      if (!satRecs.current.length) return;
      satsRef.current = propagateSats(satRecs.current, new Date());
      setCounts({ sats: satsRef.current.length });
      syncEntities();
    }, 2500);
    const ck = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancel = true;
      window.clearInterval(fa);
      window.clearInterval(sa);
      window.clearInterval(ck);
    };
  }, [setCounts, setStatus, setClock]);

  function syncEntities() {
    const Cesium = cesiumRef.current;
    const ds = dsRef.current;
    if (!Cesium || !ds) return;
    const layersNow = layersRef.current;
    const bags: Contact[][] = [];
    if (layersNow.flights) bags.push(flightsRef.current);
    if (layersNow.satellites) bags.push(satsRef.current);
    if (layersNow.earthquakes) bags.push(quakesRef.current);
    if (layersNow.launches) bags.push(launchesRef.current);
    const keep = new Set<string>();
    for (const bag of bags) {
      for (const c of bag) {
        keep.add(c.id);
        upsertEntity(Cesium, ds, c);
      }
    }
    const remove: any[] = [];
    for (const e of ds.entities.values) {
      if (!keep.has(e.id)) remove.push(e);
    }
    for (const e of remove) ds.entities.remove(e);
  }
  syncRef.current = syncEntities;

  useEffect(() => {
    syncEntities();
  }, [layers]);

  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !flyTo) return;
    flyCamera(Cesium, viewer, flyTo.lat, flyTo.lng, flyTo.altKm);
  }, [flyTo]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!target || cameraMode === "free") {
      viewer.trackedEntity = undefined;
      const Cesium = cesiumRef.current;
      if (Cesium) viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }, [target, cameraMode]);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 h-full w-full touch-none", sensorClass(sensor))}
    />
  );
}

function sensorClass(sensor: SensorMode) {
  if (sensor === "nvg") return "god-sensor-nvg";
  if (sensor === "flir") return "god-sensor-flir";
  if (sensor === "noir") return "god-sensor-noir";
  if (sensor === "crt") return "god-sensor-crt";
  return "";
}

export default GlobeScene;
