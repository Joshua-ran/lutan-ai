import { test, expect } from "./fixtures.ts";
import { createApp } from "../../server/app.ts";
import { createAgentService } from "../../server/agent/service.ts";
import { readLlmConfig } from "../../server/llm/config.ts";
import { diagnose } from "../../shared/engine.ts";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const reply = (kind: string, action: string, visible: string[]) =>
  Response.json({
    model: "deepseek-flash",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            observations: { visible, reported: [], unknown: [] },
            action,
            action_kind: kind,
            reason: "只比较一个变量，并结合你已经尝试的范围。",
            check: "记录是否出现新的跟饵或触碰，没有改善也如实反馈。",
            follow_up_question: null,
          }),
        },
      },
    ],
  });
const tool = (name: string, args = {}) =>
  Response.json({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tool-1",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });

test("V1.2 图文、工具记忆、城市天气、会话恢复和规则降级主流程（模拟供应商）", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let weatherCalls = 0,
    modelCalls = 0;
  const config = readLlmConfig({
    LLM_PROVIDER: "deepseek",
    LLM_ENABLED: "true",
    DEEPSEEK_API_KEY: "e2e-agent-test-only",
    LLM_MODEL_LABEL: "agent-test",
    LLM_TIMEOUT_MS: "2000",
  });
  const model = (async (_url: unknown, init?: RequestInit) => {
    modelCalls++;
    const body = JSON.parse(String(init?.body));
    const last = body.messages.at(-1);
    if (last.role === "tool") {
      const result = JSON.parse(last.content);
      const user = body.messages.findLast((item: any) => item.role === "user");
      const briefing = JSON.parse(Array.isArray(user.content) ? user.content[0].text : user.content);
      if (result.source === "client_session_snapshot_user_reported") {
        expect(result.actions.at(-1).feedback).toBe("没有改善");
        if (briefing.decision_contract) {
          const contract = briefing.decision_contract;
          return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ observations: { visible: briefing.prior_visible, reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question }) } }] });
        }
        return reply(
          "change_position",
          "仅比较另一个合法安全的相邻结构位置，保持拟饵和手法不变。",
          ["岸边可见石块与岸线。"],
        );
      }
      if (briefing.decision_contract) {
        const contract = briefing.decision_contract;
        return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ observations: { visible: briefing.prior_visible, reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question }) } }] });
      }
      return reply("check_rig", "先在安全位置检查钩尖与钓组状态。", [
        "岸边可见石块与岸线。",
      ]);
    }
    const briefing = JSON.parse(
      typeof last.content === "string" ? last.content : last.content[0].text,
    );
    if (briefing.message.includes("刚才")) return tool("read_session_actions");
    if (briefing.message.includes("天气"))
      return tool("get_weather_by_city", { city: "南充" });
    if (Array.isArray(last.content)) {
      expect(last.content[1].type).toBe("image_url");
      expect(last.content[1].image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    }
    if (briefing.decision_contract) {
      const contract = briefing.decision_contract;
      return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify({ observations: { visible: Array.isArray(last.content) ? ["岸边可见石块与岸线。"] : briefing.prior_visible, reported: [], unknown: [] },
          action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason,
          check: contract.check, follow_up_question: contract.follow_up_question }),
      } }] });
    }
    return reply("change_layer", "保持当前位置和软饵，只比较另一个搜索水层。", [
      "岸边可见石块与岸线。",
    ]);
  }) as typeof fetch;
  const weather = (async (url: URL | RequestInfo) => {
    weatherCalls++;
    return String(url).includes("geocoding")
      ? Response.json({
          results: [
            {
              name: "南充",
              latitude: 30.8,
              longitude: 106.1,
              country: "中国",
              admin1: "四川",
            },
          ],
        })
      : Response.json({
          timezone: "Asia/Shanghai",
          current: {
            time: "2026-11-16T15:00",
            temperature_2m: 18,
            precipitation: 0,
            weather_code: 3,
            wind_speed_10m: 5,
          },
        });
  }) as typeof fetch;
  const server = createApp({
    agentService: createAgentService({
      config,
      fetcher: model,
      weatherFetcher: weather,
    }),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture not listening");
  const origin = `http://127.0.0.1:${address.port}`;
  await page.route("**/api/agent/turn", async (route) => {
    const response = await route.fetch({ url: `${origin}/api/agent/turn` });
    await route.fulfill({ response });
  });
  try {
    await page.goto("/");
    const diagnosis = diagnose({});
    await page.evaluate(
      (record) =>
        localStorage.setItem(
          "lutan_records_v1",
          JSON.stringify({ schema_version: 2, records: [record] }),
        ),
      {
        id: diagnosis.id,
        schema_version: 2,
        created_at: diagnosis.created_at,
        diagnosis,
        feedback: { outcome: "暂未尝试", memo: "保留的旧版记录" },
      },
    );
    await page.goto("/#diagnose");
    await page.locator(".agent-context summary").click();
    await page
      .getByRole("button", { name: "已核对公告，允许当前方式", exact: true })
      .click();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 200;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#88a7a0";
      ctx.fillRect(0, 0, 320, 200);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("选择一张现场照片", { exact: true }).setInputFiles({
      name: "synthetic-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await expect(page.locator(".agent-photo img")).toBeVisible();
    await page
      .locator("#agent-message")
      .fill("我在小河道钓鳜鱼，软饵试了半小时没口，感觉在退水。");
    await page
      .getByRole("button", { name: "发送给现场助手", exact: true })
      .click();
    const result = page.getByRole("region", {
      name: "现场助手结果",
      exact: true,
    });
    await expect(result.locator(".source-label")).toHaveText(
      "Agent · agent-test",
    );
    await expect(result.locator(".agent-observations")).toContainText(
      "岸边可见石块",
    );
    await expect(result.locator(".agent-observations")).toContainText(
      "感觉在退水",
    );
    const pending = page.getByRole("note", { name: "这轮先补充的信息", exact: true });
    await expect(pending).toContainText("水层");
    await pending.getByRole("button", { name: "已确认主要搜索一个水层", exact: true }).click();
    await page.getByRole("button", { name: "发送给现场助手", exact: true }).click();
    await expect(result.locator(".action-card p")).toContainText("水层");
    await expect(pending).toHaveCount(0);
    await page
      .locator(".agent-feedback")
      .getByRole("button", { name: "没改善", exact: true })
      .click();
    await page
      .locator("#agent-message")
      .fill("刚才建议的动作试了20分钟，还是没口。");
    await page
      .getByRole("button", { name: "发送给现场助手", exact: true })
      .click();
    await expect(result.locator(".agent-tools")).toContainText(
      "读取本次尝试 · 已执行",
    );
    await expect(result.locator(".action-card p")).toContainText("检查钩尖");
    await page.locator("#agent-city").fill("南充");
    await page.locator("#agent-message").fill("我在南充，顺便看一下天气。");
    await page
      .getByRole("button", { name: "发送给现场助手", exact: true })
      .click();
    await expect(result.locator(".agent-tools")).toContainText(
      "查询城市天气 · 已执行",
    );
    await expect(result.locator(".weather-summary")).toContainText("18 °C");
    expect(weatherCalls).toBe(2);
    expect(modelCalls).toBe(6);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const output =
      process.env.LUTAN_SCREENSHOTS_DIR ||
      path.join(os.tmpdir(), "lutan-ai-screenshots");
    fs.mkdirSync(output, { recursive: true });
    await result.evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
    await page.screenshot({
      path: path.join(output, `${info.project.name}-v1.2-agent-mock.png`),
      animations: "disabled",
    });
    const stored = await page.evaluate(
      () => localStorage.getItem("lutan_agent_sessions_v1")!,
    );
    expect(stored).not.toMatch(/data:image|base64|e2e-agent-test-only/);
    await page.reload();
    await expect(page.locator(".agent-result .source-label")).toHaveText(
      "Agent · agent-test",
    );
    await page.goto("/#history");
    await expect(page.locator(".agent-history .record-item")).toHaveCount(1);
    await expect(page.locator(".history-panel .record-item")).toHaveCount(1);
    await page
      .getByRole("button", { name: "恢复本次会话 →", exact: true })
      .click();
    await expect(page.locator(".agent-result .source-label")).toHaveText(
      "Agent · agent-test",
    );
    await page.route("**/api/agent/turn", (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    );
    await page
      .locator("#agent-message")
      .fill("现在服务不可用，仍想记录下一步。");
    await page
      .getByRole("button", { name: "发送给现场助手", exact: true })
      .click();
    await expect(page.locator(".agent-result .source-label")).toHaveText(
      "本机规则回退",
    );
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
