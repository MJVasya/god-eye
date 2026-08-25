import * as THREE from "three";

export const EARTH_RADIUS_KM = 6371;
export const GLOBE_RADIUS = 1.6;
/** Street-level dive — cars and rooftops on Esri Maxar. */
export const STREET_LOOK_KM = 0.55;
/** City oblique — photoreal downtown, the default useful view. */
export const SURFACE_LOOK_KM = 2.4;
export const REGION_LOOK_KM = 18;
export const GLOBE_LOOK_KM = 16000;
export const MIN_CAMERA_DISTANCE = GLOBE_RADIUS * (1 + STREET_LOOK_KM / EARTH_RADIUS_KM);

export const HOME = { name: "Chicago", lat: 41.8781, lng: -87.6298 };

export function latLngToVec3(
  lat: number,
  lng: number,
  altKm = 0,
  radius = GLOBE_RADIUS,
  target = new THREE.Vector3(),
) {
  const r = radius * (1 + altKm / EARTH_RADIUS_KM);
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);
  return target.set(x, y, z);
}

export function vec3ToLatLng(v: THREE.Vector3, radius = GLOBE_RADIUS) {
  const r = v.length() || radius;
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)) * 180) / Math.PI;
  const lng = (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180;
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  const altKm = (r / radius - 1) * EARTH_RADIUS_KM;
  return { lat, lng: wrapped, altKm };
}

export function sunDirection(date = new Date(), target = new THREE.Vector3()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86_400_000;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lng = 15 * (12 - utcHours);
  return latLngToVec3(decl, lng, 0, 1, target).normalize();
}

export function headingOffset(lat: number, lng: number, headingDeg: number, km: number) {
  const R = EARTH_RADIUS_KM;
  const h = (headingDeg * Math.PI) / 180;
  const d = km / R;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(h) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180 };
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR;
  const dLng = (bLng - aLng) * toR;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function deadReckon(
  lat: number,
  lng: number,
  heading: number,
  speedMs: number,
  dtSec: number,
) {
  if (!speedMs || dtSec <= 0) return { lat, lng };
  const km = (speedMs * dtSec) / 1000;
  return headingOffset(lat, lng, heading, km);
}

export function formatAlt(altKm: number) {
  if (altKm >= 100) return `${Math.round(altKm)} km`;
  if (altKm >= 1) return `${altKm.toFixed(1)} km`;
  return `${Math.round(altKm * 1000)} m`;
}

export function formatSpeed(ms: number) {
  if (!ms) return "—";
  const kts = ms * 1.94384;
  return `${Math.round(kts)} kt`;
}

export function formatCoord(lat: number, lng: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns}  ${Math.abs(lng).toFixed(3)}°${ew}`;
}
