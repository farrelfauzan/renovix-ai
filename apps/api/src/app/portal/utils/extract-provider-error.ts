import { Readable } from "node:stream";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";

export function extractProviderError(error: any): {
  status?: number;
  message: string;
  clientMessage: string;
} {
  const isProviderHttpError = error instanceof ProviderHttpError;
  const status = isProviderHttpError ? error.status : error?.response?.status;
  const responseData = isProviderHttpError ? error.bodyText : error?.response?.data;

  let details: string | undefined;
  if (typeof responseData === "string") {
    details = responseData;
  } else if (
    responseData &&
    typeof responseData === "object" &&
    !(responseData instanceof Readable) // RX-169: a response stream is circular; never stringify it
  ) {
    details =
      responseData?.error?.message ||
      responseData?.message ||
      JSON.stringify(responseData);
  }

  const normalizedDetails = details
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const message =
    normalizedDetails || error?.message || "Unknown stream error";

  let clientMessage = "Stream error";
  if (status === 400) {
    clientMessage = normalizedDetails
      ? `Provider rejected request (HTTP 400): ${normalizedDetails}`
      : "Provider rejected request (HTTP 400)";
  } else if (status) {
    clientMessage = normalizedDetails
      ? `Provider request failed (${status}): ${normalizedDetails}`
      : `Provider request failed (${status})`;
  }

  return { status, message, clientMessage };
}
