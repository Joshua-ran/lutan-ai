import { diagnose } from "../shared/engine.ts";
import {
  AI_OUTPUT_BOUNDARY,
  WORKFLOW_VERSION,
  diagnosisSchema,
  rulesGeneration,
  type DiagnosisInput,
  type FallbackReason,
} from "../shared/schema.ts";
import { ModelFailure, requestModel } from "./llm/adapter.ts";
import { readLlmConfig, type LlmConfig } from "./llm/config.ts";
import { createModelBudget, type ModelBudget } from "./llm/budget.ts";

type SafeEvent = {
  event: "diagnosis_generated";
  rule_id: string;
  mode: "rules" | "llm_assisted";
  fallback_reason: FallbackReason | null;
  duration_ms: number;
};
export function createDiagnosisService({
  config = readLlmConfig(),
  fetcher = fetch,
  now = Date.now,
  budget,
  logger = (event: SafeEvent) => {
    console.info(JSON.stringify(event));
  },
}: {
  config?: LlmConfig;
  fetcher?: typeof fetch;
  now?: () => number;
  logger?: (event: SafeEvent) => void;
  budget?: ModelBudget;
} = {}) {
  const callBudget = budget ?? createModelBudget(config, now);
  return {
    capabilities() {
      return {
        configured: config.configured,
        configuration: config.configuration,
        provider: config.configured ? config.provider : null,
        model: config.configured ? config.modelLabel : null,
        connection_verified: false,
        output_policy: "grounded_candidates_only",
        workflow_version: WORKFLOW_VERSION,
      };
    },
    async generate(input: DiagnosisInput, signal?: AbortSignal) {
      const started = now();
      const base = diagnose(input, "server_rules");
      const fallback = (reason: FallbackReason) =>
        diagnosisSchema.parse({ ...base, generation: rulesGeneration(reason) });
      let result;
      if (base.risk !== "normal" || input.legality !== "用户已核实允许")
        result = fallback("safety_gate");
      else if (!config.configured) result = fallback("not_configured");
      else if (signal?.aborted) result = fallback("cancelled");
      else {
        let release: (() => void) | undefined;
        try {
          release = await callBudget.acquire();
          const { provider_model, ...assisted } = await requestModel(
            base,
            config,
            fetcher,
            signal,
          );
          result = diagnosisSchema.parse({
            ...base,
            ...assisted,
            source: "server_llm",
            generation: {
              mode: "llm_assisted",
              workflow_version: WORKFLOW_VERSION,
              provider: config.provider,
              model: config.modelLabel,
              fallback_reason: null,
              output_boundary: AI_OUTPUT_BOUNDARY,
              provider_model,
              latency_ms: Math.max(0, now() - started),
            },
          });
        } catch (error) {
          result = fallback(
            error instanceof ModelFailure ? error.reason : "invalid_output",
          );
        } finally {
          release?.();
        }
      }
      if (config.logEvents) {
        try {
          logger({
            event: "diagnosis_generated",
            rule_id: result.rule_id,
            mode: result.generation.mode,
            fallback_reason: result.generation.fallback_reason,
            duration_ms: Math.max(0, now() - started),
          });
        } catch {
          /* 日志系统不可用不得影响诊断与降级 */
        }
      }
      return result;
    },
  };
}
