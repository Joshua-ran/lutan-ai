import type { LlmConfig } from "./config.ts";
import { ModelFailure } from "./errors.ts";

export function createModelBudget(config: LlmConfig, now = Date.now) {
  let minute = now(),
    day = now(),
    minuteCount = 0,
    dayCount = 0,
    active = 0;
  return {
    acquire() {
      const time = now();
      if (time - minute >= 60000) {
        minute = time;
        minuteCount = 0;
      }
      if (time - day >= 86400000) {
        day = time;
        dayCount = 0;
      }
      if (dayCount >= config.dailyRequestLimit)
        throw new ModelFailure("budget_exhausted");
      if (minuteCount >= config.requestsPerMinute)
        throw new ModelFailure("rate_limited");
      if (active >= config.maxConcurrency) throw new ModelFailure("busy");
      minuteCount++;
      dayCount++;
      active++;
      let released = false;
      return () => {
        if (!released) {
          active--;
          released = true;
        }
      };
    },
  };
}
export type ModelBudget = {
  acquire(): (() => void) | Promise<() => void>;
};
