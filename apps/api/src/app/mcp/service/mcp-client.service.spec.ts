import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpClientService, McpServerConfig } from "./mcp-client.service";
import type { McpConnection } from "../types/mcp-connection";

// RNX-217: McpClientService keeps no connection; each connect() is a new client and a new process, closed only by
// its own close(). Real stdio connections to the local stub server (apps/api/test/mcp-stub-server.mjs).
const STUB_SERVER = resolve(__dirname, "../../../../test/mcp-stub-server.mjs");

type StubRecord = { owner: string; pid: number; event: string; caller?: string };

describe("McpClientService (RNX-217, local stub MCP server)", () => {
  const service = new McpClientService();
  let dir: string;
  let opened: McpConnection[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rnx217-client-"));
    opened = [];
  });

  afterEach(async () => {
    await Promise.allSettled(opened.map((connection) => service.close(connection)));
    rmSync(dir, { recursive: true, force: true });
  });

  const stubConfig = (): McpServerConfig => ({
    id: "github-user-1",
    name: "github",
    transport: "stdio",
    command: process.execPath,
    args: [STUB_SERVER],
    env: { MCP_STUB_OWNER: "user-1", MCP_STUB_RECORD_FILE: join(dir, "user-1.jsonl") },
  });

  const records = (): StubRecord[] =>
    readFileSync(join(dir, "user-1.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));

  const connect = async (): Promise<McpConnection> => {
    const connection = await service.connect(stubConfig());
    opened.push(connection);
    return connection;
  };

  it("opens a new connection (a new process) on every connect, also for the same server id", async () => {
    const first = await connect();
    const second = await connect();

    expect(first.client).not.toBe(second.client);
    const pids = records().filter((r) => r.event === "started").map((r) => r.pid);
    expect(new Set(pids).size).toBe(2);
  });

  it("closing one connection leaves the other with the same server id open: its next call is answered", async () => {
    const first = await connect();
    const second = await connect();

    await service.close(first);
    const result = await second.client.callTool({ name: "whoami", arguments: { caller: "second" } });

    expect(result.content).toEqual([{ type: "text", text: "answered by user-1" }]);
    expect(records().filter((r) => r.event === "call").map((r) => r.caller)).toEqual(["second"]);
  });

  it("close removes the connection's credential dir, also when closing the client fails", async () => {
    const credentialDir = mkdtempSync(join(dir, "cred-"));
    const failing = {
      serverId: "google-gmail-user-1",
      client: { close: async () => Promise.reject(new Error("close failed")) },
      credentialDir,
    } as unknown as McpConnection;

    await expect(service.close(failing)).rejects.toThrow("close failed");

    expect(existsSync(credentialDir)).toBe(false);
  });
});
