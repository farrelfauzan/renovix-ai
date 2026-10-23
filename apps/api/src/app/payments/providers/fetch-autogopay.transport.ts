import { AUTOGOPAY_API } from "../config/autogopay-api";
import type { AutoGoPayRequestOptions } from "../types/autogopay-request-options";
import type { AutoGoPayResponse } from "../types/autogopay-response";
import type { AutoGoPayTransport } from "../types/autogopay-transport";

/**
 * The default AutoGoPay transport (RNX-229): fetch with `Authorization: Bearer <API key>` and a JSON body, aborted
 * after the call's total timeout (body read included). No connect timeout of its own: see AUTOGOPAY_API.
 */
export class FetchAutoGoPayTransport implements AutoGoPayTransport {
  constructor(private readonly apiKey: string) {}

  /** POSTs the body; the HTTP status and the JSON body (undefined when it is not JSON). */
  async post(path: string, body: Readonly<Record<string, unknown>>, options: AutoGoPayRequestOptions): Promise<AutoGoPayResponse> {
    const response = await fetch(`${AUTOGOPAY_API.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return { status: response.status, body: this.parseJson(await response.text()) };
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
