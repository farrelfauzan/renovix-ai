import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import { createAuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AuditLogRow } from "@/lib/audit-log/audit-log-row";
import { AuditLogScreen } from "./audit-log-screen";

// RX-164: the audit log screen against a mocked back-office API client (no sign-in screen exists yet).

const row = (id: string, overrides: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id,
  adminId: `admin-${id}`,
  adminEmail: `${id}@example.com`,
  resource: "package",
  action: "update",
  before: { price: 100 },
  after: { price: 120 },
  reason: `reason ${id}`,
  effectiveAt: "2026-10-15T08:00:00.000Z",
  createdAt: "2026-10-15T08:00:00.000Z",
  ...overrides,
});

/** A mocked ApiClient: list pages by cursor (none: page 1), the CSV for the export path. */
function createMockClient(pages: Record<string, { rows: AuditLogRow[]; nextCursor: string | null }>) {
  const request = jest.fn(async (path: string): Promise<Response> => {
    const url = new URL(path, "http://api.test");
    if (url.pathname.endsWith("/export")) return { ok: true, status: 200, blob: async () => new Blob(["id\r\n"]) } as Response;
    const page = pages[url.searchParams.get("cursor") ?? "first"];
    return { ok: true, status: 200, json: async () => page } as Response;
  });
  const client: ApiClient = { request };
  return { client, request, paths: () => request.mock.calls.map(([path]) => path) };
}

const FIRST = { rows: [row("a", { before: { email: "***", plan: "pro" }, after: { email: "***", plan: "team" } }), row("b")], nextCursor: "cursor-2" };
const SECOND = { rows: [row("c")], nextCursor: null };

describe("AuditLogScreen (RX-164)", () => {
  it("loads the first page and shows every column, with before and after values", async () => {
    const mock = createMockClient({ first: FIRST });

    render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Admin", "Resource", "Action", "Before", "After", "Reason", "Effective time",
    ]);
    const [, first] = within(table).getAllByRole("row");
    const cells = within(first).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "a@example.com", "package", "update",
      JSON.stringify({ email: "***", plan: "pro" }, null, 2), JSON.stringify({ email: "***", plan: "team" }, null, 2),
      "reason a", "2026-10-15T08:00:00.000Z",
    ]);
    expect(mock.paths()).toEqual(["/api/v1/admin/audit-log"]);
  });

  it("applies the filters as the query of the read route", async () => {
    const mock = createMockClient({ first: FIRST });
    render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Admin id"), { target: { value: "admin-7" } });
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "package" } });
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "update" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01T08:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-02T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
    const expected = new URLSearchParams({
      adminId: "admin-7",
      resource: "package",
      action: "update",
      from: new Date("2026-10-01T08:00").toISOString(),
      to: new Date("2026-10-02T09:30").toISOString(),
    });
    expect(mock.paths()[1]).toBe(`/api/v1/admin/audit-log?${expected}`);
  });

  it("asks for the next page with the cursor of the current one, keeping the filters", async () => {
    const mock = createMockClient({ first: FIRST, "cursor-2": SECOND });
    render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "package" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));

    expect(await screen.findByText("reason c")).toBeTruthy();
    expect(screen.queryByText("reason a")).toBeNull();
    expect(mock.paths()[2]).toBe("/api/v1/admin/audit-log?resource=package&cursor=cursor-2");
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("the export button downloads the CSV of the applied filters", async () => {
    const mock = createMockClient({ first: FIRST });
    const createObjectURL = jest.fn(() => "blob:audit-log");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "revoke" } });
    fireEvent.change(screen.getByLabelText("Admin id"), { target: { value: "admin-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mock.paths()[2]).toBe("/api/v1/admin/audit-log/export?adminId=admin-7&action=revoke");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:audit-log");
    click.mockRestore();
  });

  it("says so when the API refuses (e.g. 403 without audit:read)", async () => {
    const request = jest.fn(async (): Promise<Response> => ({ ok: false, status: 403 }) as Response);

    render(<AuditLogScreen api={createAuditLogApi({ request })} />);

    expect((await screen.findByRole("alert")).textContent).toBe("The audit log could not be loaded.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
