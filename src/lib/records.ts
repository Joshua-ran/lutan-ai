import {
  feedbackSchema,
  recordSchema,
  recordsEnvelopeSchema,
  type Diagnosis,
  type Feedback,
  type TripRecord,
} from "../../shared/schema.ts";

export const RECORDS_KEY = "lutan_records_v1";
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RecordsState = { records: TripRecord[]; error: string | null };

function browserStorage(): StorageLike {
  return window.localStorage;
}

export function readRecords(storage?: StorageLike): RecordsState {
  try {
    const raw = (storage ?? browserStorage()).getItem(RECORDS_KEY);
    if (!raw) return { records: [], error: null };
    const result = recordsEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!result.success)
      return {
        records: [],
        error:
          "本机记录格式异常，原始数据已保留。请先导出原始备份，或手动清空后重新记录。",
      };
    return { records: result.data.records, error: null };
  } catch {
    return {
      records: [],
      error:
        "无法读取本机记录，可能是浏览器禁用了存储或记录已损坏。可导出本次结果备份。",
    };
  }
}

export function createRecord(
  diagnosis: Diagnosis,
  feedback: Feedback,
): TripRecord {
  return recordSchema.parse({
    id: diagnosis.id,
    schema_version: 2,
    created_at: diagnosis.created_at,
    diagnosis,
    feedback: feedbackSchema.parse(feedback),
  });
}

function writeRecords(
  records: TripRecord[],
  storage?: StorageLike,
): RecordsState {
  try {
    const data = recordsEnvelopeSchema.parse({ schema_version: 2, records });
    (storage ?? browserStorage()).setItem(RECORDS_KEY, JSON.stringify(data));
    return { records: data.records, error: null };
  } catch {
    return {
      records: readRecords(storage).records,
      error: "保存失败，可能是本机空间不足或浏览器禁止存储。请导出 JSON 备份。",
    };
  }
}

export function saveRecord(
  record: TripRecord,
  storage?: StorageLike,
): RecordsState {
  const current = readRecords(storage);
  if (current.error) return current;
  const records = [
    record,
    ...current.records.filter((item) => item.id !== record.id),
  ];
  if (records.length > 500)
    return {
      ...current,
      error: "已达到 500 条本机记录上限，请先导出备份并删除部分记录。",
    };
  return writeRecords(records, storage);
}

export function deleteRecord(id: string, storage?: StorageLike): RecordsState {
  const current = readRecords(storage);
  if (current.error) return current;
  return writeRecords(
    current.records.filter((item) => item.id !== id),
    storage,
  );
}

export function clearRecords(storage?: StorageLike): RecordsState {
  try {
    (storage ?? browserStorage()).removeItem(RECORDS_KEY);
    return { records: [], error: null };
  } catch {
    return {
      records: readRecords(storage).records,
      error: "浏览器未允许删除本机记录，请检查浏览器存储设置。",
    };
  }
}

export function exportRecords(records: TripRecord[]) {
  return {
    product: "路探 AI",
    schema_version: 2,
    exported_at: new Date().toISOString(),
    provenance:
      "用户输入与规则/AI 辅助诊断，模式及边界见各记录；个人反馈不等于渔获提升，不附加精确位置数据。",
    records: records.map((item) => recordSchema.parse(item)),
  };
}

export function getRawBackup(): string | null {
  try {
    return browserStorage().getItem(RECORDS_KEY) ?? "{}";
  } catch {
    return null;
  }
}

export function downloadJson(value: unknown, filename: string) {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type: "application/json;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function recordSummary(records: TripRecord[]) {
  return {
    total: records.length,
    tried: records.filter(
      (r) =>
        r.feedback.outcome === "有改善" || r.feedback.outcome === "没有改善",
    ).length,
    improved: records.filter((r) => r.feedback.outcome === "有改善").length,
  };
}
