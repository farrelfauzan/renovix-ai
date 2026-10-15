import { createHmac } from "node:crypto";
import { signOAuthState } from "./sign-oauth-state";

const SECRET = "rx151-unit-secret";
const PAYLOAD = { n: "A".repeat(43), u: "user-1", w: "workspace-1", p: "google-gmail", exp: 2_000_000_000 };

describe("signOAuthState (RX-151)", () => {
  it("is base64url(JSON payload).base64url(HMAC-SHA256(secret, encoded payload))", () => {
    const actualState = signOAuthState(PAYLOAD, SECRET);
    const [encodedPayload, signature] = actualState.split(".");
    expect(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))).toEqual(PAYLOAD);
    expect(signature).toBe(createHmac("sha256", SECRET).update(encodedPayload).digest("base64url"));
  });

  it("gives a different signature under another secret", () => {
    const [, signatureA] = signOAuthState(PAYLOAD, SECRET).split(".");
    const [, signatureB] = signOAuthState(PAYLOAD, "another-secret").split(".");
    expect(signatureA).not.toBe(signatureB);
  });
});
