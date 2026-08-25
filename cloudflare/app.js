import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const EARTH_R = 6371;
const GLOBE = 1.6;
const state = {
  layers: { flights: true, satellites: true, earthquakes: true, launches: true },
  sensor: "optical",
  flights: [],
  sats: [],
  quakes: [],
  launches: [],
  target: null,
  source: "live",
  tle: [],
};

const root = document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x07090c, 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 80);
camera.position.set(0, 1.05, 4.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = GLOBE * (1 + 1500 / EARTH_R);
controls.maxDistance = GLOBE * 5.4;

scene.add(new THREE.AmbientLight(0xffffff, 0.22));

function latLngToVec3(lat, lng, altKm = 0, target = new THREE.Vector3()) {
  const r = GLOBE * (1 + altKm / EARTH_R);
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return target.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function sunDir(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60;
  return latLngToVec3(decl, 15 * (12 - utc), 0, new THREE.Vector3()).normalize();
}

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const dayMap = texLoader.load(
  "https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg",
);
const nightMap = texLoader.load(
  "https://unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg",
);
function prepTex(t) {
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
}
prepTex(dayMap);
prepTex(nightMap);

const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    dayMap: { value: dayMap },
    nightMap: { value: nightMap },
    sun: { value: sunDir() },
    mode: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D dayMap, nightMap; uniform vec3 sun; uniform float mode; varying vec2 vUv; varying vec3 vN;
    void main(){
      vec3 day=texture2D(dayMap,vUv).rgb;
      vec3 lights=texture2D(nightMap,vUv).rgb;
      vec3 night=day*vec3(0.055,0.07,0.11)+lights*2.15;
      float ndl=dot(normalize(vN),normalize(sun));
      float f=smoothstep(-0.02,0.10,ndl);
      vec3 c=mix(night,day,f);
      float lat=vUv.y*180.0, lon=vUv.x*360.0;
      float latCell=abs(fract(lat/15.0+0.5)-0.5)*15.0;
      float lonCell=abs(fract(lon/15.0+0.5)-0.5)*15.0;
      float latW=max(fwidth(lat),1.0e-4), lonW=max(fwidth(lon),1.0e-4);
      float grid=max(1.0-smoothstep(0.0,latW*1.35,latCell),1.0-smoothstep(0.0,lonW*1.35,lonCell));
      c+=vec3(0.16,0.26,0.20)*grid*0.28;
      float grain=fract(sin(dot(vUv*vec2(1800.0,900.0),vec2(12.9898,78.233)))*43758.5453);
      c+=(grain-0.5)*0.018;
      if(mode<0.5) c*=vec3(0.96,0.98,1.0);
      else if(mode<1.5){ float g=dot(c,vec3(0.15,0.75,0.1)); c=vec3(g*0.12,g*1.18,g*0.28); }
      else if(mode<2.5){ float l=dot(c,vec3(0.25,0.55,0.2)); c=mix(mix(vec3(0.02,0.0,0.18),vec3(0.95,0.18,0.04),smoothstep(0.0,0.45,l)),vec3(1.0,0.94,0.72),smoothstep(0.45,1.0,l)); }
      else if(mode<3.5){ float g=dot(c,vec3(0.3,0.5,0.2)); c=vec3(g); }
      else c=pow(c,vec3(0.85))*vec3(0.85,1.05,0.8);
      gl_FragColor=vec4(c,1.0); }`,
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(GLOBE, 128, 128), earthMat);
scene.add(earth);
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE * 1.018, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0x79a7ff, transparent: true, opacity: 0.11, side: THREE.BackSide, depthWrite: false }),
);
scene.add(atmo);

function starfield() {
  const n = 4000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 40 + Math.random() * 20;
    const phi = Math.acos(2 * Math.random() - 1);
    const th = Math.random() * Math.PI * 2;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe7eee8, size: 0.04 })));
}
starfield();

function makeLayer(color, cap, geo) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color, toneMapped: false }), cap);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
const flightMesh = makeLayer(0x8fde9c, 1800, new THREE.ConeGeometry(0.007, 0.026, 5));
const satMesh = makeLayer(0x9eb4ff, 400, new THREE.IcosahedronGeometry(0.01, 0));
const quakeMesh = makeLayer(0xe25a45, 400, new THREE.OctahedronGeometry(0.012, 0));
const launchMesh = makeLayer(0xd7a35a, 24, new THREE.IcosahedronGeometry(0.016, 0));
const dummy = new THREE.Object3D();
const tmp = new THREE.Vector3();
const look = new THREE.Vector3();

function writeMesh(mesh, items, headinged) {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const c = items[i];
    latLngToVec3(c.lat, c.lng, Math.max(c.altKm, 0.02), tmp);
    dummy.position.copy(tmp);
    dummy.lookAt(0, 0, 0);
    if (headinged) dummy.rotateX(Math.PI / 2);
    dummy.scale.setScalar(c.kind === "iss" ? 1.8 : 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}

function headingOffset(lat, lng, heading, km) {
  const d = km / EARTH_R;
  const h = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180 };
}

function deadReckon(c, dt) {
  if (!c.speedMs) return;
  const km = (c.speedMs * dt) / 1000;
  const n = headingOffset(c.lat, c.lng, c.heading, km);
  c.lat = n.lat;
  c.lng = n.lng;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("click", (ev) => {
  pointer.x = (ev.clientX / innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([flightMesh, satMesh, quakeMesh, launchMesh]);
  if (!hits.length) {
    state.target = null;
    renderCard();
    return;
  }
  const h = hits[0];
  const map = new Map([
    [flightMesh, state.flights],
    [satMesh, state.sats],
    [quakeMesh, state.quakes],
    [launchMesh, state.launches],
  ]);
  const list = map.get(h.object);
  state.target = list?.[h.instanceId] || null;
  renderCard();
});

async function load(layer) {
  const res = await fetch(`/api/${layer}`);
  if (!res.ok) throw new Error(layer);
  return res.json();
}

function setStatus(t) {
  document.getElementById("status").textContent = t;
}

async function refreshFlights() {
  try {
    setStatus("SYNC FLIGHTS");
    const data = await load("flights");
    state.flights = data.flights;
    state.source = data.source;
    document.getElementById("pill").textContent = data.source === "live" ? "LIVE" : "SIM";
    document.getElementById("pill").className = "pill" + (data.source === "live" ? "" : " sim");
    setStatus(data.source === "live" ? "LIVE MESH" : "SIMULATED AIR");
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
    state.launches = l.map((x) => ({
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
    counts();
  } catch {
    setStatus("LAYER PARTIAL");
  }
}

function gstime(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let gmst = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  gmst = ((gmst % 86400) + 86400) % 86400;
  return (gmst / 240) * (Math.PI / 180);
}

function propagate() {
  if (!state.tle.length) return;
  const date = new Date();
  const gmst = gstime(date);
  const out = [];
  for (const t of state.tle.slice(0, 220)) {
    const mm = t.MEAN_MOTION;
    if (!mm) continue;
    const epoch = Date.parse(t.EPOCH + "Z");
    const minutes = (date.getTime() - epoch) / 60000;
    const revs = mm * minutes;
    const M = ((t.MEAN_ANOMALY + revs * 360) % 360) * (Math.PI / 180);
    const inc = t.INCLINATION * (Math.PI / 180);
    const raan0 = t.RA_OF_ASC_NODE * (Math.PI / 180);
    const raan = raan0 - 7.292115e-5 * (minutes * 60);
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

function flyTo(lat, lng, altKm = 1600) {
  latLngToVec3(lat, lng, altKm, camera.position);
  controls.target.set(0, 0, 0);
  state.target = null;
  renderCard();
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
        `<button data-layer="${id}" class="${state.layers[id] ? "on" : ""}">${label}</button>`,
    )
    .join("");
  document.getElementById("dock").onclick = (e) => {
    const id = e.target.dataset.layer;
    if (!id) return;
    state.layers[id] = !state.layers[id];
    renderDock();
  };
}

function renderSensors() {
  const modes = [
    ["optical", "1 OPTICAL"],
    ["nvg", "2 NVG"],
    ["flir", "3 FLIR"],
    ["noir", "4 NOIR"],
    ["crt", "5 CRT"],
  ];
  document.getElementById("sensors").innerHTML = modes
    .map(
      ([id, label]) =>
        `<button data-s="${id}" class="${state.sensor === id ? "on" : ""}">${label}</button>`,
    )
    .join("");
  document.getElementById("sensors").onclick = (e) => {
    const id = e.target.dataset.s;
    if (!id) return;
    setSensor(id);
  };
}

function setSensor(id) {
  state.sensor = id;
  const map = { optical: 0, nvg: 1, flir: 2, noir: 3, crt: 4 };
  earthMat.uniforms.mode.value = map[id];
  atmo.material.color.set(id === "nvg" ? 0x3dff7a : id === "flir" ? 0xff6a2a : 0x79a7ff);
  renderSensors();
}

function renderMissions() {
  document.getElementById("missions").innerHTML = `
    <button data-m="contacts">LIVE CONTACTS</button>
    <button data-m="orbit">ORBITAL WATCH</button>
    <button data-m="night">NIGHT WATCH</button>
    <button data-m="reset">RESET</button>`;
  document.getElementById("missions").onclick = (e) => {
    const m = e.target.dataset.m;
    if (m === "contacts") {
      state.layers.flights = true;
      setSensor("optical");
      flyTo(48.1, 11.5, 900);
    } else if (m === "orbit") {
      state.layers.satellites = true;
      flyTo(0, -80, 3200);
    } else if (m === "night") {
      state.layers.flights = true;
      setSensor("nvg");
      flyTo(41.88, -87.63, 1500);
    } else if (m === "reset") flyTo(20, -30, 2800);
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
    renderCard();
  };
  document.getElementById("cockpit").onclick = () => {
    if (!state.target) return;
    latLngToVec3(state.target.lat, state.target.lng, state.target.altKm + 40, camera.position);
  };
}

document.getElementById("enter").onclick = () => {
  document.getElementById("boot").remove();
  document.getElementById("hud").hidden = false;
  renderDock();
  renderSensors();
  renderMissions();
  void refreshFlights();
  void refreshRest();
};

document.getElementById("src").onclick = () => {
  const el = document.getElementById("about");
  el.hidden = false;
};
document.getElementById("about-close").onclick = () => {
  document.getElementById("about").hidden = true;
};
document.getElementById("about").addEventListener("click", (e) => {
  if (e.target.id === "about") e.currentTarget.hidden = true;
});

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
      flyTo(Number(b.dataset.lat), Number(b.dataset.lng), 1500);
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
    renderCard();
    const about = document.getElementById("about");
    if (about) about.hidden = true;
  }
  if (e.code === "KeyR") flyTo(20, -30, 2800);
});

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

setInterval(() => {
  document.getElementById("stamp").textContent = new Date().toISOString().slice(0, 19).replace("T", "  ") + "Z";
}, 1000);
setInterval(() => void refreshFlights(), 28000);
setInterval(() => {
  propagate();
  counts();
}, 2500);

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  earthMat.uniforms.sun.value.copy(sunDir());
  if (state.layers.flights) {
    for (const f of state.flights) deadReckon(f, dt);
    writeMesh(flightMesh, state.flights, true);
    flightMesh.visible = true;
  } else flightMesh.visible = false;
  satMesh.visible = state.layers.satellites;
  if (satMesh.visible) writeMesh(satMesh, state.sats, false);
  quakeMesh.visible = state.layers.earthquakes;
  if (quakeMesh.visible) writeMesh(quakeMesh, state.quakes, false);
  launchMesh.visible = state.layers.launches;
  if (launchMesh.visible) writeMesh(launchMesh, state.launches, false);
  if (state.target) {
    const t =
      state.flights.find((x) => x.id === state.target.id) ||
      state.sats.find((x) => x.id === state.target.id) ||
      state.target;
    latLngToVec3(t.lat, t.lng, t.altKm, look);
    const desired = look.clone().normalize().multiplyScalar(look.length() + 0.55);
    camera.position.lerp(desired, 1 - Math.exp(-2.2 * dt));
    controls.target.lerp(look, 1 - Math.exp(-2.2 * dt));
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
