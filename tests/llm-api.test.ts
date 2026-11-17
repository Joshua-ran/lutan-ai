import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { createDiagnosisService } from "../server/diagnosis-service.ts";
import { readLlmConfig } from "../server/llm/config.ts";

test("完整 HTTP 工作流：能力标记、AI 响应、输入脱敏与安全门控", async () => {
  let calls = 0,
    providerBody = "";
  const service = createDiagnosisService({
    config: readLlmConfig({
      LLM_ENABLED: "true",
      LLM_API_KEY: "test-private-key",
      LLM_MODEL: "private-model",
      LLM_MODEL_LABEL: "demo-model",
      LLM_BASE_URL: "http://127.0.0.1:9999/v1",
    }),
    fetcher: (async (_url, init) => {
      calls++;
      providerBody = String(init?.body);
      const payload = JSON.parse(JSON.parse(providerBody).messages[1].content);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                action_id: "contextual_action",
                rationale_ids: ["rule_basis", "target_context"],
                unknown_ids: Object.keys(payload.required_unknowns),
                follow_up_question_id: payload.required_question_id,
                evidence_status: "insufficient",
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  const server = createApp({ diagnosisService: service }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server not listening");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.capabilities.llm, true);
    assert.equal(health.llm.connection_verified, false);
    assert.equal(health.llm.model, "demo-model");
    assert.doesNotMatch(
      JSON.stringify(health),
      /private-key|private-model|9999/,
    );
    const post = async (input: unknown) =>
      (
        await fetch(`${origin}/api/diagnoses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).json();
    const result = await post({
      legality: "用户已核实允许",
      alias: "保密钓点",
    });
    assert.equal(result.source, "server_llm");
    assert.equal(result.generation.model, "demo-model");
    assert.doesNotMatch(providerBody, /保密|alias/);
    assert.equal(calls, 1);
    const danger = await post({ legality: "用户已核实允许", flow: "很急" });
    const restricted = await post({ legality: "禁止垂钓" });
    const unknown = await post({});
    assert.equal(danger.rule_id, "safety_first");
    assert.equal(restricted.rule_id, "no_fishing");
    assert.equal(unknown.rule_id, "verify_legality");
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
