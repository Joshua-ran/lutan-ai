import { z } from "zod";
import type { Diagnosis } from "../../shared/schema.ts";

/** 模型只返回受约束的引用 ID；页面文案由服务端可信候选渲染，不接受自由文本事实。 */
export function buildGrounding(base: Diagnosis) {
  const input = base.input;
  const context = [
    `本次以${input.fish}为目标`,
    ...(input.structure === "不清楚"
      ? []
      : [`你报告正在搜索${input.structure}`]),
  ].join("，");
  const actions = {
    rule_action: base.priority_action,
    contextual_action: `${context}。${base.priority_action}`,
  };
  const rationales: Record<string, string> = {
    rule_basis: base.rationale,
    target_context: `你的本次目标是${input.fish}，目标选择不是该水域物种出现的证据；本建议用于比较动作，不是针对该鱼种习性的推断。`,
    attempt_context: `你报告的搜索时长为${input.duration}、水层为${input.layers}、已调整${input.adjust}；这些尝试决定了本次只比较一个变量的范围。`,
  };
  if (input.structure !== "不清楚")
    rationales.structure_context = `你报告正在搜索${input.structure}，可将其与已经尝试的位置一起记录，比较结构与流态差异；结构本身不能证明目标鱼存在。`;
  if (input.clarity !== "未知")
    rationales.clarity_context = `你报告现场水色为${input.clarity}，这只是本次观察条件，不能据此确定鱼口变化方向或原因。`;
  const unknowns = Object.fromEntries(
    base.unknowns.map((text, index) => [`u${index}`, text]),
  );
  const questions: Record<string, string> = {};
  if (base.follow_up_question)
    questions.rule_question = base.follow_up_question;
  else if (input.structure === "不清楚")
    questions.structure_question =
      "你目前搜索的结构是什么？不确定时可以保留未知。";
  else if (input.clarity === "未知")
    questions.clarity_question = "你是否观察到现场水色？不了解时可以保留未知。";

  const actionIds = Object.keys(actions) as [
    keyof typeof actions,
    ...(keyof typeof actions)[],
  ];
  const rationaleIds = Object.keys(rationales) as [string, ...string[]];
  const unknownIds = Object.keys(unknowns) as [string, ...string[]];
  const questionIds = Object.keys(questions);
  const questionSchema = questionIds.length
    ? z.enum(questionIds as [string, ...string[]]).nullable()
    : z.null();
  const schema = z
    .object({
      action_id: z.enum(actionIds),
      rationale_ids: z.array(z.enum(rationaleIds)).min(2).max(4),
      unknown_ids: z
        .array(z.enum(unknownIds))
        .min(unknownIds.length)
        .max(unknownIds.length),
      follow_up_question_id: questionSchema,
      evidence_status: z.literal("insufficient"),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        !value.rationale_ids.includes("rule_basis") ||
        new Set(value.rationale_ids).size !== value.rationale_ids.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: "必须保留规则依据且依据不得重复",
        });
      }
      if (
        new Set(value.unknown_ids).size !== unknownIds.length ||
        unknownIds.some((id) => !value.unknown_ids.includes(id))
      ) {
        ctx.addIssue({ code: "custom", message: "必须保留所有未知边界" });
      }
      if (
        base.follow_up_question &&
        value.follow_up_question_id !== "rule_question"
      ) {
        ctx.addIssue({ code: "custom", message: "不能删除规则要求的关键追问" });
      }
    });
  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "action_id",
      "rationale_ids",
      "unknown_ids",
      "follow_up_question_id",
      "evidence_status",
    ],
    properties: {
      action_id: { type: "string", enum: actionIds },
      rationale_ids: {
        type: "array",
        items: { type: "string", enum: rationaleIds },
        minItems: 2,
        maxItems: 4,
      },
      unknown_ids: {
        type: "array",
        items: { type: "string", enum: unknownIds },
        minItems: unknownIds.length,
        maxItems: unknownIds.length,
      },
      follow_up_question_id: questionIds.length
        ? { anyOf: [{ type: "string", enum: questionIds }, { type: "null" }] }
        : { type: "null" },
      evidence_status: { type: "string", enum: ["insufficient"] },
    },
  };
  // 显式白名单：绝不序列化整个 input、请求对象、昵称、备注、ID、坐标或环境变量。
  const payload = {
    user_observations: {
      water: input.water,
      target_fish: input.fish,
      structure: input.structure,
      clarity: input.clarity,
      waterlevel: input.waterlevel,
      flow: input.flow,
      rain: input.rain,
      duration: input.duration,
      lures: input.lures,
      layers: input.layers,
      adjust: input.adjust,
      signal: input.signal,
      observed: input.observed,
    },
    risk: "normal",
    legality: "user_reported_checked_not_independently_verified",
    rule_id: base.rule_id,
    evidence_status: "insufficient",
    verified_external_evidence: [],
    allowed_actions: actions,
    allowed_rationales: rationales,
    required_unknowns: unknowns,
    allowed_follow_up_questions: questions,
    required_rationale_id: "rule_basis",
    required_question_id: base.follow_up_question ? "rule_question" : null,
    output_schema: jsonSchema,
  };
  return {
    actions,
    rationales,
    unknowns,
    questions,
    schema,
    jsonSchema,
    payload,
  };
}

export const MODEL_SYSTEM_PROMPT = `你是路探 AI 的受约束诊断辅助器。只输出符合给定 JSON Schema 的 JSON 对象。
所有观察来自用户自述，不是实时监测、物种证据或系统核实的许可。不得添加物种、水文、鱼口概率、法规或生物学习性结论。
规则已决定风险和单变量方向。只从 allowed_actions 选择一个行动 ID，从 allowed_rationales 选择 2–4 个不同依据 ID，必须包含 rule_basis。
优先体现当前结构、水色及已经尝试的范围，不能为差异化而编造解释。required_unknowns 的全部 ID 必须保留。
追问只能选择一个已提供的 ID 或 null；required_question_id 非空时必须保留。不得返回任何额外字段、自由文本、工具调用或 Markdown。`;
