import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AGENT_RUN_MAX_STEPS_MESSAGE } from "../config/agent-run-max-steps-message";
import { budgetStopMessage } from "../utils/budget-stop-message";
import { rememberOfferedTools } from "../utils/remember-offered-tools";
import type { McpRunSession } from "../types/mcp-run-session";
import type { ToolSchema } from "../types/tool-schema";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatResponse } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setRunCap } from "../../../../test/run-cap";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-25: the agent run (AR) on the chat engine, against main at 800d50f (docs/testing.md, "AR and CH differences").
// AC2: the AR loop's differences kept (15 rounds with a call_agent counting 3, no `length` continuation, whole tool
// results, "No response from LLM"); AC7: extraction once and not awaited; AC10 (Bug B): the run's cost is the sum of
// its charged model calls, also on a budget stop; AC14 (D341 D2): the user's message is kept after a failure; AC17: the
// linked agents count in the reservation. Real AgentRunService, run policy, links, meter and ledger on the test
// database; fake provider at non-default rates (2 / 1 / 3 per token, in micro-credits). The tool service is a stub with
// one tool, `long_tool`, whose result is longer than CH's 4,000-character cut. These collaborators load ESM-only
// packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));

const LONG_RESULT = "x".repeat(5_000);
const toolSchema = (name: string): ToolSchema => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } }) as ToolSchema;
const longToolTurn = () => ({ toolCalls: [{ name: "long_tool", arguments: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe("RNX-25: the agent run on the chat engine (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const extractAndStore = jest.fn(async () => undefined);
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (_tools: unknown, _agentId: string, _userId: string, _workspaceId: string, options: { injectCallAgent?: boolean; mcpSession: McpRunSession }) => {
      const schemas = [toolSchema("long_tool"), ...(options.injectCallAgent ? [toolSchema("call_agent")] : [])];
      rememberOfferedTools(options.mcpSession, schemas);
      return schemas;
    }),
    executeTool: jest.fn(async () => LONG_RESULT),
    cleanupMcpConnections: jest.fn(async () => undefined),
  };
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
          { provide: AgentToolService, useValue: tools },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) },
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
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    jest.clearAllMocks();
    extractAndStore.mockImplementation(async () => undefined);
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 2, cachedCreditsPerToken: 1, outputCreditsPerToken: 3 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed and funded with `credits`, with his own active agent (max_tokens `maxTokens`) and, with `link`, a linked helper. */
  const seed = async ({ credits = "1", link = false, maxTokens = 100, helperMaxTokens = 100 } = {}) => {
    const bob = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, credits);
    const agent = await createAgent(prisma, { userId: bob.id, status: "active", maxTokens });
    const helper = await createAgent(prisma, { userId: bob.id, name: "Bob helper", status: "active", maxTokens: helperMaxTokens });
    if (link) await prisma.agentLink.create({ data: { callerAgentId: agent.id, calleeAgentId: helper.id } });
    return { bob, agent, helper };
  };

  const storedMessages = async () =>
    (await prisma.agentMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content, m.tokens, m.cost?.toFixed(6) ?? null]);

  const chargedTotal = async () =>
    (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } })).reduce((sum, entry) => sum.plus(entry.amount.negated()), new Decimal(0));

  describe("AC2: the AR loop's differences, as on main", () => {
    it("loop limit: 15 rounds, a call_agent counting 3: one call_agent round and 12 tool rounds end with the max-steps text (13 root calls and 1 hop)", async () => {
      const { bob, agent, helper } = await seed({ link: true });
      fake.enqueue(
        { toolCalls: [{ name: "call_agent", arguments: { agent: helper.id, task: "do it" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        { content: "Helper answer", usage: { prompt_tokens: 10, completion_tokens: 5 } },
        ...Array.from({ length: 12 }, longToolTurn),
        { content: "never sent" },
      );

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(actual.message.content).toBe(AGENT_RUN_MAX_STEPS_MESSAGE);
      expect(fake.requests).toHaveLength(14);
      expect(tools.executeTool).toHaveBeenCalledTimes(12);
    });

    it("no `length` continuation: an answer cut at max_tokens is the final answer, after one call", async () => {
      const { bob, agent } = await seed();
      const chat = fake.chat.bind(fake);
      jest.spyOn(fake, "chat").mockImplementationOnce(async (request) => {
        const response = await chat(request);
        return { ...response, choices: [{ ...response.choices[0], finish_reason: "length" }] } as ChatResponse;
      });
      fake.enqueue({ content: "Part one. ", usage: { prompt_tokens: 10, completion_tokens: 5 } }, { content: "never sent" });

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect([actual.message.content, fake.requests.length]).toEqual(["Part one. ", 1]);
    });

    it("whole tool results: a 5,000-character result goes back to the model uncut", async () => {
      const { bob, agent } = await seed();
      fake.enqueue(longToolTurn(), { content: "Done", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      await service.chat(bob.id, agent.id, "Hi");

      expect(fake.requests[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: expect.any(String), content: LONG_RESULT });
    });

    it("a response without a choice fails the run with 400 \"No response from LLM\"; AC14: the user's message is kept, no answer is stored, the call is settled", async () => {
      const { bob, agent } = await seed();
      const chat = fake.chat.bind(fake);
      jest.spyOn(fake, "chat").mockImplementationOnce(async (request) => ({ ...(await chat(request)), choices: [] }));
      fake.enqueue({ content: "dropped", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const failure = service.chat(bob.id, agent.id, "Hi");

      await expect(failure).rejects.toBeInstanceOf(BadRequestException);
      await expect(failure).rejects.toThrow("No response from LLM");
      expect(await storedMessages()).toEqual([["user", "Hi", null, null]]);
      expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["settled"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  it("AC14 (D341 D2): a provider error keeps the user's message in the session; no answer is stored, the hold is released", async () => {
    const { bob, agent } = await seed();
    fake.enqueue({ error: { code: 502, message: "bad gateway" } });

    await expect(service.chat(bob.id, agent.id, "Hi", "session-1")).rejects.toThrow();

    expect(await storedMessages()).toEqual([["user", "Hi", null, null]]);
    expect((await prisma.agentRun.findFirstOrThrow()).sessionId).toBe("session-1");
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["released"]);
    await assertCreditLedgerInvariants(prisma);
  });

  describe("AC10 (Bug B): the run's cost is the sum of its charged model calls", () => {
    it("two model calls at non-default rates: the stored answer's cost and usage.cost equal the sum of the run's usage entries", async () => {
      const { bob, agent } = await seed();
      fake.enqueue(longToolTurn(), { content: "Done", usage: { prompt_tokens: 20, completion_tokens: 7 } });

      const actual = await service.chat(bob.id, agent.id, "Hi");

      // 10 x 2 + 5 x 3 = 35 and 20 x 2 + 7 x 3 = 61 micro-credits.
      const expected = await chargedTotal();
      expect(expected.toFixed(6)).toBe("0.000096");
      expect(actual.usage).toEqual({ totalTokens: 15 + 27, cost: expected.toFixed() });
      expect(await storedMessages()).toEqual([
        ["user", "Hi", null, null],
        ["assistant", "Done", 42, "0.000096"],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("a run that stops at its budget after one charged call: its cost is that call's charge, its tokens 0 (as on main)", async () => {
      const { bob, agent, helper } = await seed({ link: true, helperMaxTokens: 4_096 });
      await setRunCap(prisma, 0.01);
      // 4,000 x 2 + 10 x 3 = 8,030 micro-credits; the helper's E_call (its prompt + 4,096 x 3) no longer fits under 0.01.
      fake.enqueue({ toolCalls: [{ name: "call_agent", arguments: { agent: helper.id, task: "do it" } }], usage: { prompt_tokens: 4_000, completion_tokens: 10 } });

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(actual.message.content).toBe(budgetStopMessage(new Decimal("0.01")));
      expect(actual.usage).toEqual({ totalTokens: 0, cost: "0.00803" });
      expect((await chargedTotal()).toFixed(6)).toBe("0.008030");
      expect(await storedMessages()).toEqual([
        ["user", "Hi", null, null],
        ["assistant", budgetStopMessage(new Decimal("0.01")), 0, "0.008030"],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  it("AC7: an approved answer is handed to extraction once (RNX-284's path), and the reply does not wait for it", async () => {
    const { bob, agent } = await seed();
    extractAndStore.mockImplementation(() => new Promise<undefined>(() => undefined));
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await service.chat(bob.id, agent.id, "Hi");

    expect(actual.message.content).toBe("Hello");
    expect(extractAndStore.mock.calls).toEqual([[agent.id, bob.id, "Hi", "Hello", "inside"]]);
  });

  describe("AC17: the linked agents count in the run's reservation, as on main", () => {
    it("with credits under the minimum a run with its link needs: 402 CREDITS_EXHAUSTED; no model call, nothing reserved or stored", async () => {
      // The helper's E_call is about 500,000 x 3 micro-credits (1.5 credits); the agent's own first call alone fits in 0.1.
      const { bob, agent } = await seed({ credits: "0.1", link: true, helperMaxTokens: 500_000 });
      fake.enqueue({ content: "never sent" });

      await expect(service.chat(bob.id, agent.id, "Hi")).rejects.toMatchObject({ status: 402, response: { code: "CREDITS_EXHAUSTED" } });

      expect(fake.requests).toHaveLength(0);
      expect([await prisma.creditReservation.count(), await prisma.agentRun.count(), await prisma.agentMessage.count()]).toEqual([0, 0, 0]);
    });

    it("control: the same agent without the link runs on the same credits", async () => {
      const { bob, agent } = await seed({ credits: "0.1", helperMaxTokens: 500_000 });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const actual = await service.chat(bob.id, agent.id, "Hi");

      expect(actual.message.content).toBe("Hello");
    });
  });
});
