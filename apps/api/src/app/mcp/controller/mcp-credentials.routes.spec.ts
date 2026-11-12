import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { McpController } from "./mcp.controller";
import { McpUserController } from "./mcp-user.controller";
import { McpService } from "../service/mcp.service";
import { McpUserService } from "../service/mcp-user.service";
import { McpClientService } from "../service/mcp-client.service";
import { McpRegistryService } from "../service/mcp-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-140 (tests first): the MCP credential routes, written against the services before their queries move
// into repositories, so the same tests pin the behaviour after the move. Connect, list, disconnect, use (the
// connection test) and delete; another user's credential is never read, used or deleted, with the status
// these routes answer today; a credential is stored as iv:tag:data (AES-256-GCM, hex) of its env JSON and
// listed without it; no planted secret reaches a log line or a response. Real services, test database; the
// MCP client is a stub (no package is started, no third party is called).
// RNX-292 (D312): a credential is the account's (one per user and provider) and is used in a workspace where a
// workspace_mcp_connections row switches it on; a seeded credential is switched on in the workspace it names.
const PROVIDER = "notion";
const OWNER_SECRET = "rnx140-marker-owner-notion-token";
const MEMBER_SECRET = "rnx140-marker-member-notion-token";
const OTHER_KEY_SECRET = "rnx140-marker-other-key-token";
const STORED_FORM = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;
const NOTION_PACKAGE = "@modelcontextprotocol/server-notion";

type Actor = { id: string; email: string };

/** The key the API encrypts credentials with in tests (setup-env.ts). */
const testKey = (): Buffer => Buffer.from(process.env.MCP_ENCRYPTION_KEY as string, "hex");

/** Reads a stored credential as AES-256-GCM `iv:tag:data` (hex) under `key`. */
const decryptStored = (stored: string, key: Buffer = testKey()): unknown => {
  const [iv, tag, data] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(decipher.update(data, "hex", "utf8") + decipher.final("utf8"));
};

/** Encrypts an env the way the services store it, under `key`. */
const encryptStored = (env: Record<string, string>, key: Buffer = testKey()): string => {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = cipher.update(JSON.stringify(env), "utf8", "hex") + cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data}`;
};

describe("RNX-140: MCP credential routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let owner: Actor;
  let member: Actor;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let logLines: string[];
  let responseBodies: string[];
  const mcpClient = {
    connect: jest.fn(),
    close: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [McpController, McpUserController],
      providers: [
        McpService,
        McpUserService,
        McpRegistryService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService({}) },
        { provide: McpClientService, useValue: mcpClient },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    mcpClient.connect.mockImplementation(async (config: { id: string }) => ({
      serverId: config.id,
      client: { listTools: async () => ({ tools: [{ name: "notion_search", inputSchema: {} }] }) },
      credentialDir: null,
    }));
    owner = await createUser(prisma);
    member = await createUser(prisma);
    workspaceId = (await createWorkspace(prisma, { ownerId: owner.id })).id;
    otherWorkspaceId = (await createWorkspace(prisma, { ownerId: owner.id })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: member.id, role: "member", status: "active", joinedAt: new Date() },
        { workspaceId: otherWorkspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
      ],
    });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, so `member` may use the workspace.
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    logLines = [];
    responseBodies = [];
    const record = (...args: unknown[]): void => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    };
    for (const level of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => record(...args));
    }
    for (const level of ["log", "error", "warn", "info", "debug"] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => record(...args));
    }
  });

  // No planted secret reaches a log line or a response body, in any test of this file.
  afterEach(() => {
    const secrets = [OWNER_SECRET, MEMBER_SECRET, OTHER_KEY_SECRET];
    const leaked = secrets.filter((secret) => [...logLines, ...responseBodies].some((line) => line.includes(secret)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => app?.close());

  const send = async (actor: Actor, method: "GET" | "POST" | "DELETE", url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: asSessionUser(actor), payload });
    responseBodies.push(res.body);
    return res;
  };

  const connect = (actor: Actor, env: Record<string, string>, wsId: string = workspaceId, provider: string = PROVIDER) =>
    send(actor, "POST", "/mcp/user/connect", { provider, workspaceId: wsId, env });

  const seedCredential = (actor: Actor, data: { provider?: string; workspaceId?: string; status?: string; connectedAt?: Date; envEncrypted?: string } = {}) =>
    prisma.userMcpCredential.create({
      data: {
        userId: actor.id,
        provider: data.provider ?? PROVIDER,
        envEncrypted: data.envEncrypted ?? encryptStored({ NOTION_TOKEN: actor.id === owner.id ? OWNER_SECRET : MEMBER_SECRET }),
        status: data.status ?? "connected",
        connectedAt: data.connectedAt,
        workspaceConnections: { create: { workspaceId: data.workspaceId ?? workspaceId } },
      },
    });

  const rows = () => prisma.userMcpCredential.findMany({ orderBy: { id: "asc" } });

  /** RNX-292: the workspace switches, as (credential, workspace) pairs. */
  const switches = async () =>
    (await prisma.workspaceMcpConnection.findMany()).map((c) => ({ credentialId: c.credentialId, workspaceId: c.workspaceId })).sort((a, b) => (a.credentialId + a.workspaceId).localeCompare(b.credentialId + b.workspaceId));

  describe("connect: POST /mcp/user/connect", () => {
    it("stores the env encrypted as iv:tag:data for the caller and provider, switched on in the workspace, and answers { connected, provider }", async () => {
      const res = await connect(owner, { NOTION_TOKEN: OWNER_SECRET });

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 201, body: { connected: true, provider: PROVIDER } });
      const [row, ...others] = await rows();
      expect(others).toEqual([]);
      expect(row).toMatchObject({ userId: owner.id, provider: PROVIDER, status: "connected", expiresAt: null });
      expect(await switches()).toEqual([{ credentialId: row.id, workspaceId }]);
      expect(row.envEncrypted).toMatch(STORED_FORM);
      expect(row.envEncrypted).not.toContain(OWNER_SECRET);
      expect(decryptStored(row.envEncrypted)).toEqual({ NOTION_TOKEN: OWNER_SECRET });
    });

    it("connecting the same provider again replaces the env in the same row: status connected, connectedAt now", async () => {
      const old = await seedCredential(owner, { status: "expired", connectedAt: new Date("2026-01-01T00:00:00Z"), envEncrypted: encryptStored({ NOTION_TOKEN: "rnx140-old" }) });

      const res = await connect(owner, { NOTION_TOKEN: OWNER_SECRET });

      expect(res.statusCode).toBe(201);
      const [row, ...others] = await rows();
      expect(others).toEqual([]);
      expect(row).toMatchObject({ id: old.id, status: "connected" });
      expect(row.connectedAt.getTime()).toBeGreaterThan(old.connectedAt.getTime());
      expect(decryptStored(row.envEncrypted)).toEqual({ NOTION_TOKEN: OWNER_SECRET });
    });

    it("another user's credential for the same provider and workspace is left as it was", async () => {
      const ownerRow = await seedCredential(owner);

      const res = await connect(member, { NOTION_TOKEN: MEMBER_SECRET });

      expect(res.statusCode).toBe(201);
      const after = await rows();
      expect(after).toHaveLength(2);
      expect(after.find((row) => row.id === ownerRow.id)).toEqual(ownerRow);
      const memberRow = after.find((row) => row.userId === member.id);
      expect(decryptStored(memberRow!.envEncrypted)).toEqual({ NOTION_TOKEN: MEMBER_SECRET });
    });
  });

  describe("list: GET /mcp/user/credentials and GET /mcp/servers", () => {
    it("GET /mcp/user/credentials lists only the caller's credentials of that workspace, newest first, without the env", async () => {
      const notion = await seedCredential(owner, { connectedAt: new Date("2026-01-01T00:00:00Z") });
      const github = await seedCredential(owner, { provider: "github", status: "expired", connectedAt: new Date("2026-02-01T00:00:00Z") });
      await seedCredential(owner, { workspaceId: otherWorkspaceId, provider: "slack" });
      await seedCredential(member, { provider: "linear" });

      const res = await send(owner, "GET", `/mcp/user/credentials?workspaceId=${workspaceId}`);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: github.id, provider: "github", status: "expired", connectedAt: github.connectedAt.toISOString(), expiresAt: null },
        { id: notion.id, provider: PROVIDER, status: "connected", connectedAt: notion.connectedAt.toISOString(), expiresAt: null },
      ]);
    });

    it("another user's credentials are not read: the member lists only their own", async () => {
      await seedCredential(owner);
      const own = await seedCredential(member, { provider: "linear" });

      const res = await send(member, "GET", `/mcp/user/credentials?workspaceId=${workspaceId}`);

      expect(res.json().map((c: { id: string }) => c.id)).toEqual([own.id]);
    });

    it("GET /mcp/servers lists the caller's account credentials that the registry knows, newest first", async () => {
      const notion = await seedCredential(owner, { connectedAt: new Date("2026-01-01T00:00:00Z") });
      const slack = await seedCredential(owner, { workspaceId: otherWorkspaceId, provider: "slack", status: "expired", connectedAt: new Date("2026-03-01T00:00:00Z") });
      await seedCredential(owner, { provider: "rnx140-unknown-provider", connectedAt: new Date("2026-04-01T00:00:00Z") });
      await seedCredential(member, { provider: "github" });

      const res = await send(owner, "GET", "/mcp/servers");

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: slack.id, name: "slack", displayName: "Slack", transport: "stdio", status: "expired", isGlobal: false, createdAt: slack.connectedAt.toISOString() },
        { id: notion.id, name: PROVIDER, displayName: "Notion", transport: "stdio", status: "connected", isGlobal: false, createdAt: notion.connectedAt.toISOString() },
      ]);
    });

    it("another user's credentials are not read: GET /mcp/servers of the member shows none of the owner's", async () => {
      await seedCredential(owner);

      const res = await send(member, "GET", "/mcp/servers");

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: [] });
    });
  });

  describe("use: POST /mcp/servers/:id/test", () => {
    it("connects with the caller's decrypted env, lists the tools, closes, and marks the credential connected", async () => {
      const cred = await seedCredential(owner, { status: "expired" });

      const res = await send(owner, "POST", `/mcp/servers/${cred.id}/test`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 201, body: { status: "connected", toolCount: 1, tools: ["notion_search"] } });
      expect(mcpClient.connect).toHaveBeenCalledTimes(1);
      expect(mcpClient.connect).toHaveBeenCalledWith({
        id: `test-${cred.id}`,
        name: PROVIDER,
        transport: "stdio",
        command: "npx",
        args: ["-y", NOTION_PACKAGE],
        env: { NOTION_TOKEN: OWNER_SECRET },
      });
      expect(mcpClient.close).toHaveBeenCalledTimes(1);
      expect((await prisma.userMcpCredential.findUniqueOrThrow({ where: { id: cred.id } })).status).toBe("connected");
    });

    it("error path: a failing connection answers the error and marks the credential expired", async () => {
      const cred = await seedCredential(owner);
      mcpClient.connect.mockRejectedValue(new Error("rnx140 stub connect failed"));

      const res = await send(owner, "POST", `/mcp/servers/${cred.id}/test`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 201, body: { status: "error", error: "rnx140 stub connect failed" } });
      expect((await prisma.userMcpCredential.findUniqueOrThrow({ where: { id: cred.id } })).status).toBe("expired");
    });

    it("a provider the registry does not know: an error answer, nothing connected or changed", async () => {
      const cred = await seedCredential(owner, { provider: "rnx140-unknown-provider" });

      const res = await send(owner, "POST", `/mcp/servers/${cred.id}/test`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 201, body: { status: "error", error: "Unknown provider: rnx140-unknown-provider" } });
      expect(mcpClient.connect).not.toHaveBeenCalled();
      expect(await rows()).toEqual([cred]);
    });

    it("error path: a credential encrypted under another key is a 500, logged without the env, nothing connected", async () => {
      const cred = await seedCredential(owner, { envEncrypted: encryptStored({ NOTION_TOKEN: OTHER_KEY_SECRET }, randomBytes(32)) });

      const res = await send(owner, "POST", `/mcp/servers/${cred.id}/test`);

      expect(res.statusCode).toBe(500);
      expect(mcpClient.connect).not.toHaveBeenCalled();
      expect(logLines.some((line) => line.includes("MCP credential could not be decrypted"))).toBe(true);
      expect(await rows()).toEqual([cred]);
    });

    it("another user's credential is not used: 404, nothing connected, the row unchanged", async () => {
      const cred = await seedCredential(owner, { status: "expired" });

      const res = await send(member, "POST", `/mcp/servers/${cred.id}/test`);

      expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "MCP credential not found" });
      expect(mcpClient.connect).not.toHaveBeenCalled();
      expect(await rows()).toEqual([cred]);
    });
  });

  describe("disconnect: DELETE /mcp/user/credentials/:provider and DELETE /mcp/servers/:id", () => {
    it("RNX-292: DELETE /mcp/user/credentials/:provider?workspaceId switches only the caller's connection off in that workspace; the credential stays", async () => {
      const ownerCred = await seedCredential(owner);
      await prisma.workspaceMcpConnection.create({ data: { workspaceId: otherWorkspaceId, credentialId: ownerCred.id } });
      const memberCred = await seedCredential(member);

      const res = await send(owner, "DELETE", `/mcp/user/credentials/${PROVIDER}?workspaceId=${workspaceId}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: { disconnected: true, provider: PROVIDER } });
      expect((await rows()).map((row) => row.id).sort()).toEqual([ownerCred.id, memberCred.id].sort());
      expect(await switches()).toEqual(
        [{ credentialId: ownerCred.id, workspaceId: otherWorkspaceId }, { credentialId: memberCred.id, workspaceId }].sort((a, b) =>
          (a.credentialId + a.workspaceId).localeCompare(b.credentialId + b.workspaceId),
        ),
      );
    });

    it("another user's credential is not deleted: the member gets 404 Credential not found, the owner's row stays", async () => {
      const cred = await seedCredential(owner);

      const res = await send(member, "DELETE", `/mcp/user/credentials/${PROVIDER}?workspaceId=${workspaceId}`);

      expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "Credential not found" });
      expect(await rows()).toEqual([cred]);
    });

    it("DELETE /mcp/servers/:id removes the caller's credential and (RNX-292) its workspace switches", async () => {
      const cred = await seedCredential(owner, { workspaceId: otherWorkspaceId });
      await prisma.workspaceMcpConnection.create({ data: { workspaceId, credentialId: cred.id } });
      const kept = await seedCredential(owner, { provider: "github" });

      const res = await send(owner, "DELETE", `/mcp/servers/${cred.id}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: { deleted: true } });
      expect(await rows()).toEqual([kept]);
      expect(await switches()).toEqual([{ credentialId: kept.id, workspaceId }]);
    });

    it("another user's credential is not deleted: DELETE /mcp/servers/:id by the member is 404, the row stays", async () => {
      const cred = await seedCredential(owner);

      const res = await send(member, "DELETE", `/mcp/servers/${cred.id}`);

      expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "MCP credential not found" });
      expect(await rows()).toEqual([cred]);
    });

    it("an unknown id: DELETE /mcp/servers/:id is 404", async () => {
      const res = await send(owner, "DELETE", "/mcp/servers/00000000-0000-4000-8000-000000000000");

      expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "MCP credential not found" });
    });
  });
});
