import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";
import { toProviderErrorText } from "../../../common/utils/to-provider-error-text";

/** The provider gave no answer in time (D199, RNX-190): the typed timeout error, with its fixed text. */
export class ProviderTimeoutError extends Error {
  readonly kind: ProviderErrorKind = "timeout";

  constructor() {
    super(toProviderErrorText(undefined, "timeout").clientMessage);
    this.name = "ProviderTimeoutError";
  }
}
