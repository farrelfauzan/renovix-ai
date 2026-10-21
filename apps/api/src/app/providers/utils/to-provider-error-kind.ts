import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";

const UNAUTHORIZED_STATUSES: readonly number[] = [401, 403];
/** Statuses that mean "model not found" when the answer is about the model (D199). */
const MODEL_STATUSES: readonly number[] = [400, 404, 422];
/**
 * A missing or unknown model, not the word alone: "This model's maximum context length…" or a body that echoes the
 * request's model is not about the model being missing (Reviewer, PR #127).
 */
const MENTIONS_MISSING_MODEL =
  /\bmodel\b[^\n]{0,60}?\b(not found|does not exist|doesn't exist|unknown|invalid|not supported|unsupported|not available)\b|\b(unknown|invalid|unsupported|no such)\s+model\b/i;

/**
 * The typed upstream error of a provider's non-2xx answer (D199, RNX-190). `bodyText` is only tested for a missing or
 * unknown model; the caller must not keep it.
 */
export function toProviderErrorKind({ status, bodyText }: { status: number; bodyText: string }): ProviderErrorKind {
  if (UNAUTHORIZED_STATUSES.includes(status)) return "unauthorized";
  if (MODEL_STATUSES.includes(status) && MENTIONS_MISSING_MODEL.test(bodyText)) return "model_not_found";
  return "unavailable";
}
