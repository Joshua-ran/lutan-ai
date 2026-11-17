import { test, expect, type Page } from "./fixtures.ts";
import express from "express";
import type { Server } from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createApp } from "../../server/app.ts";
import { createDiagnosisService } from "../../server/diagnosis-service.ts";
import { readLlmConfig } from "../../server/llm/config.ts";
import { diagnose } from "../../shared/engine.ts";

async function listen(app: ReturnType<typeof express>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock not listening");
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function mockWorkflow(
  page: Page,
  mode: "normal" | "invalid" | "timeout",
) {
  const provider = express();
  provider.use(express.json());
  const calls: string[] = [];
  provider.post("/v1/chat/completions", (req, res) => {
    calls.push(JSON.stringify(req.body));
    if (mode === "timeout") return;
    const context = JSON.parse(req.body.messages[1].content);
    const selection = {
      action_id: "contextual_action",
      rationale_ids: ["rule_basis", "target_context"],
      unknown_ids: Object.keys(context.required_unknowns),
      follow_up_question_id: context.required_question_id,
      evidence_status: "insufficient",
      ...(mode === "invalid"
        ? { priority_action: "该水域一定有鳜鱼，中鱼概率90%" }
        : {}),
    };
    res.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(selection) },
        },
      ],
    });
  });
  const mock = await listen(provider);
  const api = await listen(
    createApp({
      diagnosisService: createDiagnosisService({
        config: readLlmConfig({
          LLM_ENABLED: "true",
          LLM_API_KEY: "e2e-test-marker",
          LLM_MODEL: "private-provider-model",
          LLM_MODEL_LABEL: "e2e-model",
          LLM_BASE_URL: `${mock.url}/v1`,
          LLM_TIMEOUT_MS: mode === "timeout" ? "100" : "2000",
        }),
      }),
    }),
  );
  await page.route("**/api/diagnoses", async (route) => {
    const response = await route.fetch({ url: `${api.url}/api/diagnoses` });
    await route.fulfill({ response });
  });
  return {
    calls,
    cleanup: async () => {
      await close(api.server);
      await close(mock.server);
    },
  };
}

async function generate(page: Page) {
  await page
    .getByRole("button", { name: "按已有信息直接诊断", exact: false })
    .click();
  await expect(
    page.getByRole("region", { name: "诊断结果", exact: true }),
  ).toBeVisible();
}

test("AI 模式经真实本机 HTTP 协议进入页面、记录与导出，危险输入不再调用模型", async ({
  page,
}, info) => {
  const workflow = await mockWorkflow(page, "normal");
  try {
    await page.goto("/");
    await page.locator("#water-alias").fill("不向模型发送的私密河口");
    await page
      .getByRole("button", { name: "我已核对官方公告，允许", exact: true })
      .click();
    await page.goto("/#diagnose");
    await generate(page);
    await expect(page.locator(".result-panel .source-label")).toHaveText(
      "AI 辅助建议 · e2e-model",
    );
    const output =
      process.env.LUTAN_SCREENSHOTS_DIR ||
      path.join(os.tmpdir(), "lutan-ai-screenshots");
    fs.mkdirSync(output, { recursive: true });
    await page
      .getByRole("region", { name: "诊断结果", exact: true })
      .evaluate((element) =>
        element.scrollIntoView({ behavior: "instant", block: "start" }),
      );
    await page.screenshot({
      path: path.join(output, `${info.project.name}-ai-assisted-demo.png`),
      animations: "disabled",
    });
    expect(workflow.calls).toHaveLength(1);
    expect(workflow.calls[0]).not.toMatch(/私密河口|e2e-test-marker|alias/);
    await page
      .getByRole("button", { name: "记录结果反馈", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存到本机记录", exact: true })
      .click();
    await page.getByRole("button", { name: "查看记录 →", exact: true }).click();
    await page.reload();
    await expect(page.locator(".record-item")).toHaveCount(1);
    await page.getByText("查看当时的建议与依据", { exact: true }).click();
    await expect(page.locator(".record-detail")).toContainText(
      "AI 辅助建议 · e2e-model",
    );
    const snapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lutan_records_v1")!),
    );
    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.records[0].diagnosis.generation.mode).toBe("llm_assisted");
    expect(snapshot.records[0].diagnosis.generation.output_boundary).toContain(
      "规则限定",
    );
    expect(JSON.stringify(snapshot)).not.toMatch(
      /e2e-test-marker|private-provider-model/,
    );
    await page
      .getByRole("button", { name: "沿用条件，再诊断 →", exact: true })
      .click();
    await page.getByRole("button", { name: "明显很急", exact: true }).click();
    await generate(page);
    await expect(
      page.getByRole("heading", {
        name: "安全优先：先离开危险岸边",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".result-panel .source-label")).toHaveText(
      "服务端规则",
    );
    expect(workflow.calls).toHaveLength(1);
    await page
      .getByRole("region", { name: "诊断结果", exact: true })
      .evaluate((element) =>
        element.scrollIntoView({ behavior: "instant", block: "start" }),
      );
    await page.screenshot({
      path: path.join(output, `${info.project.name}-ai-safety-gate.png`),
      animations: "disabled",
    });
  } finally {
    await workflow.cleanup();
  }
});

for (const mode of ["invalid", "timeout"] as const)
  test(`模型${mode === "invalid" ? "输出不合格" : "超时"}时页面显示服务端规则与回退说明`, async ({
    page,
  }) => {
    const workflow = await mockWorkflow(page, mode);
    try {
      await page.goto("/#diagnose");
      await page
        .getByRole("button", { name: "我已核对官方公告，允许", exact: true })
        .click();
      await generate(page);
      await expect(page.locator(".result-panel .source-label")).toHaveText(
        "服务端规则",
      );
      await expect(page.locator(".result-panel")).toContainText(
        mode === "invalid" ? "AI 辅助结果未通过校验" : "AI 辅助响应超时",
      );
      await expect(page.locator(".result-panel")).not.toContainText(
        "中鱼概率90%",
      );
      expect(workflow.calls).toHaveLength(1);
    } finally {
      await workflow.cleanup();
    }
  });

test("V1 历史记录在页面中兼容读取，导出 V2 保留原反馈且不虚构模型", async ({
  page,
}) => {
  const { generation: _generation, ...oldDiagnosis } = diagnose(
    { alias: "旧版河道" },
    "server_rules",
  );
  const original = {
    schema_version: 1,
    records: [
      {
        id: oldDiagnosis.id,
        schema_version: 1,
        created_at: oldDiagnosis.created_at,
        diagnosis: oldDiagnosis,
        feedback: { outcome: "没有改善", memo: "原始反馈" },
      },
    ],
  };
  await page.goto("/");
  await page.evaluate(
    (value) => localStorage.setItem("lutan_records_v1", JSON.stringify(value)),
    original,
  );
  await page.goto("/#history");
  await expect(page.locator(".record-item")).toHaveCount(1);
  await expect(page.locator(".record-memo")).toHaveText("原始反馈");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("lutan_records_v1")!),
  );
  expect(saved.schema_version).toBe(1);
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出全部 JSON", exact: true })
    .click();
  const download = await pendingDownload;
  const filename = await download.path();
  const exported = JSON.parse(fs.readFileSync(filename!, "utf8"));
  expect(exported.schema_version).toBe(2);
  expect(exported.records[0].diagnosis.generation.mode).toBe("rules");
  expect(exported.records[0].diagnosis.generation.model).toBe(null);
  expect(exported.records[0].feedback.memo).toBe("原始反馈");
});
