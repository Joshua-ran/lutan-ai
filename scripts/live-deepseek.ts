import { loadEnvFile } from "node:process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../server/app.ts";
import { createAgentService } from "../server/agent/service.ts";
import { createDiagnosisService } from "../server/diagnosis-service.ts";
import { createModelBudget } from "../server/llm/budget.ts";
import { readLlmConfig } from "../server/llm/config.ts";
import { buildPretrip, diagnose } from "../shared/engine.ts";
import { agentFallback } from "../shared/agent-fallback.ts";
import { agentResultSchema, agentTurnInputSchema, newAgentSession } from "../shared/agent.ts";
import { diagnosisInputSchema, diagnosisSchema } from "../shared/schema.ts";
import { evaluationCases, normalizeCaseInput } from "./evaluation.ts";
import { observeModelFetch, redactRunText, settleModelRecords, type ModelCallRecord } from "./live-recording.ts";

if (!process.argv.includes("--allow-paid")) {
  console.error("真实联调会使用自己的 DeepSeek 额度。明确执行：npm run test:live -- --allow-paid；默认自动测试不会运行此脚本。");
  process.exit(1);
}
try { loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(".env 无法读取；未发送请求。"); }
const config = readLlmConfig();
if (!config.configured || config.provider !== "deepseek" || new URL(config.baseUrl).origin !== "https://api.deepseek.com") throw new Error("真实联调要求已配置的 DeepSeek 官方 HTTPS 地址；未发送请求。");
const argument = (name: string, fallback: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] || "" : fallback; };
const ids = argument("--cases", "D03,D04,D06,D01,P05").split(",");
if (ids.some((id) => !["D03", "D04", "D06", "D01", "P05"].includes(id))) throw new Error("只允许已批准的五个场景；未发送请求。");
const surface = argument("--surface", "both");
if (!["agent", "diagnosis", "both"].includes(surface)) throw new Error("--surface 需为 agent、diagnosis 或 both。");
const surfaces = surface === "both" ? ["agent", "diagnosis"] : [surface];
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[-:.]/g, "");
const output = path.resolve(argument("--output", `docs/verification/live-deepseek/run-${stamp}.json`));
if (!output.startsWith(path.resolve("docs/verification/live-deepseek") + path.sep) || !output.endsWith(".json")) throw new Error("联调记录只写入 docs/verification/live-deepseek 下的新 JSON 文件。");
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, "{}\n", { flag: "wx" });
const secrets = [config.apiKey, process.env.LLM_API_KEY || "", process.env.DEEPSEEK_API_KEY || ""];
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceFiles = ["LutanAI_Evaluation_24cases_V1.0.json", "package.json"];
const walk = (directory: string) => { for (const item of readdirSync(directory, { withFileTypes: true })) { const name = `${directory}/${item.name}`; if (item.isDirectory()) walk(name); else if (item.isFile() && /\.(ts|tsx)$/.test(name)) sourceFiles.push(name); } };
walk("server"); walk("shared");
const run: Record<string, any> = {
  kind: "real_deepseek_synthetic_scenario_integration", status: "running", started_at: startedAt,
  provider: "deepseek", provider_origin: "https://api.deepseek.com", requested_model: config.model, model_label: config.modelLabel,
  settings: { timeout_ms: config.timeoutMs, max_output_tokens: config.maxOutputTokens, response_format: config.responseFormat, vision_enabled: config.supportsVision, tools_enabled: config.supportsTools },
  limitations: ["输入来自原始合成场景，不是真实钓友或实钓反馈。", "普通场景的允许作钓状态是假设的用户自述，只用于隔离模型路径，不是官方许可核验。", "本次为文字联调；没有真实照片理解或在线天气准确性验证。", "仅保存供应商公开回复与工具调用；不保存密钥、鉴权头或思考原文。", "P05 原为出钓前场景；附原出钓前规则，并在两个现场 API 验证合法性门控。"],
  source_sha256: Object.fromEntries(sourceFiles.map((file) => [file, hash(file)])), results: [],
};
const save = () => writeFileSync(output, redactRunText(JSON.stringify(run, null, 2), secrets) + "\n");
save();
const messages: Record<string, string> = {
  D03: "目标是翘嘴，用米诺，在普通水流条件下看到跟饵但没有攻击；跟饵的鱼种没有确认。下一步做什么？",
  D04: "目标是鳜鱼，在乱石结构用软饵，感觉有疑似触碰，不确定是触底还是鱼口。下一步做什么？",
  D06: "目标是鳜鱼，用软饵和铁板，已经试过多个水层、调整手法和换位置，40分钟以上仍然无口。下一步做什么？",
  D01: "水位明显急变，水流很急，现在无口。下一步做什么？",
  P05: "这段水域是否允许垂钓还不知道。下一步做什么？",
};
const calls: ModelCallRecord[] = [];
const fetcher = observeModelFetch(calls, secrets);
const budget = createModelBudget(config);
const app = createApp({ diagnosisService: createDiagnosisService({ config, fetcher, budget }), agentService: createAgentService({ config, fetcher, budget }) });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("联调接口未启动。");
const origin = `http://127.0.0.1:${address.port}`;
try {
  for (const id of ids) for (const current of surfaces) {
    const item = evaluationCases.find((entry) => entry.case_id === id)!;
    const context = diagnosisInputSchema.parse(normalizeCaseInput(item.input));
    const session = newAgentSession(context);
    const input = agentTurnInputSchema.parse({ session_id: session.id, message: messages[id], context, session_snapshot: { messages: [], actions: [], observations: session.observations, city: "" } });
    const startCall = calls.length;
    const started = performance.now();
    console.log(`开始 ${id} / ${current}：${["D01", "P05"].includes(id) ? "验证零模型调用" : "实际调用 DeepSeek"}`);
    const response = await fetch(`${origin}${current === "agent" ? "/api/agent/turn" : "/api/diagnoses"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(current === "agent" ? input : context), signal: AbortSignal.timeout(65000) });
    const raw = await response.json();
    const parsed = current === "agent" ? agentResultSchema.safeParse(raw) : diagnosisSchema.safeParse(raw);
    const result = parsed.success ? parsed.data : raw;
    await settleModelRecords(calls.slice(startCall));
    const modelCalls = calls.slice(startCall);
    const gated = ["D01", "P05"].includes(id);
    const source = current === "agent" ? result.answer_source : result.source;
    const forbidden = item.forbidden_claims.filter((claim) => JSON.stringify(result).includes(claim));
    const expectedSource = gated ? current === "agent" ? "server_rule" : "server_rules" : current === "agent" ? "agent" : "server_llm";
    const gatesMatch = !gated || (modelCalls.length === 0 && (current === "agent" ? result.model_calls === 0 : result.generation?.fallback_reason === "safety_gate"));
    const accepted = response.status === 200 && parsed.success && source === expectedSource && gatesMatch && forbidden.length === 0 && (gated || modelCalls.length > 0 && modelCalls.every((call) => call.http_status === 200));
    run.results.push({ case_id: id, theme: item.theme, surface: current, started_at: new Date(Date.now() - (performance.now() - started)).toISOString(), duration_ms: Math.round(performance.now() - started), api_http_status: response.status, raw_scene_input: item.input, input: current === "agent" ? input : context,
      rule_output: current === "agent" ? agentFallback(input, "server_rule") : diagnose(context, "server_rules"),
      ...(id === "P05" ? { pretrip_rule_output: buildPretrip({ water: context.water, fish: context.fish, alias: "", waterlevel: context.waterlevel, rain: context.rain, legality: context.legality }, "server_rules") } : {}),
      api_output: result, provider_calls: modelCalls,
      checks: { output_schema: parsed.success, expected_source: expectedSource, actual_source: source, model_http_calls: modelCalls.length, safety_gate_zero_calls: gated ? gatesMatch : null, forbidden_literal_claims_found: forbidden },
      status: accepted ? "PASS" : "FAIL", quality_review: "pending_manual_review_of_saved_public_output",
    });
    save();
    console.log(`${id} / ${current}：${accepted ? "PASS" : "FAIL"}，来源 ${source}，供应商请求 ${modelCalls.length}，耗时 ${run.results.at(-1).duration_ms}ms`);
  }
  run.status = run.results.every((result: any) => result.status === "PASS") ? "passed_technical_checks" : "has_failures";
} catch {
  run.status = "interrupted";
  run.error = "联调未完成；已保存完成部分。原始异常不输出，以免泄露环境信息。";
} finally {
  run.completed_at = new Date().toISOString();
  run.summary = { checks: run.results.length, passed: run.results.filter((result: any) => result.status === "PASS").length, failed: run.results.filter((result: any) => result.status === "FAIL").length, actual_provider_http_calls: calls.length };
  save();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
console.log(`记录：${path.relative(process.cwd(), output)}；${JSON.stringify(run.summary)}`);
if (run.status !== "passed_technical_checks") process.exitCode = 1;
