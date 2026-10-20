import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { AgentMemoryService } from "./agent-memory.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";
import { testConnection } from "../../../../test/provider-model";

// RX-141: the conditions of every query of AgentMemoryService (the memory read into an agent's prompt, the
// extraction after a chat turn and the explicit "remember this" tool), written against the code before the
// queries moved into repositories. Each test leaves exactly one condition of a query to decide the result:
// the other workspace's memory differs only in the workspace, the archived one only in the status, and so on.
// Real service, test database; the model call is a stub that returns the facts a test scripts.
describe("RX-141: agent memory queries (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentMemoryService;
  let reply = "[]";
  const router = { chat: jest.fn(async () => ({ choices: [{ message: { content: reply } }] })) };
  const registry = {
    getCheapestModel: jest.fn(async () => ({ slug: "cheap" })),
    resolveConnection: jest.fn(async (slug: string) => testConnection({ slug })),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        AgentMemoryService,
        { provide: ProviderRouter, useValue: router },
        { provide: ModelRegistryService, useValue: registry },
      ],
    }));
    service = moduleRef.get(AgentMemoryService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    reply = "[]";
  });
  afterAll(() => moduleRef?.close());

  const workspaceMemory = (workspaceId: string, content: string, data: { type?: string; status?: string; confidence?: number } = {}) =>
    prisma.workspaceMemory.create({ data: { workspaceId, type: "fact", content, ...data } });
  const userMemory = (userId: string, content: string, data: { type?: string; status?: string; confidence?: number } = {}) =>
    prisma.userMemory.create({ data: { userId, type: "interest", content, ...data } });
  const line = (type: string, content: string) => `- [${type}] ${content}`;
  const wsRows = (workspaceId: string) => prisma.workspaceMemory.findMany({ where: { workspaceId }, orderBy: { content: "asc" } });
  const userRows = (userId: string) => prisma.userMemory.findMany({ where: { userId }, orderBy: { content: "asc" } });
  const facts = (...items: object[]) => {
    reply = JSON.stringify(items);
  };
  /** Alice, her workspace and an agent in it. */
  const setup = async () => {
    const alice = await createUser(prisma);
    const workspace = await createWorkspace(prisma, { ownerId: alice.id });
    const agent = await createAgent(prisma, { userId: alice.id, workspaceId: workspace.id });
    return { alice, workspace, agent };
  };
  /**
   * RNX-117 (answer 1): an agent in its user's default workspace (the factory's default), which must behave
   * exactly as an agent without a workspace did before every agent had one.
   */
  const createDefaultWorkspaceAgent = async (userId: string) => {
    const agent = await createAgent(prisma, { userId });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: agent.workspaceId } });
    expect(workspace).toMatchObject({ ownerId: userId, isDefault: true });
    return agent;
  };

  describe("getMemoryContext", () => {
    it("lists the active workspace memories of the agent's workspace, then the active memories of the user, best confidence first", async () => {
      const { alice, workspace, agent } = await setup();
      await workspaceMemory(workspace.id, "ws-low", { confidence: 0.6 });
      await workspaceMemory(workspace.id, "ws-high", { confidence: 0.9, type: "policy" });
      await userMemory(alice.id, "user-low", { confidence: 0.6 });
      await userMemory(alice.id, "user-high", { confidence: 0.9 });

      expect(await service.getMemoryContext(agent.id, alice.id)).toBe(
        [line("policy", "ws-high"), line("fact", "ws-low"), line("interest", "user-high"), line("interest", "user-low")].join("\n"),
      );
    });

    it("leaves out the memories of another workspace", async () => {
      const { alice, workspace, agent } = await setup();
      const other = await createWorkspace(prisma, { ownerId: alice.id });
      await workspaceMemory(workspace.id, "mine");
      await workspaceMemory(other.id, "theirs");

      expect(await service.getMemoryContext(agent.id, alice.id)).toBe(line("fact", "mine"));
    });

    it("leaves out archived and deleted workspace memories", async () => {
      const { alice, workspace, agent } = await setup();
      await workspaceMemory(workspace.id, "active");
      await workspaceMemory(workspace.id, "archived", { status: "archived" });
      await workspaceMemory(workspace.id, "deleted", { status: "deleted" });

      expect(await service.getMemoryContext(agent.id, alice.id)).toBe(line("fact", "active"));
    });

    it("gives 20 workspace memories at most, the best ones", async () => {
      const { alice, workspace, agent } = await setup();
      for (let i = 1; i <= 21; i++) await workspaceMemory(workspace.id, `ws-${i}`, { confidence: i / 100 });

      const lines = (await service.getMemoryContext(agent.id, alice.id)).split("\n");

      expect(lines).toHaveLength(20);
      expect(lines[0]).toBe(line("fact", "ws-21"));
      expect(lines).not.toContain(line("fact", "ws-1"));
    });

    it("leaves out the memories of another user and the archived and deleted ones of the user", async () => {
      const { alice, agent } = await setup();
      const bob = await createUser(prisma);
      await userMemory(alice.id, "mine");
      await userMemory(alice.id, "archived", { status: "archived" });
      await userMemory(alice.id, "deleted", { status: "deleted" });
      await userMemory(bob.id, "bobs");

      expect(await service.getMemoryContext(agent.id, alice.id)).toBe(line("interest", "mine"));
    });

    it("gives 10 user memories at most, the best ones", async () => {
      const { alice, agent } = await setup();
      for (let i = 1; i <= 11; i++) await userMemory(alice.id, `user-${i}`, { confidence: i / 100 });

      const lines = (await service.getMemoryContext(agent.id, alice.id)).split("\n");

      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe(line("interest", "user-11"));
      expect(lines).not.toContain(line("interest", "user-1"));
    });

    it("gives no workspace memory for an agent in its default workspace (as without a workspace) or an unknown agent, and still the user's", async () => {
      const { alice, workspace } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);
      await workspaceMemory(workspace.id, "ws");
      await workspaceMemory(solo.workspaceId, "default-ws");
      await userMemory(alice.id, "mine");

      expect(await service.getMemoryContext(solo.id, alice.id)).toBe(line("interest", "mine"));
      expect(await service.getMemoryContext("00000000-0000-0000-0000-000000000000", alice.id)).toBe(line("interest", "mine"));
    });

    it("uses the workspace of the agent it is asked about, not of another agent of the same user", async () => {
      const { alice, workspace, agent } = await setup();
      const other = await createWorkspace(prisma, { ownerId: alice.id });
      const otherAgent = await createAgent(prisma, { userId: alice.id, workspaceId: other.id });
      await workspaceMemory(workspace.id, "first");
      await workspaceMemory(other.id, "second");

      expect(await service.getMemoryContext(agent.id, alice.id)).toBe(line("fact", "first"));
      expect(await service.getMemoryContext(otherAgent.id, alice.id)).toBe(line("fact", "second"));
    });
  });

  describe("getWorkspaceMemoryContext", () => {
    it("lists the active memories of the agent's workspace, best confidence first, 20 at most", async () => {
      const { workspace, agent } = await setup();
      for (let i = 1; i <= 21; i++) await workspaceMemory(workspace.id, `ws-${i}`, { confidence: i / 100 });

      const lines = (await service.getWorkspaceMemoryContext(agent.id)).split("\n");

      expect(lines).toHaveLength(20);
      expect(lines[0]).toBe(line("fact", "ws-21"));
      expect(lines).not.toContain(line("fact", "ws-1"));
    });

    it("leaves out the memories of another workspace and the archived and deleted ones", async () => {
      const { alice, workspace, agent } = await setup();
      const other = await createWorkspace(prisma, { ownerId: alice.id });
      await workspaceMemory(workspace.id, "mine");
      await workspaceMemory(workspace.id, "archived", { status: "archived" });
      await workspaceMemory(workspace.id, "deleted", { status: "deleted" });
      await workspaceMemory(other.id, "theirs");

      expect(await service.getWorkspaceMemoryContext(agent.id)).toBe(line("fact", "mine"));
    });

    it("is empty for an agent in its default workspace (as without a workspace), an unknown agent and a workspace without memories", async () => {
      const { alice, workspace, agent } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);
      await workspaceMemory(workspace.id, "ws", { status: "archived" });
      await workspaceMemory(solo.workspaceId, "default-ws");
      await userMemory(alice.id, "mine");

      expect(await service.getWorkspaceMemoryContext(solo.id)).toBe("");
      expect(await service.getWorkspaceMemoryContext("00000000-0000-0000-0000-000000000000")).toBe("");
      expect(await service.getWorkspaceMemoryContext(agent.id)).toBe("");
    });
  });

  describe("extractAndStore", () => {
    const run = (agentId: string, userId: string, channelId?: string) =>
      service.extractAndStore(agentId, userId, "I like Rust", "Noted", channelId);

    it("stores a new fact as a workspace memory of the agent's workspace, with the run and the user recorded", async () => {
      const { alice, workspace, agent } = await setup();
      facts({ type: "interest", content: "Likes Rust", confidence: 0.8 });

      await run(agent.id, alice.id);

      const rows = await wsRows(workspace.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "interest", content: "Likes Rust", confidence: 0.8, sourceRunId: `agent:${agent.id}`, createdById: alice.id, status: "active" });
      expect(await userRows(alice.id)).toHaveLength(0);
    });

    it("stores the workspace of the channel in preference to the agent's, and falls back to the agent's for an unknown channel", async () => {
      const { alice, workspace, agent } = await setup();
      const channel = await prisma.channel.create({ data: { userId: alice.id, name: "c" } });
      const channelWorkspace = await createWorkspace(prisma, { ownerId: alice.id, channelId: channel.id });
      facts({ type: "interest", content: "Likes Rust" });

      await run(agent.id, alice.id, channel.id);
      await run(agent.id, alice.id, "00000000-0000-0000-0000-000000000000");

      expect(await wsRows(channelWorkspace.id)).toHaveLength(1);
      expect(await wsRows(workspace.id)).toHaveLength(1);
    });

    it("uses the default confidence 0.75 when the fact has none, skips a fact without text, and looks at 3 facts at most", async () => {
      const { alice, workspace, agent } = await setup();
      facts(
        { type: "interest", content: "one" },
        { type: "interest" },
        { type: "interest", content: "two", confidence: 0.9 },
        { type: "interest", content: "dropped by the limit of 3" },
      );

      await run(agent.id, alice.id);

      const rows = await wsRows(workspace.id);
      expect(rows.map((r) => r.content)).toEqual(["one", "two"]);
      expect(rows.find((r) => r.content === "one")!.confidence).toBe(0.75);
    });

    it("raises the confidence of an active workspace memory with the same text by 0.1 (at most 1) instead of storing a new one", async () => {
      const { alice, workspace, agent } = await setup();
      const half = await workspaceMemory(workspace.id, "Likes Rust", { confidence: 0.5 });
      const full = await workspaceMemory(workspace.id, "Prefers short answers", { confidence: 0.95 });
      facts({ type: "interest", content: "Likes Rust" }, { type: "preference", content: "Prefers short answers" });

      await run(agent.id, alice.id);

      expect(await wsRows(workspace.id)).toHaveLength(2);
      expect((await prisma.workspaceMemory.findUniqueOrThrow({ where: { id: half.id } })).confidence).toBeCloseTo(0.6);
      expect((await prisma.workspaceMemory.findUniqueOrThrow({ where: { id: full.id } })).confidence).toBe(1);
    });

    it("matches on the first 50 characters of the text", async () => {
      const { alice, workspace, agent } = await setup();
      const long = "x".repeat(50);
      const existing = await workspaceMemory(workspace.id, `${long} first ending`, { confidence: 0.5 });
      facts({ type: "interest", content: `${long} other ending` });

      await run(agent.id, alice.id);

      expect(await wsRows(workspace.id)).toHaveLength(1);
      expect((await prisma.workspaceMemory.findUniqueOrThrow({ where: { id: existing.id } })).confidence).toBeCloseTo(0.6);
    });

    it("does not match a workspace memory of another workspace: stores a new one and leaves the other as it was", async () => {
      const { alice, workspace, agent } = await setup();
      const other = await createWorkspace(prisma, { ownerId: alice.id });
      const theirs = await workspaceMemory(other.id, "Likes Rust", { confidence: 0.5 });
      facts({ type: "interest", content: "Likes Rust" });

      await run(agent.id, alice.id);

      expect(await wsRows(workspace.id)).toHaveLength(1);
      expect((await prisma.workspaceMemory.findUniqueOrThrow({ where: { id: theirs.id } })).confidence).toBe(0.5);
    });

    it("does not match an archived or a deleted workspace memory: stores a new one and leaves them as they were", async () => {
      const { alice, workspace, agent } = await setup();
      const archived = await workspaceMemory(workspace.id, "Likes Rust", { confidence: 0.5, status: "archived" });
      const deleted = await workspaceMemory(workspace.id, "Likes Rust", { confidence: 0.5, status: "deleted" });
      facts({ type: "interest", content: "Likes Rust" });

      await run(agent.id, alice.id);

      const rows = await wsRows(workspace.id);
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.id === archived.id)).toMatchObject({ confidence: 0.5, status: "archived" });
      expect(rows.find((r) => r.id === deleted.id)).toMatchObject({ confidence: 0.5, status: "deleted" });
    });

    it("in the default workspace (as without a workspace) stores a user memory with the agent as its source, no workspace memory", async () => {
      const { alice } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);
      facts({ type: "interest", content: "Likes Rust", confidence: 0.8 });

      await run(solo.id, alice.id);

      const rows = await userRows(alice.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "interest", content: "Likes Rust", confidence: 0.8, sourceConversationId: `agent:${solo.id}`, status: "active" });
      expect(await prisma.workspaceMemory.count()).toBe(0);
    });

    it("in the default workspace (as without a workspace) raises an active user memory with the same text by 0.1 instead of storing a new one", async () => {
      const { alice } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);
      const existing = await userMemory(alice.id, "Likes Rust", { confidence: 0.5 });
      facts({ type: "interest", content: "Likes Rust" });

      await run(solo.id, alice.id);

      expect(await userRows(alice.id)).toHaveLength(1);
      expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: existing.id } })).confidence).toBeCloseTo(0.6);
    });

    it("in the default workspace (as without a workspace) does not match an active memory of this user with other text: stores a new one", async () => {
      const { alice } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);
      const other = await userMemory(alice.id, "Likes hiking", { confidence: 0.5 });
      facts({ type: "interest", content: "Likes Rust" });

      await run(solo.id, alice.id);

      expect(await userRows(alice.id)).toHaveLength(2);
      expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: other.id } })).confidence).toBe(0.5);
    });

    it("in the default workspace (as without a workspace) does not match the memory of another user or an archived or deleted one", async () => {
      const { alice } = await setup();
      const bob = await createUser(prisma);
      const solo = await createDefaultWorkspaceAgent(alice.id);
      const foreign = await userMemory(bob.id, "Likes Rust", { confidence: 0.5 });
      const archived = await userMemory(alice.id, "Likes Rust", { confidence: 0.5, status: "archived" });
      const deleted = await userMemory(alice.id, "Likes Rust", { confidence: 0.5, status: "deleted" });
      facts({ type: "interest", content: "Likes Rust" });

      await run(solo.id, alice.id);

      expect(await userRows(alice.id)).toHaveLength(3);
      for (const memory of [foreign, archived, deleted]) {
        expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: memory.id } })).confidence).toBe(0.5);
      }
    });

    it("stores nothing when the model returns no facts", async () => {
      const { alice, workspace, agent } = await setup();

      await run(agent.id, alice.id);

      expect(await wsRows(workspace.id)).toHaveLength(0);
      expect(await userRows(alice.id)).toHaveLength(0);
    });
  });

  describe("storeExplicit", () => {
    it("stores a workspace memory with confidence 1 in the agent's workspace", async () => {
      const { alice, workspace, agent } = await setup();

      await service.storeExplicit(agent.id, alice.id, "Office closes at 5", "policy");

      const rows = await wsRows(workspace.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "policy", content: "Office closes at 5", confidence: 1, sourceRunId: `agent:${agent.id}`, createdById: alice.id, status: "active" });
      expect(await userRows(alice.id)).toHaveLength(0);
    });

    it("prefers the workspace of the channel, and falls back to the agent's for an unknown channel", async () => {
      const { alice, workspace, agent } = await setup();
      const channel = await prisma.channel.create({ data: { userId: alice.id, name: "c" } });
      const channelWorkspace = await createWorkspace(prisma, { ownerId: alice.id, channelId: channel.id });

      await service.storeExplicit(agent.id, alice.id, "from channel", "fact", channel.id);
      await service.storeExplicit(agent.id, alice.id, "from agent", "fact", "00000000-0000-0000-0000-000000000000");

      expect((await wsRows(channelWorkspace.id)).map((r) => r.content)).toEqual(["from channel"]);
      expect((await wsRows(workspace.id)).map((r) => r.content)).toEqual(["from agent"]);
    });

    it("in the default workspace (as without a workspace) stores a user memory with confidence 1 and the agent as its source, no workspace memory", async () => {
      const { alice } = await setup();
      const solo = await createDefaultWorkspaceAgent(alice.id);

      await service.storeExplicit(solo.id, alice.id, "Likes Rust", "interest");

      const rows = await userRows(alice.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "interest", content: "Likes Rust", confidence: 1, sourceConversationId: `agent:${solo.id}`, status: "active" });
      expect(await prisma.workspaceMemory.count()).toBe(0);
    });
  });
});
