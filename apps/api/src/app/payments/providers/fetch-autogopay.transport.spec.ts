import { autoGoPayFixtures as fx } from "../../../../test/autogopay-fixtures";
import { FetchAutoGoPayTransport } from "./fetch-autogopay.transport";

// RNX-229: the default AutoGoPay transport over a stubbed global fetch. No network, no real key (D240).
describe("FetchAutoGoPayTransport (RNX-229)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("POSTs JSON with the Bearer key and an abort signal to the AutoGoPay base URL; answers the status and JSON body", async () => {
    const mockFetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fx.generate.success.body), { status: 200 }));
    const transport = new FetchAutoGoPayTransport(fx.apiKey);

    const actual = await transport.post("/qris/generate", { amount: 165_000 }, { timeoutMs: 10_000 });

    expect(mockFetch).toHaveBeenCalledWith("https://v1-gateway.autogopay.site/qris/generate", {
      method: "POST",
      headers: { authorization: `Bearer ${fx.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: '{"amount":165000}',
      signal: expect.any(AbortSignal),
    });
    expect(actual).toEqual({ status: 200, body: fx.generate.success.body });
  });

  it("answers an HTTP error as it came, and a body that is not JSON as undefined", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const transport = new FetchAutoGoPayTransport(fx.apiKey);

    expect(await transport.post("/qris/status", { transaction_id: "agp-test-txn-0001" }, { timeoutMs: 10_000 })).toEqual({ status: 502, body: undefined });
  });

  it("aborts with a TimeoutError after the call's total timeout", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const transport = new FetchAutoGoPayTransport(fx.apiKey);

    await expect(transport.post("/qris/status", { transaction_id: "agp-test-txn-0001" }, { timeoutMs: 20 })).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
