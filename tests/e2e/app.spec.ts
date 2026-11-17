import { test, expect, type Page, type TestInfo } from "./fixtures.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const screenshots =
  process.env.LUTAN_SCREENSHOTS_DIR ||
  path.join(os.tmpdir(), "lutan-ai-screenshots");
async function screenshot(page: Page, info: TestInfo, name: string) {
  fs.mkdirSync(screenshots, { recursive: true });
  if (name === "diagnosis") {
    await page.getByRole("region", { name: "诊断结果", exact: true }).evaluate((element) => {
      element.scrollIntoView({ behavior: "instant", block: "start" });
    });
  } else {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  await page.screenshot({
    path: path.join(screenshots, `${info.project.name}-${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}
async function startDiagnosis(page: Page) {
  await page.goto("/#diagnose");
  await page
    .getByRole("button", { name: "我已核对官方公告，允许", exact: true })
    .click();
}
async function submitDirect(page: Page) {
  await page
    .getByRole("button", { name: "按已有信息直接诊断", exact: false })
    .click();
  await expect(
    page.getByRole("region", { name: "诊断结果", exact: true }),
  ).toBeVisible();
}

test("首屏正确渲染、无报错、无框架遮罩且不横向溢出", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect((await health.json()).status).toBe("ok");
  await expect(page).toHaveTitle("路探 AI · 出钓前参考");
  await expect(page.locator("h1")).toHaveText("出发前，先把信息理清楚。");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "生成出钓参考卡" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, info, "pretrip");
  expect(errors).toEqual([]);
});

test("出钓计划复用、诊断、反馈、刷新、JSON 导出、删除完整闭环", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator("#water-alias").fill("私人小河口");
  await page.getByRole("button", { name: "翘嘴", exact: true }).click();
  await page
    .getByRole("button", { name: "我已核对官方公告，允许", exact: true })
    .click();
  const request = page.waitForRequest((req) =>
    req.url().endsWith("/api/pretrip"),
  );
  await page
    .getByRole("button", { name: "生成出钓参考卡", exact: true })
    .click();
  expect((await request).postDataJSON().alias).toBe("");
  await expect(
    page.getByRole("heading", { name: "你的出钓参考卡" }),
  ).toBeVisible();
  await expect(page.getByText("证据不足", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始作钓诊断", exact: true }).click();
  await expect(page.locator(".context-bar")).toContainText("私人小河口");
  await expect(page.locator(".context-bar")).toContainText("翘嘴");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "40 分钟以上", exact: true }).click();
  await page.getByRole("button", { name: "软饵", exact: true }).click();
  await page.getByRole("button", { name: "铁板", exact: true }).click();
  await page.getByRole("button", { name: "多个水层", exact: true }).click();
  await page
    .getByRole("button", { name: "手法和换位都试过", exact: true })
    .click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "完全没口", exact: true }).click();
  await page
    .getByRole("button", { name: "生成下一步建议", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "考虑结束当前标点搜索", exact: true }),
  ).toBeVisible();
  await screenshot(page, info, "diagnosis");
  await page.getByRole("button", { name: "记录结果反馈", exact: true }).click();
  await page.getByRole("button", { name: "没有改善", exact: true }).click();
  await page.locator("#feedback-note").fill("仍然无口，记录本次比较。");
  await page
    .getByRole("button", { name: "保存到本机记录", exact: true })
    .click();
  await expect(page.locator(".save-success")).toContainText(
    "已保存到当前浏览器",
  );
  await page.getByRole("button", { name: "更新本机记录", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("lutan_records_v1")!).records.length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "查看记录 →", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".record-item")).toHaveCount(1);
  await expect(page.locator(".record-memo")).toHaveText(
    "仍然无口，记录本次比较。",
  );
  await screenshot(page, info, "history");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出全部 JSON", exact: true })
    .click();
  const download = await downloadPromise;
  const filename = await download.path();
  const exported = JSON.parse(fs.readFileSync(filename!, "utf8"));
  expect(exported.records).toHaveLength(1);
  expect(exported.records[0].feedback.outcome).toBe("没有改善");
  expect(JSON.stringify(exported)).not.toMatch(/latitude|longitude|GPS/);
  await page.getByRole("button", { name: "删除本条", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(1);
  await page.getByRole("button", { name: "删除本条", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "你的第一条经验，从这里开始。" }),
  ).toBeVisible();
});

test("危险水情安全优先，修改输入即撤销旧诊断", async ({ page }) => {
  await startDiagnosis(page);
  await page.getByRole("button", { name: "明显很急", exact: true }).click();
  await submitDirect(page);
  await expect(
    page.getByRole("heading", {
      name: "安全优先：先离开危险岸边",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".action-card")).toContainText("撤离");
  await page.getByRole("button", { name: "普通", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "诊断结果", exact: true }),
  ).toHaveCount(0);
  await submitDirect(page);
  await expect(
    page.getByRole("heading", { name: "先确认当前使用的拟饵", exact: true }),
  ).toBeVisible();
});

test("未知合法性阻断操作建议，修改计划时旧参考卡消失", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "生成出钓参考卡", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "你的出钓参考卡" }),
  ).toBeVisible();
  await page.locator("#water-alias").fill("新水域");
  await expect(
    page.getByRole("heading", { name: "你的出钓参考卡" }),
  ).toHaveCount(0);
  await page.goto("/#diagnose");
  await submitDirect(page);
  await expect(
    page.getByRole("heading", {
      name: "先核实这片水域是否允许垂钓",
      exact: true,
    }),
  ).toBeVisible();
});

test("接口失败时降级到同版本本机规则", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"unavailable"}',
    }),
  );
  await page.goto("/#diagnose");
  await submitDirect(page);
  await expect(page.locator(".result-panel .source-label")).toHaveText(
    "本机规则 · 服务暂不可用",
  );
  await expect(
    page.getByRole("heading", {
      name: "先核实这片水域是否允许垂钓",
      exact: true,
    }),
  ).toBeVisible();
});

test("修改输入时取消在途响应，旧结果不会重新出现", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/pretrip", async (route) => {
    await hold;
    await route.fulfill({ status: 503, body: "{}" }).catch(() => {});
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "生成出钓参考卡", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "正在整理参考信息…" }),
  ).toBeDisabled();
  await page.locator("#water-alias").fill("已修改");
  release();
  await expect(
    page.getByRole("button", { name: "生成出钓参考卡", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "你的出钓参考卡" }),
  ).toHaveCount(0);
});

test("存储失败会提示并保留导出功能", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.goto("/#diagnose");
  await submitDirect(page);
  await page.getByRole("button", { name: "记录结果反馈", exact: true }).click();
  await page
    .getByRole("button", { name: "保存到本机记录", exact: true })
    .click();
  await expect(
    page.getByText(
      "保存失败，可能是本机空间不足或浏览器禁止存储。请导出 JSON 备份。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "导出本次 JSON", exact: true }),
  ).toBeEnabled();
});

test("记录筛选、沿用条件再诊断与清空生效", async ({ page }) => {
  await page.goto("/#diagnose");
  await submitDirect(page);
  await page.getByRole("button", { name: "记录结果反馈", exact: true }).click();
  await page
    .getByRole("button", { name: "保存到本机记录", exact: true })
    .click();
  await page.getByRole("button", { name: "查看记录 →", exact: true }).click();
  await page
    .getByRole("button", { name: "沿用条件，再诊断 →", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "诊断结果", exact: true }),
  ).toHaveCount(0);
  await submitDirect(page);
  await page.getByRole("button", { name: "记录结果反馈", exact: true }).click();
  await page.getByRole("button", { name: "没有改善", exact: true }).click();
  await page
    .getByRole("button", { name: "保存到本机记录", exact: true })
    .click();
  await page.getByRole("button", { name: "查看记录 →", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(2);
  await page.locator("#outcome-filter").selectOption("没有改善");
  await expect(page.locator(".record-item")).toHaveCount(1);
  await page.locator("#record-search").fill("不存在的水域");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的记录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(2);
  await page.getByRole("button", { name: "清空全部记录", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".record-item")).toHaveCount(0);
});

test("删除被浏览器拒绝时记录仍显示且说明失败", async ({ page }) => {
  await page.goto("/#diagnose");
  await submitDirect(page);
  await page.getByRole("button", { name: "记录结果反馈", exact: true }).click();
  await page
    .getByRole("button", { name: "保存到本机记录", exact: true })
    .click();
  await page.getByRole("button", { name: "查看记录 →", exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
  });
  await page.getByRole("button", { name: "清空全部记录", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".record-item")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText(
    "浏览器未允许删除本机记录",
  );
});
