import { z } from "zod";
import {
  AGENT_VERSION,
  agentFinalSchema,
  agentResultSchema,
  type AgentTurnInput,
  type ToolEvent,
  type AgentResult,
  readReportedFeedback,
} from "../../shared/agent.ts";
import {
  agentFallback,
  requiredUnknowns,
  sanitizeAgentInput,
} from "../../shared/agent-fallback.ts";
import { getRisk } from "../../shared/engine.ts";
import { readLlmConfig, type LlmConfig } from "../llm/config.ts";
import { requestChatCompletion } from "../llm/chat.ts";
import { ModelFailure } from "../llm/errors.ts";
import { createModelBudget, type ModelBudget } from "../llm/budget.ts";
import { executeTool, toolDefinitions } from "./tools.ts";
import { buildAgentDecisionContract, protectedRuleIds } from "./grounding.ts";

const completionSchema = z.object({
  model: z.string().max(120).optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.enum(["stop", "tool_calls"]),
        message: z.object({
          content: z.string().max(10000).nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                type: z.literal("function"),
                function: z.object({
                  name: z.string().max(80),
                  arguments: z.string().max(4000),
                }),
              }),
            )
            .max(8)
            .nullable()
            .optional(),
        }),
      }),
    )
    .length(1),
});

const systemPrompt = `你是路探 AI 现场连续决策 Agent。风险和许可已由规则门控，仍不得建议进入急流、涉水、攀爬或靠近危险岸边。
只根据本轮图文、已提供的会话和真实工具结果回答。照片只能观察可见结构、水色、岸线、植被，不能确认涨退水趋势、鱼种存在、河段许可；用户说的退水、目标鱼和鱼口必须放 reported。不要添加无来源鱼类习性、心理（如犹豫、感兴趣）、实时鱼情、水位数值、未报告的位置距离或渔获概率。
decision_contract 非空时，这是本轮已审核的规则决定：action 必须逐字选用 action_candidates 的一项，action_kind、reason、check、follow_up_question 必须逐字使用契约值，不得改写或增补操作。observations.unknown 只能选用 unknown_candidates 中的原句。工具结果不能覆盖该决定，空会话记录不能否定当前 user_context 和 message 中用户自述的尝试。
你自主判断是否调用工具，不要每轮固定调用。用户追问上一项建议的执行效果（例如“我按你说的试了，还是没口”）或要求读取历史时，应先调用 get_session_history 核对提交的动作和反馈，再决定下一步。decision_contract 是建议边界，不是已执行的工具；不能用它代替历史查询。仅描述新的现场观察时可以直接回答，不调用无关工具。不要声称能读服务器或其他设备的记录。用户明确给出城市并请求天气时调用 get_weather；没有城市就追问，不猜测位置。工具失败就承认不可用，不编造结果。天气不等于水温、水位、鱼情。最终建议仍遵守契约，天气实测值通过工具结果区展示，不要擅自改写固定的行动依据。
持续没口不等于上一项已经尝试，信息确认也不能按鱼口结果判为失败。存在待确认信息时必须保留给定追问；用户明确补全条件后再推进下一项。不要机械重复 failed_action_kinds 中已失败的调整方向；可以提出合理的新动作，但本次只改变一个变量。最多两轮工具、共三次执行。
最终只返回 JSON，不要 Markdown：{"observations":{"visible":[],"reported":[],"unknown":[]},"action":"一项明确的动作","action_kind":"retrieve_rhythm|change_layer|change_position|check_rig|confirm_observation|end_spot|other","reason":"对应输入与历史尝试的依据","check":"做完如何观察是否有效","follow_up_question":null}。
observations.reported 和 observations.unknown 固定返回空数组 []，服务端会从用户输入及已知边界统一补充，不要自行改写这些边界。所有数组最多8条，必要追问最多一个。有图片时 visible 必须提取2至3条、每条不超过50字的实际可见岸线、岩石、植被、水面纹理观察，不要只说上传成功，也不要复述用户目标鱼。无标尺不估计尺寸或距离。单张照片不能确定涨退水、流速、流向、水下鱼群，不能把这些写成识别事实。本轮没有图片时只能引用 prior_visible 已有观察，不能新造照片观察。`;

function validateFinal(raw: unknown, input: AgentTurnInput, events: ToolEvent[]) {
  const final = agentFinalSchema.parse(raw);
  const contract = buildAgentDecisionContract(input);
  if (contract && (
    final.action_kind !== contract.action_kind ||
    !contract.action_candidates.includes(final.action) ||
    final.reason !== contract.reason || final.check !== contract.check ||
    final.follow_up_question !== contract.follow_up_question ||
    final.observations.unknown.some((text) => !contract.unknown_candidates.includes(text))
  )) throw new ModelFailure("invalid_output");
  const assertions = `${final.action} ${final.reason} ${final.check}`;
  if ((final.follow_up_question?.match(/[?？]/g)?.length ?? 0) > 1) throw new ModelFailure("invalid_output");
  const temperatures = [...assertions.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:℃|°\s*C|摄氏度)/g)].map(match => Number(match[1]));
  const knownTemperatures = events.filter(event => ["get_weather", "get_weather_by_city"].includes(event.name) && event.status === "ok").map(event => event.result.temperature_c);
  const reportedTemperatures = [...input.message.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:℃|°\s*C|摄氏度)/g)].map(match => Number(match[1]));
  if (temperatures.some(value => !knownTemperatures.includes(value) && !reportedTemperatures.includes(value))) throw new ModelFailure("invalid_output");
  if (
    /(肯定有|必然有|保证能|一定会中鱼|(?:中鱼率|渔获概率).{0,8}(?:\d|高达|达到|提升)|[0-9]+\s*[%％]|(?:水位|退水|涨水).{0,8}(?:上升|下降|上涨|退了)\s*\d|走入急流|涉水到|爬上桥墩)/.test(
      assertions,
    )
  )
    throw new ModelFailure("invalid_output");
  if (
    !input.image &&
    final.observations.visible.some(
      (text) => !input.session_snapshot.observations.visible.includes(text),
    )
  )
    throw new ModelFailure("invalid_output");
  if (
    final.observations.visible.some((text) => text.split(/[，。；;,]/).some(clause =>
      !/无法|不能|不确定|不足以|不代表/.test(clause) && /涨水|退水|鱼种|鱼群|鳜鱼|翘嘴|鲈鱼|禁钓|允许垂钓|流速|流向|水流很急|水流缓慢|水位.*(?:升|降)/.test(clause)),
    )
  )
    throw new ModelFailure("invalid_output");
  const failedKinds = new Set(
    input.session_snapshot.actions
      .filter((item) => item.feedback === "没有改善")
      .map((item) => item.kind),
  );
  const normalize = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, "");
  if (
    (failedKinds.has(final.action_kind) &&
      final.action_kind !== "other" &&
      final.action_kind !== "confirm_observation") ||
    input.session_snapshot.actions.some(
      (item) =>
        item.feedback === "没有改善" &&
        normalize(item.text) === normalize(final.action),
    )
  )
    throw new ModelFailure("invalid_output");
  return final;
}

export function createAgentService({
  config = readLlmConfig(),
  fetcher = fetch,
  weatherFetcher = fetch,
  budget,
}: {
  config?: LlmConfig;
  fetcher?: typeof fetch;
  weatherFetcher?: typeof fetch;
  budget?: ModelBudget;
} = {}) {
  const callBudget = budget ?? createModelBudget(config);
  return {
    capabilities() {
      return {
        enabled: config.configured,
        model: config.configured ? config.modelLabel : null,
        vision: config.configured && config.supportsVision,
        tools: config.configured && config.supportsTools,
        max_tool_rounds: 2,
        max_tool_executions: 3,
        protected_rule_ids: [...protectedRuleIds],
        version: AGENT_VERSION,
      };
    },
    async turn(
      raw: AgentTurnInput,
      signal?: AbortSignal,
    ): Promise<AgentResult> {
      const start = performance.now();
      const input = sanitizeAgentInput(raw);
      const events: ToolEvent[] = [];
      const warnings: string[] = [];
      let calls = 0;
      const finish = (result: AgentResult) =>
        agentResultSchema.parse({
          ...result,
          tool_events: events,
          warnings: [...result.warnings, ...warnings].slice(0, 8),
          model_calls: calls,
          duration_ms: Math.round(performance.now() - start),
        });
      const fallback = (message: string) =>
        finish(agentFallback(input, "server_rule", [message]));
      if (getRisk(input.context) !== "normal")
        return fallback("安全或合法性门控：本次未调用模型。");
      if (!config.configured)
        return fallback("尚未启用或配置模型，本次建议来自规则。");
      if (input.image && !config.supportsVision)
        return fallback(
          "当前模型没有启用图片能力，本次图片未发送，已使用规则建议。",
        );
      if (!config.supportsTools)
        warnings.push(
          "当前模型未启用 Function Calling，本次只能进行图文回答，不会显示虚构的工具调用。",
        );
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(60000, config.timeoutMs * 3 + 10000),
      );
      const combined = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      const failedKinds = input.session_snapshot.actions
        .filter((action) => action.feedback === "没有改善")
        .map((action) => action.kind);
      const explicitHistoryRead = config.supportsTools && input.session_snapshot.actions.length > 0 && /(?:读取|查看|核对).{0,8}(?:本次尝试|会话|历史|记录)/.test(input.message);
      const briefing = {
        message: input.message,
        user_context: input.context,
        city: input.session_snapshot.city,
        prior_visible: input.session_snapshot.observations.visible,
        failed_action_kinds: failedKinds,
        session_memory: { available: input.session_snapshot.actions.length > 0, action_count: input.session_snapshot.actions.length, source: "通过 get_session_history 核对详细动作与反馈" },
        latest_feedback: { feedback: input.session_snapshot.actions.at(-1)?.feedback ?? null },
        reported_feedback: readReportedFeedback(input.message),
        session_source: "client_snapshot_user_reported",
        decision_contract: buildAgentDecisionContract(input),
      };
      const messages: Record<string, unknown>[] = [
        { role: "system", content: systemPrompt },
        ...input.session_snapshot.messages
          .slice(-8)
          .map((item) => ({ role: item.role, content: item.text })),
        {
          role: "user",
          content: input.image
            ? [
                { type: "text", text: JSON.stringify(briefing) },
                { type: "image_url", image_url: { url: input.image } },
              ]
            : JSON.stringify(briefing),
        },
      ];
      try {
        for (let round = 0; round < 3; round++) {
          const release = await callBudget.acquire();
          let rawCompletion: unknown;
          try {
            calls++;
            rawCompletion = await requestChatCompletion(
              config,
              {
                messages,
                ...(config.supportsTools && round < 2
                  ? { tools: toolDefinitions, tool_choice: "auto" }
                  : {
                      response_format: { type: "json_object" },
                      ...(config.supportsTools
                        ? { tools: toolDefinitions, tool_choice: "none" }
                        : {}),
                    }),
              },
              fetcher,
              combined,
            );
          } finally {
            release();
          }
          const completion = completionSchema.parse(rawCompletion);
          const message = completion.choices[0].message;
          if (message.refusal) throw new ModelFailure("invalid_output");
          const toolCalls = message.tool_calls ?? [];
          if (toolCalls.length) {
            if (
              !config.supportsTools ||
              round >= 2 ||
              events.length + toolCalls.length > 3
            )
              return fallback("已达到本轮工具调用上限，使用规则继续给出建议。");
            messages.push({
              role: "assistant",
              content: message.content ?? null,
              tool_calls: toolCalls,
            });
            for (const tool of toolCalls) {
              if (
                !["read_session_actions", "get_weather_by_city", "get_session_history", "get_weather"].includes(
                  tool.function.name,
                )
              )
                return fallback("模型请求了未授权工具，已停止并回退规则。");
              const toolStart = performance.now(),
                started = new Date().toISOString();
              let result: Record<string, unknown>;
              try {
                result = await executeTool(
                  tool.function.name,
                  JSON.parse(tool.function.arguments),
                  input,
                  weatherFetcher,
                  combined,
                );
              } catch {
                result = {
                  status: "invalid_arguments",
                  message: "工具参数未通过校验，未执行请求。",
                };
              }
              const ok = result.status === "ok";
              events.push({
                id: crypto.randomUUID(),
                name: tool.function.name as ToolEvent["name"],
                status: ok ? "ok" : "error",
                started_at: started,
                duration_ms: Math.round(performance.now() - toolStart),
                summary:
                  ["read_session_actions", "get_session_history"].includes(tool.function.name)
                    ? ok
                      ? `已读取本次会话 ${input.session_snapshot.actions.length} 条动作记录`
                      : "会话工具不可用"
                    : ok
                      ? `已查询 ${String(result.city)} 的城市天气`
                      : String(result.message ?? "天气工具不可用").slice(
                          0,
                          300,
                        ),
                result,
              });
              if (!ok)
                warnings.push(
                  String(result.message ?? "部分工具不可用").slice(0, 300),
                );
              messages.push({
                role: "tool",
                tool_call_id: tool.id,
                content: JSON.stringify(result),
              });
            }
            continue;
          }
          if (
            completion.choices[0].finish_reason !== "stop" ||
            !message.content
          )
            throw new ModelFailure("invalid_output");
          if (explicitHistoryRead && !events.some(event => ["get_session_history", "read_session_actions"].includes(event.name))) {
            // Honor an explicit read request without fabricating execution. Let
            // the model choose the actual tool in the existing bounded loop.
            if (round < 2) {
              messages.push({ role: "assistant", content: message.content });
              messages.push({ role: "user", content: "本轮明确要求读取本次尝试，但尚未执行历史工具。请调用 get_session_history 核对记录后再给最终 JSON；不要将上下文摘要说成工具调用。" });
              continue;
            }
            throw new ModelFailure("invalid_output");
          }
          const final = validateFinal(JSON.parse(message.content), input, events);
          const visible = final.observations.visible;
          if (input.image && !visible.length) throw new ModelFailure("invalid_output");
          const visualReason = visible.length ? `照片观察（模型识别，待核实）：${visible.slice(0, 2).map(text => text.slice(0, 90).replace(/[。；;]+$/g, "")).join("；")}。结合用户自述：目标${input.context.fish}，拟饵${input.context.lures.join("、") || "未知"}，搜索范围${input.context.layers}。${final.reason}`.slice(0, 600) : final.reason;
          return finish({
            ...final,
            reason: visualReason,
            observations: {
              visible: final.observations.visible,
              reported: [
                input.message,
                `用户自述：目标${input.context.fish}；水位${input.context.waterlevel}；水流${input.context.flow}。`,
              ],
              unknown: [
                ...new Set([
                  ...requiredUnknowns,
                  ...final.observations.unknown,
                ]),
              ].slice(0, 8),
            },
            session_id: input.session_id,
            turn_id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            answer_source: "agent",
            model_name: config.modelLabel,
            provider: config.provider,
            model_calls: calls,
            duration_ms: 0,
            tool_events: events,
            warnings: ["合法性来自用户自述，系统未独立核验适用公告。"],
            reported_actions: input.session_snapshot.actions,
            context: input.context,
            agent_version: AGENT_VERSION,
          });
        }
        return fallback("本轮对话未完成有效输出，已使用规则建议。");
      } catch (error) {
        return fallback(
          error instanceof ModelFailure && error.reason === "timeout"
            ? "模型响应超时，已使用规则建议。"
            : error instanceof ModelFailure &&
                ["rate_limited", "budget_exhausted", "busy"].includes(
                  error.reason,
                )
              ? "当前调用额度或并发受限，已使用规则建议。"
              : "模型结果不可用或未通过校验，已使用规则建议，未展示未经校验的输出。",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
