import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { AgentLinkService } from "../service/agent-link.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import type { GuardrailResult } from "../../guardrail/dto/guardrail-result.dto";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket, sseEvents } from "../../../../test/sse-client";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-16: characterization of the agent run (AR) on POST /agents/:id/chat, as it is today: the exact SSE event
// sequence of a plain reply, an input guardrail block and an output guardrail block, with what each one stores. The
// document-intent classifier is the fake's first turn ("none"). Real AgentRunController, AgentRunService, meter and
// CreditService on the test database; fake provider; the guardrail and memory are stubs. These collaborators load
// ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const DECLINE = "INPUT-BLOCKED-REPLY";
const RAW = "RAW-SECRET-ANSWER";
const SANITIZED = "SANITIZED-TEXT";
const notBlocked = async (): Promise<GuardrailResult> => ({ blocked: false });
const passThrough = async (content: string): Promise<GuardrailResult & { content?: string }> => ({ blocked: false, content });

describe("RNX-16: agent run scenarios on POST /agents/:id/chat (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const mockCheckInput = jest.fn(notBlocked);
  const mockCheckOutput = jest.fn(passThrough);
  const mockExtractAndStore = jest.fn(async () => undefined);
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
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined },
          },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: mockExtractAndStore } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: mockCheckInput, checkOutput: mockCheckOutput } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    mockCheckInput.mockReset().mockImplementation(notBlocked);
    mockCheckOutput.mockReset().mockImplementation(passThrough);
    mockExtractAndStore.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A subscribed user funded with 1 credit, with an agent and a session cookie. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    return { user, agent, session: asSessionUser(user) };
  };

  const postChat = (agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, { method: "POST", path: `/agents/${agentId}/chat`, headers: session, body: { message: "Hi" } });

  const storedMessages = async () =>
    (await prisma.agentMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => ({
      role: m.role,
      content: m.content,
      tokens: m.tokens,
      cost: m.cost,
    }));

  it("RNX-16 plain reply (AR): the exact SSE events are status, one content chunk, session info, [DONE]; the stored assistant message has the call's total tokens and no cost", async () => {
    const { agent, session } = await seed();
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await postChat(agent.id, session);

    const run = await prisma.agentRun.findFirstOrThrow();
    expect([actual.statusCode, actual.contentType, actual.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseEvents(actual.body)).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: "Hello there" } }] },
      { sessionId: run.sessionId, runId: run.id },
      "[DONE]",
    ]);
    // AR stores no cost on the assistant message: its loop never sets totalCost (RNX-23).
    expect(await storedMessages()).toEqual([
      { role: "user", content: "Hi", tokens: null, cost: null },
      { role: "assistant", content: "Hello there", tokens: 15, cost: null },
    ]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-16 input guardrail block (AR): only the classifier calls the model; the decline is streamed as the content chunk and stored after the user message; nothing is reserved", async () => {
    const { user, agent, session } = await seed();
    fake.enqueue({ content: "none" });
    mockCheckInput.mockImplementation(async () => ({ blocked: true, reason: "prompt_injection", userMessage: DECLINE }));

    const actual = await postChat(agent.id, session);

    const run = await prisma.agentRun.findFirstOrThrow();
    expect(sseEvents(actual.body)).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: DECLINE } }] },
      { sessionId: run.sessionId, runId: run.id },
      "[DONE]",
    ]);
    expect(fake.requests.map((r) => r.max_tokens)).toEqual([200]); // the classifier's call only
    expect(mockCheckInput).toHaveBeenCalledWith("Hi", user.id, agent.id);
    expect(await storedMessages()).toEqual([
      { role: "user", content: "Hi", tokens: null, cost: null },
      { role: "assistant", content: DECLINE, tokens: null, cost: null },
    ]);
    expect([await prisma.creditReservation.count(), await prisma.creditLedgerEntry.count({ where: { type: "usage" } })]).toEqual([0, 0]);
  });

  it("RNX-16 output guardrail block (AR): the streamed reply and the stored assistant message are the sanitized text; the raw answer is in no stored message and memory is not called", async () => {
    const { agent, session } = await seed();
    fake.enqueue({ content: "none" }, { content: RAW, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    mockCheckOutput.mockImplementation(async () => ({ blocked: true, reason: "dangerous_output", sanitized: SANITIZED }));

    const actual = await postChat(agent.id, session);

    expect(sseEvents(actual.body)[1]).toEqual({ choices: [{ delta: { content: SANITIZED } }] });
    expect(actual.body).not.toContain(RAW);
    expect(await storedMessages()).toEqual([
      { role: "user", content: "Hi", tokens: null, cost: null },
      { role: "assistant", content: SANITIZED, tokens: 15, cost: null },
    ]);
    expect(await prisma.agentMessage.count({ where: { content: { contains: RAW } } })).toBe(0);
    expect(mockExtractAndStore).not.toHaveBeenCalled();
  });
});
