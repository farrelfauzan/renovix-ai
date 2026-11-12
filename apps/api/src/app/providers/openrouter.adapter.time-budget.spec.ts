import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ProviderRouter } from "./provider-router";
import type { ChatRequest } from "./provider.interface";
import { ProviderTimeBudgetExceededError } from "./errors/provider-time-budget-exceeded-error";
import { startCallBudget } from "./utils/start-call-budget";
import { chatCompletion } from "../../../test/llm-stub";
import { testConnection } from "../../../test/provider-model";

// RNX-44: the call's time budget inside the real OpenRouterAdapter (ProviderRouter hands it the budget as
// `ChatRequest.budget`): the try in flight is cut when the budget runs out, a back-off or Retry-After wait starts only
// when the time left covers it, and the caller's abort keeps its RNX-310 meaning. Fake timers (Date too) drive the
// clock; the global fetch is stubbed (no network) and, as a real fetch does, rejects with its signal's reason once that
// signal aborts. AbortSignal.timeout runs on the fake clock too.

const BUDGET_MS = 20_000;
const CHAT_TIMEOUT_MS = 300_000;
const PENDING = Symbol("pending");
const NOT_FAKED = ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] as const;
const realSetTimeout = global.setTimeout;

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "m",
  connection: testConnection({ slug: "m", providerRecordId: "provider-p1" }),
  messages: [{ role: "user", content: "hi" }],
  ...over,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** An SSE response whose body sends nothing until its signal aborts, then errors with the signal's reason. */
const silentStream = (signal: AbortSignal): Response =>
  new Response(
    new ReadableStream({ start: (controller) => signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }) }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

/** The call's outcome as it stands (its value, its error, or PENDING), read without awaiting it. */
const track = (calling: Promise<unknown>): { outcome: unknown } => {
  const state: { outcome: unknown } = { outcome: PENDING };
  calling.then(
    (value) => void (state.outcome = value),
    (err: unknown) => void (state.outcome = err),
  );
  return state;
};

const drain = async (stream: AsyncGenerator<string>): Promise<string[]> => {
  const payloads: string[] = [];
  for await (const payload of stream) payloads.push(payload);
  return payloads;
};

/** One real macrotask: every pending promise callback runs; no fake timer moves. */
const flush = (): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, 0));

/**
 * Global fetch stubbed: request n (0-based) gets `answer(n, signal)`, or hangs until its signal fires when that is
 * undefined. Each request's time on the fake clock and its signal are kept.
 */
const stubFetch = (answer: (index: number, signal: AbortSignal) => Response | undefined = () => undefined) => {
  const sentAt: number[] = [];
  const signals: AbortSignal[] = [];
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    const signal = init!.signal!;
    sentAt.push(Date.now());
    signals.push(signal);
    if (signal.aborted) return Promise.reject(signal.reason);
    const answered = answer(signals.length - 1, signal);
    if (answered) return Promise.resolve(answered);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  return { fetchSpy, sentAt, signals };
};

let adapter: OpenRouterAdapter;
let startedAt: number;
let timeouts: number[];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: [...NOT_FAKED] });
  for (const level of ["log", "warn", "error"] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  timeouts = [];
  jest.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
    return deadline.signal;
  });
  adapter = new OpenRouterAdapter(new ConfigService());
  startedAt = Date.now();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("RNX-44 AC1: the adapter within a time budget, collected", () => {
  it("a provider that never answers: the try in flight is cut at B with the time budget error (not at the 300 s try timeout), one request", async () => {
    const { fetchSpy, signals } = stubFetch();
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ budget })));

    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.outcome).toBe(PENDING);
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect([signals[0].aborted, signals[0].reason]).toEqual([true, state.outcome]);
    expect(timeouts).toEqual([CHAT_TIMEOUT_MS]);
  });

  it("503 on every try: tries at 0, 2, 6 and 14 s; the 15 s back-off does not fit the 6 s left → the time budget error at 14 s, within B", async () => {
    const { sentAt } = stubFetch(() => json(503, { error: "busy" }));
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ budget })));

    await jest.advanceTimersByTimeAsync(14_000);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(sentAt.map((at) => at - startedAt)).toEqual([0, 2_000, 6_000, 14_000]);
    budget.stop();
  });

  it("control: 503 on every try without a budget keeps today's 6 tries over 44 s, ending in the 503", async () => {
    const { sentAt } = stubFetch(() => json(503, { error: "busy" }));
    const state = track(adapter.chat(request()));

    await jest.advanceTimersByTimeAsync(44_000);

    expect(state.outcome).toMatchObject({ name: "ProviderHttpError", status: 503 });
    expect(sentAt).toHaveLength(6);
  });

  it("a 503 whose Retry-After (30 s) is longer than the time left → the time budget error at once, no second request", async () => {
    const { fetchSpy } = stubFetch(() => json(503, { error: "busy" }, { "Retry-After": "30" }));
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ budget })));
    for (let i = 0; i < 10 && state.outcome === PENDING; i++) await flush();

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    budget.stop();
  });
});

describe("RNX-44 AC4: a call that succeeds on its second try within B", () => {
  it("503, then 200 after the 2 s back-off → the answer, as today", async () => {
    const { sentAt } = stubFetch((index) => (index === 0 ? json(503, { error: "busy" }) : json(200, chatCompletion("second try"))));
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ budget })));

    await jest.advanceTimersByTimeAsync(2_000);

    expect(state.outcome).toMatchObject({ choices: [{ message: { content: "second try" } }] });
    expect(sentAt.map((at) => at - startedAt)).toEqual([0, 2_000]);
    budget.stop();
  });
});

describe("RNX-44 AC6: the caller's abort wins over the budget; the budget is never read as a disconnect", () => {
  it("collected: the caller aborts during the back-off → the call rejects with the caller's reason at once (RNX-310), not the budget error", async () => {
    const { fetchSpy } = stubFetch(() => json(503, { error: "busy" }));
    const caller = new AbortController();
    const reason = new Error("caller went away");
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ signal: caller.signal, budget })));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(state.outcome).toBe(PENDING);

    caller.abort(reason);
    await flush();

    expect(state.outcome).toBe(reason);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    budget.stop();
  });

  it("collected: the budget runs out on the try after the back-off → the time budget error; the caller's signal is untouched", async () => {
    stubFetch((index) => (index === 0 ? json(503, { error: "busy" }) : undefined));
    const caller = new AbortController();
    const budget = startCallBudget(BUDGET_MS);
    const state = track(adapter.chat(request({ signal: caller.signal, budget })));

    await jest.advanceTimersByTimeAsync(BUDGET_MS);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(caller.signal.aborted).toBe(false);
  });

  describe("stream, through ProviderRouter (the response headers came, the first token never does)", () => {
    const router = (): ProviderRouter => new ProviderRouter(adapter);

    it("the caller aborts → the stream ends at once with nothing, no error (a client disconnect, RX-161)", async () => {
      stubFetch((_index, signal) => silentStream(signal));
      const caller = new AbortController();
      const state = track(drain(router().chatStream(request({ signal: caller.signal, timeBudgetMs: BUDGET_MS }))));
      await jest.advanceTimersByTimeAsync(3_000);
      expect(state.outcome).toBe(PENDING);

      caller.abort();
      await flush();

      expect(state.outcome).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("no abort → the time budget error at B, not the empty disconnect result", async () => {
      const { signals } = stubFetch((_index, signal) => silentStream(signal));
      const caller = new AbortController();
      const state = track(drain(router().chatStream(request({ signal: caller.signal, timeBudgetMs: BUDGET_MS }))));

      await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
      expect(state.outcome).toBe(PENDING);
      await jest.advanceTimersByTimeAsync(1);

      expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
      expect(signals[0].aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
    });
  });
});

describe("RNX-44 AC3: a stream whose response never comes, in the adapter", () => {
  it("the request is cut at B with the time budget error (not the 120 s connect timeout)", async () => {
    const { signals } = stubFetch();
    const budget = startCallBudget(BUDGET_MS);
    const state = track(drain(adapter.chatStream(request({ budget }))));

    await jest.advanceTimersByTimeAsync(BUDGET_MS);

    expect(state.outcome).toBeInstanceOf(ProviderTimeBudgetExceededError);
    expect(signals[0].aborted).toBe(true);
  });
});
