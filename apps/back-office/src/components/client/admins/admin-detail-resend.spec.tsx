import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { IssuedInvitation } from "@/lib/admins/issued-invitation";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { AdminDetailRoute } from "./admin-detail-route";
import { AdminDetailScreen } from "./admin-detail-screen";

// RNX-377: after a Resend the API revokes the old invitation and issues one with a NEW id. The page moves to the new
// id (router.replace), says so, and shows the new link once; "This invitation was revoked." is only for a Revoke or
// an old URL. Next.js remounts the page for another value of the same dynamic segment, so the screen is keyed by id.
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }) }));

const LINK = "https://bo.test/accept-invitation#token=SECRET-NEW-LINK";
const NEW_ID = "inv new/2?x";
const REASON = "Made-up reason for an RNX-377 test";
const NOTICE = "Invitation resent. The previous link no longer works.";
const invited = (id: string): AdminListEntry => ({ id, status: "invited", name: null, email: "late@example.com", role: "support", mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: "2999-01-01T00:00:00.000Z" });
const me: AdminProfile = {
  id: "owner", email: "owner@example.com", name: "owner", role: "owner", permissions: ["admins:read", "admins:write", "roles:read"], scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z",
};
const sessionApi: SessionApi = { me: async () => me, changePassword: async () => undefined, signOut: async () => undefined };

/** A stateful fake: a resend revokes the old invitation and issues NEW_ID, like the API; a revoke removes it. */
function createFake() {
  let admins: AdminListEntry[] = [invited("inv-old")];
  const resendInvitation = jest.fn(async (id: string, _reason: string): Promise<IssuedInvitation> => {
    admins = [invited(NEW_ID)];
    return { invitation: { id: NEW_ID, email: "late@example.com", role: "support", expiresAt: "2999-01-01T00:00:00.000Z" }, link: LINK };
  });
  const revokeInvitation = jest.fn(async (id: string, _reason: string) => {
    admins = admins.filter((entry) => entry.id !== id);
  });
  const api = { listAdmins: jest.fn(async () => admins), listRoles: jest.fn(async () => []), reauth: jest.fn(), resendInvitation, revokeInvitation } as unknown as AdminsApi;
  return { api, resendInvitation, revokeInvitation };
}

/** Delivers the route change the way the app does: the route renders the page again with the id of the new URL. */
function Harness({ api, initialId }: { api: AdminsApi; initialId: string }) {
  const [adminId, setAdminId] = useState(initialId);
  mockReplace.mockImplementation((path: string) => setAdminId(decodeURIComponent(path.split("/").pop() as string)));
  return <AdminDetailRoute adminId={adminId} api={api} sessionApi={sessionApi} />;
}

async function resend(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
  const dialog = await screen.findByRole("dialog", { name: "Resend the invitation of late@example.com" });
  fireEvent.change(within(dialog).getByLabelText("Reason (required, audited)"), { target: { value: REASON } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
}

beforeEach(() => mockReplace.mockReset());

describe("RNX-377 AC1: a successful Resend moves the page to the new invitation", () => {
  it("sends the resend for the old id with the reason, then replaces the URL with the id of the response (encoded)", async () => {
    const fake = createFake();
    render(<Harness api={fake.api} initialId="inv-old" />);

    await resend();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(fake.resendInvitation).toHaveBeenCalledWith("inv-old", REASON);
    expect(mockReplace).toHaveBeenCalledWith("/admins-and-roles/inv%20new%2F2%3Fx");
    expect(await screen.findByRole("region", { name: "Admin late@example.com" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(NOTICE);
    expect(screen.queryByText("This invitation was revoked.")).toBeNull();
    expect(screen.queryByText("No admin or invitation has this id.")).toBeNull();
  });

  it("between the resend and the arrival of the new id: not revoked, no link yet, no action on the dead id", async () => {
    const fake = createFake();
    mockReplace.mockImplementation(() => undefined);
    render(<AdminDetailRoute adminId="inv-old" api={fake.api} sessionApi={sessionApi} />);

    await resend();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("This invitation was revoked.")).toBeNull();
    expect(screen.queryByLabelText("Invitation link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(fake.api.listAdmins).toHaveBeenCalledTimes(1);
  });
});

describe("RNX-377 AC2: the new link is shown once, across the route change", () => {
  it("opens on the new id's page, is not shown twice, and does not reopen once closed", async () => {
    const fake = createFake();
    render(<Harness api={fake.api} initialId="inv-old" />);

    await resend();

    const link = (await screen.findByLabelText("Invitation link")) as HTMLInputElement;
    expect(link.value).toBe(LINK);
    expect(screen.getAllByLabelText("Invitation link")).toHaveLength(1);
    await screen.findByRole("region", { name: "Admin late@example.com" });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Invitation created" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Invitation link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("SECRET-NEW-LINK");
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + window.location.href).not.toContain("SECRET-NEW-LINK");
  });

  it("a page opened later for the same id (another mount) shows neither the link nor the status", async () => {
    const fake = createFake();
    const first = render(<Harness api={fake.api} initialId="inv-old" />);
    await resend();
    await screen.findByLabelText("Invitation link");
    first.unmount();

    render(<AdminDetailScreen adminId={NEW_ID} api={fake.api} sessionApi={sessionApi} />);

    expect(await screen.findByRole("region", { name: "Admin late@example.com" })).toBeTruthy();
    expect(screen.queryByLabelText("Invitation link")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("RNX-377 AC3: revoked invitations still say so", () => {
  it("after Revoke the page says the invitation was revoked and does not navigate", async () => {
    const fake = createFake();
    render(<Harness api={fake.api} initialId="inv-old" />);

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke the invitation of late@example.com" });
    fireEvent.change(within(dialog).getByLabelText("Reason (required, audited)"), { target: { value: REASON } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" })));

    expect(await screen.findByText("This invitation was revoked.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
