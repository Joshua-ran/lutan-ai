import { diagnose } from "./engine.ts";
import { lureOptions } from "./schema.ts";
import { buildFollowupClarification } from "./agent-followup.ts";
import {
  AGENT_VERSION,
  agentResultSchema,
  applyReportedFeedback,
  redactPrivateText,
  type AgentTurnInput,
  type AgentResult,
} from "./agent.ts";

export function sanitizeAgentInput(raw: AgentTurnInput): AgentTurnInput {
  const message = redactPrivateText(raw.message);
  const facts = message.replace(
    /(?:没有|未见|不是|无明显)(?:急流|急涨|洪水|禁钓)/g,
    "",
  );
  const context = { ...raw.context, alias: "" };
  const observedClauses = message.split(/[，。！？；,\n]/).filter((clause) => !/(?:如果|假如|假设|要是|会不会|是否|是不是)/.test(clause));
  const followed = observedClauses.some((clause) =>
    /(?:有|看到|看见|发现|出现|观察到|仍在|一直在).{0,5}跟饵|跟饵了/.test(clause) &&
    !/(?:没(?:有)?(?:看到|看见|发现|观察到)?|未见|不再有).{0,3}跟饵|跟饵.{0,3}(?:没了|消失|停止)/.test(clause));
  const touched = observedClauses.some((clause) => /疑似触碰|(?:有|出现|感觉到).{0,4}触碰/.test(clause) && !/(?:没有|没感觉到|未见).{0,3}触碰/.test(clause));
  const deniedSignal = observedClauses.some((clause) => /没有跟饵|没看到跟饵|不再有跟饵|跟饵.{0,3}没了|没有触碰|没感觉到触碰/.test(clause));
  const noBite = observedClauses.some((clause) => /没(?:有)?(?:鱼口|咬口|口)|无口/.test(clause));
  if (followed) context.signal = "跟饵";
  else if (touched) context.signal = "疑似触碰";
  else if (deniedSignal) context.signal = noBite ? "无口" : "不清楚";
  else if (noBite && context.signal === "不清楚") context.signal = "无口";
  if (/乱石|岩石边|石头边/.test(message) && !/没有乱石|不是乱石/.test(message)) context.structure = "乱石 / 深浅交界";
  else if (/桥墩|回水湾/.test(message)) context.structure = "桥墩 / 回水湾";
  else if (/水草|岸边植被/.test(message)) context.structure = "水草 / 岸边结构";
  if (
    context.waterlevel !== "急变" &&
    /(?:感觉|观察|正在|在|近期|明显).{0,4}退水/.test(message) &&
    !/没有退水|不是退水|不在退水/.test(message)
  )
    context.waterlevel = "退水";
  for (const fish of ["鳜鱼", "翘嘴", "鲈鱼"] as const) {
    if (new RegExp(`(?:钓|目标[为是]?|想钓|路亚).{0,4}${fish}`).test(message))
      context.fish = fish;
  }
  for (const lure of lureOptions.filter((item) => item !== "其他")) {
    if (new RegExp(`(?:用|使用|换成).{0,3}${lure}|${lure}.{0,12}(?:试过|试了|没口|半小时|分钟)`, "i").test(message) &&
      !new RegExp(`没(?:有)?(?:使用|用|试).{0,3}${lure}|不(?:使用|用)${lure}`, "i").test(message))
      context.lures = [...new Set([...context.lures, lure])];
  }
  if (/当前(?:用|使用)(?:的是|的|是)?其他(?:类型的)?拟饵/.test(message)) context.lures = [...new Set([...context.lures, "其他" as const])];
  if (/(?:仍|还是|还)?不清楚(?:覆盖|搜索)?水层|不知道(?:覆盖|搜索)?水层|(?:覆盖|搜索|实际).*水层.{0,5}(?:不清楚|不知道)|无法确认水层/.test(message)) context.layers = "不清楚";
  else if (/(?:已确认|已经确认|确实|实际).{0,8}(?:搜索|覆盖|试过|搜).{0,4}多个水层|多个水层都(?:试|搜|覆盖)过/.test(message)) context.layers = "多个水层";
  else if (/已确认.{0,8}(?:搜索|覆盖|搜).{0,4}一个水层|主要(?:搜索|覆盖|搜|在).{0,3}(?:底层|中层|上层|一个水层)|只(?:搜索|覆盖|搜).{0,3}(?:底层|中层|上层|一个水层)/.test(message)) context.layers = "主要一个水层";
  if (!raw.session_snapshot.actions.length && /半小时|30\s*分钟/.test(message))
    context.duration = "20–40 分钟";
  if (/急涨|急流|水流很急|洪水|泄洪|岸边.*(?:坍塌|危险)/.test(facts)) {
    context.waterlevel = "急变";
  }
  if (/禁止垂钓|明确禁钓|这里禁钓/.test(facts)) context.legality = "禁止垂钓";
  const snapshot = {
    ...raw.session_snapshot,
    messages: raw.session_snapshot.messages.map((item) => ({
      ...item,
      text: redactPrivateText(item.text),
    })),
    actions: applyReportedFeedback(
      raw.session_snapshot.actions.map((item) => ({
        ...item,
        text: redactPrivateText(item.text).slice(0, 600),
      })),
      message,
    ),
    observations: {
      visible: raw.session_snapshot.observations.visible.map((item) =>
        redactPrivateText(item).slice(0, 600),
      ),
      reported: raw.session_snapshot.observations.reported.map((item) =>
        redactPrivateText(item).slice(0, 600),
      ),
      unknown: raw.session_snapshot.observations.unknown.map((item) =>
        redactPrivateText(item).slice(0, 600),
      ),
    },
  };
  return { ...raw, message, context, session_snapshot: snapshot };
}
export function ruleActionKind(ruleId: string): AgentResult["action_kind"] {
  if (
    ["retrieve_rhythm", "compare_rhythm", "controlled_comparison"].includes(
      ruleId,
    )
  )
    return "retrieve_rhythm";
  if (ruleId === "compare_structure") return "change_position";
  if (ruleId === "compare_layer") return "change_layer";
  if (ruleId === "check_rig") return "check_rig";
  if (["end_spot", "safety_first", "no_fishing"].includes(ruleId))
    return "end_spot";
  return "confirm_observation";
}
export const requiredUnknowns = [
  "单张照片不能确定实际流速、流向、水深或水下鱼群。",
  "照片不能确认涨退水趋势、水下鱼种或河段垂钓许可。",
  "未核验实时鱼情、水温及小河道水位，不提供渔获概率。",
  "天气数据不等于现场水位或鱼口预测。",
];
export function agentFallback(
  input: AgentTurnInput,
  source: "server_rule" | "local_rule" = "server_rule",
  warnings: string[] = [],
): AgentResult {
  const safe = sanitizeAgentInput(input);
  const rule = diagnose(
    safe.context,
    source === "local_rule" ? "local_rules" : "server_rules",
  );
  let action = rule.priority_action,
    kind = ruleActionKind(rule.rule_id),
    reason = rule.rationale;
  const failed = new Set(
    safe.session_snapshot.actions
      .filter((item) => item.feedback === "没有改善")
      .map((item) => item.kind),
  );
  if (rule.risk === "normal" && failed.has(kind)) {
    const candidates = [
      {
        kind: "check_rig" as const,
        text: "先在安全位置检查钩尖、钓组与拟饵运行状态；这次只检查装备状态，不同时换位和换饵。",
      },
      {
        kind: "change_layer" as const,
        text: "保持当前安全位置、拟饵和操作节奏，只在拟饵能力范围内比较另一个搜索水层。",
      },
      {
        kind: "change_position" as const,
        text: "在确认合法安全的范围内，仅选择一个结构或流态不同的邻近位置，保持其他变量不变。",
      },
      {
        kind: "end_spot" as const,
        text: "考虑结束当前标点的重复搜索，收竿并记录已尝试的范围，不把没有改善当作没有鱼。",
      },
    ];
    const next = candidates.find((item) => !failed.has(item.kind));
    if (next) {
      action = next.text;
      kind = next.kind;
      reason =
        "本次会话已经记录该方向没有改善，规则回退因此选择另一个尚未失败的单变量方向。";
    } else {
      action =
        "先暂停重复尝试，记录现场尚不明确的条件，核对下一次出钓所需信息。";
      kind = "confirm_observation";
      reason = "已记录多个方向没有改善，现有信息不足以继续给出可靠的新动作。";
    }
  }
  const clarification = buildFollowupClarification(safe);
  if (clarification) {
    action = clarification.action;
    kind = clarification.action_kind;
    reason = clarification.reason;
  }
  return agentResultSchema.parse({
    session_id: safe.session_id,
    turn_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    observations: {
      visible: safe.session_snapshot.observations.visible,
      reported: [
        safe.message,
        `用户条件：目标${safe.context.fish}；水位${safe.context.waterlevel}；合法性${safe.context.legality}。`,
      ],
      unknown: requiredUnknowns,
    },
    action,
    action_kind: kind,
    reason,
    check: clarification?.check ?? (
      rule.risk === "normal"
        ? "只记录这一个动作后是否出现新的跟饵、触碰或其他反馈；没有改善也如实反馈，不等同于中鱼率变化。"
        : "先确认已经远离危险或暂停作钓，并核对适用的官方预警及公告；未确认前不要继续作钓。"),
    follow_up_question: clarification ? clarification.follow_up_question : rule.follow_up_question,
    answer_source: source,
    model_name: null,
    provider: null,
    model_calls: 0,
    duration_ms: 0,
    tool_events: [],
    warnings: [rule.safety_or_legality_notice, ...warnings].slice(0, 8),
    reported_actions: safe.session_snapshot.actions,
    context: safe.context,
    agent_version: AGENT_VERSION,
  });
}
