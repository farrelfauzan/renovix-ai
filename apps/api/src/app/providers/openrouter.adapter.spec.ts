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
let setTimeoutSpy: jest.SpyInstance;

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
  setTimeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
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

  it("chat: primary answers 503 until the retries run out → the fallback serves it, once", async () => {
    primary.respond((_r, res) => sendJson(res, 503, { error: "down" }));

    const res = await withFallback().chat(request());

    expect(res.choices[0].message.content).toBe("from fallback");
    expect(primary.requests).toHaveLength(6);
    expect(retryDelays).toHaveLength(6);
    expect(fallback.requests).toHaveLength(1);
    expect(fallback.requests[0].headers.authorization).toBe(`Bearer ${FALLBACK_KEY}`);
  });

  it("chat: primary answers 502 → the fallback serves it at once, once (D156: no back-off on a 502)", async () => {
    primary.respond((_r, res) => sendJson(res, 502, { error: "down" }));

    const res = await withFallback().chat(request());

    expect(res.choices[0].message.content).toBe("from fallback");
    expect(primary.requests).toHaveLength(1);
    expect(retryDelays).toHaveLength(0);
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

    await expect(withFallback().chat(request())).rejects.toMatchObject({ status });

    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
  });

  it("negative: 429 until the retries run out → fallback not tried", async () => {
    primary.respond((_r, res) => sendJson(res, 429, {}));

    await expect(withFallback().chat(request())).rejects.toMatchObject({ status: 429 });

    expect(primary.requests).toHaveLength(6);
    expect(fallback.requests).toHaveLength(0);
  });

  it("no fallback configured → the 503 surfaces as today", async () => {
    answer503();
    const adapter = makeAdapter({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY });

    await expect(adapter.chat(request())).rejects.toMatchObject({ status: 503 });

    expect(primary.requests).toHaveLength(6);
  });

  it("the fallback is tried once: its own 503 surfaces", async () => {
    answer503();
    fallback.respond((_r, res) => sendJson(res, 503, {}));

    await expect(withFallback().chat(request())).rejects.toMatchObject({ status: 503 });

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

    await expect(drain(withFallback().chatStream(request()))).rejects.toMatchObject({ status: 400 });

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

// RX-161: transport per R-12 (fetch, Retry-After, plain-text 502, reasoning floor,
// empty answers, client disconnect). Only the local stubs are called.
describe("RX-161: provider transport", () => {
  const stubOnly = (): Env => ({ LLM_BASE_URL: primary.baseUrl, LLM_API_KEY: PRIMARY_KEY });
  const withFallback = (): Env => ({
    ...stubOnly(),
    LLM_FALLBACK_BASE_URL: fallback.baseUrl,
    LLM_FALLBACK_API_KEY: FALLBACK_KEY,
  });
  const answer = (status: number, headers: Record<string, string>, text: string) =>
    primary.respond((_r, res) => {
      res.writeHead(status, headers);
      res.end(text);
    });
  const unavailable = (retryAfter: string) =>
    answer(503, { "Content-Type": "application/json", "Retry-After": retryAfter }, '{"error":"busy"}');
  const plain502 = (headers: Record<string, string> = {}) =>
    answer(502, { "Content-Type": "text/plain", ...headers }, "Bad gateway");
  /** Collects into `out` so a test can check what was yielded before a rejection. */
  const collect = async (gen: AsyncGenerator<string>, out: string[]): Promise<void> => {
    for await (const p of gen) out.push(p);
  };

  describe("AC-a: 503 with Retry-After: 30 and a fallback", () => {
    it("chat: the fallback serves it at once, no same-provider retry, well under 30 s (real timers)", async () => {
      setTimeoutSpy.mockRestore();
      unavailable("30");
      const startedAt = Date.now();

      const res = await makeAdapter(withFallback()).chat(request());

      expect(res.choices[0].message.content).toBe("from fallback");
      expect(primary.requests).toHaveLength(1);
      expect(fallback.requests).toHaveLength(1);
      expect(Date.now() - startedAt).toBeLessThan(3000);
    }, 10000);
  });

  describe("AC-b: 503 with Retry-After and no fallback", () => {
    it("chat: exactly one retry, after the stated wait", async () => {
      let calls = 0;
      primary.respond((_r, res) => {
        if (++calls > 1) return sendJson(res, 200, chatCompletion("from primary"));
        res.writeHead(503, { "Retry-After": "7" });
        res.end();
      });

      const res = await makeAdapter(stubOnly()).chat(request());

      expect(res.choices[0].message.content).toBe("from primary");
      expect(primary.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chat: the retry answers 503 again → it surfaces, no back-off loop", async () => {
      unavailable("7");

      await expect(makeAdapter(stubOnly()).chat(request())).rejects.toMatchObject({ status: 503 });

      expect(primary.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chatStream: exactly one retry, after the stated wait", async () => {
      let calls = 0;
      primary.respond((_r, res) => {
        if (++calls > 1) return sendSse(res, ['{"retried":true}']);
        res.writeHead(503, { "Retry-After": "7" });
        res.end();
      });

      expect(await drain(makeAdapter(stubOnly()).chatStream(request()))).toEqual(['{"retried":true}']);
      expect(primary.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("control: a 503 without Retry-After keeps today's 6-attempt back-off", async () => {
      answer503();

      await expect(makeAdapter(stubOnly()).chat(request())).rejects.toMatchObject({ status: 503 });

      expect(primary.requests).toHaveLength(6);
    });
  });

  describe("AC-c: 502 with a plain-text body", () => {
    it("chat with Retry-After and a fallback: no parse error, the 503 rule (straight to the fallback)", async () => {
      plain502({ "Retry-After": "30" });

      const res = await makeAdapter(withFallback()).chat(request());

      expect(res.choices[0].message.content).toBe("from fallback");
      expect(primary.requests).toHaveLength(1);
      expect(retryDelays).toEqual([]);
    });

    it("chat with Retry-After, no fallback: one retry, then the 502 surfaces with its text, not a JSON error", async () => {
      plain502({ "Retry-After": "7" });

      const thrown = await makeAdapter(stubOnly()).chat(request()).catch((err) => err);

      expect(thrown).toMatchObject({ name: "ProviderHttpError", status: 502, bodyText: "Bad gateway" });
      expect(thrown).not.toBeInstanceOf(SyntaxError);
      expect(primary.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chat without Retry-After and a fallback (D156, B'): straight to the fallback, no back-off", async () => {
      plain502();

      const res = await makeAdapter(withFallback()).chat(request());

      expect(res.choices[0].message.content).toBe("from fallback");
      expect(primary.requests).toHaveLength(1);
      expect(fallback.requests).toHaveLength(1);
      expect(retryDelays).toEqual([]);
    });

    it("control: chat without Retry-After and no fallback keeps today's 6-attempt back-off", async () => {
      plain502();

      await expect(makeAdapter(stubOnly()).chat(request())).rejects.toMatchObject({ status: 502 });

      expect(primary.requests).toHaveLength(6);
    });

    it("chatStream without Retry-After: the fallback serves it, as for a 503", async () => {
      plain502();
      fallback.respond((_r, res) => sendSse(res, ['{"from":"fallback"}']));

      expect(await drain(makeAdapter(withFallback()).chatStream(request()))).toEqual(['{"from":"fallback"}']);
      expect(primary.requests).toHaveLength(1);
    });
  });

  describe("AC-d: max_tokens floor for reasoning models", () => {
    it("a reasoning model with max_tokens 100 → the body carries 2000 (chat and chatStream)", async () => {
      const adapter = makeAdapter(stubOnly());
      const reasoning = request({ providerId: "deepseek/deepseek-v4-pro", max_tokens: 100 });

      await adapter.chat(reasoning);
      primary.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"x"}}]}']));
      await drain(adapter.chatStream(reasoning));

      expect(primary.requests.map((r) => r.body.max_tokens)).toEqual([2000, 2000]);
    });

    it("control: a non-reasoning model keeps 100; a reasoning model above the floor keeps its value", async () => {
      const adapter = makeAdapter(stubOnly());

      await adapter.chat(request({ max_tokens: 100 }));
      await adapter.chat(request({ providerId: "deepseek/deepseek-v4-pro", max_tokens: 3000 }));

      expect(primary.requests.map((r) => r.body.max_tokens)).toEqual([100, 3000]);
    });
  });

  describe("AC-e: empty content with finish_reason length", () => {
    const EMPTY_ANSWER = /Model deepseek\/deepseek-v4-flash returned an empty answer: max_tokens \(100\)/;

    it("negative, chat: the caller gets a clear error naming the model and max_tokens", async () => {
      primary.respond((_r, res) =>
        sendJson(res, 200, {
          ...chatCompletion(""),
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
        }),
      );

      await expect(makeAdapter(stubOnly()).chat(request({ max_tokens: 100 }))).rejects.toThrow(EMPTY_ANSWER);
    });

    it("negative, chatStream: the error, and nothing is yielded", async () => {
      primary.respond((_r, res) =>
        sendSse(res, [
          '{"choices":[{"delta":{"role":"assistant","content":""}}]}',
          '{"choices":[{"delta":{},"finish_reason":"length"}]}',
          '{"usage":{"prompt_tokens":3,"completion_tokens":100,"total_tokens":103}}',
        ]),
      );
      const yielded: string[] = [];

      await expect(collect(makeAdapter(stubOnly()).chatStream(request({ max_tokens: 100 })), yielded)).rejects.toThrow(
        EMPTY_ANSWER,
      );

      expect(yielded).toEqual([]);
    });

    it("control: content cut off by length, and an empty answer that stopped normally, pass through as today", async () => {
      const adapter = makeAdapter(stubOnly());
      const cutOff = ['{"choices":[{"delta":{"content":"Hel"}}]}', '{"choices":[{"delta":{},"finish_reason":"length"}]}'];
      primary.respond((_r, res) => sendSse(res, cutOff));
      expect(await drain(adapter.chatStream(request()))).toEqual(cutOff);
      primary.respond((_r, res) => sendJson(res, 200, chatCompletion("")));

      const res = await adapter.chat(request());

      expect(res.choices[0]).toMatchObject({ message: { content: "" }, finish_reason: "stop" });
    });
  });

  describe("AC-f: the caller's signal aborts the upstream stream", () => {
    /** The stub sends one chunk and never ends; `closed` resolves when the connection to it closes. */
    const hangAfterFirstChunk = (): Promise<void> =>
      new Promise((closed) =>
        primary.respond((_r, res) => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
          res.on("close", () => closed());
        }),
      );

    it("abort after the first payload → the stub sees the request closed and the stream ends quietly", async () => {
      const closed = hangAfterFirstChunk();
      const disconnected = new AbortController();
      const yielded: string[] = [];
      const stream = makeAdapter(stubOnly()).chatStream(request({ signal: disconnected.signal }));

      const reading = collect(stream, yielded);
      while (yielded.length === 0) await new Promise((r) => realSetTimeout(r, 5));
      disconnected.abort();

      await closed;
      await expect(reading).resolves.toBeUndefined();
      expect(yielded).toEqual(['{"choices":[{"delta":{"content":"Hel"}}]}']);
      expect(primary.requests[0].body.signal).toBeUndefined();
    });

    it("the consumer stops early (break) → the stub sees the request closed", async () => {
      const closed = hangAfterFirstChunk();

      for await (const _payload of makeAdapter(stubOnly()).chatStream(request())) break;

      await closed;
    });
  });

  describe("RX-183: the stream's Retry-After wait follows the caller's signal", () => {
    const NOT_FAKED = [
      "Date", "setImmediate", "clearImmediate", "setInterval", "clearInterval",
      "nextTick", "queueMicrotask", "performance", "requestAnimationFrame",
      "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime",
    ] as const;

    afterEach(() => jest.useRealTimers());

    it("AC1: abort 1 s into a 30 s wait → the generator ends at once, one request, no timer left", async () => {
      setTimeoutSpy.mockRestore();
      jest.useFakeTimers({ doNotFake: [...NOT_FAKED] });
      unavailable("30");
      const disconnected = new AbortController();
      const stream = makeAdapter(stubOnly()).chatStream(request({ signal: disconnected.signal }));
      const reading = drain(stream).then(
        () => "finished",
        (err: Error) => err.name,
      );
      while (primary.requests.length === 0) await new Promise((r) => realSetTimeout(r, 5));
      await new Promise((r) => realSetTimeout(r, 50));
      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(1);

      disconnected.abort();

      const outcome = await Promise.race([reading, new Promise((r) => realSetTimeout(() => r("still waiting"), 500))]);
      expect(outcome).toBe("AbortError");
      expect(primary.requests).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("a signal that never fires → the primary is retried once after the stated wait (real 1 s)", async () => {
      setTimeoutSpy.mockRestore();
      let calls = 0;
      primary.respond((_r, res) => {
        if (++calls > 1) return sendSse(res, ['{"retried":true}']);
        res.writeHead(503, { "Retry-After": "1" });
        res.end();
      });
      const startedAt = Date.now();

      const payloads = await drain(makeAdapter(stubOnly()).chatStream(request({ signal: new AbortController().signal })));

      expect(payloads).toEqual(['{"retried":true}']);
      expect(primary.requests).toHaveLength(2);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    }, 10000);
  });

  it("the plain and the streaming request both carry Accept and Content-Type JSON", async () => {
    const adapter = makeAdapter(stubOnly());
    await adapter.chat(request());
    primary.respond((_r, res) => sendSse(res, []));
    await drain(adapter.chatStream(request()));

    expect(primary.requests.map((r) => [r.headers.accept, r.headers["content-type"]])).toEqual([
      ["application/json", "application/json"],
      ["application/json", "application/json"],
    ]);
  });
});
