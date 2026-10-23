import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
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
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket, sseEvents } from "../../../../test/sse-client";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-16: characterization of the channel chat (CH) on POST /channels/:id/agents/:agentId/chat, as it is today: the
// exact SSE event sequence of a plain reply, an input guardrail block and an output guardrail block, with what each one
// stores and memorises. The document-intent classifier is the fake's first turn ("none"). Real ChannelController,
// ChannelChatService, ChannelService, meter and CreditService on the test database; fake provider; the guardrail and
// memory are stubs. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const DECLINE = "INPUT-BLOCKED-REPLY";
const RAW = "RAW-SECRET-ANSWER";
const SANITIZED = "SANITIZED-TEXT";
const notBlocked = async (): Promise<GuardrailResult> => ({ blocked: false });
const passThrough = async (content: string): Promise<GuardrailResult & { content?: string }> => ({ blocked: false, content });

describe("RNX-16: channel chat scenarios on POST /channels/:id/agents/:agentId/chat (Fastify, test database, fake provider)", () => {
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
        controllers: [ChannelController],
        providers: [
          ChannelService,
          AgentRunPolicyService,
          ChannelChatService,
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
          {
            provide: AgentMemoryService,
            useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: mockExtractAndStore },
          },
          { provide: GuardrailService, useValue: { checkInput: mockCheckInput, checkOutput: mockCheckOutput } },
          { provide: S3Service, useValue: {} },
          { provide: DocumentService, useValue: {} },
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

  /** A subscribed user funded with 1 credit, an agent in their channel, and a session cookie. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: (await createPlan(prisma)).id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel, session: asSessionUser(user) };
  };

  const postChat = (channelId: string, agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, {
      method: "POST",
      path: `/channels/${channelId}/agents/${agentId}/chat`,
      headers: session,
      body: { message: "Hi" },
    });

  const storedMessages = async () =>
    (await prisma.channelMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => ({
      role: m.role,
      content: m.content,
      tokens: m.tokens,
      cost: m.cost,
    }));

  it("RNX-16 plain reply (CH): the exact SSE events are status, one content chunk, {done: true}, [DONE]; the stored assistant message has the call's total tokens and no cost", async () => {
    const { agent, channel, session } = await seed();
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await postChat(channel.id, agent.id, session);

    expect([actual.statusCode, actual.contentType, actual.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseEvents(actual.body)).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: "Hello there" } }] },
      { done: true },
      "[DONE]",
    ]);
    expect(await storedMessages()).toEqual([
      { role: "user", content: "Hi", tokens: null, cost: null },
      { role: "assistant", content: "Hello there", tokens: 15, cost: null },
    ]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-16 input guardrail block (CH): only the classifier calls the model; the decline is streamed as the content chunk and stored after the user message; nothing is reserved", async () => {
    const { user, agent, channel, session } = await seed();
    fake.enqueue({ content: "none" });
    mockCheckInput.mockImplementation(async () => ({ blocked: true, reason: "prompt_injection", userMessage: DECLINE }));

    const actual = await postChat(channel.id, agent.id, session);

    expect(sseEvents(actual.body)).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: DECLINE } }] },
      { done: true },
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

  it("RNX-16 output guardrail block (CH): the streamed reply, the stored assistant message and the memory input are the sanitized text; the raw answer is in no stored message", async () => {
    const { user, agent, channel, session } = await seed();
    fake.enqueue({ content: "none" }, { content: RAW, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    mockCheckOutput.mockImplementation(async () => ({ blocked: true, reason: "dangerous_output", sanitized: SANITIZED }));

    const actual = await postChat(channel.id, agent.id, session);

    expect(sseEvents(actual.body)[1]).toEqual({ choices: [{ delta: { content: SANITIZED } }] });
    expect(actual.body).not.toContain(RAW);
    expect(await storedMessages()).toEqual([
      { role: "user", content: "Hi", tokens: null, cost: null },
      { role: "assistant", content: SANITIZED, tokens: 15, cost: null },
    ]);
    expect(await prisma.channelMessage.count({ where: { content: { contains: RAW } } })).toBe(0);
    // CH memorises a blocked answer, but its sanitized text (AR does not memorise it at all, RNX-275).
    expect(mockExtractAndStore.mock.calls).toEqual([[agent.id, user.id, "Hi", SANITIZED, expect.anything(), channel.id]]);
  });
});
