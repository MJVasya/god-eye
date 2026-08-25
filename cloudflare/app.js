/* global Cesium */
const C = window.Cesium;
C.Ion.defaultAccessToken = "";

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
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.atmosphereLightIntensity = 25;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 180;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 4.5e7;
viewer.scene.fog.density = 2.0e-4;
viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-30, 20, 1.6e7) });
const mesh = new C.CustomDataSource("mesh");
viewer.dataSources.add(mesh);

const COLORS = {
  flight: C.Color.fromCssColorString("#8fde9c"),
  sat: C.Color.fromCssColorString("#7eb6ff"),
  iss: C.Color.fromCssColorString("#e7eee8"),
  quake: C.Color.fromCssColorString("#e25a45"),
  launch: C.Color.fromCssColorString("#d7a35a"),
};

function upsert(c) {
  const pos = C.Cartesian3.fromDegrees(c.lng, c.lat, Math.max(c.altKm, 0.03) * 1000);
  const color = COLORS[c.kind] || COLORS.flight;
  let e = mesh.entities.getById(c.id);
  if (!e) {
    e = mesh.entities.add({
      id: c.id,
      name: c.name,
      position: pos,
      point: {
        pixelSize: c.kind === "iss" ? 14 : c.kind === "launch" ? 10 : 7,
        color,
        outlineColor: C.Color.fromCssColorString("#07090c"),
        outlineWidth: 1,
        scaleByDistance: new C.NearFarScalar(1.5e3, 1.35, 9.0e6, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: c.name,
        font: "11px IBM Plex Mono, monospace",
        fillColor: C.Color.fromCssColorString("#e7eee8"),
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#07090c").withAlpha(0.55),
        pixelOffset: new C.Cartesian2(0, -16),
        scaleByDistance: new C.NearFarScalar(2.5e3, 1, 9.0e5, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    e.position = new C.ConstantPositionProperty(pos);
    e.name = c.name;
    if (e.label) e.label.text = c.name;
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

function flyTo(lat, lng, altKm = 12) {
  state.target = null;
  state.mode = "free";
  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  viewer.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(lng, lat, Math.max(altKm, 0.25) * 1000),
    duration: 2.3,
  });
  renderCard();
}

function setSensor(id) {
  state.sensor = id;
  document.getElementById("globe").className = id === "optical" ? "" : id;
  renderSensors();
}

function setStatus(s) {
  document.getElementById("status").textContent = s;
}

async function load(path) {
  const res = await fetch("/api/" + path);
  if (!res.ok) throw new Error(path);
  return res.json();
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
    const data = await load("flights");
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
    ["contacts", "LIVE CONTACTS"],
    ["orbit", "ORBITAL WATCH"],
    ["night", "NIGHT WATCH"],
    ["reset", "RESET"],
  ]
    .map(([id, label]) => `<button type="button" data-m="${id}">${label}</button>`)
    .join("");
  document.getElementById("missions").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const m = b.dataset.m;
    if (m === "contacts") {
      state.layers.flights = true;
      setSensor("optical");
      flyTo(48.1, 11.5, 45);
    } else if (m === "orbit") {
      state.layers.satellites = true;
      flyTo(0, -80, 16000);
    } else if (m === "night") {
      state.layers.flights = true;
      setSensor("nvg");
      flyTo(41.88, -87.63, 8);
    } else if (m === "reset") flyTo(20, -30, 16000);
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
    <p class="meta">${Math.abs(t.lat).toFixed(3)}° ${t.lat >= 0 ? "N" : "S"}  ${Math.abs(t.lng).toFixed(3)}° ${t.lng >= 0 ? "E" : "W"}</p>
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
      tileset = await C.createGooglePhotorealistic3DTileset();
    } else {
      tileset = await C.Cesium3DTileset.fromUrl(
        "https://tile.googleapis.com/v1/3dtiles/root.json?key=" + encodeURIComponent(trimmed),
      );
    }
    viewer.scene.primitives.add(tileset);
    setStatus("GOOGLE 3D TILES");
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
      flyTo(Number(b.dataset.lat), Number(b.dataset.lng), 12);
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
  if (e.code === "KeyR") flyTo(20, -30, 16000);
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
