import { z } from "zod";
import { redactPrivateText, type AgentTurnInput } from "../../shared/agent.ts";

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_session_history",
      description:
        "读取本次作钓会话中客户端明确传入的已尝试动作、时间和反馈。用户提到刚才/上次尝试或没有改善时，先调用再决定下一步；这不是服务器读取 localStorage。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "查询用户明确提供的城市天气。只有用户给出城市或主动请求天气时使用；缺少城市要追问，不猜位置。返回真实来源、数据时刻、失败状态；天气不能当成水位。",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "用户明确提供的城市，例如南充，不是精确钓点或坐标",
          },
          region: {
            type: "string",
            description: "用户明确提供的省份或国家，例如四川；未提供时省略，不要猜测",
          },
        },
        additionalProperties: false,
        required: ["city"],
      },
    },
  },
];
const citySchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[\p{L} .'-]+$/u);
export function canonicalToolName(name: string): "get_session_history" | "get_weather" | null {
  if (name === "get_session_history" || name === "read_session_actions") return "get_session_history";
  if (name === "get_weather" || name === "get_weather_by_city") return "get_weather";
  return null;
}
const normalize = (text: string) => text.replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|县|区|\s/g, "").toLocaleLowerCase();
function requestedPlace(city: string, region = "") {
  const compact = city.trim();
  const compound = /^(四川|广东|广西|云南|贵州|福建|浙江|江苏|安徽|江西|湖南|湖北|河南|河北|山东|山西|陕西|甘肃|青海|辽宁|吉林|黑龙江|内蒙古|宁夏|新疆|西藏|海南|台湾)(?:省|自治区)?(.{2,})$/.exec(compact);
  return compound && !region ? { city: compound[2], region: compound[1] } : { city: compact, region: region.trim() };
}
const cache = new Map<
  string,
  { until: number; data: Record<string, unknown> }
>();
async function json(url: URL, fetcher: typeof fetch, signal?: AbortSignal) {
  const response = await fetcher(url, {
    redirect: "manual",
    headers: { Accept: "application/json", "User-Agent": "LutanAI/1.2 (personal weather demo; https://lutan-ai-field-assistant.jazzy-snow-2518.chatgpt.site)" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`weather_http_${response.status}`); }
  const text = await response.text();
  if (text.length > 100000) throw new Error("weather_response_too_large");
  return JSON.parse(text) as unknown;
}
export async function getWeatherByCity(
  city: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  region = "",
): Promise<Record<string, unknown>> {
  const requested = requestedPlace(citySchema.parse(city), region ? citySchema.parse(region) : "");
  const cacheKey = `${normalize(requested.region)}|${normalize(requested.city)}`;
  const hit = fetcher === fetch ? cache.get(cacheKey) : undefined;
  if (hit && hit.until > Date.now()) return { ...hit.data, cached: true };
  try {
    const geocodeUrl = new URL(
      "https://geocoding-api.open-meteo.com/v1/search",
    );
    geocodeUrl.search = new URLSearchParams({
      name: requested.city,
      count: "5",
      language: "zh",
      format: "json",
    }).toString();
    const geocode = z
      .object({
        results: z
          .array(
            z.object({
              name: z.string(),
              latitude: z.number(),
              longitude: z.number(),
              country: z.string().optional(),
              admin1: z.string().optional(),
              timezone: z.string().optional(),
              feature_code: z.string().optional(),
            }),
          )
          .optional(),
      })
      .parse(await json(geocodeUrl, fetcher, signal));
    const places = (geocode.results ?? []).filter(place => !requested.region ||
      normalize([place.admin1, place.country].filter(Boolean).join(" ")).includes(normalize(requested.region)));
    const exact = places.filter(
      (place) =>
        normalize(place.name) === normalize(requested.city),
    );
    const matches = exact.length ? exact : places;
    // The tool asks for a city. A unique city-level administrative seat can be
    // distinguished from same-named villages by the provider's feature code.
    const citySeats = matches.filter(place => /^(?:PPLC|PPLA|PPLA1|PPLA2)$/.test(place.feature_code ?? ""));
    const candidates = citySeats.length ? citySeats : matches;
    if (!candidates.length)
      return {
        status: "needs_city",
        message: "没有找到该城市，请补充城市和省份。",
        source: "Open-Meteo Geocoding / GeoNames",
      };
    if (candidates.length > 1)
      return {
        status: "ambiguous",
        message: "发现多个同名城市，请补充省份或国家。",
        candidates: candidates.map((place) =>
          [place.name, place.admin1, place.country].filter(Boolean).join(" / "),
        ),
        source: "Open-Meteo Geocoding / GeoNames",
      };
    const place = candidates[0];
    if (/^ADM[1-3]$/.test(place.feature_code ?? ""))
      return {
        status: "needs_city",
        message: "该地区范围较大，请补充城市或县区；不能用行政区中心点代表整个地区的天气。",
        source: "Open-Meteo Geocoding / GeoNames",
      };
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,precipitation,weather_code,wind_speed_10m",
      timezone: "auto",
      forecast_days: "1",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
    }).toString();
    const forecast = z
      .object({
        timezone: z.string(),
        current_units: z.object({
          temperature_2m: z.literal("°C"),
          precipitation: z.literal("mm"),
          wind_speed_10m: z.literal("km/h"),
        }).optional(),
        current: z.object({
          time: z.string(),
          interval: z.number().int().positive().optional(),
          temperature_2m: z.number(),
          precipitation: z.number().nonnegative(),
          weather_code: z.number(),
          wind_speed_10m: z.number().nonnegative(),
        }),
      })
      .parse(await json(forecastUrl, fetcher, signal));
    const data = {
      status: "ok",
      city: place.name,
      region: [place.admin1, place.country].filter(Boolean).join(" / "),
      requested_city: city,
      location_resolution: requested.region ? "按用户提供的城市及地区筛选" : citySeats.length === 1 ? "同名结果中唯一的城市级行政中心" : "地名服务唯一匹配",
      temperature_c: forecast.current.temperature_2m,
      precipitation_mm: forecast.current.precipitation,
      wind_kmh: forecast.current.wind_speed_10m,
      units: { temperature: "°C", precipitation: "mm", wind: "km/h" },
      precipitation_interval_seconds: forecast.current.interval ?? null,
      weather_code: forecast.current.weather_code,
      data_time: forecast.current.time,
      timezone: forecast.timezone,
      retrieved_at: new Date().toISOString(),
      source: "Open-Meteo Weather Forecast / GeoNames",
      source_url: "https://open-meteo.com/en/docs",
      geocoding_source_url: "https://open-meteo.com/en/docs/geocoding-api",
      license: "CC BY 4.0",
      limitations:
        "天气为城市附近网格模型数据，不是钓点实测、水温、小河道水位或鱼口预测。",
      cached: false,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    if (fetcher === fetch)
      cache.set(cacheKey, { until: Date.now() + 15 * 60000, data });
    return data;
  } catch (error) {
    return {
      status: "unavailable",
      message: "天气服务暂不可用，没有填入替代或推测数据。",
      source: "Open-Meteo",
      failure_code: error instanceof Error && /^weather_http_\d{3}$/.test(error.message) ? error.message : "weather_transport_or_format",
      retrieved_at: new Date().toISOString(),
    };
  }
}
export async function executeTool(
  name: string,
  rawArgs: unknown,
  input: AgentTurnInput,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const canonical = canonicalToolName(name);
  if (canonical === "get_session_history") {
    z.object({}).strict().parse(rawArgs);
    return {
      status: "ok",
      source: "client_session_snapshot_user_reported",
      session_id: input.session_id,
      actions: input.session_snapshot.actions.map((action) => ({
        ...action,
        text: redactPrivateText(action.text),
      })),
      attempted_count: input.session_snapshot.actions.filter(action => action.feedback !== "暂未尝试").length,
      failed_action_kinds: [...new Set(input.session_snapshot.actions.filter(action => action.feedback === "没有改善").map(action => action.kind))],
      notice:
        "来自前端明确传入的本次会话快照，不是服务端读取 localStorage，也不是独立核验的渔获记录。",
    };
  }
  if (canonical === "get_weather") {
    const { city, region } = z.object({ city: citySchema, region: citySchema.optional() }).strict().parse(rawArgs);
    const supplied = [
      input.session_snapshot.city,
      input.message,
      ...input.session_snapshot.messages
        .filter((item) => item.role === "user")
        .map((item) => item.text),
    ].join(" ");
    if (!supplied.toLocaleLowerCase().includes(city.toLocaleLowerCase()) ||
      (region && !supplied.toLocaleLowerCase().includes(region.toLocaleLowerCase())))
      return {
        status: "needs_city",
        message: "该城市未由用户提供，请先询问城市，不猜测定位。",
      };
    return getWeatherByCity(city, fetcher, signal, region);
  }
  return { status: "not_allowed", message: "该工具不在允许清单中。" };
}
