import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { assertNoSecrets, secretValues } from "./release-policy.mjs";

const root = realpathSync(process.cwd());
const destination = path.join(root, "sites/lutan-ai");
if (!existsSync(path.join(destination, ".openai/hosting.json"))) throw new Error("Register the Site before preparing source.");
const names = ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html", ".gitignore", "scripts/build-hosting.mjs"];
for (const directory of ["src", "server", "shared", "public", "drizzle"]) {
  for (const entry of readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not deployable source.");
    if (entry.isFile()) names.push(path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
  }
}
const files = Object.fromEntries(names.map((name) => [name, readFileSync(path.join(root, name))]));
assertNoSecrets(files, secretValues(root));
// Reduce a previously prepared copy to runtime source. Preserve Git metadata,
// registration and ignored build output, but never upload product research,
// request traces, screenshots, local archives, environment files or user data.
const base = realpathSync(destination);
for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filename = path.resolve(entry.parentPath, entry.name);
  const relative = path.relative(base, filename).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Deployment cleanup escaped its checkout.");
  if (relative.startsWith(".git/") || relative.startsWith("dist/") || relative === ".openai/hosting.json") continue;
  if (!(relative in files)) rmSync(filename); // Single verified file; no recursive deletion.
}
for (const name of Object.keys(files)) {
  const target = path.join(destination, name);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(root, name), target);
}
console.log(`Prepared ${Object.keys(files).length} runtime source files for hosting; private materials and secrets excluded.`);
