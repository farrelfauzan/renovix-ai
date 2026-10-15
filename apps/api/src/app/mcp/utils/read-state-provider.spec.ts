import { readStateProvider } from "./read-state-provider";
import { signOAuthState } from "./sign-oauth-state";

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("RX-152: readStateProvider (names the cookie; does not verify the state)", () => {
  it("reads the provider of a signed state", () => {
    const state = signOAuthState({ n: "A".repeat(43), u: "user-1", w: "workspace-1", p: "github", exp: 1 }, "secret");

    expect(readStateProvider(state)).toBe("github");
  });

  it("reads the provider of an unsigned payload too (it does not verify)", () => {
    expect(readStateProvider(encode({ p: "slack" }))).toBe("slack");
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not base64url JSON", "%%%.sig"],
    ["JSON null", encode(null)],
    ["a payload without p", encode({ u: "user-1" })],
    ["a payload whose p is not a string", encode({ p: 42 })],
  ])("gives null for a state that is %s", (_label, state) => {
    expect(readStateProvider(state)).toBeNull();
  });
});
