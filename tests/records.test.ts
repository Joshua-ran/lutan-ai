import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../shared/engine.ts";
import { memoryStorage } from "../scripts/evaluation.ts";
import {
  RECORDS_KEY,
  clearRecords,
  createRecord,
  deleteRecord,
  exportRecords,
  readRecords,
  recordSummary,
  saveRecord,
} from "../src/lib/records.ts";

test("原始 V1 无生成元数据的历史记录可读取，读取不重写，保存后升级 V2", () => {
  const storage = memoryStorage();
  const { generation: _generation, ...legacyDiagnosis } = diagnose({});
  const legacy = {
    schema_version: 1,
    records: [
      {
        id: legacyDiagnosis.id,
        schema_version: 1,
        created_at: legacyDiagnosis.created_at,
        diagnosis: legacyDiagnosis,
        feedback: { outcome: "暂未尝试", memo: "旧备注" },
      },
    ],
  };
  const raw = JSON.stringify(legacy);
  storage.setItem(RECORDS_KEY, raw);
  const loaded = readRecords(storage);
  assert.equal(loaded.error, null);
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].diagnosis.generation.mode, "rules");
  assert.equal(loaded.records[0].diagnosis.generation.model, null);
  assert.equal(
    loaded.records[0].diagnosis.generation.workflow_version,
    "legacy-v1",
  );
  assert.equal(storage.getItem(RECORDS_KEY), raw);
  saveRecord(loaded.records[0], storage);
  const rewritten = JSON.parse(storage.getItem(RECORDS_KEY)!);
  assert.equal(rewritten.schema_version, 2);
  assert.equal(rewritten.records[0].schema_version, 2);
  assert.equal(rewritten.records[0].feedback.memo, "旧备注");
});

test("反馈保存、更新、删除和清空操作可读回且不会重复", () => {
  const storage = memoryStorage();
  const record = createRecord(diagnose({}), { outcome: "暂未尝试", memo: "" });
  saveRecord(record, storage);
  saveRecord(
    { ...record, feedback: { outcome: "没有改善", memo: "仍无口" } },
    storage,
  );
  assert.equal(readRecords(storage).records.length, 1);
  assert.equal(readRecords(storage).records[0].feedback.memo, "仍无口");
  const second = createRecord(diagnose({}), { outcome: "有改善", memo: "" });
  saveRecord(second, storage);
  assert.equal(recordSummary(readRecords(storage).records).tried, 2);
  assert.equal(deleteRecord(record.id, storage).records.length, 1);
  assert.equal(clearRecords(storage).records.length, 0);
  assert.equal(readRecords(storage).records.length, 0);
});
test("不覆盖损坏的历史记录，明确返回错误", () => {
  const storage = memoryStorage();
  storage.setItem(RECORDS_KEY, "{broken");
  assert.ok(readRecords(storage).error);
  const result = saveRecord(
    createRecord(diagnose({}), { outcome: "暂未尝试", memo: "" }),
    storage,
  );
  assert.ok(result.error);
  assert.equal(storage.getItem(RECORDS_KEY), "{broken");
});
test("存储配额与删除被拒绝时不假称成功", () => {
  const denied = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  const record = createRecord(diagnose({}), { outcome: "暂未尝试", memo: "" });
  assert.ok(saveRecord(record, denied).error);
  assert.ok(clearRecords(denied).error);
});
test("删除写入失败时保留原记录，界面不会误显示已删", () => {
  const memory = memoryStorage();
  const record = createRecord(diagnose({}), { outcome: "暂未尝试", memo: "" });
  saveRecord(record, memory);
  const denied = {
    getItem: memory.getItem,
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(deleteRecord(record.id, denied).records.length, 1);
  assert.equal(clearRecords(denied).records.length, 1);
});
test("未尝试与不适用不计入已尝试，有改善不输出中鱼率", () => {
  const results = [
    "暂未尝试",
    "不适用 / 不安全",
    "有改善",
    "没有改善",
  ] as const;
  const records = results.map((outcome) =>
    createRecord(diagnose({}), { outcome, memo: "" }),
  );
  assert.deepEqual(recordSummary(records), { total: 4, tried: 2, improved: 1 });
  assert.doesNotMatch(
    JSON.stringify(exportRecords(records)),
    /success_rate|catch_rate|latitude|longitude|GPS/,
  );
});
