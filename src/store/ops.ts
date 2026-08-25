import { create } from "zustand";
import type { CameraMode, Contact, SensorMode } from "@/lib/geo/types";
import { SURFACE_LOOK_KM } from "@/lib/geo/math";

export type Layers = {
  flights: boolean;
  satellites: boolean;
  earthquakes: boolean;
  launches: boolean;
};

export type FlyTo = {
  lat: number;
  lng: number;
  altKm: number;
  nonce: number;
};

export type Look = {
  lat: number;
  lng: number;
  altKm: number;
  heading: number;
};

type OpsState = {
  booted: boolean;
  layers: Layers;
  sensor: SensorMode;
  cameraMode: CameraMode;
  target: Contact | null;
  flyTo: FlyTo | null;
  look: Look | null;
  search: string;
  status: string;
  flightCount: number;
  satCount: number;
  quakeCount: number;
  flightSource: "live" | "simulated";
  clock: number;
  brief: string;
  briefing: boolean;
  tilesNonce: number;
  setBooted: () => void;
  toggleLayer: (k: keyof Layers) => void;
  setSensor: (s: SensorMode) => void;
  setCameraMode: (m: CameraMode) => void;
  setTarget: (c: Contact | null) => void;
  requestFlyTo: (lat: number, lng: number, altKm?: number) => void;
  setLook: (look: Look) => void;
  setSearch: (q: string) => void;
  setStatus: (s: string) => void;
  setCounts: (p: {
    flights?: number;
    sats?: number;
    quakes?: number;
    source?: "live" | "simulated";
  }) => void;
  setClock: (n: number) => void;
  setBrief: (s: string) => void;
  setBriefing: (v: boolean) => void;
  bumpTiles: () => void;
};

export const useOps = create<OpsState>((set) => ({
  booted: false,
  layers: { flights: true, satellites: true, earthquakes: true, launches: true },
  sensor: "optical",
  cameraMode: "free",
  target: null,
  flyTo: null,
  look: null,
  search: "",
  status: "STANDBY",
  flightCount: 0,
  satCount: 0,
  quakeCount: 0,
  flightSource: "live",
  clock: Date.now(),
  brief: "",
  briefing: false,
  tilesNonce: 0,
  setBooted: () => set({ booted: true }),
  toggleLayer: (k) =>
    set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setSensor: (sensor) => set({ sensor }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setTarget: (target) =>
    set({
      target,
      cameraMode: target ? "track" : "free",
    }),
  requestFlyTo: (lat, lng, altKm = SURFACE_LOOK_KM) =>
    set((s) => ({
      flyTo: { lat, lng, altKm, nonce: (s.flyTo?.nonce ?? 0) + 1 },
      cameraMode: "free",
      target: null,
    })),
  setLook: (look) => set({ look }),
  setSearch: (search) => set({ search }),
  setStatus: (status) => set({ status }),
  setCounts: (p) =>
    set((s) => ({
      flightCount: p.flights ?? s.flightCount,
      satCount: p.sats ?? s.satCount,
      quakeCount: p.quakes ?? s.quakeCount,
      flightSource: p.source ?? s.flightSource,
    })),
  setClock: (clock) => set({ clock }),
  setBrief: (brief) => set({ brief }),
  setBriefing: (briefing) => set({ briefing }),
  bumpTiles: () => set((s) => ({ tilesNonce: s.tilesNonce + 1 })),
}));
