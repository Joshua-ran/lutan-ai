import { buildPretrip, diagnose } from "../../shared/engine.ts";
import {
  diagnosisSchema,
  pretripSchema,
  type DiagnosisInput,
  type Trip,
  rulesGeneration,
} from "../../shared/schema.ts";

async function post(path: string, input: Trip, signal: AbortSignal) {
  // 昵称只留在浏览器；接口不接收用户的私密水域备注。
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, alias: "" }),
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(path === "/api/diagnoses" ? 65000 : 4500),
    ]),
  });
  if (!response.ok) throw new Error("服务暂时不可用");
  return response.json() as Promise<unknown>;
}

export async function requestPretrip(input: Trip, signal: AbortSignal) {
  try {
    const result = pretripSchema.parse(
      await post("/api/pretrip", input, signal),
    );
    return { ...result, input };
  } catch (error) {
    if (signal.aborted) throw error;
    return buildPretrip(input);
  }
}

export async function requestDiagnosis(
  input: DiagnosisInput,
  signal: AbortSignal,
) {
  try {
    const result = diagnosisSchema.parse(
      await post("/api/diagnoses", input, signal),
    );
    return { ...result, input };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ...diagnose(input),
      generation: rulesGeneration("api_unavailable"),
    };
  }
}
