import type { Contact } from "@/lib/geo/types";
import { HOME } from "@/lib/geo/math";

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

const iconCache = new Map<string, string>();

function contactIcon(kind: string, color: string) {
  const key = `${kind}:${color}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const path =
    kind === "quake"
      ? `<circle cx="16" cy="16" r="6" fill="${color}"/><circle cx="16" cy="16" r="11" fill="none" stroke="${color}" stroke-width="2"/>`
      : kind === "launch"
        ? `<rect x="13" y="4" width="6" height="18" rx="2" fill="${color}"/><polygon points="10,22 22,22 16,30" fill="${color}"/>`
        : kind === "sat"
          ? `<rect x="12" y="12" width="8" height="8" fill="${color}"/><rect x="4" y="13" width="7" height="6" fill="${color}" opacity=".7"/><rect x="21" y="13" width="7" height="6" fill="${color}" opacity=".7"/>`
          : `<polygon points="16,2 20,14 16,12 12,14" fill="${color}"/><polygon points="6,14 26,14 16,18" fill="${color}"/><rect x="14.5" y="18" width="3" height="10" fill="${color}"/>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${path}</svg>`,
  )}`;
  iconCache.set(key, uri);
  return uri;
}

export async function createEarthViewer(Cesium: any, el: HTMLElement) {
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
  // Keep satellite photos readable at night — do not shade the dark hemisphere.
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.dynamicAtmosphereLighting = false;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#061018");
  viewer.scene.fog.density = 1.1e-4;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 60;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 4.5e7;
  viewer.shadows = false;
  viewer.scene.highDynamicRange = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(HOME.lng, HOME.lat, 2800),
    orientation: {
      heading: Cesium.Math.toRadians(28),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
  });
  try {
    if (typeof Cesium.ArcGISTiledElevationTerrainProvider?.fromUrl === "function") {
      viewer.terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
      );
      viewer.scene.globe.depthTestAgainstTerrain = true;
    }
  } catch {
    /* ellipsoid fallback */
  }
  viewer.screenSpaceEventHandler.setInputAction((click: { position: unknown }) => {
    const ray = viewer.camera.getPickRay(click.position);
    if (!ray) return;
    const hit = viewer.scene.globe.pick(ray, viewer.scene);
    if (!hit) return;
    const carto = Cesium.Cartographic.fromCartesian(hit);
    flyCamera(
      Cesium,
      viewer,
      Cesium.Math.toDegrees(carto.latitude),
      Cesium.Math.toDegrees(carto.longitude),
      0.55,
    );
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  return viewer;
}

export function upsertEntity(Cesium: any, ds: any, c: Contact) {
  const colorCss = KIND_COLOR[c.kind] || "#8fde9c";
  const pos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, Math.max(c.altKm, 0.03) * 1000);
  const heading = Cesium.Math.toRadians(-(c.heading || 0));
  let e = ds.entities.getById(c.id);
  if (!e) {
    const moving = c.kind === "flight" || c.kind === "iss" || c.kind === "sat";
    e = ds.entities.add({
      id: c.id,
      name: c.name,
      position: pos,
      billboard: {
        image: contactIcon(c.kind, colorCss),
        width: c.kind === "iss" ? 28 : 18,
        height: c.kind === "iss" ? 28 : 18,
        rotation: heading,
        alignedAxis: moving ? Cesium.Cartesian3.UNIT_Z : Cesium.Cartesian3.ZERO,
        color: Cesium.Color.WHITE,
        scaleByDistance: new Cesium.NearFarScalar(1.2e3, 1.4, 8.0e6, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: c.name,
        font: "11px IBM Plex Mono, monospace",
        fillColor: Cesium.Color.fromCssColorString("#e7eee8"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#07090c").withAlpha(0.55),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1, 6.0e5, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    e.position = new Cesium.ConstantPositionProperty(pos);
    e.name = c.name;
    if (e.label) e.label.text = c.name;
    if (e.billboard) e.billboard.rotation = new Cesium.ConstantProperty(heading);
  }
  (e as { god?: Contact }).god = c;
  return e;
}

export async function loadGoogleTiles(Cesium: any, viewer: any, key: string) {
  const trimmed = key.trim();
  if (!trimmed) return null;
  Cesium.GoogleMaps = Cesium.GoogleMaps || {};
  Cesium.GoogleMaps.defaultApiKey = trimmed;
  let tileset;
  if (typeof Cesium.createGooglePhotorealistic3DTileset === "function") {
    tileset = await Cesium.createGooglePhotorealistic3DTileset({
      onlyUsingWithGoogleGeocoder: true,
    });
  } else {
    tileset = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(trimmed)}`,
    );
  }
  viewer.scene.primitives.add(tileset);
  return tileset;
}

export function cameraLook(Cesium: any, viewer: any) {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return null;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lng: Cesium.Math.toDegrees(carto.longitude),
    altKm: carto.height / 1000,
    heading: Cesium.Math.toDegrees(viewer.camera.heading),
  };
}

export function flyCamera(
  Cesium: any,
  viewer: any,
  lat: number,
  lng: number,
  altKm: number,
  opts?: { heading?: number; pitch?: number; duration?: number },
) {
  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  const altM = Math.max(altKm, 0.12) * 1000;
  const nadir = altM > 3.5e6;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, altM),
    orientation: {
      heading: Cesium.Math.toRadians(opts?.heading ?? (nadir ? 0 : 28)),
      pitch: Cesium.Math.toRadians(opts?.pitch ?? (nadir ? -90 : -40)),
      roll: 0,
    },
    duration: opts?.duration ?? (nadir ? 3.1 : 2.4),
  });
}
