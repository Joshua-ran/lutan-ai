import { test, expect } from "./fixtures.ts";
import { createApp } from "../../server/app.ts";
import { createAgentService } from "../../server/agent/service.ts";
import { readLlmConfig } from "../../server/llm/config.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultInput } from "../../shared/schema.ts";
import { newAgentSession } from "../../shared/agent.ts";
import { agentFallback } from "../../shared/agent-fallback.ts";

test("旧会话的许可提醒明确标为未调用 AI，重复询问不刷屏或改写旧记录", async ({ page }) => {
  const context = { ...defaultInput, legality: "未知" as const };
  const session = newAgentSession(context);
  const result = agentFallback({ session_id: session.id, context, message: "你好", session_snapshot: { messages: [], actions: [], observations: session.observations, city: "" } }, "server_rule");
  session.last_result = result;
  session.messages = [
    { id: "old-user", role: "user", text: "你好", created_at: session.created_at, had_image: false },
    { id: "old-rule", role: "assistant", text: result.action, created_at: session.created_at, had_image: false },
  ];
  const original = JSON.stringify({ schema_version: 1, current_id: session.id, sessions: [session] });
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("lutan_agent_sessions_v1")) localStorage.setItem("lutan_agent_sessions_v1", raw);
  }, original);
  await page.goto("/#diagnose");
  const assistant = page.getByRole("region", { name: "AI 现场助手", exact: true });
  await expect(assistant.locator(".agent-result .source-label")).toHaveText("安全规则 · 本次未调用 AI");
  await expect(assistant.locator(".agent-feedback")).toHaveCount(0);
  await assistant.locator("#agent-message").fill("什么情况");
  await assistant.getByRole("button", { name: "先确认作钓条件", exact: true }).click();
  await expect(assistant.locator(".agent-message")).toHaveCount(2);
  await expect(assistant.locator("#agent-message")).toHaveValue("什么情况");
  expect(await page.evaluate(() => localStorage.getItem("lutan_agent_sessions_v1"))).toBe(original);
});

test("首次使用能区分模型配置和许可门控，保留草稿并在确认后正常发送", async ({ page }, info) => {
  let modelCalls = 0, apiCalls = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const config = readLlmConfig({ LLM_PROVIDER: "deepseek", LLM_ENABLED: "true", DEEPSEEK_API_KEY: "gate-e2e-fixture", LLM_MODEL_LABEL: "gate-test" });
  const server = createApp({ agentService: createAgentService({ config, fetcher: async (_url, init) => {
    modelCalls++;
    const briefing = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
    const contract = briefing.decision_contract;
    return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[1], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question }) } }] });
  } }) }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture not listening");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch({ url: `${origin}/api/health` });
      await route.fulfill({ response });
    });
    await page.route("**/api/agent/turn", async (route) => {
      apiCalls++;
      const response = await route.fetch({ url: `${origin}/api/agent/turn` });
      await route.fulfill({ response });
    });
    await page.goto("/#diagnose");
    const assistant = page.getByRole("region", { name: "AI 现场助手", exact: true });
    const gate = assistant.getByRole("status", { name: "本轮暂不调用 AI 的原因", exact: true });
    await expect(assistant.getByRole("status", { name: "模型配置状态" })).toContainText("AI 已配置：gate-test");
    await expect(gate).toContainText("还未核实作钓许可");
    await assistant.locator("#agent-message").fill("什么情况");
    await assistant.getByRole("button", { name: "先确认作钓条件", exact: true }).click();
    await expect(assistant.locator(".agent-context")).toHaveAttribute("open", "");
    await expect(assistant.locator("#agent-message")).toHaveValue("什么情况");
    await expect(assistant.getByRole("button", { name: "尚未核对公告", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(apiCalls).toBe(0);
    expect(modelCalls).toBe(0);
    await expect(assistant.locator(".agent-message")).toHaveCount(0);

    // 合成测试条件：模拟用户已实际核验允许，不自动勾选。
    await assistant.getByRole("button", { name: "已核对公告，允许当前方式", exact: true }).click();
    await expect(gate).toHaveCount(0);
    await expect(assistant.locator("#agent-message")).toHaveValue("什么情况");
    await assistant.locator("#agent-message").fill("软饵试了半小时没口。");
    await assistant.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    await expect(assistant.locator(".agent-result .source-label")).toHaveText("Agent · gate-test");
    expect(apiCalls).toBe(1);
    expect(modelCalls).toBe(1);
    await page.reload();
    await expect(assistant.locator(".agent-result .source-label")).toHaveText("Agent · gate-test");

    await assistant.locator(".agent-context summary").click();
    await assistant.getByRole("button", { name: "尚未核对公告", exact: true }).click();
    const previousMessages = await assistant.locator(".agent-message").count();
    await assistant.locator("#agent-message").fill("你好，为什么还不能问？");
    await assistant.getByRole("button", { name: "先确认作钓条件", exact: true }).click();
    expect(await assistant.locator(".agent-message").count()).toBe(previousMessages);
    expect(apiCalls).toBe(1);
    await page.reload();
    await expect(gate).toContainText("还未核实作钓许可");
    await assistant.getByRole("button", { name: "展开作钓条件与安全确认", exact: true }).click();
    await assistant.getByRole("button", { name: "已核对公告，允许当前方式", exact: true }).click();
    await assistant.locator("#agent-message").fill("现在水流很急，下一步做什么？");
    await assistant.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    await expect(gate).toContainText("已报告危险水情");
    await expect(assistant.locator("#agent-message")).toHaveValue("现在水流很急，下一步做什么？");
    expect(apiCalls).toBe(1);
    expect(modelCalls).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    const output = process.env.LUTAN_SCREENSHOTS_DIR || path.join(os.tmpdir(), "lutan-ai-screenshots");
    fs.mkdirSync(output, { recursive: true });
    await gate.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${info.project.name}-agent-gate.png`), animations: "disabled" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
