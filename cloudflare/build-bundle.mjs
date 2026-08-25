import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const worker = readFileSync("/workspace/cloudflare/worker.js", "utf8");
const html = readFileSync("/workspace/cloudflare/page.html", "utf8");
const app = readFileSync("/workspace/cloudflare/app.js", "utf8");

const inject = `    if (url.pathname === "/app.js") {
      return new Response(${JSON.stringify(app)}, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    if (url.pathname === "/" || url.pathname === "/index.html" || !url.pathname.includes(".")) {
      return new Response(${JSON.stringify(html)}, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" } });
    }
    return new Response("not found", { status: 404 });
`;

const marker = "    // SPA_INLINE\n";
const idx = worker.indexOf(marker);
if (idx < 0) throw new Error("SPA_INLINE marker missing");
const head = worker.slice(0, idx);
const tailStart = worker.indexOf("    return new Response(\"GOD EYE\"");
if (tailStart < 0) throw new Error("fallback missing");
const after = worker.slice(worker.indexOf("  },\n};", tailStart));
const bundled = head + inject + after;
writeFileSync("/workspace/cloudflare/god-eye.bundled.js", bundled);
const gz = gzipSync(Buffer.from(bundled));
writeFileSync("/tmp/god-eye.worker.js.gz", gz);
writeFileSync("/tmp/god-eye.worker.b64", gz.toString("base64"));
console.log(
  JSON.stringify({
    bytes: bundled.length,
    gzip: gz.length,
    b64: gz.toString("base64").length,
  }),
);
