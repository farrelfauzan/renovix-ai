import { randomUUID } from "node:crypto";
import { ChatEngineContextService } from "./chat-engine-context.service";
import type { ChatContextRequest } from "../types/chat-context-request";

// RNX-281 AC4: the context holds only what the runner may read. Test doubles for the memory, knowledge and base lookups.

function setup(options: { searchable?: Record<string, boolean>; bases?: Record<string, { id: string; userId: string; workspaceId: string | null }> } = {}) {
  const memory = { getMemoryContext: jest.fn().mockResolvedValue(`memory-${randomUUID()}`) };
  const bases = options.bases ?? {};
  const knowledgeBases = { findKnowledgeBaseById: jest.fn(async (id: string) => bases[id] ?? null) };
  const workspaceKnowledge = {
    canSearchKnowledgeBase: jest.fn(async (_userId: string, base: { id: string }) => options.searchable?.[base.id] ?? false),
    searchKnowledgeBase: jest.fn(async (id: string) => [{ content: `workspace-chunk-${id}` }]),
  };
  const knowledge = { searchChunks: jest.fn(async (_userId: string, _query: string, search: { knowledgeBaseId: string }) => [{ content: `personal-chunk-${search.knowledgeBaseId}` }]) };
  const service = new ChatEngineContextService(memory as never, knowledgeBases as never, workspaceKnowledge as never, knowledge as never);
  return { service, memory, knowledgeBases, workspaceKnowledge, knowledge };
}

function contextRequest(overrides: Partial<ChatContextRequest> = {}): ChatContextRequest {
  return { agentId: randomUUID(), runnerUserId: randomUUID(), scope: "inside", knowledgeBaseIds: [], query: `query-${randomUUID()}`, offeredTools: [], ...overrides };
}

describe("ChatEngineContextService", () => {
  it("reads memory for the runner and the run's scope, and returns the offered tools", async () => {
    const t = setup();
    const request = contextRequest({ scope: "outside", offeredTools: [{ name: `tool-${randomUUID()}`, description: "" }] });
    const context = await t.service.buildContext(request);
    expect(t.memory.getMemoryContext).toHaveBeenCalledWith(request.agentId, request.runnerUserId, "outside");
    expect(context.scope).toBe("outside");
    expect(context.offeredTools).toEqual(request.offeredTools);
  });

  it("uses a base the runner may search (personal and workspace) and nothing from one they may not or one that does not exist", async () => {
    const personal = { id: randomUUID(), userId: randomUUID(), workspaceId: null };
    const shared = { id: randomUUID(), userId: randomUUID(), workspaceId: randomUUID() };
    const forbidden = { id: randomUUID(), userId: randomUUID(), workspaceId: randomUUID() };
    const missing = randomUUID();
    const t = setup({
      bases: { [personal.id]: personal, [shared.id]: shared, [forbidden.id]: forbidden },
      searchable: { [personal.id]: true, [shared.id]: true, [forbidden.id]: false },
    });
    const request = contextRequest({ knowledgeBaseIds: [personal.id, shared.id, forbidden.id, missing] });
    const context = await t.service.buildContext(request);
    expect(context.knowledge).toContain(`personal-chunk-${personal.id}`);
    expect(context.knowledge).toContain(`workspace-chunk-${shared.id}`);
    expect(context.knowledge).not.toContain(forbidden.id);
    expect(t.workspaceKnowledge.searchKnowledgeBase).not.toHaveBeenCalledWith(forbidden.id, expect.anything(), expect.anything());
    expect(t.workspaceKnowledge.canSearchKnowledgeBase).toHaveBeenCalledWith(request.runnerUserId, forbidden);
    expect(t.knowledge.searchChunks).toHaveBeenCalledWith(request.runnerUserId, request.query, expect.objectContaining({ knowledgeBaseId: personal.id }));
  });

  it("skips a base whose search fails; the others still count", async () => {
    const failing = { id: randomUUID(), userId: randomUUID(), workspaceId: null };
    const working = { id: randomUUID(), userId: randomUUID(), workspaceId: null };
    const t = setup({ bases: { [failing.id]: failing, [working.id]: working }, searchable: { [failing.id]: true, [working.id]: true } });
    t.knowledge.searchChunks.mockImplementationOnce(async () => {
      throw new Error("embedding down");
    });
    const context = await t.service.buildContext(contextRequest({ knowledgeBaseIds: [failing.id, working.id] }));
    expect(context.knowledge).toBe(`personal-chunk-${working.id}`);
  });

  // RNX-324 AC1: an access check that throws skips that base without a search; the next base still counts.
  it("skips a base whose access check throws, never searching it; the others still count", async () => {
    const throwing = { id: randomUUID(), userId: randomUUID(), workspaceId: randomUUID() };
    const working = { id: randomUUID(), userId: randomUUID(), workspaceId: randomUUID() };
    const t = setup({ bases: { [throwing.id]: throwing, [working.id]: working }, searchable: { [working.id]: true } });
    t.workspaceKnowledge.canSearchKnowledgeBase.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });
    const context = await t.service.buildContext(contextRequest({ knowledgeBaseIds: [throwing.id, working.id] }));
    expect(context.knowledge).toBe(`workspace-chunk-${working.id}`);
    expect(t.workspaceKnowledge.searchKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(t.workspaceKnowledge.searchKnowledgeBase).not.toHaveBeenCalledWith(throwing.id, expect.anything(), expect.anything());
    expect(t.knowledge.searchChunks).not.toHaveBeenCalled();
  });

  // RNX-324 AC2: a base lookup that throws skips that base the same way.
  it("skips a base whose lookup throws; the others still count", async () => {
    const throwingId = randomUUID();
    const working = { id: randomUUID(), userId: randomUUID(), workspaceId: null };
    const t = setup({ bases: { [working.id]: working }, searchable: { [working.id]: true } });
    t.knowledgeBases.findKnowledgeBaseById.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });
    const context = await t.service.buildContext(contextRequest({ knowledgeBaseIds: [throwingId, working.id] }));
    expect(context.knowledge).toBe(`personal-chunk-${working.id}`);
    expect(t.knowledge.searchChunks).toHaveBeenCalledTimes(1);
    expect(t.workspaceKnowledge.canSearchKnowledgeBase).toHaveBeenCalledTimes(1);
  });
});
