import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AdminListEntry } from "@/lib/admins/admin-list-entry";
import type { AdminsApi } from "@/lib/admins/admins-api";
import type { ApiClient } from "@/lib/api/api-client";
import { createAuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { AuditLogScreen } from "../audit-log/audit-log-screen";
import { AdminDetailScreen } from "./admin-detail-screen";

// RNX-371 AC5 (D442): "View in audit log" on an admin's page opens the audit log with that admin as the actor filter.
// next/navigation is mocked: `mockSearch` is the query of the page the link leads to. Obviously fake values only.
let mockSearch = "";
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => "/audit-log",
  useRouter: () => ({ replace: jest.fn() }),
}));

const OPS: AdminListEntry = { id: "ops id/1", status: "active", name: "ops", email: "ops@example.com", role: "support", mfa: "enrolled", lastSignInAt: null };
const LATE: AdminListEntry = { id: "late", status: "invited", name: null, email: "late@example.com", role: "support", mfa: "not_enrolled", lastSignInAt: null };
const profile = (permissions: string[]): AdminProfile => ({
  id: "owner", email: "owner@example.com", name: "owner", role: "owner", permissions, scope: "full", mustChangePassword: false, mfaEnrolled: true, idleExpiresAt: "2026-10-14T08:30:00.000Z", absoluteExpiresAt: "2026-10-14T20:00:00.000Z",
});
async function renderPage(adminId: string, permissions: string[]): Promise<void> {
  const api = { listAdmins: async () => [OPS, LATE], listRoles: async () => [], reauth: jest.fn() };
  const sessionApi: SessionApi = { me: async () => profile(permissions), changePassword: async () => undefined, signOut: async () => undefined };
  render(<AdminDetailScreen adminId={adminId} api={api as unknown as AdminsApi} sessionApi={sessionApi} />);
  await screen.findByRole("region");
}
const auditLink = () => screen.queryByRole("link", { name: "View in audit log" });

describe("admin page: View in audit log (RNX-371 AC5)", () => {
  it("followed, the audit log shows that admin as the actor filter and asks the API for that admin's rows", async () => {
    await renderPage(OPS.id, ["admins:read", "audit:read"]);
    const target = new URL(auditLink()?.getAttribute("href") ?? "", "http://back-office.test");
    expect(target.pathname).toBe("/audit-log");
    cleanup();
    mockSearch = target.search;
    const request = jest.fn(async (): Promise<Response> => ({ ok: true, status: 200, json: async () => ({ rows: [], nextCursor: null }) }) as Response);
    const client: ApiClient = { request };
    render(<AuditLogScreen api={createAuditLogApi(client)} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const asked = new URL(String((request.mock.calls[0] as unknown[])[0]), "http://api.test");
    expect(asked.pathname).toBe("/api/v1/admin/audit-log");
    expect([...asked.searchParams.entries()]).toEqual([["adminId", OPS.id]]);
    expect((screen.getByLabelText("Admin id") as HTMLInputElement).value).toBe(OPS.id);
  });

  it("is not offered without audit:read", async () => {
    await renderPage(OPS.id, ["admins:read"]);
    expect(auditLink()).toBeNull();
  });

  it("is not offered on a pending invitation, which has made no audit entry", async () => {
    await renderPage(LATE.id, ["admins:read", "audit:read"]);
    expect(auditLink()).toBeNull();
  });
});
