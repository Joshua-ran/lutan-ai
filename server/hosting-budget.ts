import { createModelBudget, type ModelBudget } from "./llm/budget.ts";
import type { LlmConfig } from "./llm/config.ts";
import { ModelFailure } from "./llm/errors.ts";

export type UsageDatabase = {
  prepare(sql: string): {
    bind(...values: (string | number)[]): { first<T>(): Promise<T | null> };
  };
};

// Public hosting shares a persistent counter across server instances. It stores
// only UTC dates and counts; no messages, images, IP addresses or user records.
export function createHostingBudget(config: LlmConfig, database: UsageDatabase | undefined, now = Date.now): ModelBudget {
  const local = createModelBudget(config, now);
  return {
    async acquire() {
      const release = local.acquire();
      try {
        if (!database) throw new ModelFailure("budget_exhausted");
        const time = now();
        const day = new Date(time).toISOString().slice(0, 10);
        const minute = Math.floor(time / 60_000);
        // A single conditional UPSERT serializes admission across all isolates.
        // A physical request is charged before it is sent, including failures.
        const admitted = await database.prepare(`
          INSERT INTO ai_usage (day, minute, minute_count, total) VALUES (?, ?, 1, 1)
          ON CONFLICT(day) DO UPDATE SET
            minute = excluded.minute,
            minute_count = CASE WHEN ai_usage.minute = excluded.minute THEN ai_usage.minute_count + 1 ELSE 1 END,
            total = ai_usage.total + 1
          WHERE ai_usage.total < ? AND (ai_usage.minute <> ? OR ai_usage.minute_count < ?)
          RETURNING total
        `).bind(day, minute, config.dailyRequestLimit, minute, config.requestsPerMinute).first<{ total: number }>();
        if (!admitted) throw new ModelFailure("budget_exhausted");
        return release;
      } catch {
        release();
        throw new ModelFailure("budget_exhausted");
      }
    },
  };
}
