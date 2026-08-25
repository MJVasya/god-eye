/* global Cesium */
const C = window.Cesium;
C.Ion.defaultAccessToken = "";

const HOME = { lat: 41.8781, lng: -87.6298 };
const STREET_KM = 0.55;
const CITY_KM = 2.4;
const REGION_KM = 18;
const GLOBE_KM = 16000;

const state = {
  layers: { flights: true, satellites: true, earthquakes: true, launches: true },
  sensor: "optical",
  mode: "free",
  flights: [],
  sats: [],
  quakes: [],
  launches: [],
  target: null,
  source: "live",
  tle: [],
};

const imagery = new C.UrlTemplateImageryProvider({
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maximumLevel: 19,
  credit: "Esri, Maxar, Earthstar Geographics",
});
const viewer = new C.Viewer("globe", {
  baseLayer: new C.ImageryLayer(imagery),
  terrainProvider: new C.EllipsoidTerrainProvider(),
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  vrButton: false,
  infoBox: false,
  selectionIndicator: true,
  shouldAnimate: true,
});
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.dynamicAtmosphereLighting = false;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.globe.baseColor = C.Color.fromCssColorString("#061018");
viewer.scene.fog.density = 1.1e-4;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 60;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 4.5e7;
viewer.shadows = false;
viewer.scene.highDynamicRange = false;
viewer.camera.setView({
  destination: C.Cartesian3.fromDegrees(HOME.lng, HOME.lat, 2800),
  orientation: {
    heading: C.Math.toRadians(28),
    pitch: C.Math.toRadians(-40),
    roll: 0,
  },
});
void (async () => {
  try {
    if (C.ArcGISTiledElevationTerrainProvider && C.ArcGISTiledElevationTerrainProvider.fromUrl) {
      viewer.terrainProvider = await C.ArcGISTiledElevationTerrainProvider.fromUrl(
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
      );
      viewer.scene.globe.depthTestAgainstTerrain = true;
    }
  } catch {
    /* ellipsoid */
  }
})();
const mesh = new C.CustomDataSource("mesh");
viewer.dataSources.add(mesh);

const COLORS = {
  flight: "#8fde9c",
  sat: "#7eb6ff",
  iss: "#e7eee8",
  quake: "#e25a45",
  launch: "#d7a35a",
};
const iconCache = new Map();
function contactIcon(kind, color) {
  const key = kind + color;
  if (iconCache.has(key)) return iconCache.get(key);
  const path =
    kind === "quake"
      ? `<circle cx="16" cy="16" r="6" fill="${color}"/><circle cx="16" cy="16" r="11" fill="none" stroke="${color}" stroke-width="2"/>`
      : kind === "launch"
        ? `<rect x="13" y="4" width="6" height="18" rx="2" fill="${color}"/><polygon points="10,22 22,22 16,30" fill="${color}"/>`
        : kind === "sat"
          ? `<rect x="12" y="12" width="8" height="8" fill="${color}"/><rect x="4" y="13" width="7" height="6" fill="${color}" opacity=".7"/><rect x="21" y="13" width="7" height="6" fill="${color}" opacity=".7"/>`
          : `<polygon points="16,2 20,14 16,12 12,14" fill="${color}"/><polygon points="6,14 26,14 16,18" fill="${color}"/><rect x="14.5" y="18" width="3" height="10" fill="${color}"/>`;
  const uri =
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${path}</svg>`);
  iconCache.set(key, uri);
  return uri;
}

function upsert(c) {
  const pos = C.Cartesian3.fromDegrees(c.lng, c.lat, Math.max(c.altKm, 0.03) * 1000);
  const color = COLORS[c.kind] || COLORS.flight;
  const heading = C.Math.toRadians(-(c.heading || 0));
  const moving = c.kind === "flight" || c.kind === "iss" || c.kind === "sat";
  let e = mesh.entities.getById(c.id);
  if (!e) {
    e = mesh.entities.add({
      id: c.id,
      name: c.name,
      position: pos,
      billboard: {
        image: contactIcon(c.kind, color),
        width: c.kind === "iss" ? 28 : 18,
        height: c.kind === "iss" ? 28 : 18,
        rotation: heading,
        alignedAxis: moving ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO,
        scaleByDistance: new C.NearFarScalar(1.2e3, 1.4, 8.0e6, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: c.name,
        font: "11px IBM Plex Mono, monospace",
        fillColor: C.Color.fromCssColorString("#e7eee8"),
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#07090c").withAlpha(0.55),
        pixelOffset: new C.Cartesian2(0, -18),
        scaleByDistance: new C.NearFarScalar(2.0e3, 1, 6.0e5, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    e.position = new C.ConstantPositionProperty(pos);
    e.name = c.name;
    if (e.label) e.label.text = c.name;
    if (e.billboard) e.billboard.rotation = new C.ConstantProperty(heading);
  }
  e.god = c;
  return e;
}

function sync() {
  const bags = [];
  if (state.layers.flights) bags.push(state.flights);
  if (state.layers.satellites) bags.push(state.sats);
  if (state.layers.earthquakes) bags.push(state.quakes);
  if (state.layers.launches) bags.push(state.launches);
  const keep = new Set();
  for (const bag of bags) {
    for (const c of bag) {
      keep.add(c.id);
      upsert(c);
    }
  }
  const drop = [];
  for (const e of mesh.entities.values) if (!keep.has(e.id)) drop.push(e);
  for (const e of drop) mesh.entities.remove(e);
}

function flyTo(lat, lng, altKm = CITY_KM) {
  state.target = null;
  state.mode = "free";
  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  const altM = Math.max(altKm, 0.12) * 1000;
  const nadir = altM > 3.5e6;
  viewer.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(lng, lat, altM),
    orientation: {
      heading: C.Math.toRadians(nadir ? 0 : 28),
      pitch: C.Math.toRadians(nadir ? -90 : -40),
      roll: 0,
    },
    duration: nadir ? 3.1 : 2.4,
  });
  renderCard();
}

viewer.screenSpaceEventHandler.setInputAction((click) => {
  const ray = viewer.camera.getPickRay(click.position);
  if (!ray) return;
  const hit = viewer.scene.globe.pick(ray, viewer.scene);
  if (!hit) return;
  const carto = C.Cartographic.fromCartesian(hit);
  flyTo(C.Math.toDegrees(carto.latitude), C.Math.toDegrees(carto.longitude), STREET_KM);
}, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

function setSensor(id) {
  state.sensor = id;
  document.getElementById("globe").className = id === "optical" ? "" : id;
  renderSensors();
}

function setStatus(s) {
  document.getElementById("status").textContent = s;
}

function formatAlt(altKm) {
  if (altKm >= 100) return Math.round(altKm) + " km";
  if (altKm >= 1) return altKm.toFixed(1) + " km";
  return Math.round(altKm * 1000) + " m";
}

function formatCoord(lat, lng) {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? "E" : "W"}`;
}

async function load(path) {
  const res = await fetch("/api/" + path);
  if (!res.ok) throw new Error(path);
  return res.json();
}

function cameraLatLng() {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return { lat: HOME.lat, lng: HOME.lng };
  return { lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude) };
}

function deadReckon(f, dt) {
  const km = (f.speedMs * dt) / 1000;
  const rad = (f.heading * Math.PI) / 180;
  f.lat += (km * Math.cos(rad)) / 111.32;
  f.lng += (km * Math.sin(rad)) / (111.32 * Math.cos((f.lat * Math.PI) / 180) || 1);
}

async function refreshFlights() {
  try {
    setStatus("SYNC FLIGHTS");
    const { lat, lng } = cameraLatLng();
    const data = await load("flights?lat=" + lat.toFixed(2) + "&lng=" + lng.toFixed(2));
    state.flights = data.flights || [];
    state.source = data.source || "live";
    const pill = document.getElementById("pill");
    pill.textContent = state.source === "live" ? "LIVE" : "SIM";
    pill.className = "pill" + (state.source === "live" ? "" : " sim");
    setStatus(state.source === "live" ? "LIVE MESH" : "SIMULATED AIR");
    sync();
    counts();
  } catch {
    setStatus("FLIGHT FEED FAIL");
  }
}

async function refreshRest() {
  try {
    const [q, t, l] = await Promise.all([
      load("quakes").catch(() => []),
      load("tle").catch(() => []),
      load("launches").catch(() => []),
    ]);
    state.quakes = q;
    state.tle = t;
    state.launches = (l || []).map((x) => ({
      id: x.id,
      kind: "launch",
      name: x.name,
      lat: x.lat,
      lng: x.lng,
      altKm: 0.04,
      heading: 0,
      speedMs: 0,
      meta: `${x.pad} · ${x.status}`,
    }));
    propagate();
    sync();
    counts();
  } catch {
    setStatus("LAYER PARTIAL");
  }
}

function gstime(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const tt = (jd - 2451545.0) / 36525;
  let gmst = 67310.54841 + (876600 * 3600 + 8640184.812866) * tt + 0.093104 * tt * tt - 6.2e-6 * tt * tt * tt;
  gmst = ((gmst % 86400) + 86400) % 86400;
  return (gmst / 240) * (Math.PI / 180);
}

function propagate() {
  if (!state.tle.length) return;
  const date = new Date();
  const gmst = gstime(date);
  const EARTH_R = 6371;
  const out = [];
  for (const t of state.tle.slice(0, 220)) {
    const mm = t.MEAN_MOTION;
    if (!mm) continue;
    const epoch = Date.parse(t.EPOCH + "Z");
    const minutes = (date.getTime() - epoch) / 60000;
    const M = ((t.MEAN_ANOMALY + mm * minutes * 360) % 360) * (Math.PI / 180);
    const inc = t.INCLINATION * (Math.PI / 180);
    const raan = t.RA_OF_ASC_NODE * (Math.PI / 180) - 7.292115e-5 * (minutes * 60);
    const r = Math.pow(398600.4418 / ((mm * 2 * Math.PI) / 86400) ** 2, 1 / 3);
    const x = r * (Math.cos(raan) * Math.cos(M) - Math.sin(raan) * Math.sin(M) * Math.cos(inc));
    const y = r * (Math.sin(raan) * Math.cos(M) + Math.cos(raan) * Math.sin(M) * Math.cos(inc));
    const z = r * (Math.sin(M) * Math.sin(inc));
    const lst = Math.atan2(y, x) - gmst;
    const lat = (Math.asin(Math.max(-1, Math.min(1, z / r))) * 180) / Math.PI;
    const lng = (((lst * 180) / Math.PI + 540) % 360) - 180;
    const name = (t.OBJECT_NAME || "SAT").trim();
    out.push({
      id: "sat-" + t.NORAD_CAT_ID,
      kind: /ISS/i.test(name) ? "iss" : "sat",
      name,
      lat,
      lng,
      altKm: r - EARTH_R,
      heading: 0,
      speedMs: 7600,
      meta: `${Math.round(r - EARTH_R)} km · TLE`,
    });
  }
  state.sats = out.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

function counts() {
  document.getElementById("stats").innerHTML = [
    ["AIR", state.flights.length],
    ["SAT", state.sats.length],
    ["EQ", state.quakes.length],
  ]
    .map(([k, v]) => `<span>${k}<b>${v}</b></span>`)
    .join("");
}

function renderDock() {
  const layers = [
    ["flights", "FLIGHTS"],
    ["satellites", "ORBIT"],
    ["earthquakes", "SEISMIC"],
    ["launches", "LAUNCH"],
  ];
  document.getElementById("dock").innerHTML = layers
    .map(
      ([id, label]) =>
        `<button type="button" data-layer="${id}" class="${state.layers[id] ? "on" : ""}">${label}</button>`,
    )
    .join("");
  document.getElementById("dock").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const id = b.dataset.layer;
    state.layers[id] = !state.layers[id];
    renderDock();
    sync();
  };
}

function renderSensors() {
  const items = [
    ["optical", "1 OPTICAL"],
    ["nvg", "2 NVG"],
    ["flir", "3 FLIR"],
    ["noir", "4 NOIR"],
    ["crt", "5 CRT"],
  ];
  document.getElementById("sensors").innerHTML = items
    .map(
      ([id, label]) =>
        `<button type="button" data-s="${id}" class="${state.sensor === id ? "on" : ""}">${label}</button>`,
    )
    .join("");
  document.getElementById("sensors").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (b) setSensor(b.dataset.s);
  };
}

function renderMissions() {
  document.getElementById("missions").innerHTML = [
    ["city", "CITY DIVE"],
    ["street", "STREET"],
    ["contacts", "LIVE CONTACTS"],
    ["orbit", "ORBITAL WATCH"],
    ["reset", "RESET"],
  ]
    .map(([id, label]) => `<button type="button" data-m="${id}">${label}</button>`)
    .join("");
  document.getElementById("missions").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const m = b.dataset.m;
    if (m === "city") {
      state.layers.flights = true;
      setSensor("optical");
      flyTo(HOME.lat, HOME.lng, CITY_KM);
    } else if (m === "street") {
      setSensor("optical");
      flyTo(HOME.lat, HOME.lng, STREET_KM);
    } else if (m === "contacts") {
      state.layers.flights = true;
      setSensor("optical");
      flyTo(40.641, -73.778, REGION_KM);
    } else if (m === "orbit") {
      state.layers.satellites = true;
      flyTo(0, -80, GLOBE_KM);
    } else if (m === "reset") flyTo(20, -30, GLOBE_KM);
    renderDock();
  };
}

function renderCard() {
  const el = document.getElementById("card");
  const t = state.target;
  if (!t) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<p class="meta">${t.kind.toUpperCase()}</p><h2>${t.name}</h2>
    <p class="meta">${formatCoord(t.lat, t.lng)}</p>
    <p>${t.meta || ""}</p>
    <div class="row"><button class="go" id="cockpit">COCKPIT</button><button class="ghost" id="drop">DROP</button></div>`;
  document.getElementById("drop").onclick = () => {
    state.target = null;
    state.mode = "free";
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    renderCard();
  };
  document.getElementById("cockpit").onclick = () => {
    state.mode = "cockpit";
  };
}

viewer.selectedEntityChanged.addEventListener(() => {
  const e = viewer.selectedEntity;
  if (e && e.god) {
    state.target = e.god;
    state.mode = "track";
    viewer.trackedEntity = e;
    renderCard();
  } else if (state.mode !== "cockpit") {
    state.target = null;
    state.mode = "free";
    viewer.trackedEntity = undefined;
    renderCard();
  }
});

viewer.scene.preUpdate.addEventListener(() => {
  if (state.layers.flights) {
    const dt = Math.min(0.05, 0.016);
    for (const f of state.flights) deadReckon(f, dt);
  }
  const lookEl = document.getElementById("look");
  if (lookEl) {
    const carto = viewer.camera.positionCartographic;
    if (carto) {
      lookEl.textContent =
        formatCoord(C.Math.toDegrees(carto.latitude), C.Math.toDegrees(carto.longitude)) +
        "  ·  " +
        formatAlt(carto.height / 1000);
    }
  }
  const t = state.target;
  if (!t) return;
  const live =
    state.flights.find((x) => x.id === t.id) ||
    state.sats.find((x) => x.id === t.id) ||
    t;
  const e = mesh.entities.getById(live.id);
  if (!e) return;
  if (state.mode === "track") {
    viewer.trackedEntity = e;
    return;
  }
  if (state.mode !== "cockpit") return;
  viewer.trackedEntity = undefined;
  const pos = e.position && e.position.getValue(viewer.clock.currentTime);
  if (!pos) return;
  const heading = C.Math.toRadians(live.heading || 0);
  viewer.camera.lookAt(pos, new C.HeadingPitchRange(heading, C.Math.toRadians(-18), 70 + Math.max(live.altKm, 0.2) * 4));
});

async function loadGoogle(key) {
  const trimmed = (key || "").trim();
  if (!trimmed) return;
  localStorage.setItem("god-eye-google-tiles-key", trimmed);
  try {
    if (C.GoogleMaps) C.GoogleMaps.defaultApiKey = trimmed;
    let tileset;
    if (typeof C.createGooglePhotorealistic3DTileset === "function") {
      tileset = await C.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    } else {
      tileset = await C.Cesium3DTileset.fromUrl(
        "https://tile.googleapis.com/v1/3dtiles/root.json?key=" + encodeURIComponent(trimmed),
      );
    }
    viewer.scene.primitives.add(tileset);
    setStatus("GOOGLE 3D TILES");
    flyTo(HOME.lat, HOME.lng, STREET_KM);
  } catch {
    setStatus("3D TILES FAIL");
  }
}

document.getElementById("enter").onclick = () => {
  document.getElementById("boot").remove();
  document.getElementById("hud").hidden = false;
  renderDock();
  renderSensors();
  renderMissions();
  flyTo(HOME.lat, HOME.lng, CITY_KM);
  void refreshFlights();
  void refreshRest();
  const saved = localStorage.getItem("god-eye-google-tiles-key");
  if (saved) {
    document.getElementById("gkey").value = saved;
    void loadGoogle(saved);
  }
};

document.getElementById("src").onclick = () => {
  document.getElementById("about").hidden = false;
};
document.getElementById("about-close").onclick = () => {
  document.getElementById("about").hidden = true;
};
document.getElementById("about").addEventListener("click", (e) => {
  if (e.target.id === "about") e.currentTarget.hidden = true;
});
document.getElementById("gkey-apply").onclick = () => {
  void loadGoogle(document.getElementById("gkey").value);
  document.getElementById("about").hidden = true;
};

let geoTimer;
document.getElementById("q").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(geoTimer);
  if (q.length < 2) {
    document.getElementById("hits").hidden = true;
    return;
  }
  geoTimer = setTimeout(async () => {
    const hits = await load("geocode?q=" + encodeURIComponent(q));
    const ul = document.getElementById("hits");
    ul.hidden = !hits.length;
    ul.innerHTML = hits
      .map((h) => `<li><button data-lat="${h.lat}" data-lng="${h.lng}">${h.name}</button></li>`)
      .join("");
    ul.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      flyTo(Number(b.dataset.lat), Number(b.dataset.lng), STREET_KM);
      ul.hidden = true;
    };
  }, 280);
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const map = { Digit1: "optical", Digit2: "nvg", Digit3: "flir", Digit4: "noir", Digit5: "crt" };
  if (map[e.code]) setSensor(map[e.code]);
  if (e.code === "Escape") {
    state.target = null;
    state.mode = "free";
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    renderCard();
    const about = document.getElementById("about");
    if (about) about.hidden = true;
  }
  if (e.code === "KeyC" && state.target) state.mode = state.mode === "cockpit" ? "track" : "cockpit";
  if (e.code === "KeyR") flyTo(20, -30, GLOBE_KM);
});

window.addEventListener("resize", () => viewer.resize());

setInterval(() => {
  document.getElementById("stamp").textContent = new Date().toISOString().slice(0, 19).replace("T", "  ") + "Z";
}, 1000);
setInterval(() => void refreshFlights(), 28000);
setInterval(() => {
  propagate();
  sync();
  counts();
}, 2500);
