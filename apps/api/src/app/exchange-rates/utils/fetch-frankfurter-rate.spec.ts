import { FRANKFURTER_SOURCE } from "../config/frankfurter-source";
import { fetchFrankfurterRate } from "./fetch-frankfurter-rate";

// RNX-53: the Frankfurter client. global fetch is stubbed in every test: no test calls the real API.
const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const timeoutError = (): Error => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("fetchFrankfurterRate (RNX-53)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the rate and its date, asking the ECB-pinned USD to IDR endpoint with a timeout signal", async () => {
    const mockFetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(answer({ date: "2026-10-20", base: "USD", quote: "IDR", rate: 16500 }));
    const actual = await fetchFrankfurterRate();
    expect(actual).toEqual({ isFetched: true, rate: 16500, rateDate: "2026-10-20" });
    expect(mockFetch).toHaveBeenCalledWith(FRANKFURTER_SOURCE.url, { signal: expect.any(AbortSignal) });
  });

  it.each([
    ["a timeout", () => Promise.reject(timeoutError()), "request failed (TimeoutError)"],
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), "request failed (TypeError)"],
    ["HTTP 500", () => Promise.resolve(answer({ message: "down" }, 500)), "HTTP 500"],
    ["a rate of 0", () => Promise.resolve(answer({ date: "2026-10-20", base: "USD", quote: "IDR", rate: 0 })), "invalid answer (rate:"],
    ["a rate of -1", () => Promise.resolve(answer({ date: "2026-10-20", base: "USD", quote: "IDR", rate: -1 })), "invalid answer (rate:"],
    ["a rate of \"abc\"", () => Promise.resolve(answer({ date: "2026-10-20", base: "USD", quote: "IDR", rate: "abc" })), "invalid answer (rate:"],
    ["no rate", () => Promise.resolve(answer({ date: "2026-10-20", base: "USD", quote: "IDR" })), "invalid answer (rate:"],
    ["another base", () => Promise.resolve(answer({ date: "2026-10-20", base: "EUR", quote: "IDR", rate: 16500 })), "invalid answer (base"],
    ["another quote", () => Promise.resolve(answer({ date: "2026-10-20", base: "USD", quote: "EUR", rate: 16500 })), "invalid answer (quote"],
    ["a date that is not YYYY-MM-DD", () => Promise.resolve(answer({ date: "20/10/2026", base: "USD", quote: "IDR", rate: 16500 })), "invalid answer (date"],
    ["a body that is not JSON", () => Promise.resolve(new Response("<html>", { status: 200 })), "invalid answer (body"],
  ])("returns a reason and no rate on %s", async (_case, mockAnswer, expectedReasonStart) => {
    jest.spyOn(globalThis, "fetch").mockImplementation(mockAnswer as typeof fetch);
    const actual = await fetchFrankfurterRate();
    expect(actual).toEqual({ isFetched: false, reason: expect.stringContaining(expectedReasonStart) });
  });
});
