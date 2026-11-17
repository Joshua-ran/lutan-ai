import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { createDiagnosisService } from "../server/diagnosis-service.ts";
import { readLlmConfig } from "../server/llm/config.ts";

let server: Server;
let origin: string;
before(async () => {
  server = createApp({ diagnosisService: createDiagnosisService({ config: readLlmConfig({}) }) }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("测试服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("健康接口准确声明能力边界且不缓存", async () => {
  const response = await fetch(`${origin}/api/health`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.capabilities.llm, false);
  assert.equal(data.capabilities.weather, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("出钓前与诊断接口返回通过输出校验的真实规则结果", async () => {
  for (const route of ["/api/pretrip", "/api/diagnoses"]) {
    const response = await fetch(`${origin}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waterlevel: "急变" }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, "server_rules");
    assert.equal(data.risk, "danger");
  }
});
test("精确位置和未知字段被接口拒绝", async () => {
  const response = await fetch(`${origin}/api/diagnoses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ GPS: [30, 106] }),
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /输入/);
});
test("错误 JSON、过大请求与不存在的接口返回明确错误", async () => {
  const headers = { "Content-Type": "application/json" };
  const invalid = await fetch(`${origin}/api/diagnoses`, {
    method: "POST",
    headers,
    body: "{broken",
  });
  assert.equal(invalid.status, 400);
  const large = await fetch(`${origin}/api/diagnoses`, {
    method: "POST",
    headers,
    body: JSON.stringify({ alias: "x".repeat(20000) }),
  });
  assert.equal(large.status, 413);
  const unknown = await fetch(`${origin}/api/missing`);
  assert.equal(unknown.status, 404);
});

test("生产首页支持带点号与中文空格的父目录，仍不公开隐藏文件", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), ".lutan-static-"));
  const checkout = path.join(temp, "路探 AI 迁移目录");
  const client = path.join(checkout, "dist/client");
  mkdirSync(client, { recursive: true });
  writeFileSync(path.join(client, "index.html"), "<!doctype html><title>portable-app</title>");
  writeFileSync(path.join(client, "demo.css"), "body{color:green}");
  writeFileSync(path.join(client, ".env"), "PRIVATE_MARKER=do-not-serve");
  const previous = process.cwd();
  let portable: Server | undefined;
  try {
    process.chdir(checkout);
    const app = createApp({ serveClient: true });
    process.chdir(previous);
    portable = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => portable!.once("listening", resolve));
    const address = portable.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") || "", /text\/html/);
    assert.match(await home.text(), /portable-app/);
    assert.equal((await fetch(`${base}/demo.css`)).status, 200);
    const hidden = await fetch(`${base}/.env`);
    assert.equal(hidden.status, 404);
    assert.doesNotMatch(await hidden.text(), /do-not-serve/);
  } finally {
    process.chdir(previous);
    if (portable) {
      portable.closeAllConnections();
      await new Promise<void>((resolve, reject) => portable!.close((error) => error ? reject(error) : resolve()));
    }
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith(".lutan-static-"))
      rmSync(resolved, { recursive: true, force: true });
  }
});
