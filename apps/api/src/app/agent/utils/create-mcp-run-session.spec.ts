import { createMcpRunSession } from "./create-mcp-run-session";

describe("createMcpRunSession (RNX-217)", () => {
  it("returns an empty session", () => {
    const actualSession = createMcpRunSession();

    expect([actualSession.connections, [...actualSession.toolConnections]]).toEqual([[], []]);
  });

  it("returns a new session on every call, never a shared one", () => {
    const first = createMcpRunSession();
    const second = createMcpRunSession();

    expect(first).not.toBe(second);
    expect(first.connections).not.toBe(second.connections);
    expect(first.toolConnections).not.toBe(second.toolConnections);
  });
});
