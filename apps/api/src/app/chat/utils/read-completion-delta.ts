import type { ChatUsage } from "../../providers/provider.interface";
import { readStreamError } from "../../providers/utils/read-stream-error";
import { readUsage } from "../../providers/utils/read-usage";

/**
 * What one provider stream payload adds to a streamed answer (RNX-196): its text delta, its finish reason and its usage
 * report (each undefined when absent; an unparseable payload adds nothing). A mid-stream error chunk is thrown as the
 * provider's ProviderStreamError (status only, never its text: D197).
 */
export function readCompletionDelta(payload: string): { content?: string; finishReason?: string; usage?: ChatUsage } {
  let parsed: any;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const streamError = readStreamError(parsed);
  if (streamError) throw streamError;
  const choice = parsed.choices?.[0];
  return { content: choice?.delta?.content || undefined, finishReason: choice?.finish_reason ?? undefined, usage: readUsage(parsed.usage) };
}
