import { z } from "zod";

const envSchema = z.object({
  LLM_PROVIDER: z
    .enum(["openai_compatible", "deepseek"])
    .default("openai_compatible"),
  LLM_VISION_ENABLED: z.enum(["true", "false"]).default("false"),
  LLM_TOOLS_ENABLED: z.enum(["true", "false"]).default("true"),
  LLM_ENABLED: z.enum(["true", "false"]).default("false"),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().trim().default(""),
  LLM_MODEL: z.string().trim().max(120).default(""),
  LLM_MODEL_LABEL: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default("configured-model"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(2500),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(128)
    .max(1024)
    .default(384),
  LLM_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
  LLM_DAILY_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(100),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  LLM_RESPONSE_FORMAT: z
    .enum(["json_schema", "json_object"])
    .default("json_schema"),
  LLM_TOKEN_PARAMETER: z
    .enum(["max_completion_tokens", "max_tokens"])
    .default("max_completion_tokens"),
  LLM_LOG_EVENTS: z.enum(["true", "false"]).default("false"),
});

export type LlmConfig = {
  provider: "openai_compatible" | "deepseek";
  supportsVision: boolean;
  supportsTools: boolean;
  enabled: boolean;
  configured: boolean;
  configuration: "disabled" | "ready" | "incomplete" | "invalid";
  baseUrl: string;
  apiKey: string;
  model: string;
  modelLabel: string;
  timeoutMs: number;
  maxOutputTokens: number;
  requestsPerMinute: number;
  dailyRequestLimit: number;
  maxConcurrency: number;
  responseFormat: "json_schema" | "json_object";
  tokenParameter: "max_completion_tokens" | "max_tokens";
  logEvents: boolean;
};

export function readLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  const deepseek = env.LLM_PROVIDER === "deepseek";
  const parsed = envSchema.safeParse({
    ...env,
    ...(deepseek
      ? {
          LLM_BASE_URL: env.LLM_BASE_URL || "https://api.deepseek.com",
          LLM_MODEL: env.LLM_MODEL || "deepseek-flash",
          LLM_MODEL_LABEL: env.LLM_MODEL_LABEL || "deepseek-flash",
          LLM_API_KEY: env.LLM_API_KEY || env.DEEPSEEK_API_KEY,
          LLM_RESPONSE_FORMAT: env.LLM_RESPONSE_FORMAT || "json_object",
          LLM_TOKEN_PARAMETER: env.LLM_TOKEN_PARAMETER || "max_tokens",
          LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS || "20000",
          LLM_VISION_ENABLED:
            env.LLM_VISION_ENABLED ||
            ((env.LLM_MODEL || "deepseek-flash") === "deepseek-flash"
              ? "true"
              : "false"),
        }
      : {}),
  });
  // 错误信息不包含环境变量值；即使配置错误也保留完整规则模式。
  const value = parsed.success ? parsed.data : envSchema.parse({});
  let urlValid = false;
  let baseUrl = value.LLM_BASE_URL;
  try {
    const url = new URL(baseUrl);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    urlValid =
      (url.protocol === "https:" || (loopback && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (value.LLM_PROVIDER !== "deepseek" ||
        url.hostname === "api.deepseek.com" ||
        loopback);
    baseUrl = url.href.replace(/\/+$/, "");
  } catch {
    /* 无效地址不进入网络请求 */
  }
  const enabled = env.LLM_ENABLED === "true";
  const complete = Boolean(value.LLM_API_KEY && value.LLM_MODEL);
  const labelSafe =
    value.LLM_MODEL_LABEL !== value.LLM_API_KEY &&
    !/^sk-/i.test(value.LLM_MODEL_LABEL);
  const configured =
    enabled && parsed.success && urlValid && complete && labelSafe;
  return {
    provider: value.LLM_PROVIDER,
    supportsVision:
      value.LLM_VISION_ENABLED === "true" &&
      (value.LLM_PROVIDER !== "deepseek" ||
        value.LLM_MODEL === "deepseek-flash"),
    supportsTools: value.LLM_TOOLS_ENABLED === "true",
    enabled,
    configured,
    configuration: !enabled
      ? "disabled"
      : !parsed.success || !urlValid || !labelSafe
        ? "invalid"
        : !complete
          ? "incomplete"
          : "ready",
    baseUrl,
    apiKey: value.LLM_API_KEY,
    model: value.LLM_MODEL,
    modelLabel: value.LLM_MODEL_LABEL,
    timeoutMs: value.LLM_TIMEOUT_MS,
    maxOutputTokens: value.LLM_MAX_OUTPUT_TOKENS,
    requestsPerMinute: value.LLM_REQUESTS_PER_MINUTE,
    dailyRequestLimit: value.LLM_DAILY_REQUEST_LIMIT,
    maxConcurrency: value.LLM_MAX_CONCURRENCY,
    responseFormat: value.LLM_RESPONSE_FORMAT,
    tokenParameter: value.LLM_TOKEN_PARAMETER,
    logEvents: value.LLM_LOG_EVENTS === "true",
  };
}
