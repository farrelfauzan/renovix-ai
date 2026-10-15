import { createHmac } from "node:crypto";
import { signOAuthState } from "./sign-oauth-state";
import { verifyOAuthState } from "./verify-oauth-state";

const SECRET = "rx151-unit-secret";
const NOW = 1_900_000_000;
const PAYLOAD = { n: "A".repeat(43), u: "user-1", w: "workspace-1", p: "google-gmail", exp: NOW + 600 };

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const signRaw = (encodedPayload: string, secret: string = SECRET): string =>
  `${encodedPayload}.${createHmac("sha256", secret).update(encodedPayload).digest("base64url")}`;

describe("verifyOAuthState (RX-151)", () => {
  it("control: returns the payload of a state it signed, before expiry", () => {
    expect(verifyOAuthState(signOAuthState(PAYLOAD, SECRET), SECRET, NOW)).toEqual(PAYLOAD);
  });

  it("refuses the old unsigned format", () => {
    expect(verifyOAuthState(encode({ userId: "user-1", workspaceId: "workspace-1", provider: "github" }), SECRET, NOW)).toBeNull();
  });

  it.each([
    ["user id", { u: "user-2" }],
    ["workspace id", { w: "workspace-2" }],
    ["provider", { p: "github" }],
    ["one-time value", { n: "B".repeat(43) }],
    ["expiry", { exp: NOW + 6000 }],
  ])("refuses a payload whose %s was changed after signing", (_label, change) => {
    const [, signature] = signOAuthState(PAYLOAD, SECRET).split(".");
    expect(verifyOAuthState(`${encode({ ...PAYLOAD, ...change })}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("refuses a state signed with another secret", () => {
    expect(verifyOAuthState(signOAuthState(PAYLOAD, "another-secret"), SECRET, NOW)).toBeNull();
  });

  it.each([
    ["an empty signature", (s: string) => `${s.split(".")[0]}.`],
    ["a shorter signature", (s: string) => s.slice(0, -1)],
    ["an extra part", (s: string) => `${s}.x`],
    ["an empty string", () => ""],
  ])("refuses %s", (_label, change) => {
    expect(verifyOAuthState(change(signOAuthState(PAYLOAD, SECRET)), SECRET, NOW)).toBeNull();
  });

  it("refuses a state at and after its expiry", () => {
    const state = signOAuthState(PAYLOAD, SECRET);
    expect(verifyOAuthState(state, SECRET, PAYLOAD.exp)).toBeNull();
    expect(verifyOAuthState(state, SECRET, PAYLOAD.exp + 1)).toBeNull();
  });

  it.each([
    ["a missing field", { n: PAYLOAD.n, u: "user-1", w: "workspace-1", exp: PAYLOAD.exp }],
    ["an extra field", { ...PAYLOAD, userId: "user-2" }],
    ["a malformed one-time value", { ...PAYLOAD, n: "short" }],
    ["a non-integer expiry", { ...PAYLOAD, exp: "2000000000" }],
  ])("refuses a correctly signed payload with %s", (_label, payload) => {
    expect(verifyOAuthState(signRaw(encode(payload)), SECRET, NOW)).toBeNull();
  });
});
