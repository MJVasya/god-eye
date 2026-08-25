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

function parseAdsb(ac) {
  const out = [];
  for (const a of ac || []) {
    const lat = Number(a.lat);
    const lng = Number(a.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (a.alt_baro === "ground") continue;
    const altFt = Number(a.alt_geom ?? a.alt_baro);
    const altKm = Number.isFinite(altFt) ? altFt * 0.0003048 : 10;
    const gs = Number(a.gs || 0) * 0.514444;
    const name = String(a.flight || a.r || a.hex || "UNK").trim() || String(a.hex);
    out.push({
      id: "icao-" + a.hex,
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

async function loadAdsb(lat, lng) {
  const out = [];
  const seen = new Set();
  const push = (rows) => {
    for (const f of rows) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const data = await getJson(
        `https://api.adsb.lol/v2/lat/${lat}/lon/${lng}/dist/250`,
        8000,
      );
      push(parseAdsb(data.ac));
    } catch {
      /* rate-limit */
    }
  }
  if (out.length < 15) {
    try {
      const mil = await getJson("https://api.adsb.lol/v2/mil", 8000);
      push(parseAdsb(mil.ac));
    } catch {
      /* mil optional */
    }
  }
  return sample(out, 900);
}

function simulatedAround(lat, lng, now = Date.now()) {
  const out = [];
  const t = now / 1000;
  for (let i = 0; i < 80; i++) {
    const ang = (i / 80) * Math.PI * 2 + t / 180;
    const ring = 0.15 + (i % 7) * 0.12;
    out.push({
      id: `sim-${i}`,
      kind: "flight",
      name: `N${(i % 90) + 10}${String.fromCharCode(65 + (i % 26))}`,
      lat: lat + Math.cos(ang) * ring,
      lng: ((lng + Math.sin(ang) * ring * 1.3 + 540) % 360) - 180,
      altKm: 3 + (i % 11),
      heading: ((ang * 180) / Math.PI + 90) % 360,
      speedMs: 180 + (i % 60),
      country: "SIM",
      meta: "LOCAL · SIMULATED",
      source: "simulated",
    });
  }
  return out;
}

async function loadFlights(lat, lng) {
  const around = Number.isFinite(lat) && Number.isFinite(lng);
  try {
    const flights = await loadAdsb(around ? lat : undefined, around ? lng : undefined);
    if (flights.length > 8) return { flights, source: "live" };
  } catch {
    /* adsb.lol rate-limits */
  }
  if (around) {
    try {
      const lamin = (lat - 3.5).toFixed(2);
      const lamax = (lat + 3.5).toFixed(2);
      const lomin = (lng - 5).toFixed(2);
      const lomax = (lng + 5).toFixed(2);
      const data = await getJson(
        `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,
        8000,
      );
      const out = [];
      for (const s of data.states || []) {
        const slat = Number(s[6]);
        const slng = Number(s[5]);
        if (!Number.isFinite(slat) || !Number.isFinite(slng) || s[8]) continue;
        const alt = Number(s[13] ?? s[7] ?? 0) / 1000;
        out.push({
          id: `icao-${s[0]}`,
          kind: "flight",
          name: String(s[1] || "").trim() || String(s[0] || "UNK"),
          lat: slat,
          lng: slng,
          altKm: Number.isFinite(alt) ? alt : 10,
          heading: Number(s[10] || 0),
          speedMs: Number(s[9] || 220),
          country: String(s[2] || ""),
          meta: `${s[2] || "—"} · FL${Math.round(((Number(s[7]) || 0) * 3.28084) / 100)}`,
          source: "live",
        });
      }
      const flights = sample(out, 800);
      if (flights.length > 8) return { flights, source: "live" };
    } catch {
      /* OpenSky often blocks datacenter IPs */
    }
  }
  return {
    flights: around ? simulatedAround(lat, lng) : simulatedFlights(),
    source: "simulated",
  };
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
          const lat = Number(url.searchParams.get("lat"));
          const lng = Number(url.searchParams.get("lng"));
          const around = Number.isFinite(lat) && Number.isFinite(lng);
          const bucket = around
            ? `${(Math.round(lat * 2) / 2).toFixed(1)}:${(Math.round(lng * 2) / 2).toFixed(1)}`
            : "global";
          return cachedJson(ctx, "flights-v4:" + bucket, TTL.flights, () =>
            loadFlights(around ? lat : undefined, around ? lng : undefined),
          );
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

    if (url.pathname === "/app.js") {
      return new Response("/* global Cesium */\nconst C = window.Cesium;\nC.Ion.defaultAccessToken = \"\";\n\nconst HOME = { lat: 41.8781, lng: -87.6298 };\nconst STREET_KM = 0.55;\nconst CITY_KM = 2.4;\nconst REGION_KM = 18;\nconst GLOBE_KM = 16000;\n\nconst state = {\n  layers: { flights: true, satellites: true, earthquakes: true, launches: true },\n  sensor: \"optical\",\n  mode: \"free\",\n  flights: [],\n  sats: [],\n  quakes: [],\n  launches: [],\n  target: null,\n  source: \"live\",\n  tle: [],\n};\n\nconst imagery = new C.UrlTemplateImageryProvider({\n  url: \"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}\",\n  maximumLevel: 19,\n  credit: \"Esri, Maxar, Earthstar Geographics\",\n});\nconst viewer = new C.Viewer(\"globe\", {\n  baseLayer: new C.ImageryLayer(imagery),\n  terrainProvider: new C.EllipsoidTerrainProvider(),\n  animation: false,\n  timeline: false,\n  geocoder: false,\n  homeButton: false,\n  sceneModePicker: false,\n  baseLayerPicker: false,\n  navigationHelpButton: false,\n  fullscreenButton: false,\n  vrButton: false,\n  infoBox: false,\n  selectionIndicator: true,\n  shouldAnimate: true,\n});\nviewer.scene.globe.enableLighting = false;\nviewer.scene.globe.dynamicAtmosphereLighting = false;\nviewer.scene.globe.showGroundAtmosphere = true;\nviewer.scene.globe.baseColor = C.Color.fromCssColorString(\"#061018\");\nviewer.scene.fog.density = 1.1e-4;\nviewer.scene.screenSpaceCameraController.minimumZoomDistance = 60;\nviewer.scene.screenSpaceCameraController.maximumZoomDistance = 4.5e7;\nviewer.shadows = false;\nviewer.scene.highDynamicRange = false;\nviewer.camera.setView({\n  destination: C.Cartesian3.fromDegrees(HOME.lng, HOME.lat, 2800),\n  orientation: {\n    heading: C.Math.toRadians(28),\n    pitch: C.Math.toRadians(-40),\n    roll: 0,\n  },\n});\nvoid (async () => {\n  try {\n    if (C.ArcGISTiledElevationTerrainProvider && C.ArcGISTiledElevationTerrainProvider.fromUrl) {\n      viewer.terrainProvider = await C.ArcGISTiledElevationTerrainProvider.fromUrl(\n        \"https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer\",\n      );\n      viewer.scene.globe.depthTestAgainstTerrain = true;\n    }\n  } catch {\n    /* ellipsoid */\n  }\n})();\nconst mesh = new C.CustomDataSource(\"mesh\");\nviewer.dataSources.add(mesh);\n\nconst COLORS = {\n  flight: \"#8fde9c\",\n  sat: \"#7eb6ff\",\n  iss: \"#e7eee8\",\n  quake: \"#e25a45\",\n  launch: \"#d7a35a\",\n};\nconst iconCache = new Map();\nfunction contactIcon(kind, color) {\n  const key = kind + color;\n  if (iconCache.has(key)) return iconCache.get(key);\n  const path =\n    kind === \"quake\"\n      ? `<circle cx=\"16\" cy=\"16\" r=\"6\" fill=\"${color}\"/><circle cx=\"16\" cy=\"16\" r=\"11\" fill=\"none\" stroke=\"${color}\" stroke-width=\"2\"/>`\n      : kind === \"launch\"\n        ? `<rect x=\"13\" y=\"4\" width=\"6\" height=\"18\" rx=\"2\" fill=\"${color}\"/><polygon points=\"10,22 22,22 16,30\" fill=\"${color}\"/>`\n        : kind === \"sat\"\n          ? `<rect x=\"12\" y=\"12\" width=\"8\" height=\"8\" fill=\"${color}\"/><rect x=\"4\" y=\"13\" width=\"7\" height=\"6\" fill=\"${color}\" opacity=\".7\"/><rect x=\"21\" y=\"13\" width=\"7\" height=\"6\" fill=\"${color}\" opacity=\".7\"/>`\n          : `<polygon points=\"16,2 20,14 16,12 12,14\" fill=\"${color}\"/><polygon points=\"6,14 26,14 16,18\" fill=\"${color}\"/><rect x=\"14.5\" y=\"18\" width=\"3\" height=\"10\" fill=\"${color}\"/>`;\n  const uri =\n    \"data:image/svg+xml,\" +\n    encodeURIComponent(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\">${path}</svg>`);\n  iconCache.set(key, uri);\n  return uri;\n}\n\nfunction upsert(c) {\n  const pos = C.Cartesian3.fromDegrees(c.lng, c.lat, Math.max(c.altKm, 0.03) * 1000);\n  const color = COLORS[c.kind] || COLORS.flight;\n  const heading = C.Math.toRadians(-(c.heading || 0));\n  const moving = c.kind === \"flight\" || c.kind === \"iss\" || c.kind === \"sat\";\n  let e = mesh.entities.getById(c.id);\n  if (!e) {\n    e = mesh.entities.add({\n      id: c.id,\n      name: c.name,\n      position: pos,\n      billboard: {\n        image: contactIcon(c.kind, color),\n        width: c.kind === \"iss\" ? 28 : 18,\n        height: c.kind === \"iss\" ? 28 : 18,\n        rotation: heading,\n        alignedAxis: moving ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO,\n        scaleByDistance: new C.NearFarScalar(1.2e3, 1.4, 8.0e6, 0.45),\n        disableDepthTestDistance: Number.POSITIVE_INFINITY,\n      },\n      label: {\n        text: c.name,\n        font: \"11px IBM Plex Mono, monospace\",\n        fillColor: C.Color.fromCssColorString(\"#e7eee8\"),\n        showBackground: true,\n        backgroundColor: C.Color.fromCssColorString(\"#07090c\").withAlpha(0.55),\n        pixelOffset: new C.Cartesian2(0, -18),\n        scaleByDistance: new C.NearFarScalar(2.0e3, 1, 6.0e5, 0),\n        disableDepthTestDistance: Number.POSITIVE_INFINITY,\n      },\n    });\n  } else {\n    e.position = new C.ConstantPositionProperty(pos);\n    e.name = c.name;\n    if (e.label) e.label.text = c.name;\n    if (e.billboard) e.billboard.rotation = new C.ConstantProperty(heading);\n  }\n  e.god = c;\n  return e;\n}\n\nfunction sync() {\n  const bags = [];\n  if (state.layers.flights) bags.push(state.flights);\n  if (state.layers.satellites) bags.push(state.sats);\n  if (state.layers.earthquakes) bags.push(state.quakes);\n  if (state.layers.launches) bags.push(state.launches);\n  const keep = new Set();\n  for (const bag of bags) {\n    for (const c of bag) {\n      keep.add(c.id);\n      upsert(c);\n    }\n  }\n  const drop = [];\n  for (const e of mesh.entities.values) if (!keep.has(e.id)) drop.push(e);\n  for (const e of drop) mesh.entities.remove(e);\n}\n\nfunction flyTo(lat, lng, altKm = CITY_KM) {\n  state.target = null;\n  state.mode = \"free\";\n  viewer.trackedEntity = undefined;\n  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);\n  const altM = Math.max(altKm, 0.12) * 1000;\n  const nadir = altM > 3.5e6;\n  viewer.camera.flyTo({\n    destination: C.Cartesian3.fromDegrees(lng, lat, altM),\n    orientation: {\n      heading: C.Math.toRadians(nadir ? 0 : 28),\n      pitch: C.Math.toRadians(nadir ? -90 : -40),\n      roll: 0,\n    },\n    duration: nadir ? 3.1 : 2.4,\n  });\n  renderCard();\n}\n\nviewer.screenSpaceEventHandler.setInputAction((click) => {\n  const ray = viewer.camera.getPickRay(click.position);\n  if (!ray) return;\n  const hit = viewer.scene.globe.pick(ray, viewer.scene);\n  if (!hit) return;\n  const carto = C.Cartographic.fromCartesian(hit);\n  flyTo(C.Math.toDegrees(carto.latitude), C.Math.toDegrees(carto.longitude), STREET_KM);\n}, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);\n\nfunction setSensor(id) {\n  state.sensor = id;\n  document.getElementById(\"globe\").className = id === \"optical\" ? \"\" : id;\n  renderSensors();\n}\n\nfunction setStatus(s) {\n  document.getElementById(\"status\").textContent = s;\n}\n\nfunction formatAlt(altKm) {\n  if (altKm >= 100) return Math.round(altKm) + \" km\";\n  if (altKm >= 1) return altKm.toFixed(1) + \" km\";\n  return Math.round(altKm * 1000) + \" m\";\n}\n\nfunction formatCoord(lat, lng) {\n  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? \"N\" : \"S\"}  ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? \"E\" : \"W\"}`;\n}\n\nasync function load(path) {\n  const res = await fetch(\"/api/\" + path);\n  if (!res.ok) throw new Error(path);\n  return res.json();\n}\n\nfunction cameraLatLng() {\n  const carto = viewer.camera.positionCartographic;\n  if (!carto) return { lat: HOME.lat, lng: HOME.lng };\n  return { lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude) };\n}\n\nfunction deadReckon(f, dt) {\n  const km = (f.speedMs * dt) / 1000;\n  const rad = (f.heading * Math.PI) / 180;\n  f.lat += (km * Math.cos(rad)) / 111.32;\n  f.lng += (km * Math.sin(rad)) / (111.32 * Math.cos((f.lat * Math.PI) / 180) || 1);\n}\n\nasync function refreshFlights() {\n  try {\n    setStatus(\"SYNC FLIGHTS\");\n    const { lat, lng } = cameraLatLng();\n    const data = await load(\"flights?lat=\" + lat.toFixed(2) + \"&lng=\" + lng.toFixed(2));\n    state.flights = data.flights || [];\n    state.source = data.source || \"live\";\n    const pill = document.getElementById(\"pill\");\n    pill.textContent = state.source === \"live\" ? \"LIVE\" : \"SIM\";\n    pill.className = \"pill\" + (state.source === \"live\" ? \"\" : \" sim\");\n    setStatus(state.source === \"live\" ? \"LIVE MESH\" : \"SIMULATED AIR\");\n    sync();\n    counts();\n  } catch {\n    setStatus(\"FLIGHT FEED FAIL\");\n  }\n}\n\nasync function refreshRest() {\n  try {\n    const [q, t, l] = await Promise.all([\n      load(\"quakes\").catch(() => []),\n      load(\"tle\").catch(() => []),\n      load(\"launches\").catch(() => []),\n    ]);\n    state.quakes = q;\n    state.tle = t;\n    state.launches = (l || []).map((x) => ({\n      id: x.id,\n      kind: \"launch\",\n      name: x.name,\n      lat: x.lat,\n      lng: x.lng,\n      altKm: 0.04,\n      heading: 0,\n      speedMs: 0,\n      meta: `${x.pad} · ${x.status}`,\n    }));\n    propagate();\n    sync();\n    counts();\n  } catch {\n    setStatus(\"LAYER PARTIAL\");\n  }\n}\n\nfunction gstime(date) {\n  const jd = date.getTime() / 86400000 + 2440587.5;\n  const tt = (jd - 2451545.0) / 36525;\n  let gmst = 67310.54841 + (876600 * 3600 + 8640184.812866) * tt + 0.093104 * tt * tt - 6.2e-6 * tt * tt * tt;\n  gmst = ((gmst % 86400) + 86400) % 86400;\n  return (gmst / 240) * (Math.PI / 180);\n}\n\nfunction propagate() {\n  if (!state.tle.length) return;\n  const date = new Date();\n  const gmst = gstime(date);\n  const EARTH_R = 6371;\n  const out = [];\n  for (const t of state.tle.slice(0, 220)) {\n    const mm = t.MEAN_MOTION;\n    if (!mm) continue;\n    const epoch = Date.parse(t.EPOCH + \"Z\");\n    const minutes = (date.getTime() - epoch) / 60000;\n    const M = ((t.MEAN_ANOMALY + mm * minutes * 360) % 360) * (Math.PI / 180);\n    const inc = t.INCLINATION * (Math.PI / 180);\n    const raan = t.RA_OF_ASC_NODE * (Math.PI / 180) - 7.292115e-5 * (minutes * 60);\n    const r = Math.pow(398600.4418 / ((mm * 2 * Math.PI) / 86400) ** 2, 1 / 3);\n    const x = r * (Math.cos(raan) * Math.cos(M) - Math.sin(raan) * Math.sin(M) * Math.cos(inc));\n    const y = r * (Math.sin(raan) * Math.cos(M) + Math.cos(raan) * Math.sin(M) * Math.cos(inc));\n    const z = r * (Math.sin(M) * Math.sin(inc));\n    const lst = Math.atan2(y, x) - gmst;\n    const lat = (Math.asin(Math.max(-1, Math.min(1, z / r))) * 180) / Math.PI;\n    const lng = (((lst * 180) / Math.PI + 540) % 360) - 180;\n    const name = (t.OBJECT_NAME || \"SAT\").trim();\n    out.push({\n      id: \"sat-\" + t.NORAD_CAT_ID,\n      kind: /ISS/i.test(name) ? \"iss\" : \"sat\",\n      name,\n      lat,\n      lng,\n      altKm: r - EARTH_R,\n      heading: 0,\n      speedMs: 7600,\n      meta: `${Math.round(r - EARTH_R)} km · TLE`,\n    });\n  }\n  state.sats = out.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));\n}\n\nfunction counts() {\n  document.getElementById(\"stats\").innerHTML = [\n    [\"AIR\", state.flights.length],\n    [\"SAT\", state.sats.length],\n    [\"EQ\", state.quakes.length],\n  ]\n    .map(([k, v]) => `<span>${k}<b>${v}</b></span>`)\n    .join(\"\");\n}\n\nfunction renderDock() {\n  const layers = [\n    [\"flights\", \"FLIGHTS\"],\n    [\"satellites\", \"ORBIT\"],\n    [\"earthquakes\", \"SEISMIC\"],\n    [\"launches\", \"LAUNCH\"],\n  ];\n  document.getElementById(\"dock\").innerHTML = layers\n    .map(\n      ([id, label]) =>\n        `<button type=\"button\" data-layer=\"${id}\" class=\"${state.layers[id] ? \"on\" : \"\"}\">${label}</button>`,\n    )\n    .join(\"\");\n  document.getElementById(\"dock\").onclick = (ev) => {\n    const b = ev.target.closest(\"button\");\n    if (!b) return;\n    const id = b.dataset.layer;\n    state.layers[id] = !state.layers[id];\n    renderDock();\n    sync();\n  };\n}\n\nfunction renderSensors() {\n  const items = [\n    [\"optical\", \"1 OPTICAL\"],\n    [\"nvg\", \"2 NVG\"],\n    [\"flir\", \"3 FLIR\"],\n    [\"noir\", \"4 NOIR\"],\n    [\"crt\", \"5 CRT\"],\n  ];\n  document.getElementById(\"sensors\").innerHTML = items\n    .map(\n      ([id, label]) =>\n        `<button type=\"button\" data-s=\"${id}\" class=\"${state.sensor === id ? \"on\" : \"\"}\">${label}</button>`,\n    )\n    .join(\"\");\n  document.getElementById(\"sensors\").onclick = (ev) => {\n    const b = ev.target.closest(\"button\");\n    if (b) setSensor(b.dataset.s);\n  };\n}\n\nfunction renderMissions() {\n  document.getElementById(\"missions\").innerHTML = [\n    [\"city\", \"CITY DIVE\"],\n    [\"street\", \"STREET\"],\n    [\"contacts\", \"LIVE CONTACTS\"],\n    [\"orbit\", \"ORBITAL WATCH\"],\n    [\"reset\", \"RESET\"],\n  ]\n    .map(([id, label]) => `<button type=\"button\" data-m=\"${id}\">${label}</button>`)\n    .join(\"\");\n  document.getElementById(\"missions\").onclick = (ev) => {\n    const b = ev.target.closest(\"button\");\n    if (!b) return;\n    const m = b.dataset.m;\n    if (m === \"city\") {\n      state.layers.flights = true;\n      setSensor(\"optical\");\n      flyTo(HOME.lat, HOME.lng, CITY_KM);\n    } else if (m === \"street\") {\n      setSensor(\"optical\");\n      flyTo(HOME.lat, HOME.lng, STREET_KM);\n    } else if (m === \"contacts\") {\n      state.layers.flights = true;\n      setSensor(\"optical\");\n      flyTo(40.641, -73.778, REGION_KM);\n    } else if (m === \"orbit\") {\n      state.layers.satellites = true;\n      flyTo(0, -80, GLOBE_KM);\n    } else if (m === \"reset\") flyTo(20, -30, GLOBE_KM);\n    renderDock();\n  };\n}\n\nfunction renderCard() {\n  const el = document.getElementById(\"card\");\n  const t = state.target;\n  if (!t) {\n    el.hidden = true;\n    return;\n  }\n  el.hidden = false;\n  el.innerHTML = `<p class=\"meta\">${t.kind.toUpperCase()}</p><h2>${t.name}</h2>\n    <p class=\"meta\">${formatCoord(t.lat, t.lng)}</p>\n    <p>${t.meta || \"\"}</p>\n    <div class=\"row\"><button class=\"go\" id=\"cockpit\">COCKPIT</button><button class=\"ghost\" id=\"drop\">DROP</button></div>`;\n  document.getElementById(\"drop\").onclick = () => {\n    state.target = null;\n    state.mode = \"free\";\n    viewer.trackedEntity = undefined;\n    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);\n    renderCard();\n  };\n  document.getElementById(\"cockpit\").onclick = () => {\n    state.mode = \"cockpit\";\n  };\n}\n\nviewer.selectedEntityChanged.addEventListener(() => {\n  const e = viewer.selectedEntity;\n  if (e && e.god) {\n    state.target = e.god;\n    state.mode = \"track\";\n    viewer.trackedEntity = e;\n    renderCard();\n  } else if (state.mode !== \"cockpit\") {\n    state.target = null;\n    state.mode = \"free\";\n    viewer.trackedEntity = undefined;\n    renderCard();\n  }\n});\n\nviewer.scene.preUpdate.addEventListener(() => {\n  if (state.layers.flights) {\n    const dt = Math.min(0.05, 0.016);\n    for (const f of state.flights) deadReckon(f, dt);\n  }\n  const lookEl = document.getElementById(\"look\");\n  if (lookEl) {\n    const carto = viewer.camera.positionCartographic;\n    if (carto) {\n      lookEl.textContent =\n        formatCoord(C.Math.toDegrees(carto.latitude), C.Math.toDegrees(carto.longitude)) +\n        \"  ·  \" +\n        formatAlt(carto.height / 1000);\n    }\n  }\n  const t = state.target;\n  if (!t) return;\n  const live =\n    state.flights.find((x) => x.id === t.id) ||\n    state.sats.find((x) => x.id === t.id) ||\n    t;\n  const e = mesh.entities.getById(live.id);\n  if (!e) return;\n  if (state.mode === \"track\") {\n    viewer.trackedEntity = e;\n    return;\n  }\n  if (state.mode !== \"cockpit\") return;\n  viewer.trackedEntity = undefined;\n  const pos = e.position && e.position.getValue(viewer.clock.currentTime);\n  if (!pos) return;\n  const heading = C.Math.toRadians(live.heading || 0);\n  viewer.camera.lookAt(pos, new C.HeadingPitchRange(heading, C.Math.toRadians(-18), 70 + Math.max(live.altKm, 0.2) * 4));\n});\n\nasync function loadGoogle(key) {\n  const trimmed = (key || \"\").trim();\n  if (!trimmed) return;\n  localStorage.setItem(\"god-eye-google-tiles-key\", trimmed);\n  try {\n    if (C.GoogleMaps) C.GoogleMaps.defaultApiKey = trimmed;\n    let tileset;\n    if (typeof C.createGooglePhotorealistic3DTileset === \"function\") {\n      tileset = await C.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });\n    } else {\n      tileset = await C.Cesium3DTileset.fromUrl(\n        \"https://tile.googleapis.com/v1/3dtiles/root.json?key=\" + encodeURIComponent(trimmed),\n      );\n    }\n    viewer.scene.primitives.add(tileset);\n    setStatus(\"GOOGLE 3D TILES\");\n    flyTo(HOME.lat, HOME.lng, STREET_KM);\n  } catch {\n    setStatus(\"3D TILES FAIL\");\n  }\n}\n\ndocument.getElementById(\"enter\").onclick = () => {\n  document.getElementById(\"boot\").remove();\n  document.getElementById(\"hud\").hidden = false;\n  renderDock();\n  renderSensors();\n  renderMissions();\n  flyTo(HOME.lat, HOME.lng, CITY_KM);\n  void refreshFlights();\n  void refreshRest();\n  const saved = localStorage.getItem(\"god-eye-google-tiles-key\");\n  if (saved) {\n    document.getElementById(\"gkey\").value = saved;\n    void loadGoogle(saved);\n  }\n};\n\ndocument.getElementById(\"src\").onclick = () => {\n  document.getElementById(\"about\").hidden = false;\n};\ndocument.getElementById(\"about-close\").onclick = () => {\n  document.getElementById(\"about\").hidden = true;\n};\ndocument.getElementById(\"about\").addEventListener(\"click\", (e) => {\n  if (e.target.id === \"about\") e.currentTarget.hidden = true;\n});\ndocument.getElementById(\"gkey-apply\").onclick = () => {\n  void loadGoogle(document.getElementById(\"gkey\").value);\n  document.getElementById(\"about\").hidden = true;\n};\n\nlet geoTimer;\ndocument.getElementById(\"q\").addEventListener(\"input\", (e) => {\n  const q = e.target.value.trim();\n  clearTimeout(geoTimer);\n  if (q.length < 2) {\n    document.getElementById(\"hits\").hidden = true;\n    return;\n  }\n  geoTimer = setTimeout(async () => {\n    const hits = await load(\"geocode?q=\" + encodeURIComponent(q));\n    const ul = document.getElementById(\"hits\");\n    ul.hidden = !hits.length;\n    ul.innerHTML = hits\n      .map((h) => `<li><button data-lat=\"${h.lat}\" data-lng=\"${h.lng}\">${h.name}</button></li>`)\n      .join(\"\");\n    ul.onclick = (ev) => {\n      const b = ev.target.closest(\"button\");\n      if (!b) return;\n      flyTo(Number(b.dataset.lat), Number(b.dataset.lng), STREET_KM);\n      ul.hidden = true;\n    };\n  }, 280);\n});\n\nwindow.addEventListener(\"keydown\", (e) => {\n  if (e.target instanceof HTMLInputElement) return;\n  const map = { Digit1: \"optical\", Digit2: \"nvg\", Digit3: \"flir\", Digit4: \"noir\", Digit5: \"crt\" };\n  if (map[e.code]) setSensor(map[e.code]);\n  if (e.code === \"Escape\") {\n    state.target = null;\n    state.mode = \"free\";\n    viewer.trackedEntity = undefined;\n    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);\n    renderCard();\n    const about = document.getElementById(\"about\");\n    if (about) about.hidden = true;\n  }\n  if (e.code === \"KeyC\" && state.target) state.mode = state.mode === \"cockpit\" ? \"track\" : \"cockpit\";\n  if (e.code === \"KeyR\") flyTo(20, -30, GLOBE_KM);\n});\n\nwindow.addEventListener(\"resize\", () => viewer.resize());\n\nsetInterval(() => {\n  document.getElementById(\"stamp\").textContent = new Date().toISOString().slice(0, 19).replace(\"T\", \"  \") + \"Z\";\n}, 1000);\nsetInterval(() => void refreshFlights(), 28000);\nsetInterval(() => {\n  propagate();\n  sync();\n  counts();\n}, 2500);\n", { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    if (url.pathname === "/" || url.pathname === "/index.html" || !url.pathname.includes(".")) {
      return new Response("<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>GOD EYE</title>\n    <meta name=\"theme-color\" content=\"#07090c\" />\n    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />\n    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />\n    <link\n      href=\"https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap\"\n      rel=\"stylesheet\"\n    />\n    <script>\n      window.CESIUM_BASE_URL = \"https://cdn.jsdelivr.net/npm/cesium@1.125.0/Build/Cesium/\";\n    </script>\n    <link\n      rel=\"stylesheet\"\n      href=\"https://cdn.jsdelivr.net/npm/cesium@1.125.0/Build/Cesium/Widgets/widgets.css\"\n    />\n    <style>\n      :root {\n        --void: #07090c;\n        --surface: #101614;\n        --paper: #e7eee8;\n        --muted: #7d8a80;\n        --line: #24302a;\n        --accent: #8fde9c;\n        --accent-fg: #07110c;\n      }\n      * { box-sizing: border-box; }\n      html, body { height: 100%; margin: 0; background: var(--void); color: var(--paper);\n        font-family: \"IBM Plex Sans\", system-ui, sans-serif; }\n      canvas { display: block; }\n      #globe { position: fixed; inset: 0; }\n      #globe.nvg .cesium-widget canvas { filter: hue-rotate(72deg) saturate(1.8) brightness(1.08) contrast(1.18); }\n      #globe.flir .cesium-widget canvas { filter: grayscale(1) contrast(1.7) sepia(1) hue-rotate(-40deg) saturate(5); }\n      #globe.noir .cesium-widget canvas { filter: grayscale(1) contrast(1.35) brightness(0.9); }\n      #globe.crt .cesium-widget canvas { filter: contrast(1.25) saturate(1.15); }\n      .cesium-viewer-toolbar, .cesium-viewer-animationContainer, .cesium-viewer-timelineContainer,\n      .cesium-viewer-fullscreenContainer, .cesium-viewer-vrContainer, .cesium-viewer-geocoderContainer,\n      .cesium-viewer-infoBoxContainer { display: none !important; }\n      .cesium-viewer, .cesium-widget, .cesium-widget canvas, .cesium-viewer-cesiumWidgetContainer { width: 100%; height: 100%; }\n      .cesium-viewer-bottom { pointer-events: none; opacity: 0.65; }\n      #hud { position: fixed; inset: 0; pointer-events: none; }\n      header, .dock, .sensors, .search, .stats, .missions, .card, .brief, .boot {\n        pointer-events: auto;\n      }\n      header { position: absolute; top: 14px; left: 14px; display: flex; gap: 12px; align-items: center; }\n      .mark { width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 10px; display: grid; place-items: center; background: var(--surface); }\n      .brand { font-family: \"Barlow Condensed\", sans-serif; letter-spacing: 0.18em; font-size: 22px; margin: 0; }\n      .sub { font-family: \"IBM Plex Mono\", monospace; font-size: 10px; letter-spacing: 0.22em; color: var(--muted); margin: 4px 0 0; }\n      .dock { position: absolute; top: 78px; left: 14px; display: flex; flex-direction: column; gap: 6px; }\n      .dock button, .sensors button, .missions button, .stats span {\n        font-family: \"IBM Plex Mono\", monospace; font-size: 10px; letter-spacing: 0.16em;\n        border: 1px solid var(--line); background: rgba(16,22,20,0.9); color: var(--muted);\n        border-radius: 8px; padding: 8px 10px; cursor: pointer;\n      }\n      .dock button.on, .sensors button.on { border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); color: var(--accent); }\n      .sensors { position: absolute; top: 78px; right: 14px; display: flex; flex-direction: column; gap: 6px; align-items: end; }\n      .sensors button.on { background: var(--accent); color: var(--accent-fg); }\n      .search { position: absolute; top: 14px; right: 14px; width: min(18rem, calc(100% - 11rem)); }\n      .search input {\n        width: 100%; background: rgba(16,22,20,0.92); border: 1px solid var(--line); color: var(--paper);\n        border-radius: 12px; padding: 10px 12px; font: 14px \"IBM Plex Sans\", sans-serif;\n      }\n      .hits { margin: 6px 0 0; padding: 0; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }\n      .hits button { display: block; width: 100%; text-align: left; background: none; border: 0; color: var(--paper); padding: 8px 12px; cursor: pointer; font-size: 13px; }\n      .hits button:hover { background: #18201c; }\n      .stats { position: absolute; left: 14px; bottom: 14px; display: flex; gap: 8px; flex-wrap: wrap; }\n      .stats span { color: var(--paper); }\n      .stats b { display: block; font-size: 14px; }\n      .missions { position: absolute; right: 14px; bottom: 14px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: end; max-width: 70%; }\n      .missions button { color: var(--paper); }\n      .card {\n        position: absolute; right: 14px; bottom: 72px; width: min(20rem, calc(100% - 28px));\n        background: rgba(16,22,20,0.95); border: 1px solid var(--line); border-radius: 16px; padding: 16px;\n      }\n      .card h2 { font-family: \"Barlow Condensed\", sans-serif; letter-spacing: 0.08em; margin: 4px 0; font-size: 28px; }\n      .card p { margin: 6px 0; color: color-mix(in oklab, var(--paper) 80%, transparent); font-size: 14px; }\n      .card .meta { font-family: \"IBM Plex Mono\", monospace; font-size: 11px; color: var(--muted); }\n      .card .row { display: flex; gap: 8px; margin-top: 12px; }\n      .card .row button { flex: 1; border: 0; border-radius: 8px; padding: 10px; font-family: \"IBM Plex Mono\", monospace; letter-spacing: 0.16em; cursor: pointer; }\n      .go { background: var(--paper); color: var(--void); }\n      .ghost { background: transparent; border: 1px solid var(--line) !important; color: var(--muted); }\n      .live { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); font-family: \"IBM Plex Mono\", monospace; font-size: 11px; color: var(--muted); text-align: center; }\n      .look { display: block; margin-top: 4px; color: var(--paper); letter-spacing: 0.04em; }\n      .pill { background: var(--accent); color: var(--accent-fg); border-radius: 999px; padding: 2px 8px; margin-left: 8px; }\n      .pill.sim { background: #d7a35a; color: var(--void); }\n      .boot { position: fixed; inset: 0; background: color-mix(in oklab, var(--void) 55%, transparent); display: grid; place-items: center; z-index: 20; }\n      .boot-card { width: min(28rem, calc(100% - 2rem)); background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; }\n      .boot-card h1 { font-family: \"Barlow Condensed\", sans-serif; letter-spacing: 0.16em; font-size: 48px; margin: 8px 0; }\n      .boot-card button { width: 100%; margin-top: 20px; border: 0; background: var(--paper); color: var(--void); border-radius: 12px; padding: 12px; font-family: \"IBM Plex Mono\", monospace; letter-spacing: 0.2em; cursor: pointer; }\n      .note { position: absolute; left: 14px; bottom: 72px; max-width: 18rem; font-family: \"IBM Plex Mono\", monospace; font-size: 9px; color: var(--muted); line-height: 1.45; pointer-events: auto; }\n      .note a, .src-link, .boot-links a { color: var(--accent); text-decoration: none; }\n      .src-link { display: block; margin-top: 6px; font-family: \"IBM Plex Mono\", monospace; font-size: 10px; letter-spacing: 0.18em; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; }\n      .boot-links { display: flex; gap: 16px; margin-top: 16px; font-family: \"IBM Plex Mono\", monospace; font-size: 10px; letter-spacing: 0.18em; }\n      .boot-links a.dim { color: var(--muted); }\n      .about { position: absolute; inset: 0; background: color-mix(in oklab, var(--void) 70%, transparent); display: none; place-items: center; z-index: 30; pointer-events: auto; }\n      .about:not([hidden]) { display: grid; }\n      .about-card { width: min(28rem, calc(100% - 2rem)); background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 22px; }\n      .about-card h2 { font-family: \"Barlow Condensed\", sans-serif; letter-spacing: 0.12em; font-size: 32px; margin: 8px 0; }\n      .about-card p { font-size: 14px; line-height: 1.5; color: color-mix(in oklab, var(--paper) 85%, transparent); }\n      .about-card a, .about-card button { display: flex; align-items: center; min-height: 44px; margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 0 12px; font-family: \"IBM Plex Mono\", monospace; font-size: 10px; letter-spacing: 0.18em; text-decoration: none; color: var(--paper); background: var(--void); }\n      .about-card a.primary { border-color: color-mix(in oklab, var(--accent) 40%, var(--line)); color: var(--accent); }\n      .about-card input {\n        width: 100%; margin-top: 8px; min-height: 44px; border: 1px solid var(--line); border-radius: 10px;\n        background: var(--void); color: var(--paper); padding: 0 12px; font-family: \"IBM Plex Mono\", monospace; font-size: 12px;\n      }\n      @media (max-width: 720px) {\n        .search, .live, .note { display: none; }\n        .card { bottom: 96px; }\n      }\n    </style>\n  </head>\n  <body>\n    <div id=\"globe\"></div>\n    <div id=\"boot\" class=\"boot\">\n      <div class=\"boot-card\">\n        <p class=\"sub\">SYSTEM BOOT</p>\n        <h1>GOD EYE</h1>\n        <p>Photoreal satellite globe. Opens over Chicago. Scroll to street, double-click to dive. Paste a Google Map Tiles key in SOURCE for 3D buildings.</p>\n        <button id=\"enter\" type=\"button\">OPEN THE MESH</button>\n        <div class=\"boot-links\">\n          <a href=\"https://github.com/MJVasya/god-eye\" target=\"_blank\" rel=\"noreferrer\">SOURCE</a>\n          <a class=\"dim\" href=\"https://github.com/bilawalsidhu/gods-eye-view\" target=\"_blank\" rel=\"noreferrer\">CESIUM ORIGINAL</a>\n        </div>\n      </div>\n    </div>\n    <div id=\"hud\" hidden>\n      <header>\n        <div class=\"mark\">\n          <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#8fde9c\" stroke-width=\"1.7\">\n            <circle cx=\"12\" cy=\"12\" r=\"3\" /><circle cx=\"12\" cy=\"12\" r=\"8\" /><path d=\"M12 2v3M12 19v3M2 12h3M19 12h3\" />\n          </svg>\n        </div>\n        <div>\n          <p class=\"brand\">GOD EYE</p>\n          <p class=\"sub\">ORBITAL INTELLIGENCE · PUBLIC MESH</p>\n          <button id=\"src\" class=\"src-link\" type=\"button\">SOURCE · MIT</button>\n        </div>\n      </header>\n      <div class=\"live\"><span id=\"stamp\"></span><span id=\"pill\" class=\"pill\">LIVE</span> <span id=\"status\">STANDBY</span><span id=\"look\" class=\"look\"></span></div>\n      <div class=\"search\">\n        <input id=\"q\" placeholder=\"Find a city, airport, pad\" />\n        <ul id=\"hits\" class=\"hits\" hidden></ul>\n      </div>\n      <div class=\"dock\" id=\"dock\"></div>\n      <div class=\"sensors\" id=\"sensors\"></div>\n      <div class=\"stats\" id=\"stats\"></div>\n      <div class=\"missions\" id=\"missions\"></div>\n      <div id=\"card\" class=\"card\" hidden></div>\n      <p class=\"note\">Public feeds only. Delayed or modeled. Not for navigation or emergency use. Cache-first Worker on the Cloudflare free plan. <a href=\"https://github.com/MJVasya/god-eye\" target=\"_blank\" rel=\"noreferrer\">Source</a> · <a href=\"https://github.com/bilawalsidhu/gods-eye-view\" target=\"_blank\" rel=\"noreferrer\">Cesium original</a></p>\n      <div id=\"about\" class=\"about\" hidden>\n        <div class=\"about-card\">\n          <p class=\"sub\">ABOUT · MIT</p>\n          <h2>GOD EYE</h2>\n          <p>Independent rewrite. Cesium + Esri Maxar satellite with real terrain — dive to rooftops, double-click to go closer. Not a fork of the Google 3D Tiles client. Paste a Map Tiles key below for photoreal buildings.</p>\n          <a class=\"primary\" href=\"https://github.com/MJVasya/god-eye\" target=\"_blank\" rel=\"noreferrer\">THIS SOURCE</a>\n          <a href=\"https://github.com/bilawalsidhu/gods-eye-view\" target=\"_blank\" rel=\"noreferrer\">CESIUM ORIGINAL</a>\n          <input id=\"gkey\" type=\"password\" autocomplete=\"off\" placeholder=\"Optional Google Map Tiles key\" />\n          <button id=\"gkey-apply\" type=\"button\">LOAD 3D TILES</button>\n          <button id=\"about-close\" type=\"button\">CLOSE</button>\n        </div>\n      </div>\n    </div>\n    <script src=\"https://cdn.jsdelivr.net/npm/cesium@1.125.0/Build/Cesium/Cesium.js\"></script>\n    <script type=\"module\" src=\"/app.js\"></script>\n  </body>\n</html>\n", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" } });
    }
    return new Response("not found", { status: 404 });
  },
};
