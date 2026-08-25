import type { CelestrakTle, Contact, FeedSource, LaunchPad } from "@/lib/geo/types";

const UA = "GOD-EYE/1.0 (public OSINT globe; educational)";

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getText(url: string, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/plain", "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseTleCatalog(text: string): CelestrakTle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: CelestrakTle[] = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    const c = lines[i + 2]!;
    if (!b.startsWith("1 ") || !c.startsWith("2 ")) continue;
    const noradId = Number(b.slice(2, 7));
    out.push({ name: a, line1: b, line2: c, noradId: Number.isFinite(noradId) ? noradId : 0 });
    i += 2;
  }
  return out;
}

function sample<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  const step = arr.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)] as T);
  return out;
}

type OpenskyState = (string | number | null | boolean)[];

function parseOpensky(states: OpenskyState[]): Contact[] {
  const out: Contact[] = [];
  for (const s of states) {
    const lat = Number(s[6]);
    const lng = Number(s[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const onGround = Boolean(s[8]);
    if (onGround) continue;
    const alt = Number(s[13] ?? s[7] ?? 0) / 1000;
    const callsign = String(s[1] ?? "").trim() || String(s[0] ?? "UNK");
    const heading = Number(s[10] ?? 0);
    const speed = Number(s[9] ?? 0);
    out.push({
      id: `icao-${s[0]}`,
      kind: "flight",
      name: callsign,
      lat,
      lng,
      altKm: Number.isFinite(alt) ? alt : 10,
      heading: Number.isFinite(heading) ? heading : 0,
      speedMs: Number.isFinite(speed) ? speed : 220,
      country: String(s[2] ?? ""),
      meta: `${s[2] ?? "—"} · FL${Math.round(((Number(s[7]) || 0) * 3.28084) / 100)}`,
      source: "live",
    });
  }
  return sample(out, 1600);
}

function simulatedFlights(now = Date.now()): Contact[] {
  const hubs = [
    [41.98, -87.9, "ORD"],
    [33.94, -118.41, "LAX"],
    [40.64, -73.78, "JFK"],
    [51.47, -0.46, "LHR"],
    [35.55, 139.78, "HND"],
    [25.25, 55.36, "DXB"],
    [1.36, 103.99, "SIN"],
    [-33.95, 151.18, "SYD"],
    [55.97, 37.41, "SVO"],
    [52.31, 4.76, "AMS"],
    [49.01, 2.55, "CDG"],
    [-23.43, -46.47, "GRU"],
  ] as const;
  const out: Contact[] = [];
  const t = now / 1000;
  for (let i = 0; i < 220; i++) {
    const a = hubs[i % hubs.length]!;
    const b = hubs[(i * 7) % hubs.length]!;
    const phase = ((t / (1800 + (i % 17) * 40) + i * 0.013) % 1 + 1) % 1;
    const lat = a[0] + (b[0] - a[0]) * phase;
    const lng = a[1] + (b[1] - a[1]) * phase;
    const heading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    out.push({
      id: `sim-${i}`,
      kind: "flight",
      name: `${a[2]}${(i % 90) + 10}`,
      lat,
      lng: ((lng + 540) % 360) - 180,
      altKm: 9 + (i % 7),
      heading,
      speedMs: 230 + (i % 40),
      country: "SIM",
      meta: `${a[2]} → ${b[2]} · SIMULATED`,
      source: "simulated",
    });
  }
  return out;
}

function parseAdsb(ac: Array<Record<string, unknown>> | undefined): Contact[] {
  const out: Contact[] = [];
  for (const a of ac ?? []) {
    const lat = Number(a.lat);
    const lng = Number(a.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (a.alt_baro === "ground") continue;
    const altFt = Number(a.alt_geom ?? a.alt_baro);
    const altKm = Number.isFinite(altFt) ? altFt * 0.0003048 : 10;
    const gs = Number(a.gs || 0) * 0.514444;
    const name = String(a.flight || a.r || a.hex || "UNK").trim();
    out.push({
      id: `icao-${a.hex}`,
      kind: "flight",
      name,
      lat,
      lng,
      altKm,
      heading: Number(a.track || a.true_heading || 0),
      speedMs: gs || 220,
      country: String(a.t || "ADS-B"),
      meta: `${a.t || "ADS-B"} · ${String(a.hex).toUpperCase()} · FL${Math.round((Number(a.alt_baro) || 0) / 100)}`,
      source: "live",
    });
  }
  return out;
}

async function loadAdsb(): Promise<Contact[]> {
  const out: Contact[] = [];
  const seen = new Set<string>();
  const push = (rows: Contact[]) => {
    for (const f of rows) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  };
  try {
    const mil = (await getJson("https://api.adsb.lol/v2/mil", 8000)) as {
      ac?: Array<Record<string, unknown>>;
    };
    push(parseAdsb(mil.ac));
  } catch {
    /* mil optional */
  }
  const hubs = [
    [40.64, -73.78],
    [51.47, -0.46],
    [35.55, 139.78],
  ] as const;
  for (const [lat, lon] of hubs) {
    if (out.length > 700) break;
    try {
      const data = (await getJson(
        `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/300`,
        8000,
      )) as { ac?: Array<Record<string, unknown>> };
      push(parseAdsb(data.ac));
    } catch {
      break;
    }
  }
  return sample(out, 900);
}

export async function loadFlights(): Promise<{ flights: Contact[]; source: FeedSource }> {
  try {
    const data = (await getJson("https://opensky-network.org/api/states/all", 14_000)) as {
      states?: OpenskyState[];
    };
    const flights = parseOpensky(data.states ?? []);
    if (flights.length > 40) return { flights, source: "live" };
  } catch {
    /* OpenSky often blocks datacenter IPs. */
  }
  try {
    const flights = await loadAdsb();
    if (flights.length > 20) return { flights, source: "live" };
  } catch {
    /* adsb.lol rate-limits */
  }
  return { flights: simulatedFlights(), source: "simulated" };
}

export async function loadQuakes(): Promise<Contact[]> {
  const data = (await getJson(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  )) as {
    features?: Array<{
      id: string;
      geometry: { coordinates: [number, number, number] };
      properties: { mag: number; place: string };
    }>;
  };
  return (data.features ?? []).map((f) => {
    const [lng, lat, depth] = f.geometry.coordinates;
    return {
      id: `qk-${f.id}`,
      kind: "quake" as const,
      name: `M${f.properties.mag.toFixed(1)}`,
      lat,
      lng,
      altKm: 0.02,
      heading: 0,
      speedMs: 0,
      mag: f.properties.mag,
      meta: `${f.properties.place} · ${Math.round(depth)} km depth`,
      source: "live" as const,
    };
  });
}

const ISS_FALLBACK: CelestrakTle = {
  name: "ISS (ZARYA)",
  noradId: 25544,
  line1: "1 25544U 98067A   26236.69321429  .00007505  00000-0  14120-3 0  9993",
  line2: "2 25544  51.6332 321.0241 0007692  79.3790 280.8065 15.49608243582370",
};

export async function loadTle(): Promise<CelestrakTle[]> {
  try {
    const rows = (await getJson("https://db.satnogs.org/api/tle/?format=json", 10_000)) as Array<{
      tle0?: string;
      tle1?: string;
      tle2?: string;
      norad_cat_id?: number;
    }>;
    if (Array.isArray(rows) && rows.length) {
      const seen = new Set<number>();
      const out: CelestrakTle[] = [];
      let iss: CelestrakTle | null = null;
      for (const r of rows) {
        const line1 = String(r.tle1 || "");
        const line2 = String(r.tle2 || "");
        if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
        const noradId = Number(r.norad_cat_id) || Number(line1.slice(2, 7));
        if (!noradId || seen.has(noradId)) continue;
        seen.add(noradId);
        const name = String(r.tle0 || "SAT").replace(/^0\s+/, "").trim() || "SAT";
        const row: CelestrakTle = { name, line1, line2, noradId };
        if (noradId === 25544 || /ISS/i.test(name)) iss = row;
        else out.push(row);
        if (out.length + (iss ? 1 : 0) >= 280) break;
      }
      if (iss) out.unshift(iss);
      if (out.length) return out.slice(0, 280);
    }
  } catch {
    /* try ARISS */
  }
  try {
    const parsed = parseTleCatalog(await getText("https://live.ariss.org/iss.txt", 8_000));
    if (parsed.length) return parsed;
  } catch {
    /* hardcoded ISS */
  }
  return [ISS_FALLBACK];
}

export async function loadLaunches(): Promise<LaunchPad[]> {
  try {
    const data = (await getJson("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=8")) as {
      results?: Array<{
        id: string;
        name: string;
        net: string;
        status?: { name?: string };
        pad?: {
          name?: string;
          latitude?: string | number;
          longitude?: string | number;
        };
      }>;
    };
    const live = (data.results ?? [])
      .map((r) => {
        const lat = Number(r.pad?.latitude);
        const lng = Number(r.pad?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: `ln-${r.id}`,
          name: r.name,
          lat,
          lng,
          when: r.net,
          pad: r.pad?.name ?? "Pad",
          status: r.status?.name ?? "TBD",
        } satisfies LaunchPad;
      })
      .filter((x): x is LaunchPad => x !== null);
    if (live.length) return live;
  } catch {
    /* Launch Library free tier is 15 req/hour — keep the layer populated. */
  }
  return fallbackLaunches();
}

function fallbackLaunches(): LaunchPad[] {
  const t = Date.now();
  const when = (h: number) => new Date(t + h * 3600_000).toISOString();
  return [
    { id: "ln-ksc", name: "Falcon / Starliner watch — KSC", lat: 28.608, lng: -80.604, when: when(18), pad: "LC-39A", status: "WATCH" },
    { id: "ln-ccafs", name: "Atlas / Vulcan watch — Canaveral", lat: 28.562, lng: -80.577, when: when(42), pad: "SLC-41", status: "WATCH" },
    { id: "ln-vafb", name: "West-coast polar watch — VAFB", lat: 34.632, lng: -120.611, when: when(30), pad: "SLC-4E", status: "WATCH" },
    { id: "ln-sb", name: "Starship flight window — Starbase", lat: 25.997, lng: -97.157, when: when(72), pad: "Orbital Pad", status: "WATCH" },
    { id: "ln-kourou", name: "Ariane / Vega watch — Guiana", lat: 5.236, lng: -52.775, when: when(54), pad: "ELA-4", status: "WATCH" },
    { id: "ln-baik", name: "Soyuz watch — Baikonur", lat: 45.92, lng: 63.342, when: when(36), pad: "Site 31/6", status: "WATCH" },
    { id: "ln-jiu", name: "Long March watch — Jiuquan", lat: 40.958, lng: 100.291, when: when(24), pad: "SLS-2", status: "WATCH" },
    { id: "ln-mahia", name: "Electron watch — Māhia", lat: -39.261, lng: 177.865, when: when(48), pad: "LC-1", status: "WATCH" },
  ];
}

export async function geocode(q: string): Promise<{ name: string; lat: number; lng: number }[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  const data = (await getJson(url)) as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>;
  return data.map((d) => ({
    name: d.display_name.split(",").slice(0, 3).join(","),
    lat: Number(d.lat),
    lng: Number(d.lon),
  }));
}
