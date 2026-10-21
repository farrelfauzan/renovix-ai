import { hashApiKey } from "./hash-api-key";
import { matchesApiKeyHash } from "./matches-api-key-hash";

describe("RNX-18: matchesApiKeyHash", () => {
  const inputKey = `rnx_live_${"cd".repeat(38)}`;
  const storedHash = hashApiKey(inputKey, "secret");

  it("control: matches the key it was made from", () => {
    expect(matchesApiKeyHash(inputKey, storedHash, "secret")).toBe(true);
  });

  it.each([
    ["another key with the same prefix", `${inputKey.slice(0, -1)}e`],
    ["the same key under another secret", inputKey],
  ])("does not match %s", (_case, presented) => {
    const secret = presented === inputKey ? "other-secret" : "secret";

    expect(matchesApiKeyHash(presented, storedHash, secret)).toBe(false);
  });

  it("does not match (and does not throw on) a stored value of another length", () => {
    expect(matchesApiKeyHash(inputKey, storedHash.slice(2), "secret")).toBe(false);
  });
});
