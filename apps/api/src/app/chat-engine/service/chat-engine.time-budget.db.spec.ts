import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { ChatEngineService } from "./chat-engine.service";
import { ChatEngineMeterService } from "./chat-engine-meter.service";
import { ChatEngineContextService } from "./chat-engine-context.service";
import { ChatEngineExecution } from "../ports/chat-engine-execution.port";
import { ChatEngineOutputApproval } from "../ports/chat-engine-output-approval.port";
import { ChatEnginePersistence } from "../ports/chat-engine-persistence.port";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatExecutionInput } from "../types/chat-execution-input";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { ProviderRouter } from "../../providers/provider-router";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderTimeBudgetExceededError } from "../../providers/errors/provider-time-budget-exceeded-error";
import { PrismaService } from "../../prisma/prisma.service";
import { UsageService } from "../../usage/service/usage.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-44 AC7 and AC9: a metered run whose model call runs out of its time budget, end to end: real ChatEngineService,
// ChatEngineMeterService, AgentRunMeterService, CreditService, PlatformSettingsService (the modelCallBudgetSeconds row
// in the test database), ProviderRouter and OpenRouterAdapter, with the global fetch stubbed (no network): the provider
// never answers, and a request settles only when its signal fires. Real time: the setting is in whole seconds.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));

const MODES = [["streamed"], ["collected"]] as const;
const SETTING = "modelCallBudgetSeconds";
const AUTHOR = { changedBy: "rnx-44-test", reason: "RNX-44 test" };
const MS_PER_SECOND = 1000;
/** Slack for the real clock around a budget of whole seconds. */
const CLOCK_SLACK_MS = 900;

describe("RNX-44: a model call of a metered run that runs out of its time budget (real adapter, stubbed fetch, test database)", () => {
  const execution = {
    execute: jest.fn(async function* (input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
      const { response } = await input.callModel({ messages: [{ role: "user", content: input.approvedInput }], max_tokens: 100 });
      yield { type: "text", text: response.choices[0].message.content ?? "" };
    }),
  };
  const outputApproval = { approveOutput: jest.fn(async (content: string) => ({ status: "approved" as const, content })), approveToolResult: jest.fn() };
  const persistence = { saveExchange: jest.fn(async () => undefined), handToMemory: jest.fn(async () => undefined) };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: ChatEngineService;
  let settings: PlatformSettingsService;

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
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          { provide: ChatEngineContextService, useValue: { buildContext: async () => ({ scope: "inside", memory: "", knowledge: "", offeredTools: [] }) } },
          { provide: ChatEngineExecution, useValue: execution },
          { provide: ChatEngineOutputApproval, useValue: outputApproval },
          { provide: ChatEnginePersistence, useValue: persistence },
        ],
      },
      (b) => b.overrideProvider(OpenRouterAdapter).useValue(new OpenRouterAdapter(new ConfigService())),
    ));
    engine = moduleRef.get(ChatEngineService);
    settings = moduleRef.get(PlatformSettingsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 2, cachedCreditsPerToken: 1, outputCreditsPerToken: 3 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** Stubs the global fetch: every request hangs until its signal fires, then rejects with the signal's reason (as fetch does). */
  const stubSilentProvider = () => {
    const signals: AbortSignal[] = [];
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init!.signal!;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    return { fetchSpy, signals };
  };

  const seed = async () => {
    const bob = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, "1");
    const agent = await createAgent(prisma, { userId: bob.id, status: "active" });
    return { bob, request: { principal: { runnerUserId: bob.id }, source: "agent-run", conversation: { agentId: agent.id }, input: "Hi" } };
  };

  /** Runs the request in `mode`; the error it ended with (thrown, or the streamed error event's), and how long it took. */
  const runIn = async (mode: string, request: unknown): Promise<{ error: unknown; elapsedMs: number }> => {
    const startedAt = Date.now();
    try {
      if (mode === "collected") await engine.collect(request);
      else for await (const _event of engine.run(request)) void _event;
    } catch (error) {
      return { error, elapsedMs: Date.now() - startedAt };
    }
    throw new Error("the run did not fail");
  };

  const moneyOf = async (userId: string) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
    const reservations = await prisma.creditReservation.findMany();
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
    return {
      balance: account.balance.toFixed(6),
      held: account.held.toFixed(6),
      reservations: reservations.map((r) => [r.status, r.consumed.toFixed(6)]),
      entries: entries.map((e) => [e.outcome, e.amount.toFixed(6)]),
    };
  };

  it.each(MODES)("AC7 %s: the call runs out of its 1 s budget → the time budget error; one provider_error entry of 0, the hold released, no other charge, the run failed (not budget_stopped)", async (mode) => {
    await settings.saveSetting({ name: SETTING, value: 1, author: AUTHOR });
    const { bob, request } = await seed();
    const { fetchSpy, signals } = stubSilentProvider();
    const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");

    const { error, elapsedMs } = await runIn(mode, request);

    expect(error).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(elapsedMs).toBeGreaterThanOrEqual(MS_PER_SECOND - 50);
    expect(elapsedMs).toBeLessThan(MS_PER_SECOND + CLOCK_SLACK_MS);
    expect([fetchSpy.mock.calls.length, signals[0].aborted, signals[0].reason]).toEqual([1, true, error]);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["failed"]);
    expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [["released", "0.000000"]], entries: [["provider_error", "0.000000"]] });
    expect(persistence.saveExchange).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC9: the setting changed in the registry → the next call carries the new budget in its ChatRequest, and it applies", async () => {
    const chat = jest.spyOn(moduleRef.get(ProviderRouter), "chat");
    await settings.saveSetting({ name: SETTING, value: 1, author: AUTHOR });
    const { request } = await seed();
    stubSilentProvider();
    const first = await runIn("collected", request);

    await settings.saveSetting({ name: SETTING, value: 2, author: AUTHOR });
    const second = await runIn("collected", request);

    expect(chat.mock.calls.map(([params]) => params.timeBudgetMs)).toEqual([MS_PER_SECOND, 2 * MS_PER_SECOND]);
    expect([first.error, second.error].every((error) => error instanceof ProviderTimeBudgetExceededError)).toBe(true);
    expect(first.elapsedMs).toBeLessThan(MS_PER_SECOND + CLOCK_SLACK_MS);
    expect(second.elapsedMs).toBeGreaterThanOrEqual(2 * MS_PER_SECOND - 50);
  });

  it("control: without the setting the call carries no budget (today's behaviour)", async () => {
    const chat = jest.spyOn(moduleRef.get(ProviderRouter), "chat").mockRejectedValue(new Error("stop here"));
    const { request } = await seed();

    await runIn("collected", request);

    expect(chat.mock.calls[0][0]).not.toHaveProperty("timeBudgetMs");
  });
});
