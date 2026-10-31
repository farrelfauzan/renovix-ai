import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import type { GuardrailResult } from "../../guardrail/dto/guardrail-result.dto";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { budgetStopMessage } from "../utils/budget-stop-message";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-275: the agent run applies the output guardrail before it stores or memorises the answer. A blocked answer is
// stored as the guardrail's sanitized text (or the fallback), never raw, is not memorised, and so never reaches the
// model as history on the next turn. One checkOutput call per run. Real AgentRunService, meter and ledger on the test
// database, fake provider; the guardrail and the memory service are stubs. These collaborators load ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const RAW = "RAW-SECRET-ANSWER";
const SANITIZED = "SANITIZED-TEXT";
const FALLBACK = "I'm unable to provide that response.";
const CALL_AGENT = { type: "function", function: { name: "call_agent", description: "Call", parameters: {} } };

const passThrough = async (content: string): Promise<GuardrailResult & { content?: string }> => ({ blocked: false, content });
const blockWith =
  (sanitized?: string) =>
  async (): Promise<GuardrailResult & { content?: string }> => ({ blocked: true, reason: "dangerous_output", sanitized, userMessage: sanitized });

describe("RNX-275: the output guardrail runs before the agent run stores or memorises the answer (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const mockCheckOutput = jest.fn(passThrough);
  const mockExtractAndStore = jest.fn(async () => undefined);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
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
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => (options?.injectCallAgent ? [CALL_AGENT] : []),
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: mockExtractAndStore },
          },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: mockCheckOutput },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    mockCheckOutput.mockReset().mockImplementation(passThrough);
    mockExtractAndStore.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed and funded with 1 credit, with his own active agent. */
  const seed = async () => {
    const bob = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, "1");
    const agent = await createAgent(prisma, { userId: bob.id, status: "active" });
    return { bob, agent };
  };

  const assistantContentsOf = async (runId: string) =>
    (await prisma.agentMessage.findMany({ where: { runId, role: "assistant" }, orderBy: { createdAt: "asc" } })).map(
      (m) => m.content,
    );

  const messagesContaining = (text: string) => prisma.agentMessage.findMany({ where: { content: { contains: text } } });

  describe("the guardrail blocks the answer", () => {
    it("AC1: the stored assistant message holds the sanitized text, never the raw answer; the reply is the sanitized text", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: RAW });
      mockCheckOutput.mockImplementation(blockWith(SANITIZED));

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(await assistantContentsOf(actual.runId)).toEqual([SANITIZED]);
      expect(await messagesContaining(RAW)).toEqual([]);
      expect(actual.message.content).toBe(SANITIZED);
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
      expect(mockCheckOutput).toHaveBeenCalledWith(RAW, bob.id, agent.id);
    });

    it("AC1: blocked without sanitized text, the stored message and the reply are the fallback", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: RAW });
      mockCheckOutput.mockImplementation(blockWith(undefined));

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(await assistantContentsOf(actual.runId)).toEqual([FALLBACK]);
      expect(await messagesContaining(RAW)).toEqual([]);
      expect(actual.message.content).toBe(FALLBACK);
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
    });

    it("AC2: agent memory is not started at all, so it never sees the raw answer", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: RAW });
      mockCheckOutput.mockImplementation(blockWith(SANITIZED));

      await service.chat(bob.id, agent.id, "Hi");

      expect(mockExtractAndStore).not.toHaveBeenCalled();
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
    });

    it("AC3: the next turn's history holds the sanitized text as the previous assistant message, never the raw answer", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: RAW }, { content: "SECOND-ANSWER" });
      mockCheckOutput.mockImplementationOnce(blockWith(SANITIZED));
      const first = await service.chat(bob.id, agent.id, "Hi");

      await service.chat(bob.id, agent.id, "And then?", first.sessionId);

      const actualHistory = fake.requests[1].messages.map((m: any) => [m.role, String(m.content)]);
      expect(actualHistory.filter(([, content]) => content.includes(RAW))).toEqual([]);
      expect(actualHistory).toContainEqual(["assistant", SANITIZED]);
      expect(mockCheckOutput).toHaveBeenCalledTimes(2);
    });
  });

  describe("AC4 (control): the guardrail does not block", () => {
    it("the stored message, the memory input and the reply are the model's answer; one checkOutput call", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: "PLAIN-ANSWER" });

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(await assistantContentsOf(actual.runId)).toEqual(["PLAIN-ANSWER"]);
      expect(actual.message.content).toBe("PLAIN-ANSWER");
      expect(mockExtractAndStore).toHaveBeenCalledTimes(1);
      expect(mockExtractAndStore).toHaveBeenCalledWith(agent.id, bob.id, "Hi", "PLAIN-ANSWER", expect.anything());
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
    });

    it("#170 review: masked but not blocked (e.g. PII), the stored message, the memory input and the reply are the masked text; one checkOutput call", async () => {
      const { bob, agent } = await seed();
      fake.enqueue({ content: "Call me at 0812-0000-3535" });
      mockCheckOutput.mockImplementation(async () => ({ blocked: false, content: "Call me at [PHONE]" }));

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(await assistantContentsOf(actual.runId)).toEqual(["Call me at [PHONE]"]);
      expect(await messagesContaining("0812-0000-3535")).toEqual([]);
      expect(actual.message.content).toBe("Call me at [PHONE]");
      expect(mockExtractAndStore).toHaveBeenCalledTimes(1);
      expect(mockExtractAndStore).toHaveBeenCalledWith(agent.id, bob.id, "Hi", "Call me at [PHONE]", expect.anything());
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
    });

    it("the budget-stop message still goes through the guardrail once and is stored as returned", async () => {
      const { bob, agent } = await seed();
      const helper = await createAgent(prisma, { userId: bob.id, name: "Bob helper", status: "active" });
      await prisma.agentLink.create({ data: { callerAgentId: agent.id, calleeAgentId: helper.id } });
      await setRunCap(prisma, 0.01);
      // 9,500 + 10 micro-credits: the helper's call no longer fits under 0.01, so the run stops before it.
      fake.enqueue({
        toolCalls: [{ name: "call_agent", arguments: { agent: helper.id, task: "do it" } }],
        usage: { prompt_tokens: 9_500, completion_tokens: 10 },
      });
      const expectedContent = budgetStopMessage(new Decimal("0.01"));

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(actual.message.content).toBe(expectedContent);
      expect(await assistantContentsOf(actual.runId)).toEqual([expectedContent]);
      expect(mockCheckOutput).toHaveBeenCalledTimes(1);
      expect(mockCheckOutput).toHaveBeenCalledWith(expectedContent, bob.id, agent.id);
    });
  });
});
