import * as satellite from "satellite.js";
import type { CelestrakTle, Contact } from "@/lib/geo/types";

export type LiveSat = {
  id: string;
  name: string;
  rec: ReturnType<typeof satellite.twoline2satrec>;
  iss: boolean;
};

export function compileTle(tles: CelestrakTle[]): LiveSat[] {
  const out: LiveSat[] = [];
  for (const t of tles) {
    try {
      const rec = satellite.twoline2satrec(t.line1, t.line2);
      if (!rec || rec.error) continue;
      const name = (t.name || "SAT").trim();
      out.push({
        id: `sat-${t.noradId}`,
        name,
        rec,
        iss: /ISS/i.test(name) || t.noradId === 25544,
      });
    } catch {
      /* skip bad TLE */
    }
  }
  return out;
}

export function propagateSats(sats: LiveSat[], date: Date): Contact[] {
  const gmst = satellite.gstime(date);
  const out: Contact[] = [];
  for (const s of sats) {
    const pv = satellite.propagate(s.rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const pos = pv.position;
    const geo = satellite.eciToGeodetic(pos, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lng = satellite.degreesLong(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: s.id,
      kind: s.iss ? "iss" : "sat",
      name: s.name,
      lat,
      lng,
      altKm: geo.height,
      heading: 0,
      speedMs: 7600,
      meta: `${Math.round(geo.height)} km · SGP4`,
      source: "live",
    });
  }
  return out;
}
