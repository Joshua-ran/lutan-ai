// Hosting transport only. The Node/Express entry remains server/index.ts;
// both transports use the same services, rules, schemas and model adapter.
import { buildPretrip } from "../shared/engine.ts";
import { RULE_VERSION, diagnosisInputSchema, tripSchema } from "../shared/schema.ts";
import { agentTurnInputSchema } from "../shared/agent.ts";
import { createAgentService } from "./agent/service.ts";
import { validateImage } from "./agent/image.ts";
import { createDiagnosisService } from "./diagnosis-service.ts";
import { readLlmConfig } from "./llm/config.ts";
import { createHostingBudget, type UsageDatabase } from "./hosting-budget.ts";

export type HostingEnvironment = Record<string, unknown> & { DB?: UsageDatabase };
export type HostedAsset = { content: string; type: string; binary?: boolean };
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { ...securityHeaders, "Cache-Control": "no-store" } });
}
async function readInput(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw 415;
  if (Number(request.headers.get("content-length")) > limit) throw 413;
  if (!request.body) throw 400;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw 413; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw 400; }
  } finally { reader.releaseLock(); }
}

export function createHostedHandler(env: HostingEnvironment, assets: Record<string, HostedAsset> = {}) {
  const strings = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const config = readLlmConfig(strings);
  const budget = createHostingBudget(config, env.DB);
  const diagnosis = createDiagnosisService({ config, budget });
  const agent = createAgentService({ config, budget });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/health" && request.method === "GET") return json({
          status: "ok", product: "路探 AI", version: "1.2.0", rule_version: RULE_VERSION,
          capabilities: { diagnosis: config.configured ? "rules_with_optional_llm" : "rules", llm: config.configured, weather: agent.capabilities().enabled && agent.capabilities().tools, waterlevel: false, species: false, cloud_storage: false },
          llm: diagnosis.capabilities(), agent: agent.capabilities(),
        });
        if (!["/api/pretrip", "/api/diagnoses", "/api/agent/turn"].includes(url.pathname)) return json({ error: "接口不存在" }, 404);
        if (request.method !== "POST") return json({ error: "请使用 POST 请求" }, 405);
        const raw = await readInput(request, url.pathname === "/api/agent/turn" ? 3 * 1024 * 1024 : 16 * 1024);
        if (url.pathname === "/api/pretrip") {
          const parsed = tripSchema.safeParse(raw);
          return parsed.success ? json(buildPretrip(parsed.data, "server_rules")) : json({ error: "输入不符合出钓计划格式" }, 422);
        }
        if (url.pathname === "/api/diagnoses") {
          const parsed = diagnosisInputSchema.safeParse(raw);
          return parsed.success ? json(await diagnosis.generate(parsed.data, request.signal)) : json({ error: "输入不符合现场诊断格式" }, 422);
        }
        const parsed = agentTurnInputSchema.safeParse(raw);
        if (!parsed.success) return json({ error: "现场助手输入格式无效，请缩短文字或重新选择图片。" }, 422);
        if (parsed.data.image && !validateImage(parsed.data.image)) return json({ error: "图片必须为真实 JPG、PNG 或 WebP，压缩后不超过 2 MB。" }, 422);
        return json(await agent.turn(parsed.data, request.signal));
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "页面不存在" }, 404);
      const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
      if (!asset) return json({ error: "页面不存在" }, 404);
      const body = request.method === "HEAD" ? null : asset.binary ? Uint8Array.from(atob(asset.content), (character) => character.charCodeAt(0)) : asset.content;
      return new Response(body, { headers: { ...securityHeaders, "Content-Type": asset.type, "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
    } catch (error) {
      const status = typeof error === "number" ? error : 500;
      return json({ error: status === 413 ? "请求内容过长" : status === 400 ? "请求必须包含有效 JSON" : status === 415 ? "请使用 JSON 格式提交" : "服务暂时不可用，请稍后重试" }, status);
    }
  };
}
