import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const installedChrome =
  process.platform === "win32" &&
  existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe");
const target = process.env.LUTAN_BASE_URL;
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: path.join(os.tmpdir(), "lutan-ai-playwright-results"),
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: target || "http://127.0.0.1:5173",
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (installedChrome ? "chrome" : undefined),
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: target
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
      },
});
