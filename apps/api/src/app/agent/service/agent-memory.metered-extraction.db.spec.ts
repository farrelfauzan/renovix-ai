import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { UsageService } from "../../usage/service/usage.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { ProviderAttemptDeadlineError } from "../../providers/errors/provider-attempt-deadline-error";
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";

// RNX-284 (D296, D322): the automatic memory extraction (AgentMemoryService.extractAndStore) is metered. Its one model
// call is its own run on the runner's paid wallet: its own reservation, one usage entry at the model's normal rates,
// settled, or released when nothing was charged; never an orphan hold. One attempt within the platform setting
// memoryExtractionTimeoutSeconds, never retried; without the setting there is no call. Failures are logged by name only
// and never thrown. Real AgentMemoryService, meter, CreditService and UsageService on the test database; fake provider
// (AC4 hands the call to the real OpenRouterAdapter over a stubbed fetch).
describe("RNX-284: the memory extraction's own metered model call (test database, fake provider)", () => {
  const SETTING = "memoryExtractionTimeoutSeconds";
  const USER_TEXT = "PRIVATE USER TEXT I like Rust";
  const ANSWER_TEXT = "PRIVATE ANSWER TEXT Noted";
  const FACT = { type: "interest", content: "Likes Rust", confidence: 0.8 };
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [AgentMemoryService, AgentRunMeterService, CreditService, PlatformSettingsService, ModelRegistryService, UsageService],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(AgentMemoryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const setTimeoutSetting = (seconds: number) => prisma.platformSetting.create({ data: { name: SETTING, value: seconds } });

  /** Alice, funded with `credits` (none for "0"), and an agent in her own (non-default) workspace. */
  const seed = async (credits = "1") => {
    const alice = await createUser(prisma);
    if (credits !== "0") await fundPaidWallet(prisma, alice.id, credits);
    const workspace = await createWorkspace(prisma, { ownerId: alice.id });
    const agent = await createAgent(prisma, { userId: alice.id, workspaceId: workspace.id });
    return { alice, workspace, agent };
  };

  const extract = (agentId: string, userId: string) => service.extractAndStore(agentId, userId, USER_TEXT, ANSWER_TEXT, "inside");

  const reservationsOf = (userId: string) =>
    prisma.creditReservation.findMany({ where: { account: { userId } }, orderBy: { createdAt: "asc" } });
  const usageEntriesOf = (userId: string) =>
    prisma.creditLedgerEntry.findMany({ where: { memberUserId: userId, type: "usage" }, orderBy: { seq: "asc" } });
  const accountOf = (userId: string) =>
    prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
  const factsStored = async () => (await prisma.workspaceMemory.count()) + (await prisma.userMemory.count());

  /** A failed or refused extraction: one hold placed and released, one usage entry of 0 (provider_error), the balance untouched, nothing stored. */
  const expectReleasedUncharged = async (userId: string) => {
    expect((await reservationsOf(userId)).map((r) => [r.status, r.consumed.toFixed(6)])).toEqual([["released", "0.000000"]]);
    expect((await usageEntriesOf(userId)).map((e) => [e.outcome, e.amount.toFixed(6)])).toEqual([["provider_error", "0.000000"]]);
    expect([(await accountOf(userId)).balance.toFixed(6), (await accountOf(userId)).held.toFixed(6)]).toEqual(["1.000000", "0.000000"]);
    expect(await factsStored()).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  };

  /** No log line carries the exchange's text or the model's answer (redacted logs). */
  const expectRedacted = (lines: string[], ...secrets: string[]) => {
    for (const secret of [USER_TEXT, ANSWER_TEXT, ...secrets]) expect(lines.filter((line) => line.includes(secret))).toEqual([]);
  };

  describe("AC3: the money branches, each with its own hold on the runner's wallet, never an orphan", () => {
    it("success: one request (one attempt of 15 s), one reservation settled for what it charged at the normal rate, one completed usage entry with the agent, the fact stored", async () => {
      const { alice, workspace, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ content: JSON.stringify([FACT]), usage: { prompt_tokens: 100, completion_tokens: 20 } });

      await extract(agent.id, alice.id);

      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]).toMatchObject({ model: "test-model", singleAttemptTimeoutMs: 15000, max_tokens: 500 });
      const [reservation] = await reservationsOf(alice.id);
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000120"]);
      const entries = await usageEntriesOf(alice.id);
      expect(entries.map((e) => [e.outcome, e.amount.toFixed(6), e.agentId, e.runId])).toEqual([["completed", "-0.000120", agent.id, reservation.runId]]);
      const account = await accountOf(alice.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999880", "0.000000"]);
      expect(await prisma.workspaceMemory.findMany({ where: { workspaceId: workspace.id } })).toEqual([
        expect.objectContaining({ content: "Likes Rust", type: "interest" }),
      ]);
      expect(await prisma.usageLog.count({ where: { userId: alice.id } })).toBe(1);
      await assertCreditLedgerInvariants(prisma);
    });

    it("review finding 2: the hold is only this one call's estimate (counted prompt + max_tokens 500 at the rates), not min(cap, available)", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ content: "[]", usage: { prompt_tokens: 100, completion_tokens: 20 } });

      await extract(agent.id, alice.id);

      // Standard 1 / 1 / 1: E_call = (counted prompt + 500) micro-credits; min(cap 10, available 1) would be 1.
      const expectedHeld = ((countPromptTokens(fake.requests[0].messages) + 500) / 1_000_000).toFixed(6);
      const [reservation] = await reservationsOf(alice.id);
      expect(reservation.amountHeld.toFixed(6)).toBe(expectedHeld);
      expect(reservation.amountHeld.lessThan(1)).toBe(true);
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000120"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("a provider that reports more than the estimate (over max_tokens): the hold is used up, the rest is charged from the available balance, settled", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ content: "[]", usage: { prompt_tokens: 5000, completion_tokens: 600 } });

      await extract(agent.id, alice.id);

      const [reservation] = await reservationsOf(alice.id);
      expect(reservation.status).toBe("settled");
      expect(reservation.consumed.toFixed(6)).toBe(reservation.amountHeld.toFixed(6));
      expect((await usageEntriesOf(alice.id)).map((e) => [e.outcome, e.amount.toFixed(6)])).toEqual([["completed", "-0.005600"]]);
      const account = await accountOf(alice.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.994400", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("insufficient credit: the reservation is refused before any call; no hold, no usage, nothing stored; logged by name, never thrown", async () => {
      const { alice, agent } = await seed("0");
      await setTimeoutSetting(15);
      const { lines } = captureLogLines();

      await expect(extract(agent.id, alice.id)).resolves.toBeUndefined();

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
      expect(await factsStored()).toBe(0);
      expect(lines.filter((line) => line.includes("Memory extraction failed"))).toEqual([
        expect.stringContaining("CreditsExhaustedException"),
      ]);
      expectRedacted(lines);
    });

    it("provider failure: the hold is released, the call's usage entry is 0, nothing stored; the log names the error only", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ error: { code: 500, message: "PROVIDER BODY TEXT" } });
      const { lines } = captureLogLines();

      await expect(extract(agent.id, alice.id)).resolves.toBeUndefined();

      expect(fake.requests).toHaveLength(1);
      await expectReleasedUncharged(alice.id);
      expect(lines.filter((line) => line.includes("Memory extraction failed"))).toEqual([expect.stringContaining("ProviderHttpError")]);
      expectRedacted(lines, "PROVIDER BODY TEXT");
    });

    it("D331: a 503 is not moved to the model's fallback model: one request, the hold released, nothing stored", async () => {
      const fallback = await createResolvableModel(prisma, { slug: "fallback-model", modelName: "fallback-model", maxTokens: 8192 });
      const primary = await prisma.aiModel.findFirstOrThrow({ where: { slug: "test-model" } });
      await prisma.aiModelFallback.create({ data: { modelId: primary.id, fallbackModelId: fallback.model.id, position: 0 } });
      await prisma.aiModelFallback.create({ data: { modelId: fallback.model.id, fallbackModelId: primary.id, position: 0 } });
      await moduleRef.get(ModelRegistryService).refresh();
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ error: { code: 503, message: "unavailable" } });

      await expect(extract(agent.id, alice.id)).resolves.toBeUndefined();

      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0].connection.fallbacks ?? []).toEqual([]);
      await expectReleasedUncharged(alice.id);
    });

    it.each([
      ["timeout (the single attempt's deadline)", () => new ProviderAttemptDeadlineError(), "ProviderAttemptDeadlineError"],
      // An Error named AbortError: Jest's sandbox has its own Error, so a DOMException is not `instanceof Error` here.
      ["cancel (the call aborted)", () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "AbortError"],
    ] as const)("%s: the hold is released, the call's usage entry is 0, nothing stored; logged by name", async (_name, failure, name) => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      jest.spyOn(fake, "chat").mockRejectedValueOnce(failure());
      const { lines } = captureLogLines();

      await expect(extract(agent.id, alice.id)).resolves.toBeUndefined();

      await expectReleasedUncharged(alice.id);
      expect(lines.filter((line) => line.includes("Memory extraction failed"))).toEqual([expect.stringContaining(name)]);
      expectRedacted(lines);
    });

    it("an answer that is not JSON: charged and settled like any answer, nothing stored, and the parse error's text (it quotes the answer) is not logged", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ content: "[MODEL SAID SOMETHING PRIVATE", usage: { prompt_tokens: 10, completion_tokens: 10 } });
      const { lines } = captureLogLines();

      await extract(agent.id, alice.id);

      expect((await reservationsOf(alice.id)).map((r) => r.status)).toEqual(["settled"]);
      expect(await factsStored()).toBe(0);
      expectRedacted(lines, "MODEL SAID SOMETHING PRIVATE");
    });

    it("two extractions: two reservations and two usage entries, one each, every hold closed", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      fake.enqueue({ content: "[]", usage: { prompt_tokens: 10, completion_tokens: 1 } }, { error: { code: 503, message: "busy" } });

      await extract(agent.id, alice.id);
      await extract(agent.id, alice.id);

      expect(fake.requests).toHaveLength(2);
      const reservations = await reservationsOf(alice.id);
      expect(reservations.map((r) => r.status)).toEqual(["settled", "released"]);
      const entries = await usageEntriesOf(alice.id);
      expect(entries.map((e) => [e.runId, e.outcome])).toEqual([
        [reservations[0].runId, "completed"],
        [reservations[1].runId, "provider_error"],
      ]);
      expect((await accountOf(alice.id)).held.toFixed(6)).toBe("0.000000");
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC5: without the setting there is no extraction", () => {
    it("no request, no hold, no usage, nothing stored; the log names the missing setting", async () => {
      const { alice, agent } = await seed();
      const { lines } = captureLogLines();

      await extract(agent.id, alice.id);

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
      expect(await factsStored()).toBe(0);
      expect(lines.filter((line) => line.includes(SETTING))).toEqual([
        expect.stringContaining("Memory extraction skipped: the platform setting memoryExtractionTimeoutSeconds is not set"),
      ]);
    });
  });

  describe("AC4: the 15 s setting is the call's only deadline, with no retry (real adapter, stubbed fetch)", () => {
    it("a pending extraction call is stopped when its 15 s timeout fires: one request, never the 300 s timeout or a retry; the hold released, nothing stored", async () => {
      const { alice, agent } = await seed();
      await setTimeoutSetting(15);
      const adapter = new OpenRouterAdapter(new ConfigService());
      const sent: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementationOnce((request: ChatRequest) => {
        sent.push(request);
        return adapter.chat(request);
      });
      const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
        const signal = init!.signal!;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      });
      const timeouts: number[] = [];
      const deadlines: AbortController[] = [];
      jest.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
        timeouts.push(ms);
        deadlines.push(new AbortController());
        return deadlines[deadlines.length - 1].signal;
      });
      let isSettled = false;
      const { lines } = captureLogLines();

      const extraction = extract(agent.id, alice.id).then(() => void (isSettled = true));
      while (fetchSpy.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(isSettled).toBe(false);
      expect((await reservationsOf(alice.id)).map((r) => r.status)).toEqual(["open"]);
      deadlines[0].abort(new DOMException("timed out", "TimeoutError"));
      await extraction;

      expect(sent.map((r) => r.singleAttemptTimeoutMs)).toEqual([15000]);
      expect(timeouts).toEqual([15000]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await expectReleasedUncharged(alice.id);
      expect(lines.filter((line) => line.includes("Memory extraction failed"))).toEqual([expect.stringContaining("ProviderAttemptDeadlineError")]);
    });
  });

  it("R17 (kept): a run outside the workspace makes no call and places no hold", async () => {
    const { agent } = await seed();
    const outsider = await createUser(prisma);
    await fundPaidWallet(prisma, outsider.id, "1");
    await setTimeoutSetting(15);

    await service.extractAndStore(agent.id, outsider.id, USER_TEXT, ANSWER_TEXT, "outside");

    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
  });
});
