import type { ApiClient } from "@/lib/api/api-client";
import { readRefusal } from "@/lib/sign-in/read-refusal";
import type { EmailReveal } from "./email-reveal";
import type { ProfitReport } from "./profit-report";
import type { ProviderOption } from "./provider-option";
import type { ReconciliationEntry } from "./reconciliation-entry";
import type { ReconciliationEntryInput } from "./reconciliation-entry-input";
import type { ReconciliationReport } from "./reconciliation-report";
import type { ReportRange } from "./report-range";
import type { UsageReport } from "./usage-report";

/** Global prefix `/api` + version `v1` + the admin routes (apps/api admin-usage module: RNX-228). */
const ADMIN_PATH = "/api/v1/admin";

/**
 * The usage, profit and reconciliation routes (RNX-228). Each throws SignedOutError when the session is over and a
 * RefusedError with the API's message (and status, e.g. 403) on any other answer but 2xx. A read covers 92 days at most.
 */
export type UsageApi = {
  /** Token counts and calls; needs `usage:read`. */
  readonly usage: (range: ReportRange) => Promise<UsageReport>;
  /** Cost, revenue, profit and margin; needs `profit:read`. */
  readonly profit: (range: ReportRange) => Promise<ProfitReport>;
  /** The entered provider days with their flags; needs `profit:read`. */
  readonly reconciliation: (range: ReportRange) => Promise<ReconciliationReport>;
  /** Stores a provider's portal balance of a day (audited); needs `reconciliation:write`. */
  readonly recordEntry: (input: ReconciliationEntryInput) => Promise<ReconciliationEntry>;
  /** Reveals a user's email with the reason (audited); needs `usage:read` and `users:read_pii`. */
  readonly revealEmail: (userId: string, reason: string) => Promise<EmailReveal>;
  /** The provider records the reconciliation form offers (`GET /admin/providers`, needs `providers:read`). */
  readonly listProviders: () => Promise<readonly ProviderOption[]>;
};

/** The usage routes on the session client (cookies, shared refresh). */
export function createUsageApi(client: ApiClient): UsageApi {
  const send = async (path: string, body?: unknown): Promise<Response> => {
    const init: RequestInit = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await client.request(`${ADMIN_PATH}${path}`, init);
    if (!res.ok) throw await readRefusal(res);
    return res;
  };
  const query = ({ from, to }: ReportRange): string => `?${new URLSearchParams({ from, to })}`;
  return {
    usage: async (range) => (await send(`/usage/daily${query(range)}`)).json(),
    profit: async (range) => (await send(`/usage/profit${query(range)}`)).json(),
    reconciliation: async (range) => (await send(`/reconciliation${query(range)}`)).json(),
    recordEntry: async (input) => (await send("/reconciliation/entries", input)).json(),
    revealEmail: async (userId, reason) => (await send(`/usage/users/${encodeURIComponent(userId)}/email`, { reason })).json(),
    listProviders: async () => (await (await send("/providers")).json()).map(({ id, name }: ProviderOption) => ({ id, name })),
  };
}
