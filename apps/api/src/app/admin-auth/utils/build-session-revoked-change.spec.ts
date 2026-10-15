import { buildSessionRevokedChange } from "./build-session-revoked-change";

describe("buildSessionRevokedChange", () => {
  it("the session id with revoked false before and true after, and nothing else", () => {
    expect(buildSessionRevokedChange("s-1")).toEqual({
      before: { sessionId: "s-1", revoked: false },
      after: { sessionId: "s-1", revoked: true },
    });
  });
});
