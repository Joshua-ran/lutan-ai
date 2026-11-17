import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { Marked } from "marked";

export const templates = new Set([".env.example", ".env.deepseek.example"]);
const rootFiles = new Set([
  "package.json", "package-lock.json", "README.md", ".gitignore", ...templates,
  "tsconfig.json", "vite.config.ts", "playwright.config.ts", "index.html", "Start-LutanAI.cmd", "交付中心.html",
  "LutanAI_PRD_V1.0.md", "LutanAI_Prototype_V1.0.html", "LutanAI_Prototype_Preview.png", "LutanAI_Pretrip_Preview.png", "LutanAI_Diagnosis_Preview.png",
  "LutanAI_Evaluation_24cases_V1.0.json", "LutanAI_Evaluation_Plan_V1.0.md", "LutanAI_Public_Cases_13.json", "LutanAI_Secondary_Research.md", "LutanAI_Portfolio_Guide.md", "路探AI_求职作品介绍.html",
]);
const directories = {
  src: new Set([".ts", ".tsx", ".css", ".json"]),
  server: new Set([".ts"]), shared: new Set([".ts"]), public: new Set([".svg", ".png", ".jpg", ".ico", ".txt"]),
  scripts: new Set([".ts", ".mjs"]), tests: new Set([".ts", ".mjs", ".json"]),
  docs: new Set([".md", ".json", ".png"]), delivery: new Set([".html", ".css", ".png", ".svg"]),
  drizzle: new Set([".sql", ".json"]),
};
const forbiddenParts = new Set(["node_modules", "dist", ".cache", "releases", ".git", ".agents", ".codex", ".aws", "coverage", "test-results", "playwright-report"]);
const slash = (name) => name.split(path.sep).join("/");

export function allowedFile(name) {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || forbiddenParts.has(part))) return false;
  if (parts.some((part) => part.startsWith(".env")) && !templates.has(name)) return false;
  if (parts.length === 1) return rootFiles.has(name);
  if (parts.slice(1).some((part) => part.startsWith("."))) return false;
  return Boolean(directories[parts[0]]?.has(path.posix.extname(name)));
}

export function collectFiles(base) {
  const result = [];
  function walk(directory) {
    for (const entry of readdirSync(path.join(base, directory), { withFileTypes: true })) {
      const name = slash(path.join(directory, entry.name));
      if (entry.isSymbolicLink()) throw new Error(`不打包符号链接：${name}`);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !forbiddenParts.has(entry.name)) walk(name);
      } else if (entry.isFile() && allowedFile(name)) result.push(name);
    }
  }
  for (const name of rootFiles) if (existsSync(path.join(base, name))) result.push(name);
  for (const directory of Object.keys(directories)) {
    if (lstatSync(path.join(base, directory)).isSymbolicLink()) throw new Error(`不打包符号链接：${directory}`);
    walk(directory);
  }
  for (const name of result) if (!lstatSync(path.join(base, name)).isFile()) throw new Error(`不是普通文件：${name}`);
  return [...new Set(result)].sort();
}

export function secretValues(base, environment = process.env) {
  const values = new Set();
  const collect = (env) => {
    for (const [name, value] of Object.entries(env))
      if (/(?:API_KEY|ACCESS_TOKEN|SECRET_KEY)$/i.test(name) && typeof value === "string" && value.trim().length >= 8) values.add(value.trim());
  };
  collect(environment);
  const envFile = path.join(base, ".env");
  if (existsSync(envFile)) collect(parseEnv(readFileSync(envFile, "utf8")));
  return [...values];
}

export function assertNoSecrets(files, values) {
  for (const [name, bytes] of Object.entries(files)) {
    const buffer = Buffer.from(bytes);
    if (values.some((value) => buffer.includes(Buffer.from(value)))) throw new Error(`发现环境密钥值，已停止打包：${name}`);
    if (/\bsk-[A-Za-z0-9_-]{24,}\b/.test(buffer.toString("utf8"))) throw new Error(`发现疑似 API 密钥，已停止打包：${name}`);
    if (templates.has(name)) {
      const env = parseEnv(buffer.toString("utf8"));
      if (Object.entries(env).some(([key, value]) => /(?:KEY|TOKEN|SECRET)$/i.test(key) && value.trim()))
        throw new Error(`环境模板包含非空密钥字段：${name}`);
    }
  }
}

export function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function verifyDelivery(base, allowed = null) {
  const outward = ["交付中心.html", "LutanAI_Prototype_V1.0.html"];
  function htmlFiles(dir) {
    for (const entry of readdirSync(path.join(base, dir), { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) htmlFiles(name);
      else if (entry.isFile() && name.endsWith(".html")) outward.push(name);
    }
  }
  htmlFiles("delivery");
  let localLinks = 0, externalLinks = 0;
  for (const name of outward) {
    const html = readFileSync(path.join(base, name), "utf8");
    for (const match of html.matchAll(/\b(href|src)=["']([^"']+)["']/g)) {
      const [, attribute, raw] = match;
      if (raw.startsWith("#") || raw.startsWith("data:")) continue;
      if (/^https?:\/\//i.test(raw)) {
        if (attribute === "src") throw new Error(`离线页面依赖远程资源：${name}`);
        externalLinks++;
        continue;
      }
      if (/^[a-z]+:|^[/\\]/i.test(raw)) throw new Error(`不可移动链接：${name}`);
      const clean = decodeURIComponent(raw.split(/[?#]/, 1)[0].replaceAll("&amp;", "&"));
      const resolved = path.resolve(base, path.dirname(name), clean);
      const relative = slash(path.relative(base, resolved));
      if (relative.startsWith("../") || path.isAbsolute(relative) || !existsSync(resolved) || (allowed && !allowed.has(relative)))
        throw new Error(`链接或资源不存在于交付包：${name} → ${relative}`);
      localLinks++;
    }
    if (name.startsWith("delivery/文档/")) {
      const source = name.slice("delivery/文档/".length).replace(/\.html$/, ".md");
      const markdown = readFileSync(path.join(base, source), "utf8");
      const tokens = new Marked({ gfm: true }).lexer(markdown);
      const headings = tokens.filter((t) => t.type === "heading").length;
      const tables = tokens.filter((t) => t.type === "table").length;
      if ((html.match(/<h[1-6]\b/g) || []).length < headings || (html.match(/<table\b/g) || []).length < tables)
        throw new Error(`标题或表格渲染不完整：${source}`);
      if (tokens.some((t) => t.type === "code") && !html.includes("<pre>")) throw new Error(`代码块渲染缺失：${source}`);
    }
  }
  const phone = readFileSync(path.join(base, "delivery/demo/demo.html"), "utf8");
  if (!/<iframe\b[^>]*width="375"[^>]*height="812"/.test(phone)) throw new Error("历史原型缺少 375×812 手机壳。");
  const css = readFileSync(path.join(base, "delivery/assets/delivery.css"), "utf8");
  if (/@import|url\(\s*["']?https?:/i.test(css)) throw new Error("交付样式依赖外网。");
  return { html_pages: outward.length, local_links: localLinks, optional_external_links: externalLinks, phone_viewport: "375x812" };
}
