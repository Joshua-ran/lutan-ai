import { test, expect } from "./fixtures.ts";
import { createApp } from "../../server/app.ts";
import { createAgentService } from "../../server/agent/service.ts";
import { readLlmConfig } from "../../server/llm/config.ts";

test("还是没有口啊会得到可见追问，补充水层后推进且不伪造尝试时间", async ({ page }) => {
  let calls = 0;
  const briefs: any[] = [];
  const config = readLlmConfig({ LLM_PROVIDER: "deepseek", LLM_ENABLED: "true", DEEPSEEK_API_KEY: "followup-e2e-fixture", LLM_MODEL_LABEL: "followup-test" });
  const server = createApp({ agentService: createAgentService({ config, fetcher: async (_url, init) => {
    calls++;
    const briefing = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
    briefs.push(briefing);
    const contract = briefing.decision_contract;
    return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question }) } }] });
  } }) }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture not listening");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const routePath of ["health", "agent/turn"]) await page.route(`**/api/${routePath}`, async (route) => {
      const response = await route.fetch({ url: `${origin}/api/${routePath}` });
      await route.fulfill({ response });
    });
    await page.goto("/#diagnose");
    const assistant = page.getByRole("region", { name: "AI 现场助手", exact: true });
    await assistant.getByRole("button", { name: "展开作钓条件与安全确认", exact: true }).click();
    // 合成测试条件，不自动填写真实用户的许可。
    await assistant.getByRole("button", { name: "已核对公告，允许当前方式", exact: true }).click();
    await assistant.locator("#agent-message").fill("软饵试了半小时没口，实际覆盖的水层不清楚。");
    await assistant.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    const result = assistant.getByRole("region", { name: "现场助手结果", exact: true });
    await expect(result.locator(".source-label")).toHaveText("Agent · followup-test");
    const firstAction = await result.locator(".action-card p").innerText();
    const pending = assistant.getByRole("note", { name: "这轮先补充的信息", exact: true });
    await expect(pending).toContainText("水层");
    await expect(assistant.locator(".agent-feedback")).toHaveCount(0);
    await assistant.locator("#agent-message").fill("还是没有口啊");
    await assistant.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    await expect(result.locator(".action-card p")).not.toHaveText(firstAction);
    await expect(pending).toContainText("一个水层、多个水层");
    await expect(assistant.locator(".agent-message.assistant").last()).toContainText("先确认：");
    expect(await assistant.locator(".agent-chat").evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2);
    expect(briefs[1].latest_feedback.feedback).toBe("暂未尝试");
    expect(briefs[1].reported_feedback.attempted).toBe(false);
    await pending.getByRole("button", { name: "已确认主要搜索一个水层", exact: true }).click();
    await expect(assistant.locator("#agent-message")).toHaveValue("已确认主要搜索一个水层");
    expect(calls).toBe(2);
    await assistant.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    await expect(pending).toHaveCount(0);
    await expect(result.locator(".action-card p")).toContainText("小幅改变搜索水层");
    expect(calls).toBe(3);
    expect(briefs[2].user_context.layers).toBe("主要一个水层");
    await result.getByRole("button", { name: "没改善", exact: true }).click();
    await result.getByRole("button", { name: "补充无改善反馈，继续下一步 →", exact: true }).click();
    await expect(assistant.locator("#agent-message")).not.toHaveValue(/20\s*分钟/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(result.locator(".source-label")).toHaveText("Agent · followup-test");
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("lutan_agent_sessions_v1")!));
    expect(state.sessions[0].context.layers).toBe("主要一个水层");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
