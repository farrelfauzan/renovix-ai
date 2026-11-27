import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import type { PackagesApi } from "@/lib/packages/packages-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import type { UserDetail } from "@/lib/users/user-detail";
import type { UserSession } from "@/lib/users/user-session";
import { createUsersApi } from "@/lib/users/users-api";
import { UsersScreen } from "./users-screen";

// RNX-100: the user actions of the /users detail (suspend, reinstate, reset API keys, revoke one session, revoke all),
// fired through the screen and the real users API client over a recording request double: each confirmed action sends
// exactly one request, with the trimmed reason in its JSON body. Made-up values only.

const REASON = "ticket 6100: account abuse report";
const READER = ["users:read"];
const WRITER = ["users:read", "users:write"];
const USER_ID = "user-70";
const SESSIONS: UserSession[] = [
  { id: "session-new", createdAt: "2026-11-26T08:00:00.000Z", expiresAt: "2026-12-03T08:00:00.000Z", userAgent: "MadeUpBrowser/2.0" },
  { id: "session-old", createdAt: "2026-11-20T08:00:00.000Z", expiresAt: "2026-11-27T08:00:00.000Z", userAgent: null },
];
const detailOf = (status: string): UserDetail => ({
  id: USER_ID, email: "***", name: "***", package: null, creditsAvailable: "70", status: status as UserDetail["status"], lastLoginAt: null,
  phone: null, joinedAt: "2026-09-12T00:00:00.000Z", timezone: null, language: null, signInMethods: ["credential"], ledger: null,
});
const profile = (permissions: string[]): AdminProfile => ({
  id: "admin-1", name: "Ops", email: "ops@example.com", role: "custom", permissions, scope: "full", mfaEnrolled: true, mustChangePassword: false, idleExpiresAt: "2026-11-25T08:30:00.000Z", absoluteExpiresAt: "2026-11-25T20:00:00.000Z",
});
const packagesApi = { listOffers: async () => [] } as unknown as PackagesApi;

type Answer = { readonly ok: boolean; readonly status: number; readonly body: unknown };

/** The users API on the real client; reads answer the made-up list, detail and sessions, writes answer `write`. */
function renderWith(permissions: string[], { status = "active", write = { ok: true, status: 200, body: { revoked: 2 } } }: { status?: string; write?: Answer } = {}) {
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const isRead = (init?.method ?? "GET") === "GET";
    const read = path.includes("/users?") ? { page: 1, pageSize: 50, hasMore: false, items: [detailOf(status)] } : path.endsWith("/sessions") ? { sessions: SESSIONS } : detailOf(status);
    const answer: Answer = isRead ? { ok: true, status: 200, body: read } : write;
    return { ok: answer.ok, status: answer.status, json: async () => answer.body } as Response;
  });
  const sessionApi: SessionApi = { me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined };
  render(<UsersScreen api={createUsersApi({ request } as ApiClient)} packagesApi={packagesApi} sessionApi={sessionApi} />);
  return { request, writes: () => request.mock.calls.filter(([, init]) => init?.method !== "GET") };
}
const openUser = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole("button", { name: `Open user ${USER_ID}` }));
  const panel = await screen.findByRole("region", { name: `User ${USER_ID}` });
  await within(panel).findByText("Personal data");
  return panel;
};
const openSessions = async (panel: HTMLElement): Promise<HTMLElement> => {
  fireEvent.mouseDown(within(panel).getByRole("tab", { name: "Sessions" }));
  return within(panel).findByRole("table");
};

type Action = {
  readonly name: string;
  readonly status: string;
  readonly button: string;
  readonly title: string;
  readonly isInSessions: boolean;
  readonly path: string;
  readonly method: string;
};
const ACTIONS: readonly Action[] = [
  { name: "suspend", status: "active", button: "Suspend…", title: `Suspend user ${USER_ID}`, isInSessions: false, path: `/api/v1/admin/users/${USER_ID}/suspend`, method: "POST" },
  { name: "reinstate", status: "suspended", button: "Reinstate…", title: `Reinstate user ${USER_ID}`, isInSessions: false, path: `/api/v1/admin/users/${USER_ID}/reinstate`, method: "POST" },
  { name: "reset API keys", status: "active", button: "Reset API keys…", title: `Reset the API keys of user ${USER_ID}`, isInSessions: false, path: `/api/v1/admin/users/${USER_ID}/reset-api-keys`, method: "POST" },
  { name: "revoke one session", status: "active", button: "Revoke session session-old", title: "Revoke session session-old", isInSessions: true, path: `/api/v1/admin/users/${USER_ID}/sessions/session-old`, method: "DELETE" },
  { name: "revoke all sessions", status: "active", button: "Revoke all", title: `Revoke all sessions of user ${USER_ID}`, isInSessions: true, path: `/api/v1/admin/users/${USER_ID}/sessions`, method: "DELETE" },
];
/** Opens the user (and the Sessions tab when the action is there), clicks the action and returns its reason dialog. */
const openDialog = async (action: Action): Promise<HTMLElement> => {
  const panel = await openUser();
  if (action.isInSessions) await openSessions(panel);
  fireEvent.click(within(panel).getByRole("button", { name: action.button }));
  return screen.getByRole("dialog", { name: action.title });
};
const typeReason = (dialog: HTMLElement, reason: string) =>
  fireEvent.change(within(dialog).getByLabelText("Reason (required, audited)"), { target: { value: reason } });

describe("UsersScreen: the user actions (RNX-100)", () => {
  it.each(ACTIONS.map((action) => [action.name, action] as const))("AC7 %s: confirming with a reason sends exactly one request with the trimmed reason", async (_name, action) => {
    const { writes } = renderWith(WRITER, { status: action.status });
    const dialog = await openDialog(action);
    expect(writes()).toEqual([]);
    typeReason(dialog, `  ${REASON}  `);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()).toEqual([[action.path, { method: action.method, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: REASON }) }]]);
  });

  it.each(ACTIONS.map((action) => [action.name, action] as const))("%s: Confirm stays disabled while the reason is empty or blank, and nothing is sent", async (_name, action) => {
    const { writes } = renderWith(WRITER, { status: action.status });
    const dialog = await openDialog(action);
    const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    typeReason(dialog, "  \t ");
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("without users:write: no Suspend, Reinstate or Reset API keys, and the sessions are listed without Revoke or Revoke all", async () => {
    const { writes } = renderWith(READER);
    const panel = await openUser();
    for (const name of ["Suspend…", "Reinstate…", "Reset API keys…"]) expect(within(panel).queryByRole("button", { name })).toBeNull();
    const table = await openSessions(panel);
    expect(within(table).getByText("MadeUpBrowser/2.0")).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Revoke/ })).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("with users:write: a suspended user offers Reinstate, not Suspend; each session row has an icon-only Revoke", async () => {
    renderWith(WRITER, { status: "suspended" });
    const panel = await openUser();
    expect(within(panel).queryByRole("button", { name: "Suspend…" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Reinstate…" })).toBeTruthy();
    const table = await openSessions(panel);
    const revokeButtons = within(table).getAllByRole("button", { name: /^Revoke session / });
    expect(revokeButtons.map((button) => [button.getAttribute("aria-label"), button.textContent])).toEqual([["Revoke session session-new", ""], ["Revoke session session-old", ""]]);
  });

  it("a suspend reads the detail again; a key reset shows how many keys were revoked", async () => {
    const { request } = renderWith(WRITER);
    const suspendDialog = await openDialog(ACTIONS[0]);
    typeReason(suspendDialog, REASON);
    fireEvent.click(within(suspendDialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path === `/api/v1/admin/users/${USER_ID}`)).toHaveLength(2));
    const panel = await screen.findByRole("region", { name: `User ${USER_ID}` });
    fireEvent.click(await within(panel).findByRole("button", { name: "Reset API keys…" }));
    const resetDialog = screen.getByRole("dialog", { name: ACTIONS[2].title });
    typeReason(resetDialog, REASON);
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Confirm" }));
    expect(await within(panel).findByText("API keys revoked: 2.")).toBeTruthy();
  });

  it("a refusal shows the API's message (409 on suspend)", async () => {
    renderWith(WRITER, { write: { ok: false, status: 409, body: { statusCode: 409, message: "The user is already suspended" } } });
    const dialog = await openDialog(ACTIONS[0]);
    typeReason(dialog, REASON);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    const panel = screen.getByRole("region", { name: `User ${USER_ID}` });
    expect((await within(panel).findByRole("alert")).textContent).toBe("The user is already suspended");
  });
});
