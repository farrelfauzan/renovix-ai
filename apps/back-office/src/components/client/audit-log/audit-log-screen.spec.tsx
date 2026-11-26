import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import type { ApiClient } from "@/lib/api/api-client";
import { createAuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AuditLogRow } from "@/lib/audit-log/audit-log-row";
import { AuditLogScreen } from "./audit-log-screen";

// RX-164: the audit log screen against a mocked back-office API client (no sign-in screen exists yet).
// RX-371: the applied filters live in the URL (next/navigation is mocked: `mockSearch` is the page URL's query, `mockReplace` the router),
// and the row actions are icon-only with a tooltip (jsdom has no hover, so the shared tooltip always shows its content, as the button's next sibling).
let mockSearch = "";
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => "/audit-log",
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("@performa-ai/ui/components/tooltip", () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});

beforeEach(() => {
  mockSearch = "";
  mockReplace.mockClear();
});

const row = (id: string, overrides: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id,
  adminId: `admin-${id}`,
  adminEmail: `${id}@example.com`,
  resource: "package",
  action: "update",
  before: { price: 100 },
  after: { price: 120 },
  reason: `reason ${id}`,
  requestId: `req-${id}`,
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
      "Admin", "Resource", "Action", "Before", "After", "Reason", "Effective time", "Actions",
    ]);
    const [, first] = within(table).getAllByRole("row");
    const cells = within(first).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "a@example.com", "package", "update",
      JSON.stringify({ email: "***", plan: "pro" }, null, 2), JSON.stringify({ email: "***", plan: "team" }, null, 2),
      "reason a", "2026-10-15T08:00:00.000Z", "Open",
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

  describe("filters in the URL and the copied link (RX-371)", () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    const setFilters = () => {
      fireEvent.change(screen.getByLabelText("Admin id"), { target: { value: "admin-7" } });
      fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "package" } });
      fireEvent.change(screen.getByLabelText("Action"), { target: { value: "update" } });
    };

    beforeEach(() => {
      writeText.mockClear();
      Object.assign(navigator, { clipboard: { writeText } });
    });

    it("applying filters writes only the set ones to the URL", async () => {
      const mock = createMockClient({ first: FIRST });
      render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
      await screen.findByRole("table");

      fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "package" } });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01T08:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

      expect(mockReplace).toHaveBeenCalledWith("/audit-log?resource=package&from=2026-10-01T08%3A00");
      await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
      expect(mockReplace).toHaveBeenLastCalledWith("/audit-log");
      await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(3));
    });

    it("a copied link, opened again, shows the same filters and asks the API for the same rows", async () => {
      const first = createMockClient({ first: FIRST });
      const { unmount } = render(<AuditLogScreen api={createAuditLogApi(first.client)} />);
      await screen.findByRole("table");
      setFilters();
      fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
      await waitFor(() => expect(first.request).toHaveBeenCalledTimes(2));
      const typedFrom = (screen.getByLabelText("From") as HTMLInputElement).value;
      const typedTo = (screen.getByLabelText("To") as HTMLInputElement).value;

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      expect(screen.getByRole("status").textContent).toBe("Link copied");
      const link = new URL(writeText.mock.calls[0][0]);
      expect(link.origin + link.pathname).toBe(`${window.location.origin}/audit-log`);
      expect(Object.fromEntries(link.searchParams)).toEqual({ adminId: "admin-7", resource: "package", action: "update", from: typedFrom, to: typedTo });
      expect(new Date(typedTo).getTime() - new Date(typedFrom).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      unmount();
      mockSearch = link.search;
      const second = createMockClient({ first: FIRST });

      render(<AuditLogScreen api={createAuditLogApi(second.client)} />);

      await screen.findByRole("table");
      for (const [label, value] of [["Admin id", "admin-7"], ["Resource", "package"], ["Action", "update"], ["From", typedFrom], ["To", typedTo]]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
      }
      expect(second.paths()).toEqual([first.paths()[1]]);
    });

    it("the 30-day preset keeps the typed filters and applies at once", async () => {
      const mock = createMockClient({ first: FIRST });
      render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
      await screen.findByRole("table");
      fireEvent.change(screen.getByLabelText("Action"), { target: { value: "revoke" } });

      fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));

      await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
      const from = (screen.getByLabelText("From") as HTMLInputElement).value;
      const to = (screen.getByLabelText("To") as HTMLInputElement).value;
      expect(Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000)).toBe(30 * 24 * 60);
      expect(mock.paths()[1]).toContain("action=revoke");
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  describe("entry detail dialog (RX-371, D446)", () => {
    it("Open is icon-only with the tooltip Open, and opens a modal with who, what, reason, before and after side by side, and the request id", async () => {
      const mock = createMockClient({ first: FIRST });
      render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
      await screen.findByRole("table");
      const open = screen.getByRole("button", { name: "Open audit entry a" });
      expect(open.textContent).toBe("");
      expect(open.nextElementSibling?.textContent).toBe("Open");
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(open);

      const dialog = screen.getByRole("dialog", { name: "Audit entry a" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(screen.getByRole("table", { hidden: true }).parentElement?.contains(dialog)).toBe(false);
      expect(screen.queryByRole("table")).toBeNull();
      const text = dialog.textContent ?? "";
      for (const expected of ["a@example.com", "admin-a", "package", "update", "reason a", "req-a", "2026-10-15T08:00:00.000Z"]) expect(text).toContain(expected);
      const before = within(dialog).getByRole("heading", { name: "Before" }).parentElement as HTMLElement;
      const after = within(dialog).getByRole("heading", { name: "After" }).parentElement as HTMLElement;
      expect(before.parentElement).toBe(after.parentElement);
      expect(before.textContent).toContain(JSON.stringify({ email: "***", plan: "pro" }, null, 2));
      expect(after.textContent).toContain(JSON.stringify({ email: "***", plan: "team" }, null, 2));
      expect(mock.request).toHaveBeenCalledTimes(1);
      expect(open.closest("tr")?.className).toContain("bg-rx-accent-fill");
    });

    it("the close button and Esc close it, and the focus goes back to the row's Open", async () => {
      const mock = createMockClient({ first: { rows: [row("a"), row("b")], nextCursor: null } });
      render(<AuditLogScreen api={createAuditLogApi(mock.client)} />);
      await screen.findByRole("table");
      const openA = screen.getByRole("button", { name: "Open audit entry a" });
      fireEvent.click(openA);
      fireEvent.click(within(screen.getByRole("dialog", { name: "Audit entry a" })).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(openA));

      const openB = screen.getByRole("button", { name: "Open audit entry b" });
      fireEvent.click(openB);
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Audit entry b" }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(openB));
      expect(openB.closest("tr")?.className).not.toContain("bg-rx-accent-fill");
    });
  });
});
