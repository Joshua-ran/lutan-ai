import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { allowedFile, assertNoSecrets } from "../scripts/release-policy.mjs";
import { root } from "../scripts/local-runtime.mjs";

test("交付清单拒绝路径穿越、私有配置、依赖和归档嵌套", () => {
  for (const file of ["../README.md", "/tmp/README.md", "D:/secret.ts", "src/../../.env", "src\\App.tsx", ".env", ".env.local", "docs/.env.example", "server/.aws/credentials.ts", "scripts/node_modules/key.ts", "dist/server.mjs", "releases/old.zip", "LutanAI_Portfolio_V1.zip", "docs/key.pem"])
    assert.equal(allowedFile(file), false, file);
  for (const file of [".env.example", ".env.deepseek.example", "src/App.tsx", "server/agent/service.ts", "交付中心.html", "delivery/文档/docs/V1.2_AGENT.html"])
    assert.equal(allowedFile(file), true, file);
});

test("交付密钥检查拒绝实际值与已填写模板，错误不回显密钥", () => {
  const secret = randomBytes(24).toString("hex");
  assert.doesNotThrow(() => assertNoSecrets({ ".env.example": Buffer.from("LLM_API_KEY=\nLLM_ENABLED=false") }, [secret]));
  for (const files of [
    { "README.md": Buffer.from(`unexpected ${secret}`) },
    { ".env.deepseek.example": Buffer.from(`LLM_API_KEY=${secret}`) },
    { ".env.example": Buffer.from("LLM_API_KEY=populated-example") },
  ]) assert.throws(() => assertNoSecrets(files, [secret]), (error) => !error.message.includes(secret));
});

test("doctor 检查不向已配置模型发送请求，也不输出密钥", async () => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.end("{}"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const secret = randomBytes(24).toString("hex");
  try {
    const child = spawn(process.execPath, ["scripts/doctor.mjs", "--json"], {
      cwd: root, windowsHide: true,
      env: { ...process.env, LLM_ENABLED: "true", LLM_PROVIDER: "openai_compatible", LLM_API_KEY: secret, DEEPSEEK_API_KEY: "", LLM_MODEL: "test-model", LLM_MODEL_LABEL: "test-model", LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`, HOST: "127.0.0.1", PORT: "65534" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(code, 0);
    assert.equal((stdout + stderr).includes(secret), false);
    const report = JSON.parse(stdout);
    assert.equal(report.model.configuration, "ready");
    assert.equal(report.model.inference_verified, false);
    assert.equal(calls, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
