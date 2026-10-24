import { rememberOfferedTools } from "./remember-offered-tools";
import { createMcpRunSession } from "./create-mcp-run-session";

describe("rememberOfferedTools (RNX-276)", () => {
  const schema = (name: string) => ({
    type: "function" as const,
    function: { name, description: "", parameters: {} },
  });

  it("adds every offered schema name to the session", () => {
    const session = createMcpRunSession();
    rememberOfferedTools(session, [schema("calculator"), schema("web_search")]);

    expect([...session.offeredToolNames].sort()).toEqual(["calculator", "web_search"]);
  });

  it("adds nothing to a session it is not given (undefined session)", () => {
    expect(() => rememberOfferedTools(undefined, [schema("calculator")])).not.toThrow();
  });

  it("keeps names already recorded (a run may build its schemas in two steps)", () => {
    const session = createMcpRunSession();
    rememberOfferedTools(session, [schema("calculator")]);
    rememberOfferedTools(session, [schema("calculator"), schema("create_document")]);

    expect([...session.offeredToolNames].sort()).toEqual(["calculator", "create_document"]);
  });
});
