import type { AutoGoPayRequestOptions } from "./autogopay-request-options";
import type { AutoGoPayResponse } from "./autogopay-response";

/**
 * How the AutoGoPay adapter reaches the API (RNX-229): one authenticated JSON POST. The default sends it with fetch;
 * tests inject a fake that answers recorded fixtures (no network). A failed or timed-out call throws.
 */
export interface AutoGoPayTransport {
  /** POSTs the JSON body to the path; the answer whatever its HTTP status. */
  post(path: string, body: Readonly<Record<string, unknown>>, options: AutoGoPayRequestOptions): Promise<AutoGoPayResponse>;
}
