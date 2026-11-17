import { getRisk } from "./engine.ts";
import { readReportedFeedback, type AgentTurnInput, type AgentResult } from "./agent.ts";

export type FollowupDecision = Pick<AgentResult, "action" | "action_kind" | "reason" | "check" | "follow_up_question">;

/** 缺少上一步的必要信息时，用一个明确追问推进，不能复读初始建议或编造已尝试。 */
export function buildFollowupClarification(input: AgentTurnInput): FollowupDecision | null {
  if (getRisk(input.context) !== "normal") return null;
  const last = input.session_snapshot.actions.at(-1);
  if (!last) return null;
  const report = readReportedFeedback(input.message);
  // A new observed signal has higher priority than an old clarification.
  if ((input.context.signal === "跟饵" && /跟饵/.test(input.message)) || (input.context.signal === "疑似触碰" && /触碰/.test(input.message))) return null;
  if (last.kind === "check_rig" && input.context.layers === "不清楚" && /没有异常|未见异常|(?:钩尖|钓组|装备).{0,8}正常/.test(input.message)) return {
    action: "先暂停新增调整，记录装备未见异常及水层仍无法确认的情况。",
    action_kind: "confirm_observation",
    reason: "你报告装备未见异常，但水层信息仍缺失，现有信息不足以支持新的可靠调整。",
    check: "保留已经报告的结果和未知项，后续有新观察再补充，不把检查正常当成鱼口或鱼种证据。",
    follow_up_question: null,
  };
  const continuing = Boolean(report.outcome || report.attempted || report.not_attempted || /仍不清楚|还是不清楚|不知道怎么确认|无法确认/.test(input.message));
  if (!continuing) return null;
  if (last.kind === "confirm_observation" && !input.context.lures.length) return {
    action: "这轮先补充当前拟饵名称，暂不增加新的作钓调整。",
    action_kind: "confirm_observation",
    reason: "你反馈仍没有口，但本次会话还缺少当前拟饵信息，不能假定你用了哪一种。",
    check: "只填写实际使用的拟饵；不清楚时保持未知，不把无口解释成鱼种或水域结论。",
    follow_up_question: "你当前实际使用软饵、米诺、铁板、VIB，还是其他拟饵？",
  };
  if (last.kind === "confirm_observation" && input.context.layers === "不清楚") {
    if (/仍不清楚(?:覆盖|搜索)?水层|水层仍不清楚|无法确认水层|不知道怎么确认/.test(input.message) && !input.session_snapshot.actions.some((item) => item.kind === "check_rig" && item.feedback === "没有改善")) return {
      action: "水层先保留未知，这轮只在安全位置检查钩尖、钓组和拟饵是否异常。",
      action_kind: "check_rig",
      reason: "你明确说仍不能确认水层，先做不依赖水层判断的装备检查，不继续要求你猜测。",
      check: "记录是否发现异常或仍无法判断；没有异常也如实说明，不等同于鱼口或渔获变化。",
      follow_up_question: "检查后钩尖、钓组或拟饵是否发现异常？",
    };
    return {
      action: "先补充上一项的搜索水层记录，暂不重复调整拟饵或位置。",
      action_kind: "confirm_observation",
      reason: "你反馈仍没有口，上次需要确认的水层信息仍缺失；现在先补这一项，不能据此认定某个水层无效。",
      check: "只报告自己能确认的覆盖范围，判断不了就明确说仍不清楚；持续无口不自动记作上一步已执行或失败。",
      follow_up_question: "你现在能确认主要覆盖一个水层、多个水层，还是仍不清楚？",
    };
  }
  if (!report.attempted && !report.not_attempted && last.feedback === "暂未尝试") return {
    action: "先补充上一项是否已经尝试，暂不追加新的调整变量。",
    action_kind: "confirm_observation",
    reason: "你报告仍没有口，但还没有明确上一步是否实际执行，不能擅自把它记为失败。",
    check: "按真实情况说明尚未尝试或已尝试后的反馈，不推断实际耗时或鱼口原因。",
    follow_up_question: "刚才那一项建议你实际尝试过了吗？",
  };
  if (report.attempted && !report.outcome) return {
    ...( /暂时无法判断|无法判断(?:效果|结果)|不确定是否改善/.test(input.message) ? {
      action: "先保持当前条件，记录这次尝试的反馈尚无法判断。",
      action_kind: "confirm_observation" as const,
      reason: "你已说明尝试过但结果尚不确定，不能把已尝试记成成功或失败。",
      check: "后续出现明确观察时再补充，不设定未提供的时长或保证鱼口。",
      follow_up_question: null,
    } : {
    action: "先记录上一项的实际反馈，再决定是否改变下一个变量。",
    action_kind: "confirm_observation",
    reason: "你明确说已经尝试，但还没有报告结果，不能替你记成有改善或没有改善。",
    check: "只报告实际反馈，无法判断时保留未知，不把已尝试等同于有效。",
    follow_up_question: "这次尝试后是有改善、没有改善，还是暂时无法判断？",
    }),
  };
  return null;
}
