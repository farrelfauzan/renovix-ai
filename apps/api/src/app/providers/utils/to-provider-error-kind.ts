import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";

const UNAUTHORIZED_STATUSES: readonly number[] = [401, 403];
/** Statuses that mean "model not found" when the answer is about the model (D199). */
const MODEL_STATUSES: readonly number[] = [400, 404, 422];
const MENTIONS_MODEL = /model/i;

/**
 * The typed upstream error of a provider's non-2xx answer (D199, RNX-190). `bodyText` is only tested for a mention of
 * the model; the caller must not keep it.
 */
export function toProviderErrorKind({ status, bodyText }: { status: number; bodyText: string }): ProviderErrorKind {
  if (UNAUTHORIZED_STATUSES.includes(status)) return "unauthorized";
  if (MODEL_STATUSES.includes(status) && MENTIONS_MODEL.test(bodyText)) return "model_not_found";
  return "unavailable";
}
