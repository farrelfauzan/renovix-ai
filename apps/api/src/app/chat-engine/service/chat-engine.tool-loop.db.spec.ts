import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatEngineService } from "./chat-engine.service";
import { ChatEngineMeterService } from "./chat-engine-meter.service";
import { ChatEngineContextService } from "./chat-engine-context.service";
import { ChatEngineToolLoop } from "./chat-engine-tool-loop.service";
import { CHAT_ENGINE_LOOP_PROFILES } from "../config/chat-engine-loop-profiles";
import { EMPTY_CHAT_ENGINE_RESULT } from "../config/empty-chat-engine-result";
import { UNAVAILABLE_PEER_CALL } from "../config/unavailable-peer-call";
import { ChatEngineExecution } from "../ports/chat-engine-execution.port";
import { ChatEngineOutputApproval } from "../ports/chat-engine-output-approval.port";
import { ChatEnginePeerCall } from "../ports/chat-engine-peer-call.port";
import { ChatEnginePersistence } from "../ports/chat-engine-persistence.port";
import { applyChatEngineEvent } from "../utils/apply-chat-engine-event";
import type { ChatEngineResult } from "../types/chat-engine-result";
import type { ChatEngineRunOptions } from "../types/chat-engine-run-options";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatResponse } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { UsageService } from "../../usage/service/usage.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-283: the tool loop on the credit ledger. Real ChatEngineService, ChatEngineMeterService, ChatEngineToolLoop,
// AgentToolService, AgentRunMeterService, CreditService, run policy, model registry and UsageService on the test database;
// the model is the fake provider. The output approval and the persistence are test doubles; the peer port is the empty
// one (a spy around it). Non-default rates (2 / 1 / 3 per token, in micro-credits), run caps and loop limits. These
// collaborators load ESM-only packages and are stubbed.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

/** The agent's max_tokens: with output at 3 per token, E_call is about 0.00035 credits for the first request. */
const AGENT_MAX_TOKENS = 100;
const MODES = [["streamed"], ["collected"]] as const;
type Mode = (typeof MODES)[number][0];
const calculatorCall = (expression: string) => ({ toolCalls: [{ name: "calculator", arguments: { expression } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe("RNX-283: the chat engine's tool loop on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const outputApproval = {
    approveOutput: jest.fn(async (content: string) => ({ status: "approved" as const, content })),
    approveToolResult: jest.fn(async (content: string) => ({ status: "approved" as const, content })),
  };
  const persistence = { saveExchange: jest.fn(async () => undefined), handToMemory: jest.fn(async () => undefined) };
  const peers = { callPeer: jest.fn(UNAVAILABLE_PEER_CALL.callPeer) };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: ChatEngineService;
  let tools: AgentToolService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChatEngineService,
          ChatEngineMeterService,
          AgentRunMeterService,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          AgentToolService,
          { provide: ChatEngineExecution, useClass: ChatEngineToolLoop },
          { provide: ChatEnginePeerCall, useValue: peers },
          { provide: McpClientService, useValue: { connect: jest.fn(), close: jest.fn() } },
          { provide: McpService, useValue: {} },
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: WebSearchService, useValue: { search: jest.fn() } },
          { provide: DocumentService, useValue: {} },
          { provide: AgentMemoryService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ChatEngineContextService,
            useValue: { buildContext: async (request: { offeredTools: unknown[] }) => ({ scope: "inside", memory: "", knowledge: "", offeredTools: request.offeredTools }) },
          },
          { provide: ChatEngineOutputApproval, useValue: outputApproval },
          { provide: ChatEnginePersistence, useValue: persistence },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    engine = moduleRef.get(ChatEngineService);
    tools = moduleRef.get(AgentToolService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 2, cachedCreditsPerToken: 1, outputCreditsPerToken: 3 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed (unless `subscribed` is false) and funded with 1 credit, with his own active agent that has the calculator. */
  const seed = async ({ subscribed = true } = {}) => {
    const bob = await createUser(prisma);
    if (subscribed) await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, "1");
    const agent = await createAgent(prisma, { userId: bob.id, status: "active", maxTokens: AGENT_MAX_TOKENS });
    await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "calculator" } });
    const request = { principal: { runnerUserId: bob.id }, source: "agent-run", conversation: { agentId: agent.id }, input: "Hi", options: { offeredTools: [{ name: "calculator" }] } };
    return { bob, agent, request };
  };

  const runIn = async (mode: Mode, request: unknown, options: ChatEngineRunOptions = {}): Promise<ChatEngineResult> => {
    if (mode === "collected") return engine.collect(request, options);
    let result = EMPTY_CHAT_ENGINE_RESULT;
    for await (const event of engine.run(request, options)) result = applyChatEngineEvent(result, event);
    return result;
  };

  const failIn = async (mode: Mode, request: unknown, options: ChatEngineRunOptions = {}): Promise<unknown> => {
    try {
      await runIn(mode, request, options);
    } catch (error) {
      return error;
    }
    throw new Error("the run did not fail");
  };

  /** The account's balance and held, the reservations' status, held and consumed, and the usage entries' outcome and amount. */
  const moneyOf = async (userId: string) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
    const reservations = await prisma.creditReservation.findMany();
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
    return {
      balance: account.balance.toFixed(6),
      held: account.held.toFixed(6),
      reservations: reservations.map((r) => [r.status, r.amountHeld.toFixed(6), r.consumed.toFixed(6)]),
      entries: entries.map((e) => [e.outcome, e.amount.toFixed(6)]),
    };
  };

  const closings = () => jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");

  it.each(MODES)("%s: a tool call and its follow-up: one reservation, one usage entry per model call, the tool ran, settled once", async (mode) => {
    const { bob, request } = await seed();
    fake.enqueue(calculatorCall("6*7"), { content: "It is 42", usage: { prompt_tokens: 20, completion_tokens: 10 } });
    const closeRun = closings();
    const result = await runIn(mode, request);
    expect([result.content, result.toolResults]).toEqual(["It is 42", [{ toolName: "calculator", content: "Result: 42" }]]);
    // 10 x 2 + 5 x 3 = 35, then 20 x 2 + 10 x 3 = 70 micro-credits.
    expect(await moneyOf(bob.id)).toEqual({ balance: "0.999895", held: "0.000000", reservations: [["settled", "1.000000", "0.000105"]], entries: [["completed", "-0.000035"], ["completed", "-0.000070"]] });
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["completed"]);
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: a non-default limit of 2 rounds: no third provider call; what ran is settled, the max-steps answer is stored", async (mode) => {
    jest.replaceProperty(CHAT_ENGINE_LOOP_PROFILES, "agent-run", { ...CHAT_ENGINE_LOOP_PROFILES["agent-run"]!, maxIterations: 2 });
    const { bob, request } = await seed();
    fake.enqueue(calculatorCall("1"), calculatorCall("2"), calculatorCall("3"));
    const result = await runIn(mode, request);
    expect(result.content).toBe(CHAT_ENGINE_LOOP_PROFILES["agent-run"]!.maxStepsMessage);
    expect(fake.requests).toHaveLength(2);
    expect(await moneyOf(bob.id)).toEqual({ balance: "0.999930", held: "0.000000", reservations: [["settled", "1.000000", "0.000070"]], entries: [["completed", "-0.000035"], ["completed", "-0.000035"]] });
    expect(persistence.saveExchange).toHaveBeenCalledTimes(1);
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: the budget stop inside the loop (non-default cap): the next call is not made, the stop message is approved and stored, settled once", async (mode) => {
    const { bob, request } = await seed();
    // The offered tool schema is in every estimate: E_call is over 0.0008; after a call of 1500 micro-credits the next no longer fits 0.002.
    await setRunCap(prisma, 0.002);
    fake.enqueue({ ...calculatorCall("1"), usage: { prompt_tokens: 300, completion_tokens: 300 } }, { content: "never" });
    const closeRun = closings();
    const result = await runIn(mode, request);
    const stop = budgetStopMessage(new Decimal("0.002"));
    expect(result.content).toBe(stop);
    expect(outputApproval.approveOutput).toHaveBeenCalledWith(stop, bob.id, request.conversation.agentId);
    expect(fake.requests).toHaveLength(1);
    expect(await moneyOf(bob.id)).toEqual({ balance: "0.998500", held: "0.000000", reservations: [["settled", "0.002000", "0.001500"]], entries: [["completed", "-0.001500"]] });
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["budget_stopped"]);
    expect((persistence.saveExchange.mock.calls[0] as unknown[])[0]).toMatchObject({ approvedOutput: stop });
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: a budget stop raised in the peer port ends the run at its budget, not as a tool result; settled once", async (mode) => {
    const { bob, request } = await seed();
    fake.enqueue({ toolCalls: [{ name: "call_agent", arguments: { agent: "B", task: "t" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }, { content: "never" });
    peers.callPeer.mockRejectedValueOnce(new RunBudgetStoppedError(new Decimal(1)));
    const closeRun = closings();
    const result = await runIn(mode, request);
    expect(result.content).toBe(budgetStopMessage(new Decimal(1)));
    expect(fake.requests).toHaveLength(1);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["budget_stopped"]);
    expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: an abort during a tool: no further model call; the charged call is settled once, nothing stored", async (mode) => {
    const { bob, request } = await seed();
    fake.enqueue(calculatorCall("1"), { content: "never" });
    const controller = new AbortController();
    jest.spyOn(tools, "executeTool").mockImplementationOnce(async () => {
      controller.abort();
      return "tool result";
    });
    const closeRun = closings();
    const error = await failIn(mode, request, { signal: controller.signal });
    expect((error as Error).name).toBe("AbortError");
    expect(fake.requests).toHaveLength(1);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["failed"]);
    expect(await moneyOf(bob.id)).toEqual({ balance: "0.999965", held: "0.000000", reservations: [["settled", "1.000000", "0.000035"]], entries: [["completed", "-0.000035"]] });
    expect([outputApproval.approveOutput.mock.calls.length, persistence.saveExchange.mock.calls.length, persistence.handToMemory.mock.calls.length]).toEqual([0, 0, 0]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("disconnect at the first tool_result: no further model call; settled once, nothing stored", async () => {
    const { bob, request } = await seed();
    fake.enqueue(calculatorCall("1"), { content: "never" });
    const closeRun = closings();
    for await (const event of engine.run(request)) if (event.type === "tool_result") break;
    expect(fake.requests).toHaveLength(1);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["failed"]);
    expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
    expect(persistence.saveExchange).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: the agent run's response without a choice: 400, the call stays charged and is settled once, nothing stored", async (mode) => {
    const { bob, request } = await seed();
    fake.enqueue({ content: "ignored" });
    const chat = fake.chat.bind(fake);
    jest.spyOn(fake, "chat").mockImplementationOnce(async (params) => ({ ...(await chat(params)), choices: [] }) as ChatResponse);
    const error = await failIn(mode, request);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
    expect(persistence.saveExchange).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: a runner without a subscription is denied: no tools built, nothing reserved or called", async (mode) => {
    const { bob, request } = await seed({ subscribed: false });
    const build = jest.spyOn(tools, "buildToolSchemasWithMcp");
    const result = await runIn(mode, request);
    expect([result.status, result.reason]).toEqual(["denied", "no_subscription"]);
    expect([build.mock.calls.length, fake.requests.length]).toEqual([0, 0]);
    expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
  });
});
