import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { McpService } from "./mcp.service";
import { McpUserService } from "./mcp-user.service";

// RX-110: a credential encrypted under key A and read under key B is an error, logged as one,
// never an empty credential. Both services read MCP_ENCRYPTION_KEY through one loader.
const KEY_A = randomBytes(32).toString("hex");
const KEY_B = randomBytes(32).toString("hex");
const SECRET_ENV = { NOTION_TOKEN: "rx110-marker-token" };

/** In-memory stand-in for the one credential row these tests store. */
function createCredentialStore() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    userMcpCredential: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => rows.push({ id: "cred-1", ...create }),
      findUnique: async () => rows[0] ?? null,
      findFirst: async () => rows[0] ?? null,
    },
  };
}

const withKey = <T>(key: string | undefined, build: () => T): T => {
  const saved = process.env.MCP_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.MCP_ENCRYPTION_KEY;
  else process.env.MCP_ENCRYPTION_KEY = key;
  try {
    return build();
  } finally {
    if (saved === undefined) delete process.env.MCP_ENCRYPTION_KEY;
    else process.env.MCP_ENCRYPTION_KEY = saved;
  }
};

const userService = (store: ReturnType<typeof createCredentialStore>, key: string | undefined) =>
  withKey(key, () => new McpUserService(new ConfigService({}), store as never, {} as never));

describe("MCP credentials and MCP_ENCRYPTION_KEY (RX-110)", () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("control: the same key reads the credential back", async () => {
    const store = createCredentialStore();
    await userService(store, KEY_A).connectWithToken("u1", "w1", "notion", SECRET_ENV);
    await expect(userService(store, KEY_A).resolveCredentials("u1", "w1", "notion")).resolves.toEqual(SECRET_ENV);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("McpUserService: key B on a key-A credential throws and logs an error, never returns {}", async () => {
    const store = createCredentialStore();
    await userService(store, KEY_A).connectWithToken("u1", "w1", "notion", SECRET_ENV);
    await expect(userService(store, KEY_B).resolveCredentials("u1", "w1", "notion")).rejects.toThrow(
      "MCP credential could not be decrypted",
    );
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MCP credential could not be decrypted"));
  });

  it("McpService: key B on a key-A credential throws and logs an error, never connects with {}", async () => {
    const store = createCredentialStore();
    await userService(store, KEY_A).connectWithToken("u1", "w1", "notion", SECRET_ENV);
    const connectServer = jest.fn();
    const registry = { getPackageInfo: () => ({ package: "@example/notion-mcp" }) };
    const service = withKey(KEY_B, () => new McpService(store as never, { connectServer } as never, registry as never));
    await expect(service.testConnection("u1", "cred-1")).rejects.toThrow("MCP credential could not be decrypted");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MCP credential could not be decrypted"));
    expect(connectServer).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["the old 31-character fallback", "default-dev-key-32-bytes-long!!"],
  ])("both services refuse to start when the key is %s (no fallback, no padding)", (_label, key) => {
    const store = createCredentialStore();
    expect(() => userService(store, key)).toThrow(/MCP_ENCRYPTION_KEY/);
    expect(() => withKey(key, () => new McpService(store as never, {} as never, {} as never))).toThrow(
      /MCP_ENCRYPTION_KEY/,
    );
  });

  it("never logs the decrypted credential or the key", async () => {
    const store = createCredentialStore();
    await userService(store, KEY_A).connectWithToken("u1", "w1", "notion", SECRET_ENV);
    await expect(userService(store, KEY_B).resolveCredentials("u1", "w1", "notion")).rejects.toThrow();
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain(KEY_A);
    expect(logged).not.toContain(KEY_B);
    expect(logged).not.toContain("rx110-marker-token");
  });
});
