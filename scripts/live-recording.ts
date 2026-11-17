/** 仅供显式真实联调使用；记录供应商公开回复，不记录鉴权头、图片或思考原文。 */
export type ModelCallRecord = {
  started_at: string;
  duration_ms: number;
  http_status: number | null;
  response_id?: string;
  provider_model?: string;
  request_id?: string;
  finish_reason?: string | null;
  content?: string | null;
  tool_calls?: unknown[];
  usage?: Record<string, number>;
  provider_error?: Record<string, string>;
  transport_error?: string;
  capture_status: "pending" | "captured" | "invalid_json" | "too_large" | "interrupted";
};

export function redactRunText(value: string, secrets: string[]) {
  let text = value;
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\bsk-[A-Za-z0-9_-]{24,}\b/g, "[REDACTED]");
}

export function observeModelFetch(
  records: ModelCallRecord[],
  secrets: string[],
  delegate: typeof fetch = fetch,
): typeof fetch {
  return async (url, init) => {
    const started = performance.now();
    const record: ModelCallRecord = { started_at: new Date().toISOString(), duration_ms: 0, http_status: null, capture_status: "pending" };
    records.push(record);
    const finishTime = () => { record.duration_ms = Math.round(performance.now() - started); };
    let response: Response;
    try { response = await delegate(url, init); }
    catch (error) {
      record.transport_error = error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : "NetworkError";
      record.capture_status = "interrupted";
      finishTime();
      throw error;
    }
    record.http_status = response.status;
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-ds-request-id");
    if (requestId && /^[A-Za-z0-9._:-]{1,200}$/.test(requestId)) record.request_id = redactRunText(requestId, secrets);
    // clone 在旁路读取；原 Response 原样返回，生产传输的超时/取消/校验仍生效。
    const clone = response.clone();
    const capture = async () => {
      const reader = clone.body?.getReader();
      if (!reader) { record.capture_status = "invalid_json"; finishTime(); return; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) { record.capture_status = "too_large"; void reader.cancel().catch(() => {}); finishTime(); return; }
          chunks.push(part.value);
        }
        const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const safe = (value: unknown, max: number) => typeof value === "string" ? redactRunText(value, secrets).slice(0, max) : undefined;
        record.response_id = safe(raw.id, 200);
        record.provider_model = safe(raw.model, 120);
        const choice = raw.choices?.[0];
        record.finish_reason = safe(choice?.finish_reason, 80) ?? null;
        record.content = safe(choice?.message?.content, 10000) ?? null;
        if (Array.isArray(choice?.message?.tool_calls)) record.tool_calls = choice.message.tool_calls.slice(0, 8).map((call: any) => ({
          id: safe(call.id, 200), type: safe(call.type, 80),
          function: { name: safe(call.function?.name, 80), arguments: safe(call.function?.arguments, 4000) },
        }));
        if (raw.usage && typeof raw.usage === "object") record.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter((key) => Number.isSafeInteger(raw.usage[key]) && raw.usage[key] >= 0).map((key) => [key, raw.usage[key]]));
        if (raw.error && typeof raw.error === "object") record.provider_error = Object.fromEntries(["type", "code", "message"].map((key) => [key, safe(raw.error[key], 1200)]).filter((pair) => pair[1] !== undefined)) as Record<string, string>;
        record.capture_status = "captured";
      } catch { record.capture_status = "interrupted"; }
      finally { reader.releaseLock(); finishTime(); }
    };
    void capture();
    return response;
  };
}

export async function settleModelRecords(records: ModelCallRecord[]) {
  for (let attempt = 0; attempt < 100 && records.some((record) => record.capture_status === "pending"); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  for (const record of records) if (record.capture_status === "pending") record.capture_status = "interrupted";
}
