import { test, expect } from "./fixtures.ts";

test("visitor can explore examples without API calls or changing real safety conditions", async ({ page }) => {
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/")) posts++; });
  await page.goto("/");
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByRole("button", { name: "先看使用示例" }).click();
  const dialog = page.getByRole("dialog", { name: "一次只验证一个改变。" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("不调用模型");
  await dialog.getByRole("button", { name: "试了很久没口" }).click();
  await expect(dialog.locator("h3")).toContainText("结束");
  await dialog.getByRole("button", { name: "水情突然变化" }).click();
  await expect(dialog).toContainText("安全优先");
  await expect(dialog.locator("h3")).toContainText("危险");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
  expect(posts).toBe(0);
  await dialog.getByRole("button", { name: "进入现场助手" }).click();
  await expect(page).toHaveURL(/#diagnose/);
  await expect(page.getByLabel("本轮暂不调用 AI 的原因")).toContainText("还未核实作钓许可");
  expect(posts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
