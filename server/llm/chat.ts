import type { LlmConfig } from "./config.ts";
import { ModelFailure } from "./errors.ts";

async function limitedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ModelFailure("invalid_output");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new ModelFailure("invalid_output");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ModelFailure("invalid_output");
  }
}
export async function requestChatCompletion(
  config: LlmConfig,
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throw new ModelFailure("cancelled");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let cancel = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelFailure("timeout"));
    }, config.timeoutMs);
    cancel = () => {
      controller.abort();
      reject(new ModelFailure("cancelled"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
  const operation = async () => {
    const response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      // Workers supports manual/follow only. Returning 3xx without following
      // preserves the credential boundary on both Node and the hosted runtime.
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        model: config.model,
        stream: false,
        ...(config.provider === "deepseek"
          ? { thinking: { type: "disabled" } }
          : { n: 1 }),
        [config.tokenParameter]: config.maxOutputTokens,
      }),
    });
    if (config.logEvents) {
      // Operational metadata only; never log credentials, prompts or content.
      console.info(JSON.stringify({ event: "model_provider_response", provider: config.provider, http_status: response.status }));
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ModelFailure("provider_error");
    }
    return limitedJson(response);
  };
  try {
    return await Promise.race([operation(), interrupted]);
  } catch (error) {
    if (error instanceof ModelFailure) throw error;
    throw new ModelFailure(
      controller.signal.aborted
        ? signal?.aborted
          ? "cancelled"
          : "timeout"
        : "provider_error",
    );
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener("abort", cancel);
  }
}
