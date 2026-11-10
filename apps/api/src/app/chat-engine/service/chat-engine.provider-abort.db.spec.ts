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
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { UsageService } from "../../usage/service/usage.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { chatCompletion } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-283 AC7: an abort cancels the provider request in flight, end to end: real ChatEngineService, ChatEngineMeterService,
// AgentRunMeterService, CreditService and the real OpenRouterAdapter, with the global fetch stubbed (no network): a
// request answers or hangs until its signal fires. The execution is scripted (two metered calls). The ledger stays
// correct: the cancelled call is a provider_error entry of 0, the hold is closed once. These collaborators load ESM-only
// packages and are stubbed.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));

const MODES = [["streamed"], ["collected"]] as const;

describe("RNX-283 AC7: the engine's abort cancels the in-flight provider call (real adapter, stubbed fetch, test database)", () => {
  const execution = {
    execute: jest.fn(async function* (input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
      for (let i = 0; i < 2; i++) {
        const { response } = await input.callModel({ messages: [{ role: "user", content: input.approvedInput }], max_tokens: 100 });
        yield { type: "text", text: response.choices[0].message.content ?? "" };
      }
    }),
  };
  const outputApproval = { approveOutput: jest.fn(async (content: string) => ({ status: "approved" as const, content })), approveToolResult: jest.fn() };
  const persistence = { saveExchange: jest.fn(async () => undefined), handToMemory: jest.fn(async () => undefined) };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: ChatEngineService;

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

  /**
   * Stubs the global fetch: the first `answered` requests get a chat completion (3 prompt and 2 completion tokens); the
   * next one is in flight (it settles only when its signal fires) and `controller` aborts the run right after it is sent.
   */
  const stubFetch = (answered: number, controller: AbortController) => {
    const signals: AbortSignal[] = [];
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init!.signal!;
      signals.push(signal);
      if (signals.length <= answered) return Promise.resolve(new Response(JSON.stringify(chatCompletion("first")), { status: 200, headers: { "Content-Type": "application/json" } }));
      const hanging = new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      controller.abort();
      return hanging;
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

  const failIn = async (mode: string, request: unknown, signal: AbortSignal): Promise<unknown> => {
    try {
      if (mode === "collected") await engine.collect(request, { signal });
      else for await (const _event of engine.run(request, { signal })) void _event;
    } catch (error) {
      return error;
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

  it.each(MODES)("%s: an abort during the first call cancels its request (no retry): one provider_error entry of 0, the hold released once, nothing stored", async (mode) => {
    const { bob, request } = await seed();
    const controller = new AbortController();
    const { fetchSpy, signals } = stubFetch(0, controller);
    const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
    const error = await failIn(mode, request, controller.signal);
    expect((error as Error).name).toBe("AbortError");
    expect([fetchSpy.mock.calls.length, signals[0].aborted]).toEqual([1, true]);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["failed"]);
    expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [["released", "0.000000"]], entries: [["provider_error", "0.000000"]] });
    expect([outputApproval.approveOutput.mock.calls.length, persistence.saveExchange.mock.calls.length]).toEqual([0, 0]);
    await assertCreditLedgerInvariants(prisma);
  });

  it.each(MODES)("%s: an abort during the second call: the first stays charged, the cancelled one is charged 0; settled once, no further request", async (mode) => {
    const { bob, request } = await seed();
    const controller = new AbortController();
    const { fetchSpy, signals } = stubFetch(1, controller);
    const error = await failIn(mode, request, controller.signal);
    expect((error as Error).name).toBe("AbortError");
    expect([fetchSpy.mock.calls.length, signals[1].aborted]).toEqual([2, true]);
    // 3 x 2 + 2 x 3 = 12 micro-credits for the first call.
    expect(await moneyOf(bob.id)).toEqual({
      balance: "0.999988",
      held: "0.000000",
      reservations: [["settled", "0.000012"]],
      entries: [["completed", "-0.000012"], ["provider_error", "0.000000"]],
    });
    expect(persistence.saveExchange).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });
});
