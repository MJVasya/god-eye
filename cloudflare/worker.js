const UA = "GOD-EYE/1.0 (Cloudflare Worker; public OSINT globe)";

const TTL = {
  flights: 20,
  quakes: 300,
  tle: 21600,
  launches: 1800,
  geocode: 86400,
};

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

async function cachedJson(ctx, key, ttl, loader) {
  const cache = caches.default;
  const cacheKey = new Request("https://god-eye.cache/" + key);
  const hit = await cache.match(cacheKey);
  if (hit) return cors(hit);
  let data;
  try {
    data = await loader();
  } catch {
    data = key.startsWith("geo:") ? [] : { error: "upstream", fallback: true };
  }
  const res = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return cors(res);
}

async function getJson(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function sample(arr, cap) {
  if (arr.length <= cap) return arr;
  const step = arr.length / cap;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function simulatedFlights(now = Date.now()) {
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
  ];
  const out = [];
  const t = now / 1000;
  for (let i = 0; i < 220; i++) {
    const a = hubs[i % hubs.length];
    const b = hubs[(i * 7) % hubs.length];
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

async function loadFlights() {
  try {
    const data = await getJson("https://opensky-network.org/api/states/all", 8000);
    const out = [];
    for (const s of data.states || []) {
      const lat = Number(s[6]);
      const lng = Number(s[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || s[8]) continue;
      const alt = Number(s[13] ?? s[7] ?? 0) / 1000;
      out.push({
        id: `icao-${s[0]}`,
        kind: "flight",
        name: String(s[1] || "").trim() || String(s[0] || "UNK"),
        lat,
        lng,
        altKm: Number.isFinite(alt) ? alt : 10,
        heading: Number(s[10] || 0),
        speedMs: Number(s[9] || 220),
        country: String(s[2] || ""),
        meta: `${s[2] || "—"} · FL${Math.round(((Number(s[7]) || 0) * 3.28084) / 100)}`,
        source: "live",
      });
    }
    const flights = sample(out, 800);
    if (flights.length > 40) return { flights, source: "live" };
  } catch {
    /* OpenSky often blocks datacenter IPs; Cache API stores the fallback. */
  }
  return { flights: simulatedFlights(), source: "simulated" };
}

async function loadQuakes() {
  try {
    const data = await getJson(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    );
    return (data.features || []).map((f) => {
      const [lng, lat, depth] = f.geometry.coordinates;
      return {
        id: `qk-${f.id}`,
        kind: "quake",
        name: `M${f.properties.mag.toFixed(1)}`,
        lat,
        lng,
        altKm: 0.02,
        heading: 0,
        speedMs: 0,
        mag: f.properties.mag,
        meta: `${f.properties.place} · ${Math.round(depth)} km depth`,
        source: "live",
      };
    });
  } catch {
    return [];
  }
}

async function loadTle() {
  try {
    const rows = await getJson("https://db.satnogs.org/api/tle/?format=json", 10000);
    if (Array.isArray(rows) && rows.length) {
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        const line1 = String(r.tle1 || "");
        const line2 = String(r.tle2 || "");
        if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
        const id = Number(r.norad_cat_id) || Number(line1.slice(2, 7));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(tleToOmm(String(r.tle0 || "SAT").replace(/^0\s+/, "").trim() || "SAT", id, line1, line2));
        if (out.length >= 220) break;
      }
      if (out.length) return out;
    }
  } catch {
    /* try ARISS */
  }
  try {
    const text = await getText("https://live.ariss.org/iss.txt", 8000);
    const parsed = parseTleText(text);
    if (parsed.length) return parsed;
  } catch {
    /* hardcoded ISS */
  }
  return [
    tleToOmm(
      "ISS (ZARYA)",
      25544,
      "1 25544U 98067A   26236.69321429  .00007505  00000-0  14120-3 0  9993",
      "2 25544  51.6332 321.0241 0007692  79.3790 280.8065 15.49608243582370",
    ),
  ];
}

async function getText(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { Accept: "text/plain", "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

function tleEpochIso(line1) {
  const yy = Number(line1.slice(18, 20));
  const doy = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  return new Date(ms).toISOString().replace("Z", "");
}

function tleToOmm(name, id, line1, line2) {
  return {
    OBJECT_NAME: name,
    NORAD_CAT_ID: id,
    EPOCH: tleEpochIso(line1),
    MEAN_MOTION: Number(line2.slice(52, 63)),
    INCLINATION: Number(line2.slice(8, 16)),
    RA_OF_ASC_NODE: Number(line2.slice(17, 25)),
    MEAN_ANOMALY: Number(line2.slice(43, 51)),
  };
}

function parseTleText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const c = lines[i + 2];
    if (!b.startsWith("1 ") || !c.startsWith("2 ")) continue;
    out.push(tleToOmm(a.replace(/^0\s+/, ""), Number(b.slice(2, 7)), b, c));
    i += 2;
  }
  return out;
}

async function loadLaunches() {
  const pads = [
    ["canaveral", 28.562, -80.577],
    ["kennedy", 28.608, -80.604],
    ["vandenberg", 34.632, -120.611],
    ["guiana", 5.236, -52.775],
    ["taiyuan", 38.849, 111.608],
    ["jiuquan", 40.958, 100.291],
    ["xichang", 28.246, 102.027],
    ["wenchang", 19.614, 110.951],
    ["baikonur", 45.92, 63.342],
    ["starbase", 25.997, -97.157],
    ["boca chica", 25.997, -97.157],
    ["mahia", -39.261, 177.865],
    ["satish", 13.72, 80.23],
    ["sriharikota", 13.72, 80.23],
    ["tanegashima", 30.401, 130.977],
    ["wallops", 37.94, -75.466],
    ["kodiak", 57.436, -152.339],
    ["semnan", 35.234, 53.921],
    ["naro", 34.432, 127.535],
    ["pledsetsk", 62.927, 40.577],
    ["plesetsk", 62.927, 40.577],
    ["vostochny", 51.884, 128.334],
  ];
  try {
    const data = await getJson("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=8&mode=list");
    const live = (data.results || [])
      .map((r) => {
        let lat = Number(r.pad?.latitude);
        let lng = Number(r.pad?.longitude);
        const hay = `${r.pad?.name || r.pad || ""} ${r.location || r.pad?.location?.name || ""}`.toLowerCase();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const hit = pads.find(([k]) => hay.includes(k));
          if (!hit) return null;
          lat = hit[1];
          lng = hit[2];
        }
        return {
          id: `ln-${r.id}`,
          name: r.name,
          lat,
          lng,
          when: r.net,
          pad: r.pad?.name || (typeof r.pad === "string" ? r.pad : "Pad"),
          status: r.status?.name || r.status || "TBD",
        };
      })
      .filter(Boolean);
    if (live.length) return live;
  } catch {
    /* Launch Library free tier throttles — keep pads on the globe. */
  }
  const when = new Date(Date.now() + 36 * 3600e3).toISOString();
  return [
    { id: "ln-ksc", name: "Falcon / Starliner watch — KSC", lat: 28.608, lng: -80.604, when, pad: "LC-39A", status: "WATCH" },
    { id: "ln-ccafs", name: "Atlas / Vulcan watch — Canaveral", lat: 28.562, lng: -80.577, when, pad: "SLC-41", status: "WATCH" },
    { id: "ln-vafb", name: "West-coast polar watch — VAFB", lat: 34.632, lng: -120.611, when, pad: "SLC-4E", status: "WATCH" },
    { id: "ln-sb", name: "Starship flight window — Starbase", lat: 25.997, lng: -97.157, when, pad: "Orbital Pad", status: "WATCH" },
    { id: "ln-kourou", name: "Ariane / Vega watch — Guiana", lat: 5.236, lng: -52.775, when, pad: "ELA-4", status: "WATCH" },
    { id: "ln-baik", name: "Soyuz watch — Baikonur", lat: 45.92, lng: 63.342, when, pad: "Site 31/6", status: "WATCH" },
    { id: "ln-jiu", name: "Long March watch — Jiuquan", lat: 40.958, lng: 100.291, when, pad: "SLS-2", status: "WATCH" },
    { id: "ln-mahia", name: "Electron watch — Māhia", lat: -39.261, lng: 177.865, when, pad: "LC-1", status: "WATCH" },
  ];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const layer = url.pathname.replace("/api/", "").replace(/\/$/, "");
        if (layer === "flights" || layer === "intel") {
          return cachedJson(ctx, "flights", TTL.flights, loadFlights);
        }
        if (layer === "quakes") return cachedJson(ctx, "quakes", TTL.quakes, loadQuakes);
        if (layer === "tle") return cachedJson(ctx, "tle", TTL.tle, loadTle);
        if (layer === "launches") return cachedJson(ctx, "launch-v2", 300, loadLaunches);
        if (layer === "geocode") {
          const q = url.searchParams.get("q") || "";
          if (q.trim().length < 2) return cors(Response.json([]));
          return cachedJson(ctx, "geo:" + q.toLowerCase(), TTL.geocode, () =>
            getJson(
              `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
            ).then((data) =>
              data.map((d) => ({
                name: d.display_name.split(",").slice(0, 3).join(","),
                lat: Number(d.lat),
                lng: Number(d.lon),
              })),
            ),
          );
        }
        if (layer === "health") {
          return cors(Response.json({ ok: true, service: "god-eye", plan: "workers-free" }));
        }
        return cors(Response.json({ error: "unknown" }, { status: 404 }));
      } catch (err) {
        return cors(Response.json({ error: String(err) }, { status: 502 }));
      }
    }

    // SPA_INLINE
    return new Response("GOD EYE", { status: 404 });
  },
};
