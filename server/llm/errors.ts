import type { FallbackReason } from "../../shared/schema.ts";
export class ModelFailure extends Error {
  constructor(public readonly reason: FallbackReason) {
    super(reason);
  }
}
