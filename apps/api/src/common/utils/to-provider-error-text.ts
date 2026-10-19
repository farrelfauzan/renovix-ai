/**
 * The fixed texts for a provider failure (D197, D208): a client message and a log text that name only the HTTP
 * status. They never carry provider text, a response body, a URL or a key, whatever the provider sent.
 */
export function toProviderErrorText(status: number): { clientMessage: string; logText: string } {
  const code = Number.isInteger(status) ? status : 502;
  return {
    clientMessage: `Provider request failed (${code})`,
    logText: `Provider error (status ${code})`,
  };
}
