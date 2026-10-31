import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditsExhaustedException } from "../../billing/errors/credits-exhausted.exception";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket } from "../../../../test/sse-client";
import { AgentLinkService } from "../service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-200: POST /agents/:id/chat answers its refusals (no subscription, no credits, a first call over the per-run cap)
// as real HTTP answers with their JSON body and code, before the document-intent classifier call and the SSE headers;
// a refused message writes no run and no message. A refusal that can only come after the headers (the reservation)
// carries its code in the SSE error event. Real AgentRunController, AgentRunService, meter and CreditService on the
// test database; fake provider, spied on. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

/** The `error` object of every SSE error event in a response body. */
const sseErrors = (body: string): unknown[] =>
  body
    .split("\n\n")
    .map((event) => event.replace(/^data: /, ""))
    .filter((data) => data.startsWith('{"error"'))
    .map((data) => JSON.parse(data).error);

describe("RNX-200: the agent chat route refuses before the SSE headers (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const cleanupMcpConnections = jest.fn(async () => undefined);
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
            useValue: {
              buildToolSchemasWithMcp: async () => [],
              cleanupMcpConnections,
            },
          },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: DocumentService, useValue: {} },
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
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    cleanupMcpConnections.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits; the first call's max_tokens alone is 0.004096.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A user (subscribed unless `subscribed` is false) funded with `credits` (none for "0"), with an agent and a session cookie. */
  const seed = async ({ credits, subscribed = true }: { credits: string; subscribed?: boolean }) => {
    const user = await createUser(prisma);
    if (subscribed) await createPackageSnapshot(prisma, { userId: user.id });
    if (credits !== "0") await fundPaidWallet(prisma, user.id, credits);
    const agent = await createAgent(prisma, { userId: user.id });
    const session = asSessionUser(user);
    return { user, agent, session };
  };

  const postChat = (agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, {
      method: "POST",
      path: `/agents/${agentId}/chat`,
      headers: session,
      body: { message: "Hi" },
    });

  /** Rows a refused message must not write. */
  const writtenRows = async () => ({
    runs: await prisma.agentRun.count(),
    messages: await prisma.agentMessage.count(),
    reservations: await prisma.creditReservation.count(),
  });

  it("AC1: a subscribed user with 0 ledger credits → HTTP 402 CREDITS_EXHAUSTED, no SSE header, no model call (classifier included), nothing saved", async () => {
    const { agent, session } = await seed({ credits: "0" });
    const providerChat = jest.spyOn(moduleRef.get(ProviderRouter), "chat");

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([402, expect.stringContaining("application/json")]);
    expect(JSON.parse(res.body)).toEqual({ statusCode: 402, code: "CREDITS_EXHAUSTED", message: "Not enough credits" });
    expect([providerChat.mock.calls.length, fake.requests.length]).toEqual([0, 0]);
    expect(await writtenRows()).toEqual({ runs: 0, messages: 0, reservations: 0 });
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC2: a first call over the per-run cap → HTTP 402 RUN_CAP_EXCEEDED naming the cap, no SSE header, no model call, nothing saved", async () => {
    const { agent, session } = await seed({ credits: "1" });
    await setRunCap(prisma, 0.001);
    const providerChat = jest.spyOn(moduleRef.get(ProviderRouter), "chat");

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([402, expect.stringContaining("application/json")]);
    expect(JSON.parse(res.body)).toEqual({
      statusCode: 402,
      code: "RUN_CAP_EXCEEDED",
      message: expect.stringContaining("0.001 credits"),
    });
    expect([providerChat.mock.calls.length, fake.requests.length]).toEqual([0, 0]);
    expect(await writtenRows()).toEqual({ runs: 0, messages: 0, reservations: 0 });
    await assertCreditLedgerInvariants(prisma);
  });

  it("no active subscription → HTTP 403 before the SSE header and any model call, nothing saved", async () => {
    const { agent, session } = await seed({ credits: "1", subscribed: false });

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([403, expect.stringContaining("application/json")]);
    expect(fake.requests).toHaveLength(0);
    expect(await writtenRows()).toEqual({ runs: 0, messages: 0, reservations: 0 });
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC3: a refusal after the SSE headers (the run's reservation refused, forced) → the SSE error event carries CREDITS_EXHAUSTED; no run or message; MCP cleaned up once", async () => {
    const { agent, session } = await seed({ credits: "1" });
    fake.enqueue({ content: "none" }); // the document-intent classifier
    jest.spyOn(moduleRef.get(CreditService), "reserveRun").mockRejectedValueOnce(new CreditsExhaustedException());

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseErrors(res.body)).toEqual([{ code: "CREDITS_EXHAUSTED", message: "Not enough credits" }]);
    expect(fake.requests).toHaveLength(1); // the classifier only
    expect(await writtenRows()).toEqual({ runs: 0, messages: 0, reservations: 0 });
    expect(cleanupMcpConnections).toHaveBeenCalledTimes(1);
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC5: a funded subscribed user → 200 SSE with the reply, the classifier then the run, one settled reservation, both messages saved", async () => {
    const { user, agent, session } = await seed({ credits: "1" });
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(res.body).toContain(JSON.stringify({ choices: [{ delta: { content: "Hello there" } }] }));
    expect(sseErrors(res.body)).toEqual([]);
    expect(fake.requests).toHaveLength(2);
    const reservations = await prisma.creditReservation.findMany();
    expect(reservations.map((r) => [r.status, r.consumed.toFixed(6)])).toEqual([["settled", "0.000015"]]);
    const messages = await prisma.agentMessage.findMany({ orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hi"],
      ["assistant", "Hello there"],
    ]);
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id, type: "usage" } })).toBe(1);
    expect(cleanupMcpConnections).toHaveBeenCalledTimes(1);
    await assertCreditLedgerInvariants(prisma);
  });
});
