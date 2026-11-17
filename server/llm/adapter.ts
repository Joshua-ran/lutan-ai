import { z } from "zod";
import type { LlmConfig } from "./config.ts";
import { buildGrounding, MODEL_SYSTEM_PROMPT } from "./grounding.ts";
import type { Diagnosis } from "../../shared/schema.ts";
import { getRisk } from "../../shared/engine.ts";
import { requestChatCompletion } from "./chat.ts";
import { ModelFailure } from "./errors.ts";
export { ModelFailure } from "./errors.ts";

const responseSchema = z.object({
  model: z
    .string()
    .regex(/^[A-Za-z0-9._/-]{1,120}$/)
    .optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop"),
        message: z.object({
          content: z.string().min(1).max(6000),
          refusal: z.string().nullable().optional(),
          tool_calls: z.array(z.unknown()).max(0).nullable().optional(),
        }),
      }),
    )
    .length(1),
});

export async function requestModel(
  base: Diagnosis,
  config: LlmConfig,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (
    base.risk !== "normal" ||
    getRisk(base.input) !== "normal" ||
    base.input.legality !== "用户已核实允许"
  )
    throw new ModelFailure("safety_gate");
  const grounding = buildGrounding(base);
  const raw = await requestChatCompletion(
    config,
    {
      messages: [
        { role: "system", content: MODEL_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(grounding.payload) },
      ],
      response_format:
        config.responseFormat === "json_schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: "lutan_grounded_diagnosis",
                strict: true,
                schema: grounding.jsonSchema,
              },
            }
          : { type: "json_object" },
    },
    fetcher,
    signal,
  );
  const envelope = responseSchema.safeParse(raw);
  if (!envelope.success || envelope.data.choices[0].message.refusal)
    throw new ModelFailure("invalid_output");
  let value: unknown;
  try {
    value = JSON.parse(envelope.data.choices[0].message.content);
  } catch {
    throw new ModelFailure("invalid_output");
  }
  const selected = grounding.schema.safeParse(value);
  if (!selected.success) throw new ModelFailure("invalid_output");
  return {
    priority_action: grounding.actions[selected.data.action_id],
    rationale: [
      "rule_basis",
      ...selected.data.rationale_ids.filter((id) => id !== "rule_basis"),
    ]
      .map((id) => grounding.rationales[id])
      .join(" "),
    unknowns: [...base.unknowns],
    follow_up_question: selected.data.follow_up_question_id
      ? grounding.questions[selected.data.follow_up_question_id]
      : null,
    provider_model:
      envelope.data.model && !envelope.data.model.includes(config.apiKey)
        ? envelope.data.model
        : null,
  };
}
