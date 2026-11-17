import test from "node:test";
import assert from "node:assert/strict";
import { executeTool, getWeatherByCity, toolDefinitions } from "../server/agent/tools.ts";
import { agentTurnInputSchema, newAgentSession } from "../shared/agent.ts";
import { defaultInput } from "../shared/schema.ts";

function input(message = "我在四川南充，请查询天气。") {
  const session = newAgentSession({ ...defaultInput, legality: "用户已核实允许" });
  return agentTurnInputSchema.parse({ session_id: session.id, context: session.context, message, session_snapshot: { messages: [], actions: [], observations: session.observations, city: "" } });
}
const forecast = { timezone: "Asia/Shanghai", current_units: { temperature_2m: "°C", precipitation: "mm", wind_speed_10m: "km/h" }, current: { time: "2026-11-16T15:00", interval: 900, temperature_2m: 18, precipitation: 0.1, weather_code: 3, wind_speed_10m: 5 } };
const places = [
  { name: "南充", latitude: 30.8, longitude: 106.1, admin1: "四川", country: "中国", feature_code: "PPLA2" },
  { name: "南充", latitude: 29.4, longitude: 121.7, admin1: "浙江", country: "中国", feature_code: "PPL" },
];
test("canonical tools retain legacy aliases, session history contains only submitted attempts", async () => {
  assert.deepEqual(toolDefinitions.map(tool => tool.function.name), ["get_session_history", "get_weather"]);
  const request = input();
  for (const name of ["get_session_history", "read_session_actions"]) {
    const result = await executeTool(name, {}, request);
    assert.equal(result.status, "ok");
    assert.deepEqual(result.actions, []);
    assert.equal(result.attempted_count, 0);
    assert.equal(result.source, "client_session_snapshot_user_reported");
  }
});
test("weather resolves the provided city and province, exposes real units and time, and refuses invented regions", async () => {
  let calls = 0;
  const fetcher = (async (url: URL | RequestInfo) => {
    calls++;
    const parsed = new URL(String(url));
    if (parsed.hostname.startsWith("geocoding")) return Response.json({ results: places });
    assert.equal(parsed.searchParams.get("temperature_unit"), "celsius");
    assert.equal(parsed.searchParams.get("wind_speed_unit"), "kmh");
    return Response.json(forecast);
  }) as typeof fetch;
  const result = await executeTool("get_weather", { city: "南充", region: "四川" }, input(), fetcher);
  assert.equal(result.status, "ok");
  assert.equal(result.region, "四川 / 中国");
  assert.equal(result.precipitation_mm, 0.1);
  assert.equal(result.precipitation_interval_seconds, 900);
  assert.deepEqual(result.units, { temperature: "°C", precipitation: "mm", wind: "km/h" });
  assert.equal(result.data_time, forecast.current.time);
  assert.equal((await executeTool("get_weather", { city: "南充", region: "四川" }, input("请看看南充的天气。"), fetcher)).status, "needs_city");
  assert.equal(calls, 2);
  assert.equal((await executeTool("get_weather_by_city", { city: "四川南充" }, input(), fetcher)).status, "ok");
  assert.doesNotMatch(JSON.stringify(result), /latitude|longitude/);
});
test("same-name villages do not hide a unique city; true city ambiguity is retained", async () => {
  const fetcher = (async (url: URL | RequestInfo) => String(url).includes("geocoding") ? Response.json({ results: places }) : Response.json(forecast)) as typeof fetch;
  assert.equal((await getWeatherByCity("南充", fetcher)).status, "ok");
  const ambiguous = (async () => Response.json({ results: places.map(place => ({ ...place, feature_code: "PPLA2" })) })) as typeof fetch;
  assert.equal((await getWeatherByCity("南充", ambiguous)).status, "ambiguous");
  const province = (async () => Response.json({ results: [{ name: "四川", latitude: 30, longitude: 103, country: "中国", feature_code: "ADM1" }] })) as typeof fetch;
  assert.equal((await getWeatherByCity("四川", province)).status, "needs_city");
});
