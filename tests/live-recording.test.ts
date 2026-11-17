import test from "node:test";
import assert from "node:assert/strict";
import { observeModelFetch, settleModelRecords, type ModelCallRecord } from "../scripts/live-recording.ts";

test("真实联调旁路保留公开输出与来源，移除密钥和隐藏思考，原响应不被改写", async () => {
  const secret = "private-audit-fixture";
  const raw = { id: "completion-1", model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: `public ${secret}`, reasoning_content: "private-thought-marker" } }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, private_extra: secret } };
  const records: ModelCallRecord[] = [];
  const response = await observeModelFetch(records, [secret], async () => Response.json(raw, { headers: { "x-request-id": "req-1", "set-cookie": "private-cookie" } }))("https://api.deepseek.com/chat/completions");
  assert.deepEqual(await response.json(), raw);
  await settleModelRecords(records);
  assert.equal(records[0].http_status, 200);
  assert.equal(records[0].provider_model, "deepseek-flash");
  assert.equal(records[0].content, "public [REDACTED]");
  assert.equal(records[0].usage?.total_tokens, 25);
  assert.doesNotMatch(JSON.stringify(records), /private-audit-fixture|private-thought-marker|private-cookie|reasoning_content/);
});

test("真实联调保存上游失败状态但不回显鉴权信息，网络错误仍交给原回退", async () => {
  const records: ModelCallRecord[] = [];
  const fetcher = observeModelFetch(records, ["private-error-fixture"], async () => Response.json({ error: { code: "bad_request", message: "failed private-error-fixture", secret_other: "omit-me" } }, { status: 400 }));
  const response = await fetcher("https://api.deepseek.com/chat/completions");
  assert.equal(response.status, 400);
  await response.text();
  await settleModelRecords(records);
  assert.equal(records[0].provider_error?.code, "bad_request");
  assert.equal(records[0].provider_error?.message, "failed [REDACTED]");
  assert.doesNotMatch(JSON.stringify(records), /private-error-fixture|omit-me/);
  const failure = new TypeError("do not retain private transport detail");
  await assert.rejects(observeModelFetch(records, [], async () => { throw failure; })("https://api.deepseek.com/chat/completions"), (error) => error === failure);
  assert.equal(records[1].capture_status, "interrupted");
  assert.doesNotMatch(JSON.stringify(records), /private transport detail/);
});
