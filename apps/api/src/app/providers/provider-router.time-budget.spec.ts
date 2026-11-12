import { Logger } from "@nestjs/common";
import { ProviderRouter } from "./provider-router";
import type { ChatRequest, ChatResponse } from "./provider.interface";
import type { ModelConnection } from "./types/model-connection";
import type { ServedBy } from "./types/served-by";
import { ProviderHttpError } from "./errors/provider-http-error";
import { ProviderTimeoutError } from "./errors/provider-timeout-error";
import { ProviderTimeBudgetExceededError } from "./errors/provider-time-budget-exceeded-error";
import { FakeProviderAdapter } from "../../../test/fake-provider";
import { testConnection } from "../../../test/provider-model";

// RNX-44: one time budget per user-facing model call (`timeBudgetMs`), enforced by ProviderRouter across the fallback
// hops, and for a stream until its first payload. The fake provider stands in for the adapter (its chat and chatStream
// are replaced per test to fail, hang or answer late); fake timers (Date too) drive the clock. The adapter's own tries,
// back-off waits and the cut of the try in flight are in openrouter.adapter.time-budget.spec.ts.

const BUDGET_MS = 10_000;
/** The breaker's number (provider-circuit-breaker.ts). */
const FAILURES_TO_OPEN = 5;
const PENDING = Symbol("pending");
const NOT_FAKED = ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] as const;

const fallback = (slug: string, providerRecordId: string): ModelConnection =>
  testConnection({ slug, providerName: providerRecordId, providerRecordId });

const primary = (fallbacks: ModelConnection[] = []): ModelConnection =>
  testConnection({ slug: "m", providerName: "provider-p1", providerRecordId: "provider-p1", fallbacks });

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "m",
  connection: primary(),
  messages: [{ role: "user", content: "hi" }],
  timeBudgetMs: BUDGET_MS,
  ...over,
});

const answer = (content: string): ChatResponse => ({
  id: "gen-1",
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const hang = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** Settles after `ms` on the fake clock: with `value`, or rejected with `error`. */
const settleAfter = <T>(ms: number, outcome: { value?: T; error?: unknown }): Promise<T> =>
  new Promise<T>((resolve, reject) => setTimeout(() => (outcome.error ? reject(outcome.error) : resolve(outcome.value as T)), ms));

const unavailable = (): ProviderHttpError => new ProviderHttpError({ status: 503, kind: "unavailable" });

/** The call's outcome as it stands (its value, its error, or PENDING), read without awaiting it. */
const track = (calling: Promise<unknown>): { outcome: unknown } => {
  const state: { outcome: unknown } = { outcome: PENDING };
  calling.then(
    (value) => void (state.outcome = value),
    (err: unknown) => void (state.outcome = err),
  );
  return state;
};

/** Every payload of a stream. */
const drain = async (stream: AsyncGenerator<string>): Promise<string[]> => {
  const payloads: string[] = [];
  for await (const payload of stream) payloads.push(payload);
  return payloads;
};

/** A stream whose first payload comes after `firstAfterMs` (never, when undefined), the second `restAfterMs` later. */
async function* lateStream(firstAfterMs?: number, restAfterMs = 0): AsyncGenerator<string> {
  if (firstAfterMs === undefined) await hang();
  await settleAfter(firstAfterMs ?? 0, {});
  yield "first";
  await settleAfter(restAfterMs, {});
  yield "second";
}

/** A stream that fails before its first payload after `ms`. */
async function* failingStream(ms: number, error: unknown): AsyncGenerator<string> {
  await settleAfter(ms, { error });
}

let fake: FakeProviderAdapter;
let router: ProviderRouter;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: [...NOT_FAKED] });
  for (const level of ["log", "warn", "error"] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  fake = new FakeProviderAdapter();
  router = new ProviderRouter(fake);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("RNX-44 AC1: a hanging provider, collected", () => {
  it("the call fails with the time budget error at B, not before; the adapter's budget signal is aborted (the try in flight is cut)", async () => {
    const chat = jest.spyOn(fake, "chat").mockImplementation(() => hang());
    const state = track(router.chat(request()));

    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(state.outcome).toMatchObject({ name: "ProviderTimeBudgetExceededError", kind: "timeout", message: "Model call time budget exceeded" });
    const sent = chat.mock.calls[0][0];
    expect(sent.budget?.signal.aborted).toBe(true);
    expect(sent.budget?.signal.reason).toBe(state.outcome);
    expect(sent.signal).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("control: an answer within B is returned as today, and no timer is left", async () => {
    jest.spyOn(fake, "chat").mockImplementation(() => settleAfter(BUDGET_MS - 1, { value: answer("in time") }));
    const state = track(router.chat(request()));

    await jest.advanceTimersByTimeAsync(BUDGET_MS);

    expect(state.outcome).toMatchObject({ choices: [{ message: { content: "in time" } }], servedBy: { slug: "m" } });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("control: without timeBudgetMs the adapter gets no budget and the call is not cut", async () => {
    const chat = jest.spyOn(fake, "chat").mockImplementation(() => hang());
    const state = track(router.chat(request({ timeBudgetMs: undefined })));

    await jest.advanceTimersByTimeAsync(BUDGET_MS * 10);

    expect(state.outcome).toBe(PENDING);
    expect(chat.mock.calls[0][0]).not.toHaveProperty("budget");
  });
});

describe("RNX-44 AC2: the primary keeps failing and a fallback remains: fallback only while time is left, whole call within B", () => {
  const connection = primary([fallback("f1", "provider-p2"), fallback("f2", "provider-p3")]);
  const FAIL_AFTER_MS = 6_000;

  it("collected: P1 503 at 6 s, F1 would fail at 12 s → cut at 10 s with the time budget error; F2 never starts", async () => {
    const chat = jest.spyOn(fake, "chat").mockImplementation((params) =>
      params.connection.slug === "f2" ? Promise.resolve(answer("from f2")) : settleAfter(FAIL_AFTER_MS, { error: unavailable() }),
    );
    const state = track(router.chat(request({ connection })));

    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(chat.mock.calls.map(([params]) => params.connection.slug)).toEqual(["m", "f1"]);
    expect(chat.mock.calls[0][0].budget).toBe(chat.mock.calls[1][0].budget);
    expect(jest.getTimerCount()).toBe(1); // only F1's own (fake) failure timer, not the budget's
  });

  it("stream: P1 503 at 6 s before its first payload, F1 would fail at 12 s → cut at 10 s; F2 never starts", async () => {
    const chatStream = jest.spyOn(fake, "chatStream").mockImplementation((params) =>
      params.connection.slug === "f2" ? lateStream(0) : failingStream(FAIL_AFTER_MS, unavailable()),
    );
    const state = track(drain(router.chatStream(request({ connection }))));

    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(chatStream.mock.calls.map(([params]) => params.connection.slug)).toEqual(["m", "f1"]);
  });

  it("the budget runs out while P1's failure is being recorded → the hop to F1 fails at once with the time budget error (F1's answer is not used); P1 is reported failed once", async () => {
    jest.spyOn(fake, "chat").mockImplementation((params) =>
      params.connection.slug === "m" ? settleAfter(2_000, { error: unavailable() }) : Promise.resolve(answer("from f1")),
    );
    const onAttemptFailed = jest.fn((_failed: ServedBy) => settleAfter<void>(BUDGET_MS, {}));
    const state = track(router.chat(request({ connection }), { onAttemptFailed }));

    await jest.advanceTimersByTimeAsync(2_000 + BUDGET_MS);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(onAttemptFailed.mock.calls.map(([failed]) => failed.slug)).toEqual(["m"]);
  });

  it("control: P1 503 at 2 s, F1 answers at 3 s → served by F1 within B, as today", async () => {
    jest.spyOn(fake, "chat").mockImplementation((params) =>
      params.connection.slug === "m" ? settleAfter(2_000, { error: unavailable() }) : settleAfter(1_000, { value: answer("from f1") }),
    );
    const state = track(router.chat(request({ connection })));

    await jest.advanceTimersByTimeAsync(3_000);

    expect(state.outcome).toMatchObject({ choices: [{ message: { content: "from f1" } }], servedBy: { slug: "f1" } });
  });
});

describe("RNX-44 AC3: a stream whose first payload never arrives", () => {
  it("fails with the time budget error at B, nothing yielded", async () => {
    jest.spyOn(fake, "chatStream").mockImplementation(() => lateStream(undefined));
    const state = track(drain(router.chatStream(request())));

    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("control: a first payload just within B, the rest long after B → the whole stream, no limit after the first payload", async () => {
    jest.spyOn(fake, "chatStream").mockImplementation(() => lateStream(BUDGET_MS - 1, BUDGET_MS * 5));
    const state = track(drain(router.chatStream(request())));

    await jest.advanceTimersByTimeAsync(BUDGET_MS * 6);

    expect(state.outcome).toEqual(["first", "second"]);
  });
});

describe("RNX-44 AC5: a single attempt (singleAttemptTimeoutMs, the extraction) has no budget", () => {
  it("the adapter gets no budget and the call is not cut at B; singleAttemptTimeoutMs reaches the adapter unchanged", async () => {
    const chat = jest.spyOn(fake, "chat").mockImplementation(() => settleAfter(BUDGET_MS * 2, { value: answer("late but whole") }));
    const state = track(router.chat(request({ singleAttemptTimeoutMs: 15_000 })));

    await jest.advanceTimersByTimeAsync(BUDGET_MS + 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(BUDGET_MS);

    expect(state.outcome).toMatchObject({ choices: [{ message: { content: "late but whole" } }] });
    expect(chat.mock.calls[0][0]).not.toHaveProperty("budget");
    expect(chat.mock.calls[0][0].singleAttemptTimeoutMs).toBe(15_000);
  });
});

describe("RNX-44 AC8: a time budget that runs out never opens the provider's circuit breaker", () => {
  const callsEndingIn = async (count: number, failure: () => Promise<ChatResponse>): Promise<unknown[]> => {
    jest.spyOn(fake, "chat").mockImplementation(failure);
    const outcomes: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const state = track(router.chat(request()));
      await jest.advanceTimersByTimeAsync(BUDGET_MS);
      outcomes.push(state.outcome);
    }
    return outcomes;
  };

  it("6 calls in a row end with the time budget error → the breaker stays closed: another user's call to the same provider is served", async () => {
    const outcomes = await callsEndingIn(FAILURES_TO_OPEN + 1, () => hang());
    expect(outcomes.every((outcome) => outcome instanceof ProviderTimeBudgetExceededError)).toBe(true);
    const chat = jest.spyOn(fake, "chat").mockResolvedValue(answer("served"));
    chat.mockClear();

    const actual = await router.chat(request({ messages: [{ role: "user", content: "another user" }] }));

    expect(actual).toMatchObject({ choices: [{ message: { content: "served" } }], servedBy: { slug: "m" } });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("control: 6 calls ending in the provider's own timeout open the breaker: the next call is refused with 503, the provider not called", async () => {
    await callsEndingIn(FAILURES_TO_OPEN + 1, () => Promise.reject(new ProviderTimeoutError()));
    const chat = jest.spyOn(fake, "chat").mockResolvedValue(answer("served"));
    chat.mockClear();

    await expect(router.chat(request())).rejects.toMatchObject({ status: 503 });

    expect(chat).not.toHaveBeenCalled();
  });
});
