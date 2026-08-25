# GOD EYE

Public orbital intelligence mesh. Live globe, flights, satellites, quakes, and
launch pads — no billed map keys, no Cesium ion token.

**Live:** [godseye.gogol.me](https://godseye.gogol.me)

MIT. Independent rewrite, not a fork of the original Cesium client.

## Attribution

Inspired by [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)
(MIT, Copyright 2026 Bilawal Sidhu).

That repo is the inspectable Cesium + Google Photorealistic 3D Tiles cockpit.
This repo is a free-tier Cloudflare Worker rewrite: Three.js globe, Cache API
proxies, public feeds only. See [NOTICE](NOTICE).

## What ships

| Surface | What it is |
|---|---|
| [godseye.gogol.me](https://godseye.gogol.me) | Cloudflare Worker SPA + `/api/*` |
| `cloudflare/` | Deployable Worker source |
| `src/` | React / Three.js HUD used in the Grok preview |

Layers: ADS-B flights (OpenSky, with a labeled SIM fallback), SGP4 satellites
(SatNOGS TLE), USGS earthquakes, Launch Library 2 pads. Sensor looks: optical,
NVG, FLIR, noir, CRT. Click a contact, cockpit / track camera, search.

## Deploy (Cloudflare free plan)

1. Inline the SPA into the Worker:

```bash
node cloudflare/build-bundle.mjs
```

2. Upload `cloudflare/god-eye.bundled.js` as a Worker named `god-eye`
   (compatibility date `2024-12-01`, no KV / D1 / R2 bindings required).
3. Route a hostname to the script. This instance uses
   `godseye.gogol.me/*`.

Runtime storage is the Cache API only. No secrets.

## Source in the HUD

`SOURCE · MIT` on the boot card and header opens the about panel:

- **This source** — [MJVasya/god-eye](https://github.com/MJVasya/god-eye)
- **Cesium original** — [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)

## Honest limits

Not for navigation or emergency use. Feeds can be delayed, modeled, or empty
(OpenSky and CelesTrak are often blocked from Workers; Launch Library 2 rate
limits). Google Photorealistic 3D Tiles are **not** included — they need a
billed Maps key.

## License

[MIT](LICENSE). Third-party data and textures stay under their own terms.
