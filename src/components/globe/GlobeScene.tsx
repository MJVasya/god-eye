import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { CameraRig } from "@/components/globe/CameraRig";
import { ContactLayer, OrbitRing, TargetRing } from "@/components/globe/ContactLayer";
import { Earth } from "@/components/globe/Earth";
import { compileTle, propagateSats, type LiveSat } from "@/lib/intel/propagate";
import { getFlightsFn, getLaunchesFn, getQuakesFn, getTleFn } from "@/lib/intel/server";
import type { Contact, LaunchPad } from "@/lib/geo/types";
import { useOps } from "@/store/ops";

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

  const [flights, setFlights] = useState<Contact[]>([]);
  const [quakes, setQuakes] = useState<Contact[]>([]);
  const [sats, setSats] = useState<Contact[]>([]);
  const [launches, setLaunches] = useState<Contact[]>([]);
  const satRecs = useRef<LiveSat[]>([]);

  useEffect(() => {
    let cancel = false;
    const pullFlights = async () => {
      try {
        setStatus("SYNC FLIGHTS");
        const data = await getFlightsFn();
        if (cancel) return;
        setFlights(data.flights);
        setCounts({ flights: data.flights.length, source: data.source });
        setStatus(data.source === "live" ? "LIVE MESH" : "SIMULATED AIR");
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
        setQuakes(q);
        satRecs.current = compileTle(t);
        const satContacts = propagateSats(satRecs.current, new Date());
        setSats(satContacts);
        setLaunches(
          l.map((x) => ({
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
          })),
        );
        setCounts({ sats: satContacts.length, quakes: q.length });
      } catch {
        if (!cancel) setStatus("LAYER PARTIAL");
      }
    };
    void pullFlights();
    void pullRest();
    const fa = window.setInterval(() => void pullFlights(), 28_000);
    const sa = window.setInterval(() => {
      if (!satRecs.current.length) return;
      setSats(propagateSats(satRecs.current, new Date()));
    }, 2500);
    const ck = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancel = true;
      window.clearInterval(fa);
      window.clearInterval(sa);
      window.clearInterval(ck);
    };
  }, [setCounts, setStatus, setClock]);

  const iss = useMemo(() => sats.find((s) => s.kind === "iss") ?? null, [sats]);
  const tracked = target
    ? target.kind === "flight"
      ? (flights.find((f) => f.id === target.id) ?? target)
      : target.kind === "sat" || target.kind === "iss"
        ? (sats.find((s) => s.id === target.id) ?? target)
        : target
    : null;

  return (
    <Canvas
      className="h-full w-full touch-none"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.05, 4.6], fov: 42, near: 0.05, far: 80 }}
      onPointerMissed={() => {
        if (cameraMode !== "cockpit") setTarget(null);
      }}
    >
      <color attach="background" args={["#07090c"]} />
      <ambientLight intensity={0.22} />
      <Stars radius={60} depth={30} count={5000} factor={2.6} fade speed={0} />
      <Earth sensor={sensor} />
      {layers.flights ? (
        <ContactLayer
          items={flights}
          kind="flight"
          scale={1}
          sensor={sensor}
          liveMotion
          capacity={1800}
          onPick={setTarget}
        />
      ) : null}
      {layers.satellites ? (
        <ContactLayer
          items={sats}
          kind="sat"
          scale={0.85}
          sensor={sensor}
          liveMotion={false}
          capacity={400}
          onPick={setTarget}
        />
      ) : null}
      {layers.earthquakes ? (
        <ContactLayer
          items={quakes}
          kind="quake"
          scale={1}
          sensor={sensor}
          liveMotion={false}
          capacity={400}
          onPick={setTarget}
        />
      ) : null}
      {layers.launches ? (
        <ContactLayer
          items={launches}
          kind="launch"
          scale={1.4}
          sensor={sensor}
          liveMotion={false}
          capacity={24}
          onPick={setTarget}
        />
      ) : null}
      {tracked ? <TargetRing contact={tracked} /> : null}
      {tracked && (tracked.kind === "sat" || tracked.kind === "iss") ? (
        <OrbitRing contact={tracked} />
      ) : null}
      {iss && layers.satellites && !tracked ? <OrbitRing contact={iss} /> : null}
      <CameraRig mode={cameraMode} target={tracked} flyTo={flyTo} />
    </Canvas>
  );
}

export default GlobeScene;
