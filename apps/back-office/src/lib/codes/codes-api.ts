import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { CodeInput } from "./code-input";
import type { CodeRedemption } from "./code-redemption";
import type { CodesPage } from "./codes-page";

/**
 * The invitation-code routes of RNX-226 (D33). Every route needs `packages:write`; creating and deactivating
 * also need a recent re-authentication (ReauthRequiredError). Other refusals are a RefusedError with the API's message.
 */
export type CodesApi = {
  readonly listCodes: (page: number, limit: number) => Promise<CodesPage>;
  readonly createCode: (input: CodeInput) => Promise<void>;
  readonly deactivateCode: (id: string) => Promise<void>;
  readonly listRedemptions: (id: string) => Promise<readonly CodeRedemption[]>;
};

/** The invitation-code routes on the session client. */
export function createCodesApi(client: ApiClient): CodesApi {
  const codePath = (id: string): string => `/codes/${encodeURIComponent(id)}`;
  return {
    listCodes: async (page, limit) => (await sendAdminRequest(client, `/codes?page=${page}&limit=${limit}`)).json(),
    createCode: async (input) => {
      await sendAdminRequest(client, "/codes", "POST", input);
    },
    deactivateCode: async (id) => {
      await sendAdminRequest(client, codePath(id), "PATCH", { isActive: false });
    },
    listRedemptions: async (id) => (await sendAdminRequest(client, `${codePath(id)}/redemptions`)).json(),
  };
}
