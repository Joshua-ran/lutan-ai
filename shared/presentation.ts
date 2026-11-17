import type { Diagnosis } from "./schema.ts";

export function diagnosisSourceLabel(result: Diagnosis) {
  if (result.source === "server_llm")
    return `AI 辅助建议 · ${result.generation.model}`;
  if (result.source === "server_rules") return "服务端规则";
  return result.generation.fallback_reason === "api_unavailable"
    ? "本机规则 · 服务暂不可用"
    : "本机规则";
}

export function diagnosisFallbackNotice(result: Diagnosis) {
  const reason = result.generation.fallback_reason;
  if (reason === "timeout")
    return "AI 辅助响应超时，已使用规则建议，仍可正常记录反馈。";
  if (reason === "invalid_output")
    return "AI 辅助结果未通过校验，已使用规则建议。";
  if (
    ["provider_error", "rate_limited", "budget_exhausted", "busy"].includes(
      reason ?? "",
    )
  )
    return "AI 辅助暂不可用，已使用规则建议。";
  return null;
}
