import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { ChannelController } from "../../channel/controller/channel.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { ChannelChatService } from "../../channel/service/channel-chat.service";
import { ChannelService } from "../../channel/service/channel.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpRegistryService } from "../../mcp/service/mcp-registry.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import type { StoredDocumentResult } from "../../document/service/document.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import type { ChatRequest } from "../../providers/provider.interface";
import type { FakeTurn } from "../../providers/fake.adapter";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setRunCap } from "../../../../test/run-cap";
import { requestOverSocket } from "../../../../test/sse-client";
import { AgentLinkService } from "../service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-222: the document a run's `create_document` call generates belongs to that run. Two users' runs overlap; the
// agent and channel chat routes are called over a real socket, so each controller's read of the document is part of
// the test. Real controllers, AgentRunService, ChannelChatService, ChannelService and AgentToolService on the test
// database; the fake LLM provider answers each user from that user's own script, and the stub DocumentService stores
// nothing. Deferred gates hold a run at a model call or inside its document generation, so the order is fixed.
// The modules mocked below load ESM-only packages.
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

jest.setTimeout(30_000);

const EXPIRES_AT = "2026-10-22T00:00:00.000Z";

type Owner = "u1" | "u2";
type Runner = { owner: Owner; userId: string; agentId: string; channelId: string; session: { cookie: string } };
type Gate = { arrived: Promise<void>; arrive: () => void; released: Promise<void>; release: () => void };
type Script = { fake: FakeProviderAdapter; calls: number; holdAt?: number; gate: Gate };
type Route = (runner: Runner) => Promise<string>;

describe("RNX-222: the generated document belongs to its run (agent and channel routes, test database)", () => {
  const fake = new FakeProviderAdapter();
  /** Each user's model calls (classifier first, then the run's), and the call held until the test releases it. */
  const scripts = new Map<Owner, Script>();
  /** Document generations held until the test releases them, by the `filename` the tool call asked for. */
  const documentHolds = new Map<string, Gate>();
  const generateFromReply = jest.fn(async (_markdown: string, format: string) => ({
    format,
    url: `https://documents.test/fallback.${format}`,
    filename: `fallback.${format}`,
    expiresAt: EXPIRES_AT,
  }));
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  const stored = (owner: string): StoredDocumentResult => ({
    format: "pdf",
    url: `https://documents.test/${owner}.pdf`,
    filename: `${owner}.pdf`,
    expiresAt: EXPIRES_AT,
    key: `documents/${owner}.pdf`,
  });
  const withoutKey = ({ key: _key, ...document }: StoredDocumentResult) => document;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [AgentRunController, ChannelController],
        providers: [
          AgentRunService,
          AgentRunPolicyService,
          ChannelChatService,
          AgentLinkService,
          WorkspaceQuotaService,
          ChannelService,
          AgentToolService,
          McpClientService,
          McpService,
          McpRegistryService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: WebSearchService, useValue: {} },
          {
            provide: DocumentService,
            useValue: {
              generateWithStorage: async (_markdown: string, _format: string, filename: string) => {
                const gate = documentHolds.get(filename);
                gate?.arrive();
                await gate?.released;
                return stored(filename);
              },
              generate: generateFromReply,
            },
          },
          { provide: S3Service, useValue: {} },
          {
            provide: AgentMemoryService,
            useValue: {
              getMemoryContext: async () => "",
              getWorkspaceMemoryContext: async () => "",
              extractAndStore: async () => undefined,
            },
          },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
    // Listening before the first request: two requests started together would both try to start it.
    await app.listen(0, "127.0.0.1");
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    scripts.clear();
    documentHolds.clear();
    generateFromReply.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
    await setRunCap(prisma, 1);
    jest.spyOn(fake, "chat").mockImplementation(async (params: ChatRequest) => {
      const script = scripts.get(ownerOf(params));
      if (!script) throw new Error("No script for this request");
      if (script.calls++ === script.holdAt) {
        script.gate.arrive();
        await script.gate.released;
      }
      return script.fake.chat(params);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** The user a model call belongs to: every message of a user's run (and its classifier call) carries `[owner]`. */
  const ownerOf = (params: ChatRequest): Owner => {
    const text = JSON.stringify(params.messages);
    const owners = (["u1", "u2"] as const).filter((owner) => text.includes(`[${owner}]`));
    if (owners.length !== 1) throw new Error(`A model call of no single owner: ${owners.join(",")}`);
    return owners[0];
  };

  const newGate = (): Gate => {
    const gate = {} as Gate;
    gate.arrived = new Promise<void>((resolve) => (gate.arrive = resolve));
    gate.released = new Promise<void>((resolve) => (gate.release = resolve));
    return gate;
  };

  /** The user's model replies in order (the classifier's first); with `holdAt`, that call waits for the gate. */
  const script = (owner: Owner, turns: FakeTurn[], holdAt?: number): Gate => {
    const gate = newGate();
    scripts.set(owner, { fake: new FakeProviderAdapter(turns), calls: 0, holdAt, gate });
    return gate;
  };

  const holdDocument = (owner: Owner): Gate => {
    const gate = newGate();
    documentHolds.set(owner, gate);
    return gate;
  };

  const classify = (content: string): FakeTurn => ({ content });
  const createDocument = (owner: Owner): FakeTurn => ({
    toolCalls: [{ name: "create_document", arguments: { content: `# Report ${owner}`, format: "pdf", filename: owner } }],
  });

  /** A subscribed, funded user with a channel (its workspace's), an active agent in it and a session cookie. */
  const seedUser = async (owner: Owner): Promise<Runner> => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "5");
    const channel = await prisma.channel.create({ data: { userId: user.id, name: `${owner} room` } });
    const workspace = await createWorkspace(prisma, { ownerId: user.id, channelId: channel.id });
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id, status: "active" });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const session = asSessionUser(user);
    return { owner, userId: user.id, agentId: agent.id, channelId: channel.id, session };
  };

  /** POSTs one message to a chat route over a real socket; resolves with the SSE body once the stream ends. */
  const post = async (runner: Runner, path: string): Promise<string> => {
    const res = await requestOverSocket(app, {
      method: "POST",
      path,
      headers: runner.session,
      body: { message: `Write my report [${runner.owner}]` },
    });
    expect([res.statusCode, res.ended]).toEqual([200, true]);
    return res.body;
  };
  const agentRoute: Route = (runner) => post(runner, `/agents/${runner.agentId}/chat`);
  const channelRoute: Route = (runner) => post(runner, `/channels/${runner.channelId}/agents/${runner.agentId}/chat`);

  /** Every SSE `document` event of a response body. */
  const documentsOf = (body: string): unknown[] =>
    body
      .split("\n\n")
      .map((event) => event.replace(/^data: /, ""))
      .filter((data) => data.startsWith("{"))
      .map((data) => JSON.parse(data))
      .filter((event) => event.document !== undefined)
      .map((event) => event.document);

  /** The `metadata.document` of each assistant message stored in the runner's channel, oldest first. */
  const storedDocuments = async (runner: Runner): Promise<unknown[]> => {
    const messages = await prisma.channelMessage.findMany({
      where: { role: "assistant", chatRoom: { channelId: runner.channelId } },
      orderBy: { createdAt: "asc" },
    });
    return messages.map((message) => (message.metadata as { document?: unknown } | null)?.document ?? null);
  };

  /**
   * U1's run calls create_document; U2's overlapping run does not. U1's document generation is held until U2's run
   * has started (U2's route is past its pre-run step) and is at its model call; U1 is then held at its next model
   * call while U2's run ends and U2's route reads its result; then U1 ends.
   */
  const overlap = async (firstRoute: Route, secondRoute: Route) => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];
    const u1Document = holdDocument("u1");
    const u1Final = script("u1", [classify("none"), createDocument("u1"), { content: "u1 done" }], 2);
    const u2Reply = script("u2", [classify("none"), { content: "u2 reply" }], 1);

    const u1Response = firstRoute(u1);
    await u1Document.arrived;
    const u2Response = secondRoute(u2);
    await u2Reply.arrived;
    u1Document.release();
    await u1Final.arrived;
    u2Reply.release();
    const u2Body = await u2Response;
    u1Final.release();
    const u1Body = await u1Response;
    return { u1, u2, u1Body, u2Body };
  };

  it("AC1 agent run (U1) vs agent run (U2): U2's response carries no document, U1's carries U1's", async () => {
    const { u1Body, u2Body } = await overlap(agentRoute, agentRoute);

    expect({ u1: documentsOf(u1Body), u2: documentsOf(u2Body) }).toEqual({ u1: [withoutKey(stored("u1"))], u2: [] });
  });

  it("AC1/AC2 agent run (U1) vs channel run (U2): U2's response and stored message carry no document, U1's response carries U1's", async () => {
    const { u2, u1Body, u2Body } = await overlap(agentRoute, channelRoute);

    expect({ u1: documentsOf(u1Body), u2: documentsOf(u2Body), u2Stored: await storedDocuments(u2) }).toEqual({
      u1: [withoutKey(stored("u1"))],
      u2: [],
      u2Stored: [null],
    });
  });

  it("AC1/AC2 channel run (U1) vs agent run (U2): U2's response carries no document; U1's response and stored message carry U1's", async () => {
    const { u1, u1Body, u2Body } = await overlap(channelRoute, agentRoute);

    expect({ u1: documentsOf(u1Body), u2: documentsOf(u2Body), u1Stored: await storedDocuments(u1) }).toEqual({
      u1: [withoutKey(stored("u1"))],
      u2: [],
      u1Stored: [withoutKey(stored("u1"))],
    });
  });

  it("AC1/AC2 channel run (U1) vs channel run (U2): the document is attached only to U1's assistant message", async () => {
    const { u1, u2, u1Body, u2Body } = await overlap(channelRoute, channelRoute);
    const [u1Stored, u2Stored] = [await storedDocuments(u1), await storedDocuments(u2)];

    expect({ u1: documentsOf(u1Body), u2: documentsOf(u2Body), u1Stored, u2Stored }).toEqual({
      u1: [withoutKey(stored("u1"))],
      u2: [],
      u1Stored: [withoutKey(stored("u1"))],
      u2Stored: [null],
    });
  });

  it("AC3 agent run alone: create_document's document is streamed as the document event, without its key", async () => {
    const u1 = await seedUser("u1");
    script("u1", [classify("none"), createDocument("u1"), { content: "u1 done" }]);

    const documents = documentsOf(await agentRoute(u1));

    expect(documents).toEqual([withoutKey(stored("u1"))]);
    expect(documents[0]).not.toHaveProperty("key");
  });

  it("AC3 channel run alone: create_document's document is streamed without its key and attached to the assistant message", async () => {
    const u1 = await seedUser("u1");
    script("u1", [classify("none"), createDocument("u1"), { content: "u1 done" }]);

    const documents = documentsOf(await channelRoute(u1));

    expect(documents).toEqual([withoutKey(stored("u1"))]);
    expect(documents[0]).not.toHaveProperty("key");
    expect(await storedDocuments(u1)).toEqual([withoutKey(stored("u1"))]);
  });

  it("AC3 agent run, tool not called: the classifier fallback generates the document from the reply", async () => {
    const u1 = await seedUser("u1");
    script("u1", [classify("pdf"), { content: "the reply as markdown" }]);

    const documents = documentsOf(await agentRoute(u1));

    expect(generateFromReply).toHaveBeenCalledWith("the reply as markdown", "pdf");
    expect(documents).toEqual([await generateFromReply.mock.results[0].value]);
  });

  it("AC3 channel run, tool not called: the classifier fallback generates the document and attaches it", async () => {
    const u1 = await seedUser("u1");
    script("u1", [classify("pdf"), { content: "the reply as markdown" }]);

    const documents = documentsOf(await channelRoute(u1));

    expect(generateFromReply).toHaveBeenCalledWith("the reply as markdown", "pdf");
    const generated = await generateFromReply.mock.results[0].value;
    expect([documents, await storedDocuments(u1)]).toEqual([[generated], [generated]]);
  });
});
