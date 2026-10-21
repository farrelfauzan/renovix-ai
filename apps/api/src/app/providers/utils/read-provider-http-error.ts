import { ProviderHttpError } from "../errors/provider-http-error";
import { parseRetryAfterMs } from "./parse-retry-after-ms";
import { toProviderErrorKind } from "./to-provider-error-kind";

/**
 * The typed error for a provider's non-2xx answer (D199, RNX-190). The body is read only to tell whether the answer
 * is about the model; it is not kept, logged or returned (D197: a 401 body can echo the key, RX-174).
 */
export async function readProviderHttpError(response: Response): Promise<ProviderHttpError> {
  const bodyText = await response.text();
  return new ProviderHttpError({
    status: response.status,
    kind: toProviderErrorKind({ status: response.status, bodyText }),
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  });
}
