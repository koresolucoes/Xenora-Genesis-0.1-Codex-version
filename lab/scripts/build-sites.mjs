import { readdir, readFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const lab = fileURLToPath(new URL("../", import.meta.url));
const publicDir = join(lab, "public");
const output = process.argv[2] ? resolve(process.argv[2]) : join(lab, "dist/server/index.js");

const types = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
}));

async function collect(dir, assets) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(path, assets);
    } else if (entry.isFile()) {
      const route = "/" + relative(publicDir, path).split(sep).map(encodeURIComponent).join("/");
      const bytes = await readFile(path);
      const type = types.get(extname(entry.name).toLowerCase()) || "application/octet-stream";
      assets[route] = { type, bytes: bytes.byteLength, encoded: bytes.toString("base64") };
    }
  }
}

const assets = {};
await collect(publicDir, assets);
if (!assets["/index.html"]) throw new Error("O laboratório precisa de public/index.html.");

const source = `
import core from "./worker.js";
const assets = ${JSON.stringify(assets)};
export default {
  fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return core.fetch(request, env, ctx);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
    }
    const file = assets[path === "/" ? "/index.html" : path];
    if (!file) return new Response(null, {status: 404});
    const headers = {
      "Content-Type": file.type,
      "Content-Length": String(file.bytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=0, must-revalidate"
    };
    const body = request.method === "HEAD" ? null
      : Uint8Array.from(atob(file.encoded), character => character.charCodeAt(0));
    return new Response(body, {headers});
  }
};
`;
await mkdir(dirname(output), {recursive:true});
await build({
  stdin: {contents:source, resolveDir:lab, sourcefile:"sites-entry.js"},
  outfile:output,
  bundle:true,
  format:"esm",
  platform:"browser",
  conditions:["workerd","worker","browser"],
  target:"es2022",
  minify:true,
  legalComments:"inline"
});
console.log(`Site empacotado com ${Object.keys(assets).length} arquivos em ${output}`);
