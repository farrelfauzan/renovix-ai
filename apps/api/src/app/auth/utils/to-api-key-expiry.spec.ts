import { toApiKeyExpiry } from "./to-api-key-expiry";

describe("RNX-18: toApiKeyExpiry", () => {
  const inputNow = new Date("2026-10-21T00:00:00.000Z");

  it.each([
    ["30d", "2026-11-20T00:00:00.000Z"],
    ["90d", "2027-01-19T00:00:00.000Z"],
    ["1y", "2027-10-21T00:00:00.000Z"],
  ] as const)("%s from now", (expiresIn, expected) => {
    expect(toApiKeyExpiry(expiresIn, inputNow)?.toISOString()).toBe(expected);
  });

  it("never: no expiry", () => {
    expect(toApiKeyExpiry("never", inputNow)).toBeNull();
  });
});
