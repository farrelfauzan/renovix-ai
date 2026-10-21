import { FRANKFURTER_SOURCE } from "../config/frankfurter-source";
import { FrankfurterRateResponseDto } from "../dto/frankfurter-rate-response.dto";
import type { FetchedRate } from "../types/fetched-rate";

/**
 * Asks Frankfurter for the ECB's latest USD to IDR rate (RNX-53), with a timeout. Never throws: a timeout, a network
 * error, a non-200 answer or an answer that fails validation (no positive numeric rate) comes back as a reason.
 * The reason names the failure only, never the answer's body.
 */
export async function fetchFrankfurterRate(): Promise<FetchedRate> {
  let response: Response;
  try {
    response = await fetch(FRANKFURTER_SOURCE.url, { signal: AbortSignal.timeout(FRANKFURTER_SOURCE.timeoutMs) });
  } catch (err) {
    return { isFetched: false, reason: `request failed (${err instanceof Error ? err.name : "unknown error"})` };
  }
  if (!response.ok) return { isFetched: false, reason: `HTTP ${response.status}` };
  const parsed = FrankfurterRateResponseDto.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return { isFetched: false, reason: `invalid answer (${fields.join("; ")})` };
  }
  return { isFetched: true, rate: parsed.data.rate, rateDate: parsed.data.date };
}
