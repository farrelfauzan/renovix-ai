import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@/lib/api/api-client";
import type { AdminProfile } from "@/lib/session/admin-profile";
import type { SessionApi } from "@/lib/session/session-api";
import { createUsageApi } from "@/lib/usage/usage-api";
import { UsageAndCostScreen } from "./usage-and-cost-screen";

// RNX-163: the usage and cost screen against a mocked back-office API client (shapes from apps/api admin-usage types).

const RANGE = { from: "2026-09-24", to: "2026-10-23" };
const PERIOD = { ...RANGE, timeZone: "Asia/Jakarta" };

const profile = (permissions: string[]): AdminProfile => ({
  id: "admin-1", name: "Ops", email: "ops@example.com", role: "custom", permissions, scope: "full", mfaEnrolled: true, mustChangePassword: false,
});
const VIEWER = ["usage:read", "providers:read"];
const FINANCE = ["usage:read", "providers:read", "profit:read", "reconciliation:write", "users:read_pii"];

const usageRow = (overrides = {}) => ({
  day: "2026-10-22", providerId: "prov-1", providerModelId: "model-a", tier: "standard", workspaceId: null,
  user: { id: "user-7", email: "***" }, calls: 3, tokensNew: "100", tokensCached: "40", tokensOut: "60", tokensReasoning: "5", ...overrides,
});
const figures = {
  calls: 10, creditsConsumed: "12", costLowUsd: "1.5", costHighUsd: "2.5", costUnknownUsdCalls: 0, costLowIdr: "24000", costHighIdr: "40000",
  costUnknownIdrCalls: 0, revenueIdr: "100000", revenueUsd: "6.25", revenueUnknownCalls: 0, revenueUnknownCredits: "0", ppnIdr: "9009", ppnUsd: "0.62",
  gatewayFeeIdr: null, gatewayFeeUsd: null, netRevenueIdr: null, netRevenueUsd: null, profitLowIdr: null, profitHighIdr: null, profitLowUsd: null,
  profitHighUsd: null, netMarginLow: null, netMarginHigh: null,
};
const profitReport = {
  ...PERIOD, ppnRate: "0.11", paymentGatewayFeePercent: null,
  rows: [{ ...figures, day: "2026-10-22", providerId: "prov-1", providerModelId: "model-a", tier: "standard", wallet: "paid", packageVersionId: "pkg-1", topUpPackVersionId: null }],
  // The API's totals differ from the sum of the rows on purpose: the screen must show the API's figure.
  totals: { ...figures, calls: 999, creditsConsumed: "777", freeWalletCalls: 4, freeWalletCostLowUsd: "0.1", freeWalletCostHighUsd: "0.2", freeWalletCostLowIdr: "1600", freeWalletCostHighIdr: "3200" },
  creditsSold: { label: "list value, not cash", rows: [] },
};

type Handler = (body: Record<string, string> | undefined, url: URL) => { status: number; body?: unknown };

/** A fake API: one handler per "METHOD /path"; unknown routes answer 404; records every call. */
function createMock(handlers: Record<string, Handler>) {
  const calls: { key: string; url: URL; body?: Record<string, string> }[] = [];
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "http://api.test");
    const key = `${init?.method ?? "GET"} ${url.pathname.replace("/api/v1/admin", "")}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, url, body });
    const { status, body: answer } = handlers[key]?.(body, url) ?? { status: 404 };
    return { ok: status < 400, status, json: async () => answer } as Response;
  });
  const client: ApiClient = { request };
  return { api: createUsageApi(client), keys: () => calls.map((call) => call.key), calls };
}

const renderScreen = (permissions: string[], handlers: Record<string, Handler>) => {
  const mock = createMock(handlers);
  const sessionApi = { me: async () => profile(permissions) } as SessionApi;
  render(<UsageAndCostScreen api={mock.api} sessionApi={sessionApi} initialRange={RANGE} />);
  return mock;
};

const USAGE_OK: Record<string, Handler> = { "GET /usage/daily": () => ({ status: 200, body: { ...PERIOD, rows: [usageRow()] } }) };

describe("UsageAndCostScreen (RNX-163)", () => {
  it("viewer: the token views show, cost, revenue, profit and margin do not, and no cost route is called", async () => {
    const mock = renderScreen(VIEWER, USAGE_OK);

    expect(await screen.findByText("model-a")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Token usage" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Cost and profit" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Provider reconciliation" })).toBeNull();
    expect(screen.queryByText(/margin|revenue/i)).toBeNull();
    expect(mock.keys()).toEqual(["GET /usage/daily"]);
  });

  it("a forced call the API refuses (403) shows its message readably", async () => {
    renderScreen(FINANCE, {
      ...USAGE_OK,
      "GET /usage/profit": () => ({ status: 403, body: { statusCode: 403, message: "Forbidden resource" } }),
      "GET /reconciliation": () => ({ status: 200, body: { ...PERIOD, driftThresholdPercent: null, rows: [] } }),
      "GET /providers": () => ({ status: 200, body: [] }),
    });

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toBe("Cost and profit could not be loaded: Forbidden resource");
  });

  it("finance picks a provider and enters a balance: the day appears for that provider with its flag state", async () => {
    let entered: Record<string, string> | undefined;
    const row = (flagged: boolean) => ({
      providerId: "prov-1", day: "2026-10-22", portalBalanceUsd: "90", topUpUsd: "0", enteredByAdminId: "admin-1", previousBalanceUsd: "100",
      portalDropUsd: "10", estimateLowUsd: "4", estimateHighUsd: "5", costUnknownCalls: 0, flagged,
    });
    const mock = renderScreen(FINANCE, {
      ...USAGE_OK,
      "GET /usage/profit": () => ({ status: 200, body: profitReport }),
      "GET /providers": () => ({ status: 200, body: [{ id: "prov-1", name: "Griphub", type: "openai", extra: 1 }] }),
      "GET /reconciliation": () => ({ status: 200, body: { ...PERIOD, driftThresholdPercent: 10, rows: entered ? [row(true)] : [] } }),
      "POST /reconciliation/entries": (body) => {
        entered = body;
        return { status: 200, body: row(true) };
      },
    });
    expect(await screen.findByText("No portal balance entered in this range.")).toBeTruthy();
    await screen.findByRole("option", { name: "Griphub" });
    const form = screen.getByRole("form", { name: "Portal balance" });

    fireEvent.change(within(form).getByLabelText("Provider"), { target: { value: "prov-1" } });
    fireEvent.change(within(form).getByLabelText("Day"), { target: { value: "2026-10-22" } });
    fireEvent.change(within(form).getByLabelText("Portal balance (USD)"), { target: { value: "90" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save balance" }));

    const dayRow = (await screen.findByText("Flagged")).closest("tr") as HTMLElement;
    expect(entered).toEqual({ providerId: "prov-1", day: "2026-10-22", portalBalanceUsd: "90" });
    expect(within(dayRow).getByText("Griphub")).toBeTruthy();
    expect(within(dayRow).getByText("2026-10-22")).toBeTruthy();
    expect(mock.keys().filter((key) => key === "GET /reconciliation")).toHaveLength(2);
  });

  it("without reconciliation:write the balance form is hidden, the flagged days stay", async () => {
    renderScreen(["usage:read", "profit:read"], {
      ...USAGE_OK,
      "GET /usage/profit": () => ({ status: 200, body: profitReport }),
      "GET /reconciliation": () => ({ status: 200, body: { ...PERIOD, driftThresholdPercent: null, rows: [] } }),
    });

    expect(await screen.findByText("Drift threshold: not set (nothing is flagged)")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Portal balance" })).toBeNull();
  });

  it("a 30-day range is read once per view and the totals are the API's own, not a sum of the rows", async () => {
    const mock = renderScreen(FINANCE, {
      ...USAGE_OK,
      "GET /usage/profit": () => ({ status: 200, body: profitReport }),
      "GET /reconciliation": () => ({ status: 200, body: { ...PERIOD, driftThresholdPercent: null, rows: [] } }),
      "GET /providers": () => ({ status: 200, body: [] }),
    });

    const totals = await screen.findByLabelText("Totals");

    expect(within(totals).getByText("777")).toBeTruthy();
    expect(mock.calls.filter((call) => call.key === "GET /usage/daily").map((call) => call.url.search)).toEqual([`?from=${RANGE.from}&to=${RANGE.to}`]);
    expect(mock.calls.filter((call) => call.key === "GET /usage/profit")).toHaveLength(1);
  });

  it("cost, profit and fee show what the API says: the high case is an estimate, a missing fee is 'not set', credits sold carry their label", async () => {
    renderScreen(FINANCE, {
      ...USAGE_OK,
      "GET /usage/profit": () => ({ status: 200, body: profitReport }),
      "GET /reconciliation": () => ({ status: 200, body: { ...PERIOD, driftThresholdPercent: null, rows: [] } }),
      "GET /providers": () => ({ status: 200, body: [] }),
    });

    const totals = await screen.findByLabelText("Totals");

    expect(within(totals).getByText("Cost, high (estimate)").nextSibling?.textContent).toBe("US$2.5 · Rp40.000");
    expect(within(totals).getByText("Gateway fee").nextSibling?.textContent).toBe("not set");
    expect(within(totals).getByText("Net margin").nextSibling?.textContent).toBe("not set to not set");
    expect(within(totals).getByText("Free-wallet cost, low").nextSibling?.textContent).toBe("US$0.1 · Rp1.600");
    expect(screen.getByRole("heading", { name: "Credits sold (list value, not cash)" })).toBeTruthy();
  });

  it("the email is revealed only with users:read_pii, with a reason, and shown after the API answers", async () => {
    let reason: string | undefined;
    renderScreen(["usage:read", "users:read_pii"], {
      ...USAGE_OK,
      "POST /usage/users/user-7/email": (body) => {
        reason = body?.reason;
        return { status: 200, body: { userId: "user-7", email: "ana@example.com" } };
      },
    });
    expect(await screen.findByText("user-7")).toBeTruthy();
    expect(screen.getByText("***")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reveal email" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "support ticket 12" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("ana@example.com")).toBeTruthy();
    expect(reason).toBe("support ticket 12");
  });

  it("without users:read_pii there is no reveal control", async () => {
    renderScreen(VIEWER, USAGE_OK);

    expect(await screen.findByText("user-7")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reveal email" })).toBeNull();
  });

  it("a range over 92 days is not sent; a valid one reloads the views", async () => {
    const mock = renderScreen(VIEWER, USAGE_OK);
    await screen.findByText("model-a");
    const form = screen.getByRole("form", { name: "Report range" });

    fireEvent.change(within(form).getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Apply range" }));
    expect(within(form).getByRole("alert").textContent).toBe("A range covers at most 92 days.");
    expect(mock.keys()).toHaveLength(1);

    fireEvent.change(within(form).getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Apply range" }));
    await waitFor(() => expect(mock.calls[1]?.url.search).toBe("?from=2026-10-01&to=2026-10-23"));
  });

  it("an admin with none of the permissions sees no view and calls nothing", async () => {
    const mock = renderScreen(["users:read"], {});

    expect(await screen.findByText("Your role has no access to usage and cost.")).toBeTruthy();
    expect(mock.keys()).toEqual([]);
  });
});
