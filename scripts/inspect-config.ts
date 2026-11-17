import { loadEnvFile } from "node:process";
import { readLlmConfig } from "../server/llm/config.ts";

try { loadEnvFile(); } catch { /* 配置错误只报告状态，不输出变量或异常原文 */ }
const config = readLlmConfig();
console.log(JSON.stringify({
  configuration: config.configuration,
  enabled: config.enabled,
  configured: config.configured,
  provider: config.provider,
  key_available: Boolean(config.apiKey),
  vision: config.supportsVision,
  tools: config.supportsTools,
  timeout_ms: config.timeoutMs,
  inference_verified: false,
}));
