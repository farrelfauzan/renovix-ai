import { parseApiKeyPrefix } from "./parse-api-key-prefix";

describe("RNX-18: parseApiKeyPrefix", () => {
  const hex = "0123456789ab".repeat(6) + "cdef";

  it("gives the first 12 hex characters after rnx_live_", () => {
    expect(parseApiKeyPrefix(`rnx_live_${hex}`)).toBe("0123456789ab");
  });

  it.each([
    ["the old sk_live_ format", `sk_live_${hex}`],
    ["one character short", `rnx_live_${hex.slice(1)}`],
    ["one character too many", `rnx_live_${hex}0`],
    ["upper-case hex", `rnx_live_${hex.toUpperCase()}`],
    ["a non-hex character", `rnx_live_${hex.slice(1)}g`],
    ["text around the key", ` rnx_live_${hex}`],
  ])("refuses %s", (_case, presented) => {
    expect(parseApiKeyPrefix(presented)).toBeNull();
  });
});
