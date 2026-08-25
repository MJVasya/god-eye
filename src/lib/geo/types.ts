export type ContactKind = "flight" | "sat" | "quake" | "launch" | "iss";
export type FeedSource = "live" | "simulated";
export type SensorMode = "optical" | "nvg" | "flir" | "noir" | "crt";
export type CameraMode = "free" | "track" | "cockpit";

export type Contact = {
  id: string;
  kind: ContactKind;
  name: string;
  lat: number;
  lng: number;
  altKm: number;
  heading: number;
  speedMs: number;
  country?: string;
  mag?: number;
  meta: string;
  source: FeedSource;
};

export type SatRecRecord = {
  id: string;
  name: string;
  kind: "iss" | "sat";
  rec: unknown;
};

export type LaunchPad = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  when: string;
  pad: string;
  status: string;
};

export type IntelSnapshot = {
  fetchedAt: number;
  flights: Contact[];
  flightSource: FeedSource;
  quakes: Contact[];
  launches: LaunchPad[];
  tle: CelestrakTle[];
};

export type CelestrakTle = {
  name: string;
  line1: string;
  line2: string;
  noradId: number;
};

export type GeocodeHit = {
  name: string;
  lat: number;
  lng: number;
};
