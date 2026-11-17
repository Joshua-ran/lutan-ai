import test from "node:test";
import assert from "node:assert/strict";
import { buildPretrip, diagnose } from "../shared/engine.ts";
import { defaultInput, diagnosisInputSchema } from "../shared/schema.ts";
import { evaluationCases, evaluateCase } from "../scripts/evaluation.ts";

for (const item of evaluationCases) {
  test(`${item.case_id}: ${item.theme}`, () => {
    const result = evaluateCase(item);
    if (item.case_id === "P02")
      assert.equal(
        result.status,
        "NEEDS_REVIEW",
        "不得将未接入的历史资料功能标为已通过",
      );
    else assert.equal(result.status, "PASS", result.detail);
  });
}

test("所有安全信号组合都优先撤离，覆盖跟饵、已试多变量、禁钓和未知合法性", () => {
  for (const signal of ["无口", "跟饵", "疑似触碰", "不清楚"] as const) {
    for (const legality of ["未知", "用户已核实允许", "禁止垂钓"] as const) {
      for (const danger of [
        { waterlevel: "急变" as const },
        { flow: "很急" as const },
      ]) {
        const result = diagnose({
          ...defaultInput,
          ...danger,
          signal,
          legality,
          lures: ["软饵", "铁板"],
          adjust: "都试过",
          duration: "40 分钟以上",
          layers: "多个水层",
        });
        assert.equal(result.rule_id, "safety_first");
        assert.match(result.priority_action, /撤离/);
        assert.doesNotMatch(
          result.priority_action,
          /调整回收|更换拟饵|比较水层/,
        );
      }
    }
  }
});
test("未知合法性不建议继续作钓，禁钓状态优先于跟饵建议", () => {
  assert.equal(
    diagnose({ ...defaultInput, signal: "跟饵" }).rule_id,
    "verify_legality",
  );
  assert.equal(
    diagnose({ ...defaultInput, signal: "跟饵", legality: "禁止垂钓" }).rule_id,
    "no_fishing",
  );
});
test("不完整输入允许诊断，观察项默认未知，不虚构拟饵", () => {
  const input = diagnosisInputSchema.parse({});
  assert.deepEqual(input.lures, []);
  assert.equal(input.flow, "未知");
  assert.equal(input.signal, "不清楚");
  assert.equal(diagnose({}).rule_id, "verify_legality");
});
test("拒绝未知字段、精确坐标、重复拟饵、超长别名和非法枚举", () => {
  for (const input of [
    { GPS: "30,106" },
    { latitude: 30 },
    { waterlevel: "绝对安全" },
    { alias: "长".repeat(37) },
    { lures: ["软饵", "软饵"] },
  ]) {
    assert.equal(diagnosisInputSchema.safeParse(input).success, false);
  }
});
test("出钓前危险水情阻断准备建议", () => {
  const result = buildPretrip({ waterlevel: "急变" });
  assert.equal(result.risk, "danger");
  assert.match(result.preparation, /撤离/);
});
test("重复诊断保留版本与独立快照，输入改变影响新结果", () => {
  const first = diagnose({
    ...defaultInput,
    legality: "用户已核实允许",
    signal: "跟饵",
  });
  const second = diagnose({ ...first.input, flow: "很急" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.rule_version, second.rule_version);
  assert.equal(first.input.flow, "未知");
  assert.equal(second.rule_id, "safety_first");
});
