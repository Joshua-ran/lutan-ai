import { z } from "zod";
import { diagnosisInputSchema, type DiagnosisInput } from "./schema.ts";

export const AGENT_VERSION = "lutan-agent-1.2.0";
export const agentFeedbackOptions = [
  "已尝试",
  "有改善",
  "没有改善",
  "暂未尝试",
] as const;
export const actionKinds = [
  "retrieve_rhythm",
  "change_layer",
  "change_position",
  "check_rig",
  "confirm_observation",
  "end_spot",
  "other",
] as const;
const shortText = z.string().trim().min(1).max(600);
export const observationsSchema = z
  .object({
    visible: z.array(shortText).max(8),
    reported: z.array(shortText).max(8),
    unknown: z.array(shortText).max(8),
  })
  .strict();
export const sessionActionSchema = z
  .object({
    id: z.string().min(1).max(100),
    turn_id: z.string().max(100),
    kind: z.enum(actionKinds),
    text: shortText,
    created_at: z.string().datetime(),
    applied_at: z.string().datetime().nullable(),
    feedback: z.enum(agentFeedbackOptions),
    feedback_at: z.string().datetime().nullable(),
    source: z.enum(["agent", "server_rule", "local_rule", "user_reported"]),
  })
  .strict();
export const agentMessageSchema = z
  .object({
    id: z.string().max(100),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(1400),
    created_at: z.string().datetime(),
    had_image: z.boolean().default(false),
  })
  .strict();
export const toolEventSchema = z
  .object({
    id: z.string().max(120),
    name: z.enum(["get_session_history", "get_weather", "read_session_actions", "get_weather_by_city"]),
    status: z.enum(["ok", "error"]),
    started_at: z.string().datetime(),
    duration_ms: z.number().nonnegative(),
    summary: z.string().max(300),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();
export const snapshotSchema = z
  .object({
    messages: z.array(agentMessageSchema).max(20),
    actions: z.array(sessionActionSchema).max(20),
    observations: observationsSchema,
    city: z
      .string()
      .trim()
      .max(48)
      .regex(/^[\p{L} .'-]*$/u)
      .default(""),
  })
  .strict();
export const agentTurnInputSchema = z
  .object({
    session_id: z.string().uuid(),
    message: z.string().trim().min(1).max(1200),
    image: z.string().max(2_800_000).optional(),
    context: diagnosisInputSchema,
    session_snapshot: snapshotSchema,
  })
  .strict();
export const agentFinalSchema = z
  .object({
    observations: observationsSchema,
    action: shortText,
    action_kind: z.enum(actionKinds),
    reason: shortText,
    check: shortText,
    follow_up_question: z.string().max(160).nullable(),
  })
  .strict();
export const agentResultSchema = agentFinalSchema
  .extend({
    session_id: z.string().uuid(),
    turn_id: z.string().uuid(),
    created_at: z.string().datetime(),
    answer_source: z.enum(["agent", "server_rule", "local_rule"]),
    model_name: z.string().max(120).nullable(),
    provider: z.enum(["deepseek", "openai_compatible"]).nullable(),
    model_calls: z.number().int().min(0).max(3),
    duration_ms: z.number().nonnegative(),
    tool_events: z.array(toolEventSchema).max(3),
    warnings: z.array(z.string().max(300)).max(8),
    reported_actions: z.array(sessionActionSchema).max(20),
    context: diagnosisInputSchema,
    agent_version: z.literal(AGENT_VERSION),
  })
  .strict();
export const agentSessionSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    context: diagnosisInputSchema,
    messages: z.array(agentMessageSchema).max(20),
    observations: observationsSchema,
    actions: z.array(sessionActionSchema).max(20),
    tool_events: z.array(toolEventSchema).max(30),
    city: z.string().max(48),
    last_result: agentResultSchema.nullable(),
  })
  .strict();
export const agentStoreSchema = z
  .object({
    schema_version: z.literal(1),
    current_id: z.string().uuid().nullable(),
    sessions: z.array(agentSessionSchema).max(20),
  })
  .strict();
export type AgentTurnInput = z.infer<typeof agentTurnInputSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type SessionAction = z.infer<typeof sessionActionSchema>;
export type ToolEvent = z.infer<typeof toolEventSchema>;

export function redactPrivateText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[链接已移除]")
    .replace(
      /(?:纬度|经度|latitude|longitude)\s*[:：=]?\s*-?\d{1,3}(?:\.\d+)?/gi,
      "[坐标已移除]",
    )
    .replace(
      /(?:北纬|南纬|东经|西经)\s*\d{1,3}(?:\.\d+)?(?:度)?/g,
      "[坐标已移除]",
    )
    .replace(/-?\d{1,3}\.\d{3,}\s*[,，/ ]\s*-?\d{1,3}\.\d{3,}/g, "[坐标已移除]")
    .trim()
    .slice(0, 1200);
}
export function newAgentSession(context: DiagnosisInput): AgentSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    context: { ...context, alias: "" },
    messages: [],
    observations: { visible: [], reported: [], unknown: [] },
    actions: [],
    tool_events: [],
    city: "",
    last_result: null,
  };
}
export function applyReportedFeedback(
  actions: SessionAction[],
  message: string,
): SessionAction[] {
  const report = readReportedFeedback(message);
  const last = actions.at(-1);
  const informationAnswered = last?.kind === "confirm_observation" && !/(?:没有|没|不|尚未)(?:使用|用|确认)/.test(message) && /已(?:经)?确认.{0,14}水层|(?:当前|现在)(?:使用|用)(?:的是|是)?(?:软饵|米诺|铁板|VIB|其他拟饵)/i.test(message);
  if (!report.outcome && !report.attempted && !report.not_attempted && !informationAnswered) return [...actions];
  const now = new Date().toISOString();
  const kind = report.kind;
  if (last && (!kind || kind === last.kind)) {
    // 持续没口并不证明上项已经执行；信息确认也不能按鱼口结果判成失败。
    const knownAttempt = last.feedback !== "暂未尝试";
    if (!report.not_attempted && !report.attempted && !informationAnswered && !knownAttempt) return [...actions];
    const feedback = report.not_attempted ? "暂未尝试"
      : last.kind === "confirm_observation" ? "已尝试"
      : report.outcome === "failure" ? "没有改善"
      : report.outcome === "success" ? "有改善" : "已尝试";
    return actions.map((action) =>
      action.id === last.id
        ? {
            ...action,
            feedback,
            applied_at: report.not_attempted ? null : action.applied_at,
            feedback_at: action.feedback === feedback && action.feedback_at ? action.feedback_at : now,
          }
        : action,
    );
  }
  if (kind && report.attempted)
    return [
      ...actions,
      {
        id: crypto.randomUUID(),
        turn_id: "user-reported",
        kind,
        text: redactPrivateText(message).slice(0, 600),
        created_at: now,
        applied_at: null,
        feedback: report.outcome === "failure" ? "没有改善" : report.outcome === "success" ? "有改善" : "已尝试",
        feedback_at: now,
        source: "user_reported",
      } satisfies SessionAction,
    ].slice(-20);
  return [...actions];
}

/** 仅识别用户明确表达的进展，不把“仍没口”自动记成已执行或失败。 */
export function readReportedFeedback(message: string) {
  const text = message.replace(/\s+/g, "");
  const not_attempted = /还没(?:有)?(?:试|做|尝试|执行)|暂(?:时)?未(?:尝试|试)|尚未(?:尝试|操作)|没有照做|没按.{0,8}(?:试|做)|没(?:有)?(?:换|调整|检查)/.test(text);
  const failure = /(?:还(?:是)?|仍(?:然|旧)?|依然)(?:没有|没|无)(?:鱼口|咬口|口)|没有改善|没(?:什么)?改善|无改善|没有效果|没效果|试.{0,16}(?:没口|没有口)/.test(text);
  const success = !failure && /有(?:了)?改善|有口了|有鱼口了|有好转/.test(text);
  const hypothetical = /(?:如果|要不要|是否|能不能).{0,10}(?:试|做|换|检查)|(?:试过|做过|检查过|换过).{0,8}(?:吗|会不会)/.test(text);
  const attempted = !not_attempted && !hypothetical && /试了|试过|做了|做过|照做了|执行了|操作了|换(?:了|过)位置|换位置了|换位了|换过位|换(?:了|过)水层|调整了水层|检查(?:了|过|完|后)|已尝试/.test(text);
  const kind: SessionAction["kind"] | null = /换.{0,8}位置|换位|换到.{0,8}边/.test(text) ? "change_position"
    : /换.{0,6}水层|改.{0,6}水层|调整.{0,6}水层/.test(text) ? "change_layer"
    : /检查.{0,8}(?:钩尖|钓组|拟饵)|(?:钩尖|钓组).{0,8}检查/.test(text) ? "check_rig" : null;
  return { outcome: failure ? "failure" as const : success ? "success" as const : null, attempted, not_attempted, kind };
}
