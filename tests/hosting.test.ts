import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHostingBudget, type UsageDatabase } from "../server/hosting-budget.ts";
import { createHostedHandler } from "../server/hosting.ts";
import { readLlmConfig } from "../server/llm/config.ts";
import { agentTurnInputSchema } from "../shared/agent.ts";
import { defaultInput } from "../shared/schema.ts";
import { ModelFailure } from "../server/llm/errors.ts";

function usageStore() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_ai_usage.sql", import.meta.url), "utf8"));
  const database: UsageDatabase = { prepare: (sql) => ({ bind: (...values) => ({ first: async <T>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null }) }) };
  return { database, sqlite };
}
const isQuota = (error: unknown) => error instanceof ModelFailure && error.reason === "budget_exhausted";
test("hosted quota is atomic and shared by independent server instances; UTC day resets", async () => {
  const { database, sqlite } = usageStore();
  const config = { ...readLlmConfig({}), requestsPerMinute: 2, dailyRequestLimit: 2, maxConcurrency: 4 };
  let time = Date.UTC(2026, 10, 16, 12);
  const servers = Array.from({ length: 4 }, () => createHostingBudget(config, database, () => time));
  try {
    const results = await Promise.allSettled(servers.map((budget) => budget.acquire()));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    for (const result of results) if (result.status === "fulfilled") result.value();
    time += 61_000;
    await assert.rejects(async () => servers[2].acquire(), isQuota);
    time += 86_400_000;
    const release = await servers[3].acquire(); release();
    assert.equal(sqlite.prepare("SELECT count(*) AS days FROM ai_usage").get()?.days, 2);
  } finally { sqlite.close(); }
});
test("missing or unavailable quota storage fails closed without retaining concurrency", async () => {
  const config = { ...readLlmConfig({}), requestsPerMinute: 10, dailyRequestLimit: 10, maxConcurrency: 1 };
  const budget = createHostingBudget(config, undefined);
  await assert.rejects(async () => budget.acquire(), isQuota);
  await assert.rejects(async () => budget.acquire(), isQuota);
});
test("hosted transport preserves safe gates, privacy, schema limits and static routes", async () => {
  const handler = createHostedHandler({}, { "/index.html": { content: "<h1>路探 AI</h1>", type: "text/html" } });
  const health = await handler(new Request("https://lutan.test/api/health"));
  assert.equal((await health.json()).agent.enabled, false);
  const input = agentTurnInputSchema.parse({ session_id: crypto.randomUUID(), message: "现在怎么做？", context: { ...defaultInput, alias: "不能外传的水域备注" }, session_snapshot: { messages: [], actions: [], observations: { visible: [], reported: [], unknown: [] }, city: "" } });
  for (const patch of [{ legality: "未知" }, { legality: "用户已核实允许", flow: "很急" }]) {
    const response = await handler(new Request("https://lutan.test/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, context: { ...input.context, ...patch } }) }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.model_calls, 0);
    assert.equal(result.context.alias, "");
  }
  assert.equal((await handler(new Request("https://lutan.test/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"bogus":true}' }))).status, 422);
  assert.equal((await handler(new Request("https://lutan.test/api/pretrip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "a".repeat(17_000) }) }))).status, 413);
  assert.equal((await handler(new Request("https://lutan.test/"))).headers.get("X-Frame-Options"), "DENY");
  assert.equal((await handler(new Request("https://lutan.test/.env"))).status, 404);
});
