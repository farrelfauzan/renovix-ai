import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ProviderRouter } from "./provider-router";
import type { ChatRequest } from "./provider.interface";
import type { ModelConnection } from "./types/model-connection";
import type { ServedBy } from "./types/served-by";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../test/llm-stub";

// RNX-179 (D58, D149): per-model fallback models and a per-provider circuit breaker in ProviderRouter, with the real
// OpenRouterAdapter against local stub providers (every other host is blocked). P1 and P2 are two provider records;
// model M (slug cc/x) is on P1, its fallback F (slug y) on P2. Obviously fake keys only.

const P1_KEY = "rnx179-marker-key-not-real-p1";
const P2_KEY = "rnx179-marker-key-not-real-p2";
const REMOVED_FALLBACK_KEY = "rnx179-marker-key-not-real-removed-fallback";
const REMOVED_MAP = '{"cc/x":"rnx179-mapped-id"}';
const REMOVED_VARIABLES = ["LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_MODEL_ID_MAP"] as const;
const ENV_KEYS = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "OPENROUTER_API_KEY", ...REMOVED_VARIABLES] as const;
/** The breaker's numbers (provider-circuit-breaker.ts). */
const FAILURES_TO_OPEN = 5;
const OPEN_MS = 30_000;

const savedEnv = ENV_KEYS.map((k) => process.env[k]);
const realSetTimeout = global.setTimeout;
let p1: StubHttpServer;
let p2: StubHttpServer;
let removedFallbackStub: StubHttpServer;
let blocker: OutboundBlocker;
let warnings: string[];

/** A router over a fresh real adapter, built with exactly `env` set (the shell's LLM values are cleared). */
const makeRouter = (env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): ProviderRouter => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  return new ProviderRouter(new OpenRouterAdapter(new ConfigService()));
};

const fallbackF = (over: Partial<ModelConnection> = {}): ModelConnection => ({
  slug: "y",
  baseUrl: p2.baseUrl,
  apiKey: P2_KEY,
  providerName: "P2",
  providerRecordId: "provider-p2",
  ...over,
});

const modelM = (over: Partial<ModelConnection> = {}): ModelConnection => ({
  slug: "cc/x",
  baseUrl: p1.baseUrl,
  apiKey: P1_KEY,
  providerName: "P1",
  providerRecordId: "provider-p1",
  fallbacks: [fallbackF()],
  ...over,
});

const request = (connection: ModelConnection = modelM()): ChatRequest => ({
  model: connection.slug,
  connection,
  messages: [{ role: "user", content: "hi" }],
});

const answer = (stub: StubHttpServer, status: number) => stub.respond((_r, res) => sendJson(res, status, { error: "upstream says no" }));

/** Every payload of a stream. */
const drain = async (stream: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const payload of stream) out.push(payload);
  return out;
};

beforeAll(async () => {
  [p1, p2, removedFallbackStub] = await Promise.all([startStubHttpServer(), startStubHttpServer(), startStubHttpServer()]);
});

beforeEach(() => {
  blocker = blockOutbound();
  for (const stub of [p1, p2, removedFallbackStub]) {
    stub.requests.length = 0;
    stub.respond((_r, res) => sendJson(res, 200, chatCompletion(`from ${stub === p1 ? "P1" : stub === p2 ? "P2" : "removed"}`)));
  }
  warnings = [];
  jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => void warnings.push(String(message)));
  // The adapter's retry back-off (2 s .. 60 s) runs at once; every other timer (Prisma's transaction timeout too)
  // is untouched.
  jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realSetTimeout(fn, ms && ms >= 2000 && ms <= 60000 && /openrouter\.adapter/.test(new Error().stack ?? "") ? 0 : ms)) as typeof setTimeout);
});

afterEach(() => {
  blocker.restore();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([p1.close(), p2.close(), removedFallbackStub.close()]);
  ENV_KEYS.forEach((k, i) => (savedEnv[i] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[i])));
});

describe("RNX-179 AC1: a 503 moves the call to the fallback model", () => {
  it("P1 answers 503 → P2 receives model y with P2's key, once; P1 is asked once (no back-off with a fallback left)", async () => {
    answer(p1, 503);

    const response = await makeRouter().chat(request());

    expect(response.choices[0].message.content).toBe("from P2");
    expect(response.servedBy).toEqual({ slug: "y", providerName: "P2" });
    expect(p1.requests).toHaveLength(1);
    expect(p1.requests[0].body.model).toBe("cc/x");
    expect(p2.requests).toHaveLength(1);
    expect(p2.requests[0].body.model).toBe("y");
    expect(p2.requests[0].headers.authorization).toBe(`Bearer ${P2_KEY}`);
    expect(blocker.blocked).toEqual([]);
  });

  it("a 502 also moves the call to the fallback", async () => {
    answer(p1, 502);

    const response = await makeRouter().chat(request());

    expect(response.servedBy).toEqual({ slug: "y", providerName: "P2" });
    expect(p2.requests.map((r) => r.body.model)).toEqual(["y"]);
  });

  it("onAttemptFailed is awaited once per attempt that falls over, before the fallback is called; never for the last attempt or a 400", async () => {
    answer(p1, 503);
    const events: string[] = [];
    const hooks = {
      onAttemptFailed: async (failed: ServedBy, error: unknown) => {
        await new Promise((resolve) => realSetTimeout(resolve, 20));
        events.push(`failed ${failed.slug} ${failed.providerName} ${(error as { status?: number }).status} p2=${p2.requests.length}`);
      },
    };
    const router = makeRouter();

    await router.chat(request(), hooks);
    await router.chat(request(modelM({ fallbacks: [] })), hooks).catch(() => undefined);
    answer(p1, 400);
    await router.chat(request(), hooks).catch(() => undefined);

    expect(events).toEqual(["failed cc/x P1 503 p2=0"]);
  });

  it("control: P1 answers → P1 serves, P2 receives nothing", async () => {
    const response = await makeRouter().chat(request());

    expect(response.servedBy).toEqual({ slug: "cc/x", providerName: "P1" });
    expect(p2.requests).toHaveLength(0);
  });
});

describe("RNX-179 AC2 (negative): no fallback on 400, 401/403 or a network error", () => {
  it.each([400, 401, 403])("P1 answers %i → that error reaches the caller; P2 receives nothing", async (status) => {
    answer(p1, status);

    await expect(makeRouter().chat(request())).rejects.toMatchObject({ status });

    expect(p1.requests).toHaveLength(1);
    expect(p2.requests).toHaveLength(0);
  });

  it("P1 cannot be reached (nothing listens) → the network error reaches the caller; P2 receives nothing", async () => {
    const closed = await startStubHttpServer();
    await closed.close();

    await expect(makeRouter().chat(request(modelM({ baseUrl: closed.baseUrl })))).rejects.toThrow();

    expect(p2.requests).toHaveLength(0);
  });
});

describe("RNX-179 AC5: per-provider circuit breaker (5 failures, 30 s)", () => {
  it("5 failed calls on P1 → the next call skips P1 for 30 s and goes to P2; after 30 s P1 is tried again", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    answer(p1, 503);
    const router = makeRouter();
    for (let call = 0; call < FAILURES_TO_OPEN; call++) await router.chat(request());
    const p1AfterFailures = p1.requests.length;

    const skipped = await router.chat(request());
    now += OPEN_MS - 1;
    const stillSkipped = await router.chat(request());
    now += 2;
    p1.respond((_r, res) => sendJson(res, 200, chatCompletion("from P1")));
    const retried = await router.chat(request());

    expect(p1AfterFailures).toBe(FAILURES_TO_OPEN);
    expect(skipped.servedBy).toEqual({ slug: "y", providerName: "P2" });
    expect(stillSkipped.servedBy).toEqual({ slug: "y", providerName: "P2" });
    expect(retried.servedBy).toEqual({ slug: "cc/x", providerName: "P1" });
    expect(p1.requests).toHaveLength(FAILURES_TO_OPEN + 1);
    expect(warnings.filter((w) => /\[circuit\] provider P1 is open; skipping cc\/x/.test(w))).toHaveLength(2);
  });

  it("control: P1's open breaker leaves P2's closed: a model on P2 is still called", async () => {
    answer(p1, 503);
    const router = makeRouter();
    for (let call = 0; call < FAILURES_TO_OPEN; call++) await router.chat(request());
    p2.requests.length = 0;

    const onP2 = await router.chat(request(fallbackF()));

    expect(onP2.servedBy).toEqual({ slug: "y", providerName: "P2" });
    expect(p2.requests).toHaveLength(1);
  });

  it("control: 4 failures do not open the breaker (the 5th call still reaches P1)", async () => {
    answer(p1, 503);
    const router = makeRouter();
    for (let call = 0; call < FAILURES_TO_OPEN - 1; call++) await router.chat(request());

    await router.chat(request());

    expect(p1.requests).toHaveLength(FAILURES_TO_OPEN);
  });

  it("negative: 4xx answers do not count (5 × 400 on P1, then P1 is still called)", async () => {
    answer(p1, 400);
    const router = makeRouter();
    for (let call = 0; call < FAILURES_TO_OPEN; call++) await router.chat(request()).catch(() => undefined);

    await router.chat(request()).catch(() => undefined);

    expect(p1.requests).toHaveLength(FAILURES_TO_OPEN + 1);
  });

  it("with no fallback left, an open breaker answers the typed 503 without calling P1", async () => {
    answer(p1, 503);
    const router = makeRouter();
    for (let call = 0; call < FAILURES_TO_OPEN; call++) await router.chat(request());
    const before = p1.requests.length;

    await expect(router.chat(request(modelM({ fallbacks: [] })))).rejects.toMatchObject({ status: 503, kind: "unavailable" });

    expect(p1.requests).toHaveLength(before);
  });
});

describe("RNX-179 AC6: streams fail over only before the first byte", () => {
  it("P1 answers 503 to the stream → P2 streams it (model y, P2's key); the hooks name both attempts and the failed one", async () => {
    answer(p1, 503);
    p2.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"from P2"}}]}']));
    const tried: ServedBy[] = [];
    const failed: ServedBy[] = [];

    const payloads = await drain(
      makeRouter().chatStream(request(), { onAttempt: (t) => tried.push(t), onAttemptFailed: (f) => void failed.push(f) }),
    );

    expect(payloads).toEqual(['{"choices":[{"delta":{"content":"from P2"}}]}']);
    expect(tried).toEqual([{ slug: "cc/x", providerName: "P1" }, { slug: "y", providerName: "P2" }]);
    expect(failed).toEqual([{ slug: "cc/x", providerName: "P1" }]);
    expect(p1.requests).toHaveLength(1);
    expect(p2.requests[0].body).toMatchObject({ model: "y", stream: true });
    expect(p2.requests[0].headers.authorization).toBe(`Bearer ${P2_KEY}`);
  });

  it("negative: P1 fails after its first payload → the error reaches the caller after that payload; P2 receives nothing", async () => {
    p1.respond((_r, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      realSetTimeout(() => res.destroy(), 20);
    });
    const received: string[] = [];

    const consume = async () => {
      for await (const payload of makeRouter().chatStream(request())) received.push(payload);
    };

    await expect(consume()).rejects.toThrow();
    expect(received).toEqual(['{"choices":[{"delta":{"content":"first"}}]}']);
    expect(p2.requests).toHaveLength(0);
  });

  it("negative: a 400 on the stream → no fallback", async () => {
    answer(p1, 400);

    await expect(drain(makeRouter().chatStream(request()))).rejects.toMatchObject({ status: 400 });

    expect(p2.requests).toHaveLength(0);
  });
});

describe("RNX-179 AC7: the removed LLM_* variables are warned about at boot and have no effect", () => {
  const removedEnv = () => ({
    LLM_FALLBACK_BASE_URL: removedFallbackStub.baseUrl,
    LLM_FALLBACK_API_KEY: REMOVED_FALLBACK_KEY,
    LLM_MODEL_ID_MAP: REMOVED_MAP,
  });

  it("all three set → one warning per variable, naming it and never its value", () => {
    makeRouter(removedEnv());

    const removedWarnings = warnings.filter((w) => /has no effect/.test(w));
    expect(removedWarnings).toHaveLength(3);
    for (const name of REMOVED_VARIABLES) expect(removedWarnings.filter((w) => w.includes(name))).toHaveLength(1);
    expect(warnings.join("\n")).not.toContain(REMOVED_FALLBACK_KEY);
    expect(warnings.join("\n")).not.toContain(removedFallbackStub.baseUrl);
    expect(warnings.join("\n")).not.toContain("rnx179-mapped-id");
  });

  it("only one set → exactly one warning, naming that variable", () => {
    makeRouter({ LLM_MODEL_ID_MAP: REMOVED_MAP });

    expect(warnings.filter((w) => /has no effect/.test(w))).toEqual([expect.stringContaining("LLM_MODEL_ID_MAP")]);
  });

  it("negative: they have no effect: a 503 on a model with no fallback surfaces; the removed fallback URL gets nothing, the slug is not mapped", async () => {
    answer(p1, 503);
    const router = makeRouter(removedEnv());

    await expect(router.chat(request(modelM({ fallbacks: [] })))).rejects.toMatchObject({ status: 503 });

    expect(removedFallbackStub.requests).toHaveLength(0);
    expect(new Set(p1.requests.map((r) => r.body.model))).toEqual(new Set(["cc/x"]));
  });

  it("control: none set → no such warning", () => {
    makeRouter();

    expect(warnings.filter((w) => /has no effect/.test(w))).toEqual([]);
  });
});
