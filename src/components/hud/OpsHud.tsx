import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Crosshair,
  Eye,
  Github,
  Globe2,
  LocateFixed,
  Plane,
  Radio,
  Satellite,
  Search,
  TriangleAlert,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAlt, formatCoord, formatSpeed, GLOBE_LOOK_KM, HOME, REGION_LOOK_KM, STREET_LOOK_KM, SURFACE_LOOK_KM } from "@/lib/geo/math";
import { PLACES } from "@/lib/geo/places";
import { briefFn, geocodeFn } from "@/lib/intel/server";
import type { SensorMode } from "@/lib/geo/types";
import { useOps, type Layers } from "@/store/ops";

const SRC_REPO = "https://github.com/MJVasya/god-eye";
const SRC_ORIGINAL = "https://github.com/bilawalsidhu/gods-eye-view";

const SENSORS: { id: SensorMode; key: string; label: string }[] = [
  { id: "optical", key: "1", label: "OPTICAL" },
  { id: "nvg", key: "2", label: "NVG" },
  { id: "flir", key: "3", label: "FLIR" },
  { id: "noir", key: "4", label: "NOIR" },
  { id: "crt", key: "5", label: "CRT" },
];

const LAYER_ITEMS: { id: keyof Layers; label: string; icon: typeof Plane }[] = [
  { id: "flights", label: "FLIGHTS", icon: Plane },
  { id: "satellites", label: "ORBIT", icon: Satellite },
  { id: "earthquakes", label: "SEISMIC", icon: TriangleAlert },
  { id: "launches", label: "LAUNCH", icon: Rocket },
];

export function OpsHud() {
  const booted = useOps((s) => s.booted);
  const layers = useOps((s) => s.layers);
  const sensor = useOps((s) => s.sensor);
  const cameraMode = useOps((s) => s.cameraMode);
  const target = useOps((s) => s.target);
  const status = useOps((s) => s.status);
  const flightCount = useOps((s) => s.flightCount);
  const satCount = useOps((s) => s.satCount);
  const quakeCount = useOps((s) => s.quakeCount);
  const flightSource = useOps((s) => s.flightSource);
  const clock = useOps((s) => s.clock);
  const brief = useOps((s) => s.brief);
  const briefing = useOps((s) => s.briefing);
  const look = useOps((s) => s.look);
  const toggleLayer = useOps((s) => s.toggleLayer);
  const setSensor = useOps((s) => s.setSensor);
  const setCameraMode = useOps((s) => s.setCameraMode);
  const setTarget = useOps((s) => s.setTarget);
  const requestFlyTo = useOps((s) => s.requestFlyTo);
  const setBrief = useOps((s) => s.setBrief);
  const setBriefing = useOps((s) => s.setBriefing);
  const bumpTiles = useOps((s) => s.bumpTiles);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [gkey, setGkey] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem("god-eye-google-tiles-key") || "" : "",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const map: Record<string, SensorMode> = {
        Digit1: "optical",
        Digit2: "nvg",
        Digit3: "flir",
        Digit4: "noir",
        Digit5: "crt",
      };
      if (map[e.code]) setSensor(map[e.code]!);
      if (e.code === "Escape") {
        setTarget(null);
        setAboutOpen(false);
      }
      if (e.code === "KeyC" && target) {
        setCameraMode(cameraMode === "cockpit" ? "track" : "cockpit");
      }
      if (e.code === "KeyR") requestFlyTo(20, -30, GLOBE_LOOK_KM);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSensor, setTarget, target, cameraMode, setCameraMode, requestFlyTo]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void geocodeFn({ data: { q: query } })
        .then(setHits)
        .catch(() => setHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const stamp = useMemo(
    () =>
      new Date(clock).toISOString().replace("T", "  ").replace("Z", "Z").slice(0, 22),
    [clock],
  );

  const runBrief = async () => {
    setBriefing(true);
    const scene = [
      `Status ${status}`,
      `Sensor ${sensor}`,
      `Flights ${flightCount} (${flightSource})`,
      `Satellites ${satCount}`,
      `Earthquakes 24h ${quakeCount}`,
      target
        ? `Tracked ${target.kind} ${target.name} at ${formatCoord(target.lat, target.lng)} alt ${formatAlt(target.altKm)} ${target.meta}`
        : "No tracked contact",
    ].join(". ");
    const res = await briefFn({ data: { scene } });
    setBriefing(false);
    setBrief(res.ok ? res.text : res.error);
  };

  const runMission = (id: "contacts" | "orbit" | "seismic" | "city") => {
    if (id === "contacts") {
      if (!layers.flights) toggleLayer("flights");
      setSensor("optical");
      requestFlyTo(40.641, -73.778, REGION_LOOK_KM);
    } else if (id === "orbit") {
      if (!layers.satellites) toggleLayer("satellites");
      setSensor("optical");
      requestFlyTo(0, -80, GLOBE_LOOK_KM);
    } else if (id === "seismic") {
      if (!layers.earthquakes) toggleLayer("earthquakes");
      setSensor("flir");
      requestFlyTo(35.676, 139.65, SURFACE_LOOK_KM);
    } else {
      if (!layers.flights) toggleLayer("flights");
      setSensor("optical");
      requestFlyTo(HOME.lat, HOME.lng, SURFACE_LOOK_KM);
    }
  };

  if (!booted) return <BootScreen />;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-paper">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-void/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-void/85 to-transparent" />

      <header className="pointer-events-auto flex items-start justify-between gap-3 p-3 md:p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface">
            <Eye className="size-5 text-accent" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-display text-xl leading-none tracking-[0.18em] text-paper">
              GOD EYE
            </p>
            <p className="mt-1 font-mono text-micro tracking-[0.22em] text-muted">
              ORBITAL INTELLIGENCE · PUBLIC MESH
            </p>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="mt-1 font-mono text-micro tracking-[0.18em] text-accent"
            >
              SOURCE · MIT
            </button>
          </div>
        </div>
        <div className="hidden items-center gap-4 font-mono text-hud text-muted md:flex">
          <span className="tabular-nums">{stamp}</span>
          {look ? (
            <span className="tabular-nums text-paper/80">
              {formatCoord(look.lat, look.lng)} · {formatAlt(look.altKm)}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-accent-fg",
              flightSource === "live" ? "bg-accent" : "bg-amber text-void",
            )}
          >
            {flightSource === "live" ? "LIVE" : "SIM"}
          </span>
          <span>{status}</span>
        </div>
      </header>

      <div className="pointer-events-auto absolute top-16 right-3 left-3 z-20 md:top-3 md:left-auto md:w-72">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface/90 px-3 py-2">
          <Search className="size-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a city, airport, pad"
            className="w-full bg-transparent font-sans text-sm text-paper outline-none placeholder:text-muted"
          />
        </label>
        {hits.length ? (
          <ul className="mt-1 overflow-hidden rounded-xl border border-line bg-surface/95">
            {hits.map((h) => (
              <li key={`${h.lat}-${h.lng}`}>
                <button
                  type="button"
                  className="min-h-11 w-full px-3 py-2 text-left text-sm text-paper hover:bg-raised"
                  onClick={() => {
                    requestFlyTo(h.lat, h.lng, STREET_LOOK_KM);
                    setHits([]);
                    setQuery(h.name);
                  }}
                >
                  {h.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <aside className="pointer-events-auto absolute top-32 left-3 flex max-w-44 flex-col gap-1 md:top-24 md:left-4">
        {LAYER_ITEMS.map((l) => {
          const on = layers[l.id];
          const Icon = l.icon;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggleLayer(l.id)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-2 text-left font-mono text-micro tracking-widest",
                on
                  ? "border-accent/40 bg-surface text-accent"
                  : "border-line bg-void/70 text-muted",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {l.label}
            </button>
          );
        })}
        <button
          type="button"
          className="mt-1 flex min-h-11 items-center rounded-lg border border-line bg-surface/80 px-2.5 py-2 text-left font-mono text-micro tracking-wider text-muted md:hidden"
          onClick={() => setJumpOpen((v) => !v)}
        >
          JUMP
        </button>
        <p className="mt-1 hidden font-mono text-micro tracking-wider text-muted md:block">
          DBL-CLICK DIVE · 1–5 SENSOR · C COCKPIT · R RESET
        </p>
      </aside>

      <div className="pointer-events-auto absolute top-32 right-3 flex flex-col items-end gap-1 md:top-28">
        {SENSORS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSensor(s.id)}
            className={cn(
              "min-h-11 rounded-full border px-3 py-1.5 font-mono text-micro tracking-widest",
              sensor === s.id
                ? "border-accent bg-accent text-accent-fg"
                : "border-line bg-surface/80 text-muted",
            )}
          >
            {s.key} {s.label}
          </button>
        ))}
      </div>

      {target ? (
        <article className="pointer-events-auto absolute right-3 bottom-36 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-line bg-surface/95 p-4 md:bottom-8 md:right-4">
          <p className="font-mono text-micro tracking-[0.22em] text-muted">
            {target.kind.toUpperCase()} · {target.source.toUpperCase()}
          </p>
          <h2 className="mt-1 font-display text-2xl tracking-[0.08em] text-paper">
            {target.name}
          </h2>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted">
            {formatCoord(target.lat, target.lng)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-hud">
            <div>
              <dt className="text-muted">ALT</dt>
              <dd className="tabular-nums text-paper">{formatAlt(target.altKm)}</dd>
            </div>
            <div>
              <dt className="text-muted">SPD</dt>
              <dd className="tabular-nums text-paper">{formatSpeed(target.speedMs)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm leading-snug text-paper/80">{target.meta}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setCameraMode(cameraMode === "cockpit" ? "track" : "cockpit")}
              className="min-h-11 flex-1 rounded-lg bg-paper px-3 py-2 font-mono text-micro tracking-widest text-void"
            >
              {cameraMode === "cockpit" ? "RELEASE" : "COCKPIT"}
            </button>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="min-h-11 rounded-lg border border-line px-3 py-2 font-mono text-micro tracking-widest text-muted"
            >
              DROP
            </button>
          </div>
        </article>
      ) : null}

      <footer className="pointer-events-auto absolute bottom-0 left-0 right-0 flex flex-col gap-2 p-3 md:flex-row md:items-end md:justify-between md:p-4">
        <div className="flex flex-wrap gap-2">
          <Stat label="AIR" value={String(flightCount)} icon={Plane} />
          <Stat label="SAT" value={String(satCount)} icon={Satellite} />
          <Stat label="EQ" value={String(quakeCount)} icon={Activity} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runMission("contacts")}
            className="min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-paper"
          >
            LIVE CONTACTS
          </button>
          <button
            type="button"
            onClick={() => runMission("orbit")}
            className="min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-paper"
          >
            ORBITAL WATCH
          </button>
          <button
            type="button"
            onClick={() => runMission("city")}
            className="min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-paper"
          >
            CITY DIVE
          </button>
          <button
            type="button"
            onClick={() => {
              setSensor("optical");
              requestFlyTo(HOME.lat, HOME.lng, STREET_LOOK_KM);
            }}
            className="min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-paper"
          >
            STREET
          </button>
          <button
            type="button"
            onClick={() => runMission("seismic")}
            className="hidden min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-paper sm:inline"
          >
            SEISMIC
          </button>
          <button
            type="button"
            onClick={() => {
              setBriefOpen(true);
              void runBrief();
            }}
            className="min-h-11 rounded-lg border border-line bg-surface/90 px-3 py-2 font-mono text-micro tracking-wider text-accent md:hidden"
          >
            BRIEF
          </button>
          <button
            type="button"
            onClick={() => requestFlyTo(20, -30, GLOBE_LOOK_KM)}
            className="min-h-11 rounded-lg border border-line bg-void/80 px-3 py-2 font-mono text-micro tracking-wider text-muted"
          >
            <Globe2 className="mr-1 inline size-3.5" />
            RESET
          </button>
        </div>
      </footer>

      <div
        className={cn(
          "pointer-events-auto absolute bottom-36 left-3 w-[min(18rem,calc(100%-1.5rem))] md:bottom-8 md:left-4 md:block md:w-72",
          briefOpen ? "block" : "hidden md:block",
        )}
      >
        <div className="rounded-2xl border border-line bg-surface/90 p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-micro tracking-widest text-muted">BRIEF</p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={briefing}
                onClick={() => void runBrief()}
                className="min-h-11 rounded-md bg-raised px-3 font-mono text-micro tracking-wider text-accent disabled:opacity-50"
              >
                {briefing ? "WAIT" : "REQUEST"}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md px-3 font-mono text-micro text-muted md:hidden"
                onClick={() => setBriefOpen(false)}
              >
                CLOSE
              </button>
            </div>
          </div>
          <p className="mt-2 min-h-14 font-mono text-hud leading-relaxed text-paper/85 whitespace-pre-wrap">
            {brief || "Request a five-line readout of the current public mesh."}
          </p>
        </div>
        <p className="mt-2 hidden max-w-xs font-mono text-micro leading-relaxed text-muted md:block">
          Public feeds only. Delayed or modeled. Not for navigation or emergency use.{" "}
          <a
            href={SRC_REPO}
            target="_blank"
            rel="noreferrer"
            className="text-accent"
          >
            Source
          </a>
          {" · "}
          <a
            href={SRC_ORIGINAL}
            target="_blank"
            rel="noreferrer"
            className="text-accent"
          >
            Cesium original
          </a>
        </p>
      </div>

      {aboutOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-void/70 p-4">
          <div className="w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-5">
            <p className="font-mono text-micro tracking-[0.28em] text-accent">ABOUT · MIT</p>
            <h2 className="mt-2 font-display text-3xl tracking-[0.12em] text-paper">GOD EYE</h2>
            <p className="mt-3 text-sm leading-relaxed text-paper/85">
              Independent rewrite. Cesium + Esri Maxar satellite with real terrain
              — dive to rooftops, double-click to go closer. Not a fork of the
              Google Photorealistic 3D Tiles client; paste a Map Tiles key below
              if you want that mesh.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href={SRC_REPO}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-lg border border-accent/40 bg-void px-3 font-mono text-micro tracking-widest text-accent"
              >
                <Github className="size-3.5" strokeWidth={1.75} />
                THIS SOURCE
              </a>
              <a
                href={SRC_ORIGINAL}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-void px-3 font-mono text-micro tracking-widest text-paper"
              >
                <Github className="size-3.5" strokeWidth={1.75} />
                CESIUM ORIGINAL
              </a>
            </div>
            <label className="mt-4 block font-mono text-micro tracking-widest text-muted">
              OPTIONAL GOOGLE 3D TILES KEY
              <input
                type="password"
                autoComplete="off"
                placeholder="Maps Tile API key"
                value={gkey}
                onChange={(e) => setGkey(e.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-line bg-void px-3 font-mono text-xs tracking-normal text-paper outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const v = gkey.trim();
                if (v) window.localStorage.setItem("god-eye-google-tiles-key", v);
                else window.localStorage.removeItem("god-eye-google-tiles-key");
                bumpTiles();
                requestFlyTo(HOME.lat, HOME.lng, STREET_LOOK_KM);
                setAboutOpen(false);
              }}
              className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-accent/40 bg-void font-mono text-micro tracking-widest text-accent"
            >
              LOAD 3D TILES
            </button>
            <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
              Esri Maxar satellite is the free default. A Google Map Tiles key
              loads photoreal 3D buildings — same mesh as the original.
            </p>
            <button
              type="button"
              onClick={() => setAboutOpen(false)}
              className="mt-4 min-h-11 w-full rounded-xl border border-line font-mono text-micro tracking-[0.2em] text-muted"
            >
              CLOSE
            </button>
          </div>
        </div>
      ) : null}

      {jumpOpen ? (
        <div className="pointer-events-auto absolute inset-x-3 top-28 z-30 rounded-xl border border-line bg-surface p-3 md:hidden">
          <p className="font-mono text-micro text-muted">JUMP</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLACES.slice(0, 8).map((p) => (
              <button
                key={p.name}
                type="button"
                className="min-h-11 rounded-full border border-line px-3 font-mono text-micro"
                onClick={() => {
                  requestFlyTo(p.lat, p.lng, SURFACE_LOOK_KM);
                  setJumpOpen(false);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {sensor === "crt" ? <div className="scanlines pointer-events-none absolute inset-0" /> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Plane;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/90 px-2.5 py-1.5">
      <Icon className="size-3.5 text-accent" strokeWidth={1.75} />
      <div>
        <p className="font-mono text-micro tracking-[0.18em] text-muted">{label}</p>
        <p className="font-mono text-sm tabular-nums leading-none text-paper">{value}</p>
      </div>
    </div>
  );
}

function BootScreen() {
  const setBooted = useOps((s) => s.setBooted);
  const requestFlyTo = useOps((s) => s.requestFlyTo);
  const [line, setLine] = useState(0);
  const lines = [
    "PUBLIC SIGNALS ONLINE",
    "ESRI MAXAR / ADSB / USGS / TLE",
    "DOUBLE-CLICK TO DIVE",
    "MESH READY",
  ];
  useEffect(() => {
    const t = window.setInterval(() => setLine((n) => n + 1), 420);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-void/55">
      <div className="w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-6">
        <p className="font-mono text-micro tracking-[0.28em] text-accent">SYSTEM BOOT</p>
        <h1 className="mt-2 font-display text-5xl tracking-[0.16em] text-paper">GOD EYE</h1>
        <p className="mt-2 text-sm text-muted">
          Photoreal satellite globe. Opens over Chicago. Scroll to street, double-click to dive.
        </p>
        <ul className="mt-5 space-y-1 font-mono text-hud text-paper/80">
          {lines.slice(0, Math.min(lines.length, line + 1)).map((l) => (
            <li key={l} className="flex items-center gap-2">
              <Radio className="size-3 text-accent" />
              {l}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setBooted();
            requestFlyTo(HOME.lat, HOME.lng, SURFACE_LOOK_KM);
          }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-paper py-3 font-mono text-xs tracking-[0.2em] text-void"
        >
          <LocateFixed className="size-4" />
          OPEN THE MESH
        </button>
        <p className="mt-3 flex items-center gap-1 font-mono text-micro text-muted">
          <Crosshair className="size-3" />
          Search any city. Paste a Google Map Tiles key in SOURCE for 3D buildings.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-micro tracking-widest">
          <a
            href={SRC_REPO}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-1.5 text-accent"
          >
            <Github className="size-3" strokeWidth={1.75} />
            SOURCE
          </a>
          <a
            href={SRC_ORIGINAL}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center text-muted"
          >
            CESIUM ORIGINAL
          </a>
        </div>
      </div>
    </div>
  );
}
