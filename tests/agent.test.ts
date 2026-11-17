import test from "node:test";
import assert from "node:assert/strict";
import { createAgentService } from "../server/agent/service.ts";
import { readLlmConfig } from "../server/llm/config.ts";
import { executeTool } from "../server/agent/tools.ts";
import { validateImage } from "../server/agent/image.ts";
import {
  agentTurnInputSchema,
  newAgentSession,
  type AgentTurnInput,
} from "../shared/agent.ts";
import { defaultInput } from "../shared/schema.ts";

const config = readLlmConfig({
  LLM_PROVIDER: "deepseek",
  LLM_ENABLED: "true",
  DEEPSEEK_API_KEY: "unit-test-only",
  LLM_TIMEOUT_MS: "200",
});
function input(message = "软饵试了半小时没口，感觉在退水。"): AgentTurnInput {
  const context = {
    ...defaultInput,
    legality: "用户已核实允许" as const,
    lures: ["软饵" as const],
    layers: "主要一个水层" as const,
  };
  const session = newAgentSession(context);
  return {
    session_id: session.id,
    message,
    context,
    session_snapshot: {
      messages: [],
      actions: [],
      observations: session.observations,
      city: "",
    },
  };
}
function final(
  kind = "change_layer",
  action = "保持当前位置和软饵，只比较另一个搜索水层。",
  visible: string[] = [],
) {
  return {
    observations: { visible, reported: [], unknown: [] },
    action,
    action_kind: kind,
    reason: "你报告主要搜索一个水层，可先单独比较覆盖范围。",
    check: "记录是否出现跟饵或触碰；没有变化也如实反馈。",
    follow_up_question: null,
  };
}
function completion(value: unknown) {
  return Response.json({
    model: "deepseek-flash",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(value) },
      },
    ],
  });
}
const mock = (
  fn: (body: Record<string, any>) => Response | Promise<Response>,
) =>
  (async (_url: unknown, init?: RequestInit) =>
    fn(JSON.parse(String(init?.body)))) as typeof fetch;
function tools(name: string, args = {}) {
  return Response.json({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
}

test("图文内容按官方多模态格式发送，并区分照片观察与用户退水自述", async () => {
  const request = input();
  request.image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const result = await createAgentService({
    config,
    fetcher: mock((body) => {
      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.messages.at(-1).content[1].type, "image_url");
      assert.equal(
        body.messages.at(-1).content[1].image_url.url,
        request.image,
      );
      const contract = JSON.parse(body.messages.at(-1).content[0].text).decision_contract;
      return completion({ observations: { visible: ["岸边可见石块和岸线。"], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question });
    }),
  }).turn(request);
  assert.equal(result.answer_source, "agent");
  assert.equal(result.model_calls, 1);
  assert.equal(result.tool_events.length, 0);
  assert.match(result.observations.reported.join(""), /退水/);
  assert.doesNotMatch(result.observations.visible.join(""), /退水/);
  assert.doesNotMatch(JSON.stringify(result), /base64|unit-test-only/);
});

test("真实 tool_calls → 会话工具 → role=tool 回填，避免重复已失败动作", async () => {
  const request = input("刚才建议的动作试了20分钟，还是没口。");
  request.session_snapshot.actions = [
    {
      id: "a1",
      turn_id: "t1",
      kind: "change_layer",
      text: "比较另一个水层。",
      created_at: new Date().toISOString(),
      applied_at: null,
      feedback: "暂未尝试",
      feedback_at: null,
      source: "agent",
    },
  ];
  let calls = 0;
  const result = await createAgentService({
    config,
    fetcher: mock((body) => {
      if (calls++ === 0) return tools("read_session_actions");
      const output = JSON.parse(body.messages.at(-1).content);
      assert.equal(body.messages.at(-1).role, "tool");
      assert.equal(output.source, "client_session_snapshot_user_reported");
      assert.equal(output.actions[0].feedback, "没有改善");
      const briefing = JSON.parse(body.messages.findLast((item: any) => item.role === "user").content);
      const contract = briefing.decision_contract;
      return completion({ observations: { visible: [], reported: [], unknown: [] }, action: contract.action_candidates[0], action_kind: contract.action_kind, reason: contract.reason, check: contract.check, follow_up_question: contract.follow_up_question });
    }),
  }).turn(request);
  assert.equal(result.answer_source, "agent");
  assert.equal(result.model_calls, 2);
  assert.equal(result.tool_events[0].name, "read_session_actions");
  assert.equal(result.tool_events[0].status, "ok");
  assert.notEqual(result.action_kind, "change_layer");
  assert.equal(result.reported_actions[0].feedback, "没有改善");
});

test("天气仅查询用户给出的城市，保留真实返回的时刻和来源，失败不填假数据", async () => {
  const request = input("我在南充，顺便看一下天气。");
  let modelCalls = 0,
    weatherCalls = 0;
  const weatherFetcher = (async (url: URL | RequestInfo) => {
    weatherCalls++;
    if (String(url).includes("geocoding"))
      return Response.json({
        results: [
          {
            name: "南充",
            latitude: 30.8,
            longitude: 106.1,
            country: "中国",
            admin1: "四川",
          },
        ],
      });
    return Response.json({
      timezone: "Asia/Shanghai",
      current: {
        time: "2026-11-16T15:00",
        temperature_2m: 18,
        precipitation: 0,
        weather_code: 3,
        wind_speed_10m: 5,
      },
    });
  }) as typeof fetch;
  const result = await createAgentService({
    config,
    weatherFetcher,
    fetcher: mock((body) => {
      if (modelCalls++ === 0)
        return tools("get_weather_by_city", { city: "南充" });
      const output = JSON.parse(body.messages.at(-1).content);
      assert.equal(output.status, "ok");
      assert.equal(output.data_time, "2026-11-16T15:00");
      return completion(final());
    }),
  }).turn(request);
  assert.equal(weatherCalls, 2);
  assert.equal(
    result.tool_events[0].result.source,
    "Open-Meteo Weather Forecast / GeoNames",
  );
  assert.equal(result.tool_events[0].result.temperature_c, 18);
  assert.doesNotMatch(JSON.stringify(result.tool_events), /latitude|longitude/);
  const blocked = await executeTool(
    "get_weather_by_city",
    { city: "成都" },
    request,
    weatherFetcher,
  );
  assert.equal(blocked.status, "needs_city");
  assert.equal(weatherCalls, 2);
  const failed = await executeTool(
    "get_weather_by_city",
    { city: "南充" },
    request,
    (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  );
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.temperature_c, undefined);
});

test("危险、禁钓、未知合法性和无密钥均零模型调用，文字危险同样门控", async () => {
  let calls = 0;
  const fetcher = mock(() => {
    calls++;
    return completion(final());
  });
  const service = createAgentService({ config, fetcher });
  for (const request of [
    { ...input(), context: { ...input().context, flow: "很急" as const } },
    {
      ...input(),
      context: { ...input().context, legality: "禁止垂钓" as const },
    },
    { ...input(), context: { ...input().context, legality: "未知" as const } },
    input("岸边发现急涨水和急流，仍然没口"),
  ]) {
    assert.equal((await service.turn(request)).answer_source, "server_rule");
  }
  assert.equal(
    (
      await createAgentService({ config: readLlmConfig({}), fetcher }).turn(
        input(),
      )
    ).answer_source,
    "server_rule",
  );
  assert.equal(calls, 0);
});

test("工具循环有上限，未授权工具不会执行，已失败的原样建议会回退", async () => {
  let calls = 0;
  const loop = await createAgentService({
    config,
    fetcher: mock(() => {
      calls++;
      return tools("read_session_actions");
    }),
  }).turn(input());
  assert.equal(calls, 3);
  assert.equal(loop.tool_events.length, 2);
  assert.equal(loop.answer_source, "server_rule");
  const unknown = await createAgentService({
    config,
    fetcher: mock(() => tools("read_secret_files")),
  }).turn(input());
  assert.equal(unknown.tool_events.length, 0);
  assert.equal(unknown.answer_source, "server_rule");
  const request = input();
  request.session_snapshot.actions = [
    {
      id: "failed",
      turn_id: "t0",
      kind: "change_layer",
      text: "比较另一个水层。",
      created_at: new Date().toISOString(),
      applied_at: null,
      feedback: "没有改善",
      feedback_at: null,
      source: "agent",
    },
  ];
  const repeated = await createAgentService({
    config,
    fetcher: mock(() => completion(final())),
  }).turn(request);
  assert.equal(repeated.answer_source, "server_rule");
  assert.notEqual(repeated.action_kind, "change_layer");
});

test("图片内容/MIME/大小校验与不支持图片的模型降级", async () => {
  const png =
    "data:image/png;base64," +
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString(
      "base64",
    );
  assert.equal(validateImage(png), true);
  assert.equal(validateImage(png.replace("image/png", "image/jpeg")), false);
  assert.equal(
    validateImage(
      "data:image/png;base64," +
        Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
    ),
    false,
  );
  const request = input();
  request.image = png;
  const result = await createAgentService({
    config: readLlmConfig({
      LLM_PROVIDER: "deepseek",
      LLM_ENABLED: "true",
      DEEPSEEK_API_KEY: "test",
      LLM_MODEL: "deepseek-v4-pro",
    }),
    fetcher: mock(() => {
      throw new Error("不能发送图片");
    }),
  }).turn(request);
  assert.equal(result.model_calls, 0);
  assert.equal(result.answer_source, "server_rule");
  assert.equal(
    agentTurnInputSchema.safeParse({
      ...input(),
      session_snapshot: { ...input().session_snapshot, city: "30.123,106.456" },
    }).success,
    false,
  );
});

test("无图片不新造照片观察，模型超时可用规则降级，私密位置不会发给模型", async () => {
  const inventedWeather = await createAgentService({ config, fetcher: mock(() => completion({ ...final(), reason: "当前气温18℃，因此调整搜索。" })) }).turn(input());
  assert.equal(inventedWeather.answer_source, "server_rule");
  const invalid = await createAgentService({
    config,
    fetcher: mock(() =>
      completion(final("change_layer", undefined, ["看见乱石岸线"])),
    ),
  }).turn(input());
  assert.equal(invalid.answer_source, "server_rule");
  const timed = await createAgentService({
    config: { ...config, timeoutMs: 100 },
    fetcher: mock(() => new Promise<Response>(() => {})),
  }).turn(input());
  assert.equal(timed.answer_source, "server_rule");
  assert.match(timed.warnings.join(""), /超时/);
  const request = input("坐标30.123456,106.456789，软饵没口");
  request.context.alias = "私人钓点";
  await createAgentService({
    config,
    fetcher: mock((body) => {
      assert.doesNotMatch(
        JSON.stringify(body),
        /30\.123456|106\.456789|私人钓点/,
      );
      return completion(final());
    }),
  }).turn(request);
});
