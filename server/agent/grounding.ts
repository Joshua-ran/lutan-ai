import type { AgentTurnInput, AgentResult } from "../../shared/agent.ts";
import { agentFallback, requiredUnknowns, ruleActionKind } from "../../shared/agent-fallback.ts";
import { buildFollowupClarification } from "../../shared/agent-followup.ts";
import { diagnose } from "../../shared/engine.ts";

export const protectedRuleIds = ["retrieve_rhythm", "check_rig", "end_spot", "confirm_layer", "clarify_lure", "compare_layer", "compare_structure", "compare_rhythm", "clarify_attempt"] as const;

/** Every ordinary branch gets a grounded contract; missing variants never open free generation. */
export function buildAgentDecisionContract(input: AgentTurnInput) {
  const rule = diagnose(input.context, "server_rules");
  const clarification = buildFollowupClarification(input);
  if (clarification) return {
    rule_id: "followup_clarification",
    action_kind: clarification.action_kind,
    action_candidates: [clarification.action],
    reason: clarification.reason, check: clarification.check,
    follow_up_question: clarification.follow_up_question,
    unknown_candidates: [...new Set([...requiredUnknowns, ...rule.unknowns])],
  };
  const variants: Record<string, { kind: AgentResult["action_kind"]; alternative: string; check: string }> = {
    confirm_layer: {
      kind: "confirm_observation",
      alternative: "保持当前拟饵和安全位置，先记录拟饵下沉与回收时实际覆盖的水层；不指定尚未确认的底层，也不同时换饵和换位。",
      check: "记录能够确认的搜索水层，无法判断时继续标为未知；无口不能证明某个水层无效或没有鱼。",
    },
    clarify_lure: {
      kind: "confirm_observation",
      alternative: "先说明当前使用的拟饵及已知的下沉、回收路径；不清楚的部分保留未知，本轮不同时更换拟饵和位置。",
      check: "核对当前拟饵和实际覆盖范围；没有提供的条件仍为未知，不能据此判断鱼种或鱼口。",
    },
    compare_layer: {
      kind: "change_layer",
      alternative: "保持当前拟饵、手法和安全位置，只在拟饵能力范围内比较另一个搜索水层，并记录反馈。",
      check: "记录这一次水层比较的覆盖范围与反馈，没有变化也如实记录，不据此断言鱼在某层。",
    },
    retrieve_rhythm: {
      kind: "retrieve_rhythm",
      alternative: "保持当前拟饵、位置和搜索水层，本次只做一次小幅停顿节奏比较，记录跟饵与攻击反馈是否不同。",
      check: "记录这次节奏比较前后的跟饵或攻击反馈；没有变化也如实记录，不据此确认鱼种或保证鱼口。",
    },
    check_rig: {
      kind: "check_rig",
      alternative: "在安全位置只检查钩尖、钓组和拟饵运行状态，记录异常或无法判明的触碰；本次不同时换位或换饵。",
      check: "记录钩尖、钓组和拟饵是否异常；无法区分触底和鱼口时继续标为未知，不能凭触碰确认目标鱼。",
    },
    end_spot: {
      kind: "end_spot",
      alternative: "本轮结束当前标点的重复搜索，记录已尝试的拟饵、水层、手法和位置后收竿；不把无口当成没有鱼。",
      check: "记录本次搜索范围、已尝试变量和结束当前标点的选择；无口仍不能证明该处没有鱼。",
    },
  };
  if (rule.risk !== "normal") return null;
  const variant = variants[rule.rule_id] ?? {
    kind: ruleActionKind(rule.rule_id),
    alternative: rule.priority_action,
    check: "只记录这一项尝试后的反馈；不把没有改善解释为没有鱼，也不推断鱼类心理或习性。",
  };
  // 已明确失败的方向使用已有规则回退计划生成下一项候选，而不是取消约束。
  if (input.session_snapshot.actions.some((action) => action.kind === variant.kind && action.feedback === "没有改善")) {
    const next = agentFallback(input, "server_rule");
    return { rule_id: "followup_next_action", action_kind: next.action_kind, action_candidates: [next.action],
      reason: next.reason, check: next.check, follow_up_question: next.follow_up_question,
      unknown_candidates: [...new Set([...requiredUnknowns, ...rule.unknowns])] };
  }
  return {
    rule_id: rule.rule_id,
    action_kind: variant.kind,
    action_candidates: [...new Set([rule.priority_action, variant.alternative])],
    reason: rule.rationale,
    check: variant.check,
    follow_up_question: rule.follow_up_question,
    unknown_candidates: [...new Set([...requiredUnknowns, ...rule.unknowns])],
  };
}
