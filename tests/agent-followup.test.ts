import test from "node:test";
import assert from "node:assert/strict";
import { readReportedFeedback, applyReportedFeedback, newAgentSession, type AgentTurnInput, type AgentResult, type SessionAction } from "../shared/agent.ts";
import { agentFallback, sanitizeAgentInput } from "../shared/agent-fallback.ts";
import { defaultInput } from "../shared/schema.ts";
import { createAgentService } from "../server/agent/service.ts";
import { readLlmConfig } from "../server/llm/config.ts";

const stamp = "2026-11-16T10:00:00.000Z";
function action(kind: SessionAction["kind"] = "confirm_observation"): SessionAction {
  return { id: "previous", turn_id: "previous-turn", kind, text: kind === "confirm_observation" ? "保持当前拟饵，确认下沉和回收路径，记录实际覆盖的水层。" : "保持其他变量，只比较回收节奏。", created_at: stamp, applied_at: null, feedback: "暂未尝试", feedback_at: null, source: "agent" };
}
function input(message: string, actions: SessionAction[] = [action()]): AgentTurnInput {
  const context = { ...defaultInput, legality: "用户已核实允许" as const, lures: ["软饵" as const] };
  const session = newAgentSession(context);
  return { session_id: session.id, context, message, session_snapshot: { messages: [], actions, observations: session.observations, city: "" } };
}
function record(result: AgentResult): SessionAction {
  return { ...action(result.action_kind), id: result.turn_id, turn_id: result.turn_id, text: result.action, created_at: result.created_at };
}
const config = readLlmConfig({ LLM_PROVIDER: "deepseek", LLM_ENABLED: "true", DEEPSEEK_API_KEY: "followup-unit-fixture", LLM_TIMEOUT_MS: "1000" });
function reply(contract: any) {
  assert.ok(contract);
  return Response.json({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question }) } }] });
}

test("口语反馈涵盖还是没有口，未尝试和明确尝试保持区分且不编造执行时间", () => {
  for (const text of ["还是没有口啊", "还是没口", "仍然没有鱼口", "依然没口"]) {
    assert.equal(readReportedFeedback(text).outcome, "failure");
    const original = [action("retrieve_rhythm")];
    assert.deepEqual(applyReportedFeedback(original, text), original);
  }
  const original = [action("retrieve_rhythm")];
  const reported = applyReportedFeedback(original, "按你说的试了，还是没有口啊");
  assert.equal(reported[0].feedback, "没有改善");
  assert.equal(reported[0].applied_at, null);
  assert.deepEqual(applyReportedFeedback(reported, "按你说的试了，还是没有口啊"), reported);
  assert.deepEqual(applyReportedFeedback(original, "我没有换位置，还是没有口"), original);
  assert.deepEqual(applyReportedFeedback(original, "如果试过换位置还是没有口怎么办？"), original);
  assert.equal(applyReportedFeedback([action()], "上一步还没尝试")[0].feedback, "暂未尝试");
  assert.equal(original[0].feedback_at, null);
});

test("信息确认不因持续无口被记为失败，明确另做的动作可单独留存", () => {
  const information = applyReportedFeedback([action()], "刚才那一步试过了，还是没有口");
  assert.equal(information[0].feedback, "已尝试");
  const changed = applyReportedFeedback([action("retrieve_rhythm")], "我换位置了，还是没有口");
  assert.equal(changed.length, 2);
  assert.equal(changed[0].feedback, "暂未尝试");
  assert.equal(changed[1].kind, "change_position");
  assert.equal(changed[1].feedback, "没有改善");
  assert.equal(changed[1].applied_at, null);
});

test("明确补充的拟饵和水层进入下一轮，未知和否定信息不能被当成已确认", () => {
  assert.equal(sanitizeAgentInput(input("已确认主要搜索一个水层")).context.layers, "主要一个水层");
  assert.equal(sanitizeAgentInput(input("已确认搜索了多个水层")).context.layers, "多个水层");
  assert.equal(sanitizeAgentInput(input("不是只搜索底层，我还不清楚水层")).context.layers, "不清楚");
  assert.equal(sanitizeAgentInput(input("能感觉触底，但覆盖的水层还不清楚")).context.layers, "不清楚");
  const noLure = input("当前使用米诺");
  noLure.context.lures = [];
  assert.deepEqual(sanitizeAgentInput(noLure).context.lures, ["米诺"]);
  noLure.message = "没有用过米诺";
  assert.deepEqual(sanitizeAgentInput(noLure).context.lures, []);
  noLure.message = "没有使用米诺";
  assert.deepEqual(sanitizeAgentInput(noLure).context.lures, []);
});

test("原始建议 → 还是没有口啊 → 明确水层，三轮能追问并进入不同的下一步", async () => {
  const briefings: any[] = [];
  const service = createAgentService({ config, fetcher: async (_url, init) => {
    const briefing = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content);
    briefings.push(briefing);
    return reply(briefing.decision_contract);
  } });
  const first = input("软饵试了半小时没口，实际覆盖的水层还不清楚。", []);
  const firstResult = await service.turn(first);
  const second = { ...first, context: firstResult.context, message: "还是没有口啊", session_snapshot: { ...first.session_snapshot, actions: [record(firstResult)] } };
  const secondResult = await service.turn(second);
  assert.equal(secondResult.answer_source, "agent");
  assert.notEqual(secondResult.action, firstResult.action);
  assert.match(secondResult.follow_up_question!, /一个水层.*多个水层.*仍不清楚/);
  assert.equal(secondResult.reported_actions[0].feedback, "暂未尝试");
  assert.equal(briefings[1].reported_feedback.outcome, "failure");
  assert.equal(briefings[1].reported_feedback.attempted, false);
  const third = { ...second, message: "已确认主要搜索一个水层", session_snapshot: { ...second.session_snapshot, actions: [...secondResult.reported_actions, record(secondResult)] } };
  const thirdResult = await service.turn(third);
  assert.equal(thirdResult.answer_source, "agent");
  assert.equal(thirdResult.context.layers, "主要一个水层");
  assert.equal(thirdResult.action_kind, "change_layer");
  assert.notEqual(thirdResult.action, secondResult.action);
});

test("明确尝试后失败可进入新的规则方向，离线回退也不能复读初始信息确认", async () => {
  const failed = input("按你说的试过了，还是没有口啊", [action("retrieve_rhythm")]);
  failed.context.signal = "跟饵";
  const advanced = await createAgentService({ config, fetcher: async (_url, init) => reply(JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content).decision_contract) }).turn(failed);
  assert.equal(advanced.answer_source, "agent");
  assert.notEqual(advanced.action_kind, "retrieve_rhythm");
  assert.equal(advanced.reported_actions[0].feedback, "没有改善");
  const offline = agentFallback(input("还是没有口啊"), "local_rule");
  assert.notEqual(offline.action, action().text);
  assert.match(offline.follow_up_question!, /水层/);
  assert.equal(offline.model_calls, 0);
  const unclear = agentFallback(input("已尝试，但暂时无法判断", [action("change_layer")]), "local_rule");
  assert.match(unclear.reason, /不能.*成功或失败/);
  assert.equal(unclear.follow_up_question, null);
});

test("连续反馈不能绕过危险或许可门控", async () => {
  let calls = 0;
  const service = createAgentService({ config, fetcher: async () => { calls++; throw Error("must not call"); } });
  const danger = await service.turn(input("水流很急，还是没有口啊"));
  assert.equal(danger.answer_source, "server_rule");
  assert.match(danger.action, /停止|撤离/);
  const unknown = input("还是没有口啊");
  unknown.context.legality = "未知";
  assert.equal((await service.turn(unknown)).model_calls, 0);
  assert.equal(calls, 0);
});
