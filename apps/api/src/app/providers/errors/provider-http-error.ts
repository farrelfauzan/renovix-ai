import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";
import { toProviderErrorText } from "../../../common/utils/to-provider-error-text";

/**
 * The provider answered a chat or embedding request with an error status (RX-169, RX-161), as a typed upstream error
 * (D199, RNX-190). It carries the status, the kind and the Retry-After header (`retryAfterMs`), never the response
 * body: a 401 body can echo the key's last characters and its hash (RX-174), and an error object reaches logs whole
 * (Nest's ExceptionsHandler prints its own properties). The message is the kind's fixed client text (D197, D208).
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly kind: ProviderErrorKind;
  readonly retryAfterMs?: number;

  constructor(params: { status: number; kind: ProviderErrorKind; retryAfterMs?: number }) {
    super(toProviderErrorText(params.status, params.kind).clientMessage);
    this.name = "ProviderHttpError";
    this.status = params.status;
    this.kind = params.kind;
    this.retryAfterMs = params.retryAfterMs;
  }
}
