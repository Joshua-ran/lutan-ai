import test from "node:test";
import assert from "node:assert/strict";
import { createAgentService } from "../server/agent/service.ts";
import { buildAgentDecisionContract } from "../server/agent/grounding.ts";
import { readLlmConfig } from "../server/llm/config.ts";
import { agentTurnInputSchema, newAgentSession } from "../shared/agent.ts";
import { sanitizeAgentInput } from "../shared/agent-fallback.ts";
import { defaultInput } from "../shared/schema.ts";
import { evaluationCases, normalizeCaseInput } from "../scripts/evaluation.ts";

const config = readLlmConfig({ LLM_PROVIDER: "deepseek", LLM_ENABLED: "true", DEEPSEEK_API_KEY: "grounding-test-fixture" });
function input(id: string) {
  const context = normalizeCaseInput(evaluationCases.find((item) => item.case_id === id)!.input);
  const session = newAgentSession(context);
  return agentTurnInputSchema.parse({ session_id: session.id, context, message: "请根据已填条件给一个下一步。", session_snapshot: { messages: [], actions: [], observations: session.observations, city: "" } });
}
const completion = (value: unknown) => Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });

test("跟饵、触碰、充分尝试及缺少拟饵/水层时，模型必须使用可核查候选", async () => {
  for (const id of ["D03", "D04", "D05", "D06", "D13"]) {
    const request = input(id);
    const contract = buildAgentDecisionContract(request)!;
    assert.ok(contract);
    const approved = { observations: { visible: [], reported: [], unknown: contract.unknown_candidates }, action: contract.action_candidates[1], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question };
    const service = (output: unknown) => createAgentService({ config, fetcher: async (_url, init) => {
      const briefing = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
      assert.equal(briefing.decision_contract.rule_id, contract.rule_id);
      return completion(output);
    } });
    const accepted = await service(approved).turn(request);
    assert.equal(accepted.answer_source, "agent");
    assert.equal(accepted.action, approved.action);
    for (const unsafe of [
      { ...approved, action: "先向下游换位，再用软饵探另一处结构。", action_kind: "change_position" },
      { ...approved, action: "在跟饵出现的近岸5–10米内停顿。" },
      { ...approved, reason: "鱼在观察饵且犹豫，停顿可以触发其开口。" },
      { ...approved, check: "若有加重感就判断为触底，然后再次提竿刺鱼。" },
      { ...approved, check: "如果三四个方向都无触碰，说明这一层已确认无效。" },
      { ...approved, observations: { ...approved.observations, unknown: ["该鱼种会在乱石区伏击。"] } },
    ]) {
      const rejected = await service(unsafe).turn(request);
      assert.equal(rejected.answer_source, "server_rule", `${id} must reject ungrounded output`);
      assert.equal(rejected.model_calls, 1);
      assert.equal(rejected.tool_events.length, 0);
      assert.doesNotMatch(rejected.action, /5–10|向下游/);
    }
  }
});

test("受限方向已有失败反馈时，不能强制模型重复该方向", () => {
  const request = input("D03");
  request.session_snapshot.actions.push({ id: "a1", turn_id: "t1", kind: "retrieve_rhythm", text: "只比较回收节奏。", created_at: new Date().toISOString(), applied_at: null, feedback: "没有改善", feedback_at: new Date().toISOString(), source: "agent" });
  const next = buildAgentDecisionContract(request)!;
  assert.equal(next.rule_id, "followup_next_action");
  assert.notEqual(next.action_kind, "retrieve_rhythm");
});

test("明确读取历史请求不能被未执行工具的直接回复替代", async () => {
  const request = input("D03");
  request.message = "请读取本次尝试后再给下一步。";
  request.session_snapshot.actions.push({ id: "a0", turn_id: "t0", kind: "change_layer", text: "比较另一个搜索水层。", created_at: new Date().toISOString(), applied_at: null, feedback: "没有改善", feedback_at: new Date().toISOString(), source: "agent" });
  const contract = buildAgentDecisionContract(request)!;
  const final = { observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question };
  let calls = 0;
  const result = await createAgentService({ config, fetcher: async () => {
    calls++;
    if (calls === 2) return Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "history", type: "function", function: { name: "get_session_history", arguments: "{}" } }] } }] });
    return completion(final);
  } }).turn(request);
  assert.equal(result.answer_source, "agent");
  assert.equal(calls, 3);
  assert.equal(result.tool_events[0].name, "get_session_history");
  assert.equal(result.tool_events[0].status, "ok");
});

test("照片观察进入现场说明，但单张照片的流速断言被拒绝", async () => {
  const request = input("D03");
  request.image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const contract = buildAgentDecisionContract(request)!;
  const reply = (visible: string[]) => ({ observations: { visible, reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question });
  const accepted = await createAgentService({ config, fetcher: async () => completion(reply(["近岸可见砾石，水面有细碎波纹。"])) }).turn(request);
  assert.equal(accepted.answer_source, "agent");
  assert.match(accepted.reason, /照片观察/);
  assert.match(accepted.reason, /结合用户自述/);
  const rejected = await createAgentService({ config, fetcher: async () => completion(reply(["照片显示流速很快，水下有鱼群。"])) }).turn(request);
  assert.equal(rejected.answer_source, "server_rule");
});

test("新跟饵观察优先于上一轮信息追问，不机械卡在缺失水层", () => {
  const request = input("D03");
  request.context.layers = "不清楚";
  request.message = "我换了位置，发现鱼有跟饵但不咬。";
  request.session_snapshot.actions.push({ id: "old-question", turn_id: "old", kind: "confirm_observation", text: "先确认搜索水层。", created_at: new Date().toISOString(), applied_at: null, feedback: "暂未尝试", feedback_at: null, source: "agent" });
  const next = buildAgentDecisionContract(sanitizeAgentInput(request))!;
  assert.equal(next.rule_id, "retrieve_rhythm");
});

test("口语跟饵与触碰进入正确规则，否定和假设不虚构已观察事实", () => {
  for (const [message, signal] of [
    ["米诺试了半小时，有跟饵但没有咬口。", "跟饵"],
    ["没有咬口，但看到有跟饵。", "跟饵"],
    ["刚刚出现疑似触碰。", "疑似触碰"],
    ["没看到跟饵，还是没口。", "无口"],
    ["如果看到跟饵怎么办？", "不清楚"],
    ["没有触碰。", "不清楚"],
  ] as const) {
    const request = input("D03");
    request.context = { ...defaultInput, legality: "用户已核实允许", lures: ["米诺"], layers: "主要一个水层" };
    request.message = message;
    const safe = sanitizeAgentInput(request);
    assert.equal(safe.context.signal, signal, message);
    if (signal === "跟饵") assert.equal(buildAgentDecisionContract(safe)?.rule_id, "retrieve_rhythm");
    if (signal === "疑似触碰") assert.equal(buildAgentDecisionContract(safe)?.rule_id, "check_rig");
  }
});

test("普通分支全部保留依据约束，初次水层比较也不能加入鱼类心理解释", async () => {
  for (const item of evaluationCases) {
    const request = input(item.case_id);
    const rule = (await import("../shared/engine.ts")).diagnose(request.context);
    if (rule.risk === "normal") assert.ok(buildAgentDecisionContract(request), item.case_id);
  }
  const request = input("D03");
  request.context.signal = "无口";
  request.context.layers = "主要一个水层";
  request.context.adjust = "不清楚";
  const contract = buildAgentDecisionContract(request)!;
  assert.equal(contract.rule_id, "compare_layer");
  const result = await createAgentService({ config, fetcher: async () => completion({ observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: "鱼不接受当前节奏，需要延长停顿。", check: contract.check, follow_up_question: contract.follow_up_question }) }).turn(request);
  assert.equal(result.answer_source, "server_rule");
  assert.doesNotMatch(result.reason, /不接受当前节奏/);
});
