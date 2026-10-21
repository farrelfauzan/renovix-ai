import { createHash, createHmac } from "crypto";
import { hashApiKey } from "./hash-api-key";

describe("RNX-18: hashApiKey", () => {
  const inputKey = `rnx_live_${"ab".repeat(38)}`;

  it("is the HMAC-SHA256 of the whole key under the secret, in hex", () => {
    const expected = createHmac("sha256", "secret-one").update(inputKey).digest("hex");

    expect(hashApiKey(inputKey, "secret-one")).toBe(expected);
  });

  it("depends on the secret: another secret gives another hash, and it is not the plain SHA-256", () => {
    const actual = hashApiKey(inputKey, "secret-one");

    expect(actual).not.toBe(hashApiKey(inputKey, "secret-two"));
    expect(actual).not.toBe(createHash("sha256").update(inputKey).digest("hex"));
  });
});
