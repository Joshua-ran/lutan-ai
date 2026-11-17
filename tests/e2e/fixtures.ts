import { test as base, expect } from "@playwright/test";
import { createApp } from "../../server/app.ts";
import { createDiagnosisService } from "../../server/diagnosis-service.ts";
import { readLlmConfig } from "../../server/llm/config.ts";
import { createAgentService } from "../../server/agent/service.ts";

// 即使开发中的 .env 已配置付费模型，常规回归也只进入关闭模型的隔离接口。
// AI 用例自行覆盖该路由并连接本机模拟供应商，绝不借用用户的真实模型额度。
export const test = base.extend<{}, { rulesApi: string }>({
  rulesApi: [
    async ({}, use) => {
      const app = createApp({
        diagnosisService: createDiagnosisService({ config: readLlmConfig({}) }),
        agentService: createAgentService({ config: readLlmConfig({}) }),
      });
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("rules fixture not listening");
      try {
        await use(`http://127.0.0.1:${address.port}`);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    { scope: "worker" },
  ],
  page: async ({ page, rulesApi }, use) => {
    await page.route("**/api/diagnoses", async (route) => {
      const response = await route.fetch({ url: `${rulesApi}/api/diagnoses` });
      await route.fulfill({ response });
    });
    await page.route("**/api/agent/turn", async (route) => {
      const response = await route.fetch({ url: `${rulesApi}/api/agent/turn` });
      await route.fulfill({ response });
    });
    await use(page);
  },
});
export { expect };
export type { Page, TestInfo } from "@playwright/test";
