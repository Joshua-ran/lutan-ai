import test from "node:test";
import assert from "node:assert/strict";
import { requestAgentAvailability } from "../src/lib/agent-api.ts";

test("模型状态只检查本机公开健康接口，不发送模型请求或透传未知字段", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "/api/health");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.body, undefined);
      assert.equal(options?.headers, undefined);
      return Response.json({ agent: { enabled: true, model: "deepseek-flash", private_extra: "must-not-forward" } });
    };
    assert.deepEqual(await requestAgentAvailability(new AbortController().signal), { state: "ready", model: "deepseek-flash" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("未启用、错误配置和健康接口失败分别降级为明确的状态", async () => {
  const original = globalThis.fetch;
  try {
    for (const [body, state] of [
      [{ agent: { enabled: false, model: null } }, "disabled"],
      [{ agent: { enabled: true, model: "sk-private-marker" } }, "unavailable"],
      [{ agent: { enabled: "true", model: "deepseek-flash" } }, "unavailable"],
    ] as const) {
      globalThis.fetch = async () => Response.json(body);
      assert.deepEqual(await requestAgentAvailability(new AbortController().signal), { state });
    }
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.deepEqual(await requestAgentAvailability(new AbortController().signal), { state: "unavailable" });
    globalThis.fetch = async () => { throw new TypeError("private upstream detail"); };
    assert.deepEqual(await requestAgentAvailability(new AbortController().signal), { state: "unavailable" });
  } finally { globalThis.fetch = original; }
});
