import type { Contact } from "@/lib/geo/types";

const CESIUM_VER = "1.125.0";
export const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VER}/Build/Cesium/`;

declare global {
  interface Window {
    Cesium?: any;
    CESIUM_BASE_URL?: string;
  }
}

export function loadCesium(): Promise<any> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  window.CESIUM_BASE_URL = CESIUM_BASE;
  return new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-cesium]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${CESIUM_BASE}Widgets/widgets.css`;
      css.setAttribute("data-cesium", "1");
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = `${CESIUM_BASE}Cesium.js`;
    s.async = true;
    s.onload = () => resolve(window.Cesium);
    s.onerror = () => reject(new Error("cesium-load"));
    document.head.appendChild(s);
  });
}

export const KIND_COLOR: Record<string, string> = {
  flight: "#8fde9c",
  sat: "#7eb6ff",
  iss: "#e7eee8",
  quake: "#e25a45",
  launch: "#d7a35a",
};

export function createEarthViewer(Cesium: any, el: HTMLElement) {
  Cesium.Ion.defaultAccessToken = "";
  const imagery = new Cesium.UrlTemplateImageryProvider({
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit: "Esri, Maxar, Earthstar Geographics",
  });
  const viewer = new Cesium.Viewer(el, {
    baseLayer: new Cesium.ImageryLayer(imagery),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
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
  viewer.shadows = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-30, 20, 1.6e7),
  });
  return viewer;
}

export function upsertEntity(Cesium: any, ds: any, c: Contact) {
  const color = Cesium.Color.fromCssColorString(KIND_COLOR[c.kind] || "#8fde9c");
  const pos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, Math.max(c.altKm, 0.03) * 1000);
  let e = ds.entities.getById(c.id);
  if (!e) {
    e = ds.entities.add({
      id: c.id,
      name: c.name,
      position: pos,
      point: {
        pixelSize: c.kind === "iss" ? 14 : c.kind === "launch" ? 10 : 7,
        color,
        outlineColor: Cesium.Color.fromCssColorString("#07090c"),
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(1.5e3, 1.35, 9.0e6, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: c.name,
        font: "11px IBM Plex Mono, monospace",
        fillColor: Cesium.Color.fromCssColorString("#e7eee8"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#07090c").withAlpha(0.55),
        pixelOffset: new Cesium.Cartesian2(0, -16),
        scaleByDistance: new Cesium.NearFarScalar(2.5e3, 1, 9.0e5, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    e.position = new Cesium.ConstantPositionProperty(pos);
    e.name = c.name;
    if (e.label) e.label.text = c.name;
  }
  (e as { god?: Contact }).god = c;
  return e;
}

export async function loadGoogleTiles(Cesium: any, viewer: any, key: string) {
  const trimmed = key.trim();
  if (!trimmed) return;
  Cesium.GoogleMaps = Cesium.GoogleMaps || {};
  Cesium.GoogleMaps.defaultApiKey = trimmed;
  let tileset;
  if (typeof Cesium.createGooglePhotorealistic3DTileset === "function") {
    tileset = await Cesium.createGooglePhotorealistic3DTileset();
  } else {
    tileset = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(trimmed)}`,
    );
  }
  viewer.scene.primitives.add(tileset);
  return tileset;
}

export function flyCamera(Cesium: any, viewer: any, lat: number, lng: number, altKm: number) {
  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, Math.max(altKm, 0.25) * 1000),
    duration: 2.3,
  });
}
