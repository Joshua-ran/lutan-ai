import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export function supportedNode(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

export function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(process.env.PATH || "").split(delimiter).map((p) =>
      join(p, "node_modules/npm/bin/npm-cli.js")),
  ];
  return candidates.find((p) => p && /npm-cli\.js$/i.test(p) && existsSync(p));
}

export function localEnv() {
  try {
    loadEnvFile(join(root, ".env"));
    return existsSync(join(root, ".env")) ? "loaded" : "absent";
  } catch (error) {
    return error.code === "ENOENT" ? "absent" : "unreadable";
  }
}

export function endpoint() {
  const portText = process.env.PORT || "8787";
  const host = process.env.HOST || "127.0.0.1";
  if (!/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535)
    throw new Error("PORT 需要是 1–65535 的整数。");
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"].includes(host))
    throw new Error("双击启动仅支持本机或通配监听地址；自定义 HOST 请使用 npm start。");
  const loopback = host === "::1" || host === "::" ? "::1" : host === "localhost" ? "localhost" : "127.0.0.1";
  return { host, loopback, port: Number(portText), url: `http://${loopback === "::1" ? "[::1]" : loopback}:${portText}` };
}

export async function inspectPort(target) {
  const occupied = await new Promise((done) => {
    const socket = createConnection({ host: target.loopback, port: target.port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => { socket.destroy(); done(false); });
    socket.once("timeout", () => { socket.destroy(); done(true); });
  });
  if (!occupied) return { state: "free" };
  try {
    const response = await fetch(`${target.url}/api/health`, {
      signal: AbortSignal.timeout(1500), redirect: "error",
    });
    const body = await response.text();
    const health = body.length <= 16384 ? JSON.parse(body) : {};
    if (response.ok && health.status === "ok" && health.product === "路探 AI")
      return { state: health.version === pkg.version ? "same_version_running" : "other_version_running" };
  } catch { /* 外部服务不暴露其响应内容 */ }
  return { state: "occupied" };
}

export function inspectConfig() {
  if (!existsSync(join(root, "node_modules/tsx/package.json"))) return { configuration: "dependencies_missing" };
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/inspect-config.ts"], {
    cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  try {
    return result.status === 0 ? JSON.parse(result.stdout) : { configuration: "check_unavailable" };
  } catch { return { configuration: "check_unavailable" }; }
}

export function runNode(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
    const stop = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const cleanup = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    child.once("error", () => { cleanup(); rejectRun(new Error("子进程未能启动，请检查 Node 与目录权限。")); });
    child.once("exit", (code, signal) => { cleanup(); resolveRun(signal === "SIGTERM" || signal === "SIGINT" ? 0 : code ?? 1); });
  });
}

export function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  child.once("error", () => console.log(`请手动打开 ${url}`));
  child.unref();
}
