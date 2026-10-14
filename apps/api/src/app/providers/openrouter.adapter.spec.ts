import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ChatRequest } from "./provider.interface";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../test/llm-stub";

// RX-160: the chat adapter reads base URL, key, default max_tokens, a fallback
// and a model id map from configuration. Only local stubs are called; every
// other host is blocked (blockOutbound), so no test reaches a real provider.

const PRIMARY_KEY = "rx160-marker-key-not-real-primary";
const FALLBACK_KEY = "rx160-marker-key-not-real-fallback";
const OPENROUTER_KEY = "rx160-marker-key-not-real-openrouter";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_APP_TITLE",
  "OPENROUTER_APP_URL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_DEFAULT_MAX_TOKENS",
  "LLM_FALLBACK_BASE_URL",
  "LLM_FALLBACK_API_KEY",
  "LLM_MODEL_ID_MAP",
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

const savedEnv = ENV_KEYS.map((k) => process.env[k]);
const realSetTimeout = global.setTimeout;
let blocker: OutboundBlocker;
let primary: StubHttpServer;
let fallback: StubHttpServer;
let retryDelays: number[];

/** A fresh adapter that sees exactly `env` (the shell's values are cleared). */
const makeAdapter = (env: Env): OpenRouterAdapter => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  return new OpenRouterAdapter(new ConfigService());
};

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "standard-cheap",
  providerId: "deepseek/deepseek-v4-flash",
  messages: [{ role: "user", content: "hi" }],
  ...over,
});

const drain = async (gen: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const p of gen) out.push(p);
  return out;
};

const answer503 = () => primary.respond((_r, res) => sendJson(res, 503, { error: "unavailable" }));

beforeAll(async () => {
  [primary, fallback] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
});

beforeEach(() => {
  blocker = blockOutbound();
  primary.requests.length = 0;
  fallback.requests.length = 0;
  primary.respond((_r, res) => sendJson(res, 200, chatCompletion("from primary")));
  fallback.respond((_r, res) => sendJson(res, 200, chatCompletion("from fallback")));
  // The retry back-off (2 s .. 60 s) runs at once; every other timer is untouched.
  retryDelays = [];
  jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    if (ms && ms >= 2000 && ms <= 60000) {
      retryDelays.push(ms);
      return realSetTimeout(fn, 0);
    }
    return realSetTimeout(fn, ms);
  }) as typeof setTimeout);
});

afterEach(() => {
  blocker.restore();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([primary.close(), fallback.close()]);
  ENV_KEYS.forEach((k, i) => {
    if (savedEnv[i] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[i];
  });
});

describe("RX-160 AC1/AC2: base URL and key", () => {
  it("AC1: LLM_BASE_URL → the chat reaches the stub with Bearer <LLM_API_KEY>", async () => {
    const adapter = makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY });

    const res = await adapter.chat(request());

    expect(res.choices[0].message.content).toBe("from primary");
    expect(primary.requests).toHaveLength(1);
    expect(primary.requests[0].url).toBe("/v1/chat/completions");
    expect(primary.requests[0].headers.authorization).toBe(`Bearer ${PRIMARY_KEY}`);
    expect(blocker.blocked).toHaveLength(0);
  });

  it("AC1: chatStream also reaches the stub", async () => {
    primary.respond((_r, res) => sendSse(res, ['{"a":1}']));
    const adapter = makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY });

    expect(await drain(adapter.chatStream(request()))).toEqual(['{"a":1}']);
    expect(primary.requests[0].headers.authorization).toBe(`Bearer ${PRIMARY_KEY}`);
  });

  it("AC2 control: only OPENROUTER_API_KEY → today's URL, key and OpenRouter headers", async () => {
    const adapter = makeAdapter({ OPENROUTER_API_KEY: OPENROUTER_KEY });

    await expect(adapter.chat(request())).rejects.toThrow(/outbound call to openrouter.ai blocked/);

    expect(blocker.blocked).toHaveLength(1);
    const sent = blocker.blocked[0];
    expect(sent.url).toBe(`${OPENROUTER_URL}/chat/completions`);
    expect(sent.headers.Authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(sent.headers["HTTP-Referer"]).toBe("https://chat.renovix.id");
    expect(sent.headers["X-Title"]).toBe("Renovix AI");
  });

  it("LLM_API_KEY wins over OPENROUTER_API_KEY", async () => {
    const adapter = makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY, OPENROUTER_API_KEY: OPENROUTER_KEY });

    await adapter.chat(request());

    expect(primary.requests[0].headers.authorization).toBe(`Bearer ${PRIMARY_KEY}`);
  });

  it("neither key set → construction fails as today", () => {
    expect(() => makeAdapter({ LLM_BASE_URL: primary.baseUrl })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("RX-160 AC3: fallback after 502/503", () => {
  const withFallback = (): OpenRouterAdapter =>
    makeAdapter({
      LLM_BASE_URL: primary.baseUrl,
      LLM_API_KEY: PRIMARY_KEY,
      LLM_FALLBACK_BASE_URL: fallback.baseUrl,
      LLM_FALLBACK_API_KEY: FALLBACK_KEY,
    });

  it.each([503, 502])("chat: primary answers %i until the retries run out → the fallback serves it, once", async (status) => {
    primary.respond((_r, res) => sendJson(res, status, { error: "down" }));

    const res = await withFallback().chat(request());

    expect(res.choices[0].message.content).toBe("from fallback");
    expect(primary.requests).toHaveLength(6);
    expect(retryDelays).toHaveLength(6);
    expect(fallback.requests).toHaveLength(1);
    expect(fallback.requests[0].headers.authorization).toBe(`Bearer ${FALLBACK_KEY}`);
  });

  it("chat: a recovered primary (503 then 200) never touches the fallback", async () => {
    let calls = 0;
    primary.respond((_r, res) =>
      ++calls === 1 ? sendJson(res, 503, {}) : sendJson(res, 200, chatCompletion("from primary")),
    );

    const res = await withFallback().chat(request());

    expect(res.choices[0].message.content).toBe("from primary");
    expect(fallback.requests).toHaveLength(0);
  });

  it.each([400, 401, 403])("negative: primary answers %i → fallback not tried", async (status) => {
    primary.respond((_r, res) => sendJson(res, status, { error: "no" }));

    await expect(withFallback().chat(request())).rejects.toMatchObject({ response: { status } });

    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
  });

  it("negative: 429 until the retries run out → fallback not tried", async () => {
    primary.respond((_r, res) => sendJson(res, 429, {}));

    await expect(withFallback().chat(request())).rejects.toMatchObject({ response: { status: 429 } });

    expect(primary.requests).toHaveLength(6);
    expect(fallback.requests).toHaveLength(0);
  });

  it("no fallback configured → the 503 surfaces as today", async () => {
    answer503();
    const adapter = makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY });

    await expect(adapter.chat(request())).rejects.toMatchObject({ response: { status: 503 } });

    expect(primary.requests).toHaveLength(6);
  });

  it("the fallback is tried once: its own 503 surfaces", async () => {
    answer503();
    fallback.respond((_r, res) => sendJson(res, 503, {}));

    await expect(withFallback().chat(request())).rejects.toMatchObject({ response: { status: 503 } });

    expect(fallback.requests).toHaveLength(1);
  });

  it("chatStream: primary answers 503 → the fallback stream serves it (no retries on the primary)", async () => {
    answer503();
    fallback.respond((_r, res) => sendSse(res, ['{"from":"fallback"}']));

    const payloads = await drain(withFallback().chatStream(request()));

    expect(payloads).toEqual(['{"from":"fallback"}']);
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(1);
    expect(fallback.requests[0].body.stream).toBe(true);
  });

  it("chatStream negative: primary answers 400 → fallback not tried", async () => {
    primary.respond((_r, res) => sendJson(res, 400, {}));

    await expect(drain(withFallback().chatStream(request()))).rejects.toMatchObject({ response: { status: 400 } });

    expect(fallback.requests).toHaveLength(0);
  });
});

describe("RX-160 AC4: LLM_DEFAULT_MAX_TOKENS", () => {
  const env = (): Env => ({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY, LLM_DEFAULT_MAX_TOKENS: "16000" });

  it("no caller value → max_tokens 16000 (chat and chatStream)", async () => {
    const adapter = makeAdapter(env());
    await adapter.chat(request());
    primary.respond((_r, res) => sendSse(res, []));
    await drain(adapter.chatStream(request()));

    expect(primary.requests.map((r) => r.body.max_tokens)).toEqual([16000, 16000]);
  });

  it("control: a caller value wins; unset → 4096 as today", async () => {
    await makeAdapter(env()).chat(request({ max_tokens: 100 }));
    await makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY }).chat(request());

    expect(primary.requests.map((r) => r.body.max_tokens)).toEqual([100, 4096]);
  });

  it("negative: a value that is not a positive integer is refused at construction", () => {
    expect(() => makeAdapter({ ...env(), LLM_DEFAULT_MAX_TOKENS: "lots" })).toThrow(/LLM_DEFAULT_MAX_TOKENS/);
  });
});

describe("RX-160 AC7: keys never reach a log line", () => {
  it("negative: no Logger or console output carries a key, across retries, fallback and stream errors", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    for (const m of ["log", "warn", "error", "debug", "verbose"] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capture);
    for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
    const adapter = makeAdapter({
      LLM_BASE_URL: primary.baseUrl,
      LLM_API_KEY: PRIMARY_KEY,
      LLM_FALLBACK_BASE_URL: fallback.baseUrl,
      LLM_FALLBACK_API_KEY: FALLBACK_KEY,
    });
    answer503();
    fallback.respond((_r, res) => sendSse(res, ["{}"]));

    await drain(adapter.chatStream(request()));
    fallback.respond((_r, res) => sendJson(res, 200, chatCompletion("ok")));
    await adapter.chat(request({ max_tokens: 10 })); // max_tokens <= 50 also logs the raw choice

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((l) => l.includes("rx160-marker-key"))).toEqual([]);
    expect(lines.some((l) => /fallback/.test(l) && /503/.test(l))).toBe(true);
  });
});

describe("RX-160 AC8: LLM_MODEL_ID_MAP", () => {
  const env = (): Env => ({
    LLM_BASE_URL: primary.baseUrl,
    LLM_API_KEY: PRIMARY_KEY,
    LLM_MODEL_ID_MAP: '{"anthropic/claude-opus-5.5":"claude-opus-5.5"}',
  });

  it("the stub receives the mapped id; the returned model and the reasoning check keep the seeded id", async () => {
    const res = await makeAdapter(env()).chat(
      request({ model: "claude-opus-5.5", providerId: "anthropic/claude-opus-5.5", reasoning_effort: "high" }),
    );

    expect(primary.requests[0].body.model).toBe("claude-opus-5.5");
    expect(primary.requests[0].body.reasoning_effort).toBe("high");
    expect(res.model).toBe("claude-opus-5.5");
  });

  it("chatStream maps too and logs the seeded id", async () => {
    const log = jest.spyOn(Logger.prototype, "log");
    primary.respond((_r, res) => sendSse(res, []));

    await drain(makeAdapter(env()).chatStream(request({ providerId: "anthropic/claude-opus-5.5" })));

    expect(primary.requests[0].body.model).toBe("claude-opus-5.5");
    expect(log.mock.calls.some(([l]) => String(l).includes("model=anthropic/claude-opus-5.5"))).toBe(true);
  });

  it("control: an unmapped id goes out unchanged", async () => {
    await makeAdapter(env()).chat(request({ providerId: "deepseek/deepseek-v4-flash" }));

    expect(primary.requests[0].body.model).toBe("deepseek/deepseek-v4-flash");
  });

  it.each(["{not json", '["a"]', '{"a":1}'])("negative: %j is refused at construction, naming the variable", (value) => {
    expect(() => makeAdapter({ ...env(), LLM_MODEL_ID_MAP: value })).toThrow(/LLM_MODEL_ID_MAP/);
  });
});

describe("RX-160 AC9: OpenRouter headers only for OpenRouter's base URL", () => {
  it("non-OpenRouter base URL → no HTTP-Referer / X-Title", async () => {
    await makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY }).chat(request());

    expect(primary.requests[0].headers["http-referer"]).toBeUndefined();
    expect(primary.requests[0].headers["x-title"]).toBeUndefined();
  });

  it("per request: a stub primary gets none, an OpenRouter fallback gets them (control)", async () => {
    answer503();
    const adapter = makeAdapter({
      LLM_BASE_URL: primary.baseUrl,
      LLM_API_KEY: PRIMARY_KEY,
      LLM_FALLBACK_BASE_URL: OPENROUTER_URL,
      LLM_FALLBACK_API_KEY: FALLBACK_KEY,
    });

    await expect(adapter.chat(request())).rejects.toThrow(/openrouter.ai blocked/);

    expect(primary.requests[0].headers["x-title"]).toBeUndefined();
    expect(blocker.blocked).toHaveLength(1);
    expect(blocker.blocked[0].url).toBe(`${OPENROUTER_URL}/chat/completions`);
    expect(blocker.blocked[0].headers["X-Title"]).toBe("Renovix AI");
    expect(blocker.blocked[0].headers["HTTP-Referer"]).toBe("https://chat.renovix.id");
  });
});
