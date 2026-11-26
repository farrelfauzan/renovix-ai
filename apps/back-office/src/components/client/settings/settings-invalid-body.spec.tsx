import { fireEvent, render, screen } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { createSettingsApi } from "@/lib/settings/settings-api";
import { SettingsScreen } from "./settings-screen";

// RNX-364: a refused form shows the API's invalid-body message with the refused field names, through the real settings
// API module and sendAdminRequest; only the HTTP answer is faked.

const profile: AdminProfile = { id: "a", email: "a@example.com", name: "a", role: "r", permissions: ["settings:read", "settings:write"], scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z" };
const sessionApi: SessionApi = { me: async () => profile, changePassword: async () => undefined, signOut: async () => undefined };
/** jsdom has no Response, so the answer is a plain object with the fields the API client reads. */
const answerWith = (status: number, body: unknown): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const invalidBody = { error: { message: "Invalid request body", type: "invalid_request_error", details: { value: ["Expected number"], reason: ["Too short"] } } };

describe("SettingsScreen with an RNX-28 invalid-body refusal", () => {
  it("sends one save request and shows the refused field names, not the status fallback", async () => {
    const request = jest.fn(async (path: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "PUT") return answerWith(400, invalidBody);
      return answerWith(200, [{ name: "seatCeiling", value: 100 }]);
    });
    const client: ApiClient = { request };
    render(<SettingsScreen api={createSettingsApi(client)} sessionApi={sessionApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Seat ceiling per company (D7)" }));
    fireEvent.change(screen.getByLabelText("Seat ceiling per company (D7)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Reason (required, audited)"), { target: { value: "contract" } });
    request.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));

    expect(await screen.findByText("Invalid request body: value, reason")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The request was refused (400).")).toBeNull();
  });
});
