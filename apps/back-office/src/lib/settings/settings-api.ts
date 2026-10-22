import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { PlatformSetting } from "./platform-setting";

/** The platform-settings routes of RNX-226 (`settings:read`, `settings:write`); a write needs a reason. */
export type SettingsApi = {
  readonly listSettings: () => Promise<readonly PlatformSetting[]>;
  /** Writes one setting; a value its schema refuses is a RefusedError with the API's message and nothing changes. */
  readonly saveSetting: (name: string, value: number, reason: string) => Promise<void>;
};

/** The platform-settings routes on the session client. */
export function createSettingsApi(client: ApiClient): SettingsApi {
  return {
    listSettings: async () => (await sendAdminRequest(client, "/settings")).json(),
    saveSetting: async (name, value, reason) => {
      await sendAdminRequest(client, `/settings/${encodeURIComponent(name)}`, "PUT", { value, reason });
    },
  };
}
