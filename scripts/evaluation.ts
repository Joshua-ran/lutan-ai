import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPretrip, diagnose } from "../shared/engine.ts";
import { defaultInput, type DiagnosisInput } from "../shared/schema.ts";
import {
  clearRecords,
  createRecord,
  exportRecords,
  readRecords,
  recordSummary,
  saveRecord,
  type StorageLike,
} from "../src/lib/records.ts";

export type EvaluationCase = {
  case_id: string;
  phase: string;
  theme: string;
  input: Record<string, unknown>;
  expected_response_checks: string[];
  forbidden_claims: string[];
  critical_safety_or_facts: boolean;
};
export const evaluationCases: EvaluationCase[] = JSON.parse(
  readFileSync(
    new URL("../LutanAI_Evaluation_24cases_V1.0.json", import.meta.url),
    "utf8",
  ),
).cases;

export function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

export function normalizeCaseInput(
  raw: Record<string, unknown>,
): DiagnosisInput {
  const input: DiagnosisInput = {
    ...defaultInput,
    lures: ["软饵"],
    legality: "用户已核实允许",
  };
  const directKeys = [
    "fish",
    "flow",
    "signal",
    "layers",
    "adjust",
    "duration",
    "lures",
    "clarity",
  ] as const;
  for (const key of directKeys) {
    if (raw[key] !== undefined) Object.assign(input, { [key]: raw[key] });
  }
  if (typeof raw.waterlevel === "string")
    input.waterlevel = raw.waterlevel.includes("退水")
      ? "退水"
      : (raw.waterlevel as DiagnosisInput["waterlevel"]);
  if (raw.rain) input.rain = "有";
  if (raw.water_alias) input.alias = String(raw.water_alias);
  if (raw.structure === "乱石") input.structure = "乱石 / 深浅交界";
  if (raw.observed === "水面炸水") input.observed = "水面炸水";
  if (raw.legality === "未知") input.legality = "未知";
  return input;
}

export function evaluateCase(item: EvaluationCase) {
  const assumptions =
    item.phase === "现场诊断"
      ? [
          "为隔离原有诊断分支，补齐“用户已核实允许”、默认软饵；缺失观察仍为未知。合法性未知与禁钓由独立测试覆盖。",
        ]
      : [];
  let output: unknown;
  let status: "PASS" | "FAIL" | "NEEDS_REVIEW" = "PASS";
  let detail =
    "自动规则与字段断言通过；自然语言质量和专业可执行性仍待人工复核。";
  try {
    const input = normalizeCaseInput(item.input);
    if (item.phase === "出钓前") {
      const { water, fish, alias, waterlevel, rain, legality } = input;
      const result = buildPretrip({
        water,
        fish,
        alias,
        waterlevel,
        rain,
        legality,
      });
      output = result;
      assert.equal(result.evidence_status, "insufficient");
      assert.match(result.notice, /官方/);
      if (item.case_id === "P01")
        assert.match(result.unknowns.join(""), /没有记录不等于没有鱼/);
      if (item.case_id === "P02") {
        assert.match(result.unknowns.join(""), /历史出现与今天的鱼口不同/);
        status = "NEEDS_REVIEW";
        detail =
          "已检查历史出现不等于当前鱼口；P1 历史物种记录库未接入，原始假设“2022 年记录”的来源与年份展示未实现，不能将本条标为完整通过。";
      }
      if (item.case_id === "P03")
        assert.match(result.known.join(""), /用户观察水位：退水/);
      if (item.case_id === "P04")
        assert.match(result.unknowns.join(""), /实际涨退水仍未知/);
      if (item.case_id === "P05") assert.equal(result.risk, "verify_first");
      if (item.case_id === "P06")
        assert.match(result.unknowns.join(""), /具体物种/);
    } else if (item.phase === "现场诊断") {
      const result = diagnose(input);
      output = result;
      const expectedRules: Record<string, string> = {
        D01: "safety_first",
        D02: "safety_first",
        D03: "retrieve_rhythm",
        D04: "check_rig",
        D05: "confirm_layer",
        D06: "end_spot",
        D07: "compare_structure",
        D08: "compare_layer",
        D09: "compare_rhythm",
        D13: "clarify_lure",
        D14: "controlled_comparison",
      };
      if (expectedRules[item.case_id])
        assert.equal(result.rule_id, expectedRules[item.case_id]);
      if (item.case_id === "D10")
        assert.match(result.rationale, /不能确定.*因果关系/);
      if (item.case_id === "D11")
        assert.match(result.unknowns.join(""), /方向不确定.*现场安全/);
      if (item.case_id === "D12")
        assert.match(result.unknowns.join(""), /炸水不能直接识别/);
      if (item.case_id === "D13") assert.ok(result.follow_up_question);
      assert.equal(typeof result.priority_action, "string");
      assert.equal(result.evidence_status, "insufficient");
    } else {
      const storage = memoryStorage();
      const outcome =
        item.input.feedback === "没有改善" ? "没有改善" : "暂未尝试";
      const record = createRecord(diagnose(input), {
        outcome,
        memo: String(item.input.memo ?? ""),
      });
      assert.equal(saveRecord(record, storage).error, null);
      if (item.case_id === "F01") {
        assert.equal(
          readRecords(storage).records[0].feedback.outcome,
          "暂未尝试",
        );
        assert.equal(recordSummary(readRecords(storage).records).tried, 0);
        assert.equal(recordSummary(readRecords(storage).records).improved, 0);
      }
      if (item.case_id === "F02") {
        assert.equal(
          readRecords(storage).records[0].feedback.memo,
          "换了搜索水层仍无口",
        );
        assert.equal(recordSummary(readRecords(storage).records).improved, 0);
      }
      if (item.case_id === "F03") {
        assert.equal(clearRecords(storage).error, null);
        assert.equal(readRecords(storage).records.length, 0);
      }
      output = exportRecords(readRecords(storage).records);
      if (item.case_id === "F04") {
        assert.equal(record.diagnosis.input.alias, "私人小河口");
        assert.doesNotMatch(
          JSON.stringify(output),
          /GPS|latitude|longitude|经纬度|coordinates/,
        );
      }
    }
    const text = JSON.stringify(output);
    for (const forbidden of item.forbidden_claims)
      assert.ok(!text.includes(forbidden), `出现禁止表述：${forbidden}`);
  } catch (error) {
    status = "FAIL";
    detail = error instanceof Error ? error.message : String(error);
  }
  return {
    case_id: item.case_id,
    phase: item.phase,
    theme: item.theme,
    status,
    human_review: "pending",
    assumptions,
    detail,
    expected_response_checks: item.expected_response_checks,
    forbidden_claims: item.forbidden_claims,
    output,
  };
}

export function runEvaluation() {
  const results = evaluationCases.map(evaluateCase);
  return {
    product: "路探 AI",
    created_at: new Date().toISOString(),
    rule_version: "lutan-rules-1.0.0",
    scope:
      "合成案例的自动回归；非用户验证、非大模型评测、非渔获效果评估。原始评测集保持不变。",
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      needs_review: results.filter((r) => r.status === "NEEDS_REVIEW").length,
    },
    results,
  };
}
