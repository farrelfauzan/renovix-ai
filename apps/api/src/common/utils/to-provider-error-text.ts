import type { ProviderErrorKind } from "../types/provider-error-kind";

/** RNX-190 (D199): the client text of each typed upstream error that has a status. */
const KIND_CLIENT_TEXTS: Readonly<Record<Exclude<ProviderErrorKind, "timeout">, string>> = {
  unauthorized: "Provider rejected the credentials",
  model_not_found: "Model not found at the provider",
  unavailable: "Provider unavailable",
};

/**
 * The fixed texts for a provider failure (D197, D208): a client message and a log text that name only the HTTP
 * status and, for a typed upstream error (D199, RNX-190), its kind. They never carry provider text, a response body,
 * a URL or a key, whatever the provider sent.
 */
export function toProviderErrorText(
  status: number | undefined,
  kind?: ProviderErrorKind,
): { clientMessage: string; logText: string } {
  if (kind === "timeout") return { clientMessage: "Provider timed out", logText: "Provider error (timeout)" };
  const code = Number.isInteger(status) ? status : 502;
  if (!kind) return { clientMessage: `Provider request failed (${code})`, logText: `Provider error (status ${code})` };
  return { clientMessage: `${KIND_CLIENT_TEXTS[kind]} (${code})`, logText: `Provider error (status ${code}, ${kind})` };
}
