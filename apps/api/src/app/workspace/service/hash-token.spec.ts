import { WorkspaceInviteService } from "./workspace-invite.service";

// Made-up tokens. The hashes were computed outside the code under test: printf '%s' "$TOKEN" | shasum -a 256
const TOKEN = "made-up-invite-token";
const STORED_HASH = "f41b4cbe473d68165a102b7d771aad4974b809bca20152d1d16a2c070d3d0a4d";

describe("RX-130: hashToken (workspace invite token, SHA-256 in hex)", () => {
  it.each([
    { name: "a token", token: TOKEN, expected: STORED_HASH },
    { name: "a 64-character hex token", token: "a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", expected: "808eabce95ad39ee0e58f13bba1ba861571bf729f9f99ce334f331fe0d335c03" },
    { name: "one letter in another case", token: "made-up-invite-tokeN", expected: "8e196a8ce275e561aa07a069b180041ac9c40f9df82025388d7db1b038179a70" },
    { name: "a space at the end (not trimmed)", token: "made-up-invite-token ", expected: "b8fd014e588329b0072c86131b58b6d9f2620923dcc6b01e389b1d433678e04d" },
    { name: "an empty token (hashed, not refused)", token: "", expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  ])("$name -> $expected", ({ token, expected }) => {
    const actual = new WorkspaceInviteService(undefined as never, undefined as never, undefined as never)["hashToken"](token);

    expect(actual).toBe(expected);
  });

  it.each([
    { name: "the right token", token: TOKEN, expected: true },
    { name: "a wrong token", token: "another-made-up-token", expected: false },
    { name: "one letter in another case", token: "made-up-invite-tokeN", expected: false },
    { name: "a space at the end", token: "made-up-invite-token ", expected: false },
    { name: "an empty token", token: "", expected: false },
    { name: "the stored hash itself sent as the token", token: STORED_HASH, expected: false },
  ])("$name matches the stored hash: $expected", ({ token, expected }) => {
    const actual = new WorkspaceInviteService(undefined as never, undefined as never, undefined as never)["hashToken"](token);

    expect(actual === STORED_HASH).toBe(expected);
  });
});
