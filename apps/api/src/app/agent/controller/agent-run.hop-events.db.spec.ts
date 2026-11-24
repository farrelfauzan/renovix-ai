import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { AgentLinkService } from "../service/agent-link.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { requestSse } from "../../../../test/sse-socket";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-328: the start and end of each agent-call hop, written on the SSE stream of POST /agents/:id/chat as they
// happen. Real AgentRunController, AgentRunService, AgentToolService, peer-run service, meter and ledger on the test
// database; fake provider (its first turn is the document-intent classifier's "none"); memory and guardrail are stubs.
// These collaborators load ESM-only packages.
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

type Usage = { prompt_tokens: number; completion_tokens: number };
type SsePayload = Record<string, unknown> | "[DONE]";

describe("RNX-328: hop events on the agent chat stream (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [AgentRunController],
        providers: [
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentToolService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpClientService, useValue: { connect: jest.fn(), close: jest.fn() } },
          { provide: McpService, useValue: {} },
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    // A test that stops early leaves scripted turns behind; none reaches the next test.
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
    await setPeerRunLimits(prisma, { maxDepth: 3, maxAgentCalls: 3, callTimeoutSeconds: 30 });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** The owner's workspace with active agents named "Agent <X>" and the links given as "AB" (A may call B). */
  const seed = async ({ agents = ["A", "B"], links = ["AB"] }: { agents?: string[]; links?: string[] } = {}) => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id });
    await fundPaidWallet(prisma, owner.id, "1");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const byName: Record<string, Awaited<ReturnType<typeof createAgent>>> = {};
    for (const name of agents) {
      byName[name] = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: `Agent ${name}`, systemPrompt: `PROMPT ${name}`, status: "active", maxTokens: 100 });
    }
    for (const [caller, callee] of links) {
      await prisma.agentLink.create({ data: { callerAgentId: byName[caller].id, calleeAgentId: byName[callee].id } });
    }
    return { owner, A: byName.A, B: byName.B };
  };

  const call = (agent: string, task: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
    toolCalls: [{ name: "call_agent", arguments: { agent, task } }],
    usage,
  });
  const answer = (content: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({ content, usage });
  /** The first model turn of every run on the route: the document-intent classifier's answer. */
  const classifier = { content: "none" };
  const childRows = () => prisma.agentRun.findMany({ where: { parentRunId: { not: null } }, orderBy: [{ depth: "asc" }, { createdAt: "asc" }] });

  /** Runs the chat over a real socket and returns the parsed `data:` payloads in the order they were written. */
  const chat = async (owner: { id: string; email: string }, agentId: string): Promise<SsePayload[]> => {
    const { statusCode, body } = await requestSse(app, { method: "POST", path: `/agents/${agentId}/chat`, headers: asSessionUser(owner), body: { message: "Hi" } });
    expect(statusCode).toBe(200);
    return body
      .split("\n\n")
      .filter((event) => event.startsWith("data: "))
      .map((event) => event.slice("data: ".length))
      .map((data) => (data === "[DONE]" ? "[DONE]" : (JSON.parse(data) as Record<string, unknown>)));
  };
  const hasKey = (key: string) => (payload: SsePayload) => payload !== "[DONE]" && key in payload;
  const hopsOf = (payloads: SsePayload[]) => payloads.filter(hasKey("hop"));
  const contentIndexOf = (payloads: SsePayload[]) => payloads.findIndex((payload) => payload !== "[DONE]" && "choices" in payload);

  it("AC1: A calls B: a hop_start and a hop_end (depth 1, B's name, status = B's child row) are on the stream before the content chunk", async () => {
    const { owner, A, B } = await seed();
    fake.enqueue(classifier, call("Agent B", "summarise"), answer("B answer"), answer("A final"));

    const actual = await chat(owner, A.id);

    const [childRow] = await childRows();
    expect(childRow.status).toBe("completed");
    const startIndex = actual.findIndex(hasKey("hop"));
    expect(actual[startIndex]).toEqual({ hop: { type: "hop_start", agentId: B.id, agentName: "Agent B", depth: 1 } });
    expect(actual[startIndex + 1]).toEqual({ hop: { type: "hop_end", agentId: B.id, agentName: "Agent B", depth: 1, status: childRow.status } });
    expect(hopsOf(actual)).toHaveLength(2);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex + 1).toBeLessThan(contentIndexOf(actual));
    expect(actual[contentIndexOf(actual)]).toEqual({ choices: [{ delta: { content: "A final" } }] });
  }, 15000);

  it("AC2a: A -> B and B -> A: B start (1), A start (2), A end (2, refused as the refused row), B end (1, completed), in that order", async () => {
    const { owner, A, B } = await seed({ links: ["AB", "BA"] });
    fake.enqueue(classifier, call("Agent B", "ask around"), call("Agent A", "back to you"), answer("B alone"), answer("A final"));

    const actual = await chat(owner, A.id);

    const [bRow, aRow] = await childRows();
    expect([bRow.agentId, bRow.depth, bRow.status, aRow.agentId, aRow.depth, aRow.status]).toEqual([B.id, 1, "completed", A.id, 2, "refused"]);
    expect(hopsOf(actual)).toEqual([
      { hop: { type: "hop_start", agentId: B.id, agentName: "Agent B", depth: 1 } },
      { hop: { type: "hop_start", agentId: A.id, agentName: "Agent A", depth: 2 } },
      { hop: { type: "hop_end", agentId: A.id, agentName: "Agent A", depth: 2, status: aRow.status } },
      { hop: { type: "hop_end", agentId: B.id, agentName: "Agent B", depth: 1, status: bRow.status } },
    ]);
    const lastHopIndex = actual.map(hasKey("hop")).lastIndexOf(true);
    expect(lastHopIndex).toBeLessThan(contentIndexOf(actual));
  }, 15000);

  it("AC2b: a call_agent the run did not offer (an agent with no links): no hop on the stream and no child row", async () => {
    const { owner, A } = await seed({ agents: ["A"], links: [] });
    fake.enqueue(classifier, call("Agent B", "not offered"), answer("A final"));

    const actual = await chat(owner, A.id);

    expect(actual.filter(hasKey("hop"))).toEqual([]);
    expect(await childRows()).toEqual([]);
    expect(actual[contentIndexOf(actual)]).toEqual({ choices: [{ delta: { content: "A final" } }] });
  }, 15000);

  it("a failed hop: B's model call throws a provider error: hop_start, then hop_end with the status B's child row has (error); the run still answers", async () => {
    const { owner, A, B } = await seed();
    fake.enqueue(classifier, call("Agent B", "will fail"), { error: { code: 500, message: "provider down" } }, answer("A goes on"));

    const actual = await chat(owner, A.id);

    const [childRow] = await childRows();
    expect([childRow.agentId, childRow.status]).toEqual([B.id, "error"]);
    expect(hopsOf(actual)).toEqual([
      { hop: { type: "hop_start", agentId: B.id, agentName: "Agent B", depth: 1 } },
      { hop: { type: "hop_end", agentId: B.id, agentName: "Agent B", depth: 1, status: "error" } },
    ]);
    expect(actual[contentIndexOf(actual)]).toEqual({ choices: [{ delta: { content: "A goes on" } }] });
  }, 15000);

  it("AC3: a run with no agent call: the stream is exactly the status, the content chunk, the ids and [DONE] (what main sends); no hop", async () => {
    const { owner, A } = await seed({ agents: ["A"], links: [] });
    fake.enqueue(classifier, answer("Plain answer"));

    const actual = await chat(owner, A.id);

    const topRun = await prisma.agentRun.findFirstOrThrow({ where: { agentId: A.id, parentRunId: null } });
    expect(actual).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: "Plain answer" } }] },
      { sessionId: topRun.sessionId, runId: topRun.id },
      "[DONE]",
    ]);
  }, 15000);
});
