const INVALID = 'LLM_MODEL_ID_MAP must be a JSON object of strings, our model id → the provider\'s id (e.g. {"anthropic/claude-opus-5.5":"claude-opus-5.5"})';

/**
 * LLM_MODEL_ID_MAP (RX-160): which id the provider expects for each of our model ids.
 * Unset or empty → no mapping. Anything but a JSON object of strings is refused.
 */
export function parseModelIdMap(raw: string | undefined): ReadonlyMap<string, string> {
  if (!raw) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${INVALID}; it is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(INVALID);
  const entries = Object.entries(parsed);
  if (entries.some(([, id]) => typeof id !== "string")) throw new Error(INVALID);
  return new Map(entries as [string, string][]);
}
