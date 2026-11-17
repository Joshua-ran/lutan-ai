import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const hostingPath = path.resolve(root, ".openai/hosting.json");
if (!existsSync(hostingPath)) throw new Error("Hosting project is not registered.");
const manifest = JSON.parse(readFileSync(hostingPath, "utf8"));
if (!manifest.project_id) throw new Error("Hosting project ID is missing.");
const assets = {};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
const client = path.resolve(root, "dist/client");
for (const entry of readdirSync(client, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filename = path.join(entry.parentPath, entry.name);
  const extension = path.extname(entry.name);
  if (!types[extension]) throw new Error(`Unsupported public asset: ${entry.name}`);
  const binary = [".png", ".jpg", ".webp", ".ico"].includes(extension);
  assets[`/${path.relative(client, filename).split(path.sep).join("/")}`] = { content: readFileSync(filename, binary ? "base64" : "utf8"), type: types[extension], binary };
}
mkdirSync("dist/server", { recursive: true });
await build({
  stdin: { contents: `import { createHostedHandler } from './server/hosting.ts'; const assets = ${JSON.stringify(assets)}; let handler; export default { fetch(request, env) { handler ??= createHostedHandler(env, assets); return handler(request); } };`, resolveDir: root },
  outfile: "dist/server/index.js", bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
});
mkdirSync("dist/.openai", { recursive: true });
writeFileSync("dist/.openai/hosting.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Hosted app built with ${Object.keys(assets).length} public assets.`);
