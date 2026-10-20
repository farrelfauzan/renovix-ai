import { ProviderHttpError } from "../../providers/errors/provider-http-error";
import { toProviderErrorText } from "../../../common/utils/to-provider-error-text";

/**
 * The status, log message and client message of a failed provider call. RNX-208 (D197, D208): a provider error is
 * reported by the fixed texts of toProviderErrorText; no response body is read, so the provider's text (which can
 * echo part of the key, RX-174) never reaches a log or a client. A 400 keeps "Provider rejected request (HTTP 400)".
 */
export function extractProviderError(error: any): {
  status?: number;
  message: string;
  clientMessage: string;
} {
  const status = error instanceof ProviderHttpError ? error.status : error?.response?.status;
  if (!status) {
    return { status, message: error?.message || "Unknown stream error", clientMessage: "Stream error" };
  }
  const { clientMessage, logText } = toProviderErrorText(status);
  return {
    status,
    message: logText,
    clientMessage: status === 400 ? "Provider rejected request (HTTP 400)" : clientMessage,
  };
}
