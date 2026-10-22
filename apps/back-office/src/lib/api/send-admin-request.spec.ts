/** @jest-environment node */
import { ReauthRequiredError } from "@/lib/admins/reauth-required-error";
import { RefusedError } from "@/lib/sign-in/refused-error";
import type { ApiClient } from "./api-client";
import { sendAdminRequest } from "./send-admin-request";

/** A client that answers every request with `status` and `body`, and records the paths it was asked for. */
function createAnsweringClient(status: number, body: unknown): ApiClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    request: async (path) => {
      paths.push(path);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  };
}

describe("sendAdminRequest", () => {
  it("returns a 2xx answer, on the admin path", async () => {
    const client = createAnsweringClient(200, { ok: true });

    const res = await sendAdminRequest(client, "/packages");

    expect(await res.json()).toEqual({ ok: true });
    expect(client.paths).toEqual(["/api/v1/admin/packages"]);
  });

  it("turns a plain 403 into a readable message that names the API's answer", async () => {
    const client = createAnsweringClient(403, { message: "Forbidden" });

    const actual = sendAdminRequest(client, "/packages/p1/versions", "POST", {});

    await expect(actual).rejects.toThrow(new RefusedError("Your role does not allow this (the API answered: Forbidden).", 403));
  });

  it("turns 403 \"Re-authentication required\" into ReauthRequiredError, so the prompt opens", async () => {
    const client = createAnsweringClient(403, { message: "Re-authentication required" });

    await expect(sendAdminRequest(client, "/codes", "POST", {})).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("passes any other refusal on with the API's message", async () => {
    const client = createAnsweringClient(400, { message: "reason is required" });

    await expect(sendAdminRequest(client, "/settings/graceDays", "PUT", {})).rejects.toThrow("reason is required");
  });
});
