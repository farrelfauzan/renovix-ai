import type { ApiClient } from "@/lib/api/api-client";
import { readRefusal } from "@/lib/sign-in/read-refusal";
import type { AcceptInvitationInput } from "./accept-invitation-input";
import type { InvitationPreview } from "./invitation-preview";

/** Global prefix `/api` + version `v1` + the admin invitations controller (apps/api, RX-95). */
const INVITATIONS_PATH = "/api/v1/admin/invitations";

/**
 * The public invitation routes (RX-95). The token travels in the POST body only, never in the URL. Each
 * throws a RefusedError with the API's message on any answer but 2xx (404 unknown token, 410 used, revoked or
 * expired, 400 a password the API refuses).
 */
export type InvitationApi = {
  /** Who invited, the email and the role. */
  readonly preview: (token: string) => Promise<InvitationPreview>;
  /** Creates the admin and sets the cookies of an enrolment session (TOTP enrolment follows). */
  readonly accept: (input: AcceptInvitationInput) => Promise<void>;
};

/** The invitation routes on the public client: the invitee has no session, so a refusal is never refreshed. */
export function createInvitationApi(publicClient: ApiClient): InvitationApi {
  const post = async (path: string, body: object): Promise<Response> => {
    const res = await publicClient.request(`${INVITATIONS_PATH}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw await readRefusal(res);
    return res;
  };
  return {
    preview: async (token) => (await post("/preview", { token })).json(),
    accept: async (input) => {
      await post("/accept", input);
    },
  };
}
