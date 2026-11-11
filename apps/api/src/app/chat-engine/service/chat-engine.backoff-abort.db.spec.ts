import { Logger } from "@nestjs/common";
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
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-310 AC3: an abort during a chat call's back-off wait ends the metered run at once, end to end: real
// ChatEngineService, ChatEngineMeterService, AgentRunMeterService, CreditService and the real OpenRouterAdapter, with the
// global fetch stubbed (no network). The provider answers 429; the run is aborted once the adapter starts its 5 s
// back-off. The run closes as failed, the hold is closed long before the back-off would end, and the ledger has the one
// provider call only. These collaborators load ESM-only packages and are stubbed (as in chat-engine.provider-abort).
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));

const MODES = [["streamed"], ["collected"]] as const;
/** The adapter's back-off after a first 429 (unchanged by RNX-310). */
const BACK_OFF_MS = 5000;

describe("RNX-310 AC3: an abort during the 429 back-off ends the metered run at once (real adapter, stubbed fetch, test database)", () => {
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

  /** Global fetch stubbed: every request answers 429, or rejects with its signal's reason when that signal has already fired (as fetch does). */
  const stubFetch429 = () =>
    jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init!.signal!;
      if (signal.aborted) return Promise.reject(signal.reason);
      return Promise.resolve(new Response('{"error":"rate limited"}', { status: 429, headers: { "Content-Type": "application/json" } }));
    });

  /** Aborts `controller` on the next turn of the event loop after the adapter logs the start of its 5 s back-off; returns when that was. */
  const abortWhenBackOffStarts = (controller: AbortController): { startedAt?: number } => {
    const backOff: { startedAt?: number } = {};
    jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
      if (!String(message).includes(`Retrying in ${BACK_OFF_MS}ms`)) return;
      backOff.startedAt = Date.now();
      setImmediate(() => controller.abort());
    });
    return backOff;
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

  it.each(MODES)("%s: a 429, then an abort during the back-off: the run fails at once (well before the back-off ends), the hold released once, one provider_error entry of 0, no further request", async (mode) => {
    const { bob, request } = await seed();
    const controller = new AbortController();
    const fetchSpy = stubFetch429();
    const backOff = abortWhenBackOffStarts(controller);
    const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");

    const error = await failIn(mode, request, controller.signal);
    const endedAt = Date.now();

    expect((error as Error).name).toBe("AbortError");
    expect(backOff.startedAt).toBeDefined();
    expect(endedAt - backOff.startedAt!).toBeLessThan(BACK_OFF_MS / 2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["failed"]);
    expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [["released", "0.000000"]], entries: [["provider_error", "0.000000"]] });
    expect([outputApproval.approveOutput.mock.calls.length, persistence.saveExchange.mock.calls.length]).toEqual([0, 0]);
    await assertCreditLedgerInvariants(prisma);
  });
});
