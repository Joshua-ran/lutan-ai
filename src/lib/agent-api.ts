import {
  agentResultSchema,
  redactPrivateText,
  type AgentTurnInput,
} from "../../shared/agent.ts";
import { agentFallback } from "../../shared/agent-fallback.ts";
import { z } from "zod";

export type AgentAvailability =
  | { state: "checking" | "disabled" | "unavailable"; model?: undefined }
  | { state: "ready"; model: string };
const availabilitySchema = z.object({
  agent: z.object({
    enabled: z.boolean(),
    model: z.string().regex(/^(?!sk-)[A-Za-z0-9._-]{1,64}$/i).nullable(),
  }),
});

/** 只检查本机服务的公开配置状态，不探测或调用付费模型。 */
export async function requestAgentAvailability(signal: AbortSignal): Promise<AgentAvailability> {
  try {
    const response = await fetch("/api/health", {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
      cache: "no-store",
    });
    if (!response.ok) return { state: "unavailable" };
    const parsed = availabilitySchema.safeParse(await response.json());
    if (!parsed.success) return { state: "unavailable" };
    return parsed.data.agent.enabled && parsed.data.agent.model
      ? { state: "ready", model: parsed.data.agent.model }
      : { state: "disabled" };
  } catch { return { state: "unavailable" }; }
}

export async function requestAgentTurn(
  input: AgentTurnInput,
  signal: AbortSignal,
) {
  try {
    const response = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        message: redactPrivateText(input.message),
        context: { ...input.context, alias: "" },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
    });
    if (response.status === 422 || response.status === 413)
      throw new AgentInputError(
        response.status === 413
          ? "图片或会话过大，请重新选择图片。"
          : "输入或图片格式无效，请修改后重试。",
      );
    if (!response.ok) throw new Error("unavailable");
    return agentResultSchema.parse(await response.json());
  } catch (error) {
    if (signal.aborted || error instanceof AgentInputError) throw error;
    return agentFallback(input, "local_rule", [
      "服务暂不可用，已使用本机规则；没有声称已调用模型或工具。",
    ]);
  }
}
class AgentInputError extends Error {}

export async function compressAgentImage(file: File): Promise<string> {
  if (typeof createImageBitmap !== "function")
    throw new Error(
      "当前浏览器不支持图片处理，请更新浏览器或换一个浏览器再试。",
    );
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("只支持 JPG、PNG 和 WebP 图片。");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("原图过大，请选择不超过 20 MB 的照片。");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("无法读取图片，请重新选择有效照片。");
  });
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器无法处理图片。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.82);
    if (data.length * 0.75 > 2 * 1024 * 1024)
      throw new Error("压缩后仍超过 2 MB，请选择更小的照片。");
    return data;
  } finally {
    bitmap.close();
  }
}
