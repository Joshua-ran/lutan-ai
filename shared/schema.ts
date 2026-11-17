import { z } from "zod";

export const RULE_VERSION = "lutan-rules-1.0.0";
export const WORKFLOW_VERSION = "lutan-workflow-1.1.0";
export const RULE_OUTPUT_BOUNDARY =
  "建议来自版本化规则与用户观察，未核验鱼种、水文和法规，不保证鱼口或渔获。";
export const AI_OUTPUT_BOUNDARY =
  "AI 仅在规则限定的单变量候选和可追溯输入内组织建议；未核验鱼种、水文和法规，不保证鱼口或渔获。";
export const waterOptions = ["河流 / 支流", "湖泊 / 水库", "不确定"] as const;
export const fishOptions = ["鳜鱼", "翘嘴", "鲈鱼"] as const;
export const levelOptions = ["稳定", "涨水", "退水", "急变", "未知"] as const;
export const rainOptions = ["有", "无", "未知"] as const;
export const legalityOptions = ["未知", "用户已核实允许", "禁止垂钓"] as const;
export const structureOptions = [
  "乱石 / 深浅交界",
  "桥墩 / 回水湾",
  "水草 / 岸边结构",
  "不清楚",
] as const;
export const durationOptions = [
  "10 分钟左右",
  "20–40 分钟",
  "40 分钟以上",
  "不清楚",
] as const;
export const lureOptions = ["软饵", "铁板", "米诺", "VIB", "其他"] as const;
export const layerOptions = ["主要一个水层", "多个水层", "不清楚"] as const;
export const adjustOptions = [
  "没有",
  "手法",
  "换位",
  "都试过",
  "不清楚",
] as const;
export const signalOptions = ["无口", "跟饵", "疑似触碰", "不清楚"] as const;
export const flowOptions = ["缓慢", "普通", "很急", "未知"] as const;
export const clarityOptions = ["清澈", "一般", "浑浊", "未知"] as const;
export const observationOptions = [
  "没有特别观察",
  "水面炸水",
  "不清楚",
] as const;
export const outcomeOptions = [
  "有改善",
  "没有改善",
  "暂未尝试",
  "不适用 / 不安全",
] as const;

export const tripSchema = z
  .object({
    water: z.enum(waterOptions).default("河流 / 支流"),
    fish: z.enum(fishOptions).default("鳜鱼"),
    alias: z.string().trim().max(36).default(""),
    waterlevel: z.enum(levelOptions).default("未知"),
    rain: z.enum(rainOptions).default("未知"),
    legality: z.enum(legalityOptions).default("未知"),
  })
  .strict();

export const diagnosisInputSchema = tripSchema
  .extend({
    structure: z.enum(structureOptions).default("不清楚"),
    duration: z.enum(durationOptions).default("不清楚"),
    lures: z
      .array(z.enum(lureOptions))
      .max(5)
      .refine((v) => new Set(v).size === v.length, "拟饵不能重复")
      .default([]),
    layers: z.enum(layerOptions).default("不清楚"),
    adjust: z.enum(adjustOptions).default("不清楚"),
    signal: z.enum(signalOptions).default("不清楚"),
    flow: z.enum(flowOptions).default("未知"),
    clarity: z.enum(clarityOptions).default("未知"),
    observed: z.enum(observationOptions).default("不清楚"),
  })
  .strict();

const sourceSchema = z.enum(["server_rules", "local_rules"]);
export const fallbackReasonSchema = z.enum([
  "not_configured",
  "safety_gate",
  "timeout",
  "provider_error",
  "invalid_output",
  "rate_limited",
  "budget_exhausted",
  "busy",
  "cancelled",
  "api_unavailable",
]);
export const generationSchema = z
  .object({
    mode: z.enum(["rules", "llm_assisted"]),
    workflow_version: z.string().min(1).max(80),
    provider: z.enum(["openai_compatible", "deepseek"]).nullable(),
    model: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .nullable(),
    fallback_reason: fallbackReasonSchema.nullable(),
    output_boundary: z.string().min(1).max(240),
    provider_model: z
      .string()
      .regex(/^[A-Za-z0-9._/-]{1,120}$/)
      .nullable()
      .optional(),
    latency_ms: z.number().nonnegative().optional(),
  })
  .strict();
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;
export type Generation = z.infer<typeof generationSchema>;
export function rulesGeneration(
  reason: FallbackReason | null = null,
): Generation {
  return {
    mode: "rules",
    workflow_version: WORKFLOW_VERSION,
    provider: null,
    model: null,
    fallback_reason: reason,
    output_boundary: RULE_OUTPUT_BOUNDARY,
  };
}
export const diagnosisSchema = z
  .object({
    id: z.string(),
    rule_version: z.literal(RULE_VERSION),
    rule_id: z.string(),
    created_at: z.string().datetime(),
    source: z.enum(["server_rules", "local_rules", "server_llm"]),
    generation: generationSchema.optional(),
    title: z.string(),
    priority_action: z.string(),
    rationale: z.string(),
    observed_facts: z.array(z.string()),
    evidence_status: z.literal("insufficient"),
    unknowns: z.array(z.string()),
    safety_or_legality_notice: z.string(),
    follow_up_question: z.string().nullable(),
    risk: z.enum(["danger", "restricted", "verify_first", "normal"]),
    input: diagnosisInputSchema,
  })
  .strict()
  .superRefine((data, context) => {
    const ai = data.source === "server_llm";
    if (
      ai &&
      (data.risk !== "normal" ||
        data.input.legality !== "用户已核实允许" ||
        data.input.waterlevel === "急变" ||
        data.input.flow === "很急" ||
        data.generation?.mode !== "llm_assisted" ||
        !data.generation.model ||
        !["openai_compatible", "deepseek"].includes(
          data.generation.provider ?? "",
        ) ||
        data.generation.fallback_reason !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "AI 来源必须经过普通风险门控并包含模型元数据",
      });
    }
    if (
      !ai &&
      data.generation &&
      (data.generation.mode !== "rules" ||
        data.generation.model !== null ||
        data.generation.provider !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "规则来源不能标记为 AI 模式",
      });
    }
  })
  .transform((data) => ({
    ...data,
    generation: data.generation ?? {
      ...rulesGeneration(),
      workflow_version: "legacy-v1",
    },
  }));

export const pretripSchema = z
  .object({
    rule_version: z.literal(RULE_VERSION),
    source: sourceSchema,
    input: tripSchema,
    known: z.array(z.string()),
    unknowns: z.array(z.string()),
    verification: z.array(z.string()),
    preparation: z.string(),
    notice: z.string(),
    risk: z.enum(["danger", "restricted", "verify_first", "normal"]),
    evidence_status: z.literal("insufficient"),
  })
  .strict();

export const feedbackSchema = z
  .object({
    outcome: z.enum(outcomeOptions),
    memo: z.string().trim().max(240),
  })
  .strict();

export const recordSchema = z
  .object({
    id: z.string(),
    schema_version: z
      .union([z.literal(1), z.literal(2)])
      .transform(() => 2 as const),
    created_at: z.string().datetime(),
    diagnosis: diagnosisSchema,
    feedback: feedbackSchema,
  })
  .strict();

export const recordsEnvelopeSchema = z.object({
  schema_version: z
    .union([z.literal(1), z.literal(2)])
    .transform(() => 2 as const),
  records: z.array(recordSchema).max(500),
});

export type Trip = z.infer<typeof tripSchema>;
export type DiagnosisInput = z.infer<typeof diagnosisInputSchema>;
export type Diagnosis = z.infer<typeof diagnosisSchema>;
export type Pretrip = z.infer<typeof pretripSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type TripRecord = z.infer<typeof recordSchema>;
export type ResultSource = z.infer<typeof sourceSchema>;

export const defaultInput: DiagnosisInput = diagnosisInputSchema.parse({});
