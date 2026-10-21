import { inspect } from "node:util";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ChatRequest } from "./provider.interface";
import type { ModelConnection } from "./types/model-connection";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../test/llm-stub";
import { captureOutput } from "../../../test/capture-output";
import { plantedProviderSecret } from "../../../test/planted-provider-secret";

// RX-178: the chat adapter sends every call to the request's connection (a provider record: base URL, key, slug).
// The env endpoint (LLM_BASE_URL / LLM_API_KEY / OPENROUTER_API_KEY) serves GET /models only, and the env fallback
// (LLM_FALLBACK_*) and LLM_MODEL_ID_MAP are gone (D199-4). Only local stubs are called; every other host is blocked
// (blockOutbound), so no test reaches a real provider. `envStub` stands at the env URLs: a chat call must never reach it.

const CONNECTION_KEY = "rx178-marker-key-not-real-connection";
const ENV_KEY = "rx160-marker-key-not-real-env";
const FALLBACK_KEY = "rx160-marker-key-not-real-fallback";
const OPENROUTER_KEY = "rx160-marker-key-not-real-openrouter";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const SLUG = "fake/standard-model";
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
let provider: StubHttpServer;
let envStub: StubHttpServer;
let retryDelays: number[];
let setTimeoutSpy: jest.SpyInstance;

/** A fresh adapter that sees exactly `env` (the shell's values are cleared). */
const makeAdapter = (env: Env): OpenRouterAdapter => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  return new OpenRouterAdapter(new ConfigService());
};

/** The env endpoint on envStub, plus (as a stale configuration) the removed fallback and model id map. */
const staleEnv = (): Env => ({
  LLM_BASE_URL: envStub.baseUrl,
  LLM_API_KEY: ENV_KEY,
  LLM_FALLBACK_BASE_URL: envStub.baseUrl,
  LLM_FALLBACK_API_KEY: FALLBACK_KEY,
  LLM_MODEL_ID_MAP: `{"${SLUG}":"mapped-id"}`,
});

const connection = (over: Partial<ModelConnection> = {}): ModelConnection => ({
  slug: SLUG,
  baseUrl: provider.baseUrl,
  apiKey: CONNECTION_KEY,
  providerName: "stub-provider",
  ...over,
});

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "standard-cheap",
  connection: connection(),
  messages: [{ role: "user", content: "hi" }],
  ...over,
});

const drain = async (gen: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const p of gen) out.push(p);
  return out;
};

const answer503 = () => provider.respond((_r, res) => sendJson(res, 503, { error: "unavailable" }));

beforeAll(async () => {
  [provider, envStub] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
});

beforeEach(() => {
  blocker = blockOutbound();
  provider.requests.length = 0;
  envStub.requests.length = 0;
  provider.respond((_r, res) => sendJson(res, 200, chatCompletion("from provider")));
  envStub.respond((_r, res) => sendJson(res, 200, chatCompletion("from env endpoint")));
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
  await Promise.all([provider.close(), envStub.close()]);
  ENV_KEYS.forEach((k, i) => {
    if (savedEnv[i] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[i];
  });
});

describe("RX-178: a chat call goes to the request's connection", () => {
  it("chat reaches the connection's base URL with Bearer <its key> and the slug as sent; the env endpoint gets nothing", async () => {
    const adapter = makeAdapter(staleEnv());

    const res = await adapter.chat(request());

    expect(res.choices[0].message.content).toBe("from provider");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].url).toBe("/v1/chat/completions");
    expect(provider.requests[0].headers.authorization).toBe(`Bearer ${CONNECTION_KEY}`);
    expect(provider.requests[0].body.model).toBe(SLUG);
    expect(envStub.requests).toHaveLength(0);
    expect(blocker.blocked).toHaveLength(0);
  });

  it("chatStream also reaches the connection, and asks for the final usage chunk (stream_options.include_usage, D205 b)", async () => {
    provider.respond((_r, res) => sendSse(res, ['{"a":1}']));
    const adapter = makeAdapter(staleEnv());

    expect(await drain(adapter.chatStream(request()))).toEqual(['{"a":1}']);
    expect(provider.requests[0].headers.authorization).toBe(`Bearer ${CONNECTION_KEY}`);
    expect(provider.requests[0].body).toMatchObject({ model: SLUG, stream: true, stream_options: { include_usage: true } });
    expect(envStub.requests).toHaveLength(0);
  });

  it("control: a plain chat sends no stream_options", async () => {
    await makeAdapter(staleEnv()).chat(request());

    expect(provider.requests[0].body.stream_options).toBeUndefined();
  });

  it("negative: LLM_MODEL_ID_MAP is not read any more; the slug goes out unchanged, chat and chatStream", async () => {
    const adapter = makeAdapter({ ...staleEnv(), LLM_MODEL_ID_MAP: "{not json" });
    await adapter.chat(request());
    provider.respond((_r, res) => sendSse(res, []));
    await drain(adapter.chatStream(request()));

    expect(provider.requests.map((r) => r.body.model)).toEqual([SLUG, SLUG]);
  });

  it("neither env key set → construction succeeds (RNX-192: chat uses provider records); GET /models is skipped", async () => {
    const adapter = makeAdapter({ LLM_BASE_URL: envStub.baseUrl });

    expect(await adapter.listModels()).toBeUndefined();
    expect(envStub.requests).toHaveLength(0);
  });
});

describe("RX-178 (D199-4): no env fallback on 502/503 (RX-160 AC3 / D156 pinned the opposite)", () => {
  it("chat: the connection answers 503 until the retries run out → the 503 surfaces; the fallback receives 0", async () => {
    answer503();

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 503 });

    expect(provider.requests).toHaveLength(6);
    expect(retryDelays).toHaveLength(5);
    expect(envStub.requests).toHaveLength(0);
  });

  it("chat: a 502 keeps the 6-attempt back-off (no D156 shortcut to a fallback); the fallback receives 0", async () => {
    provider.respond((_r, res) => sendJson(res, 502, { error: "down" }));

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 502 });

    expect(provider.requests).toHaveLength(6);
    expect(envStub.requests).toHaveLength(0);
  });

  it("chat: a recovered connection (503 then 200) serves the answer", async () => {
    let calls = 0;
    provider.respond((_r, res) =>
      ++calls === 1 ? sendJson(res, 503, {}) : sendJson(res, 200, chatCompletion("from provider")),
    );

    const res = await makeAdapter(staleEnv()).chat(request());

    expect(res.choices[0].message.content).toBe("from provider");
    expect(envStub.requests).toHaveLength(0);
  });

  it.each([400, 401, 403])("chat: %i → one request, it surfaces", async (status) => {
    provider.respond((_r, res) => sendJson(res, status, { error: "no" }));

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status });

    expect(provider.requests).toHaveLength(1);
    expect(envStub.requests).toHaveLength(0);
  });

  it("chat: 429 until the retries run out → it surfaces", async () => {
    provider.respond((_r, res) => sendJson(res, 429, {}));

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 429 });

    expect(provider.requests).toHaveLength(6);
    expect(envStub.requests).toHaveLength(0);
  });

  it.each([502, 503])("chatStream: %i → it surfaces at once (no retries on a stream); the fallback receives 0", async (status) => {
    provider.respond((_r, res) => sendJson(res, status, {}));

    await expect(drain(makeAdapter(staleEnv()).chatStream(request()))).rejects.toMatchObject({ status });

    expect(provider.requests).toHaveLength(1);
    expect(envStub.requests).toHaveLength(0);
  });
});

describe("RX-191: no back-off wait after the last failed chat attempt", () => {
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  it("503 on every attempt: 6 attempts, the wait is 2+4+8+15+15 = 44 s, the error reaches the caller", async () => {
    answer503();

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 503 });

    expect(provider.requests).toHaveLength(6);
    expect(sum(retryDelays)).toBe(44000);
  });

  it("429 on every attempt: the wait is 5+10+20+40+60 = 135 s", async () => {
    provider.respond((_r, res) => sendJson(res, 429, {}));

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 429 });

    expect(provider.requests).toHaveLength(6);
    expect(sum(retryDelays)).toBe(135000);
  });

  it("control: a 503 then a 200 waits once (2 s) and returns the answer", async () => {
    let calls = 0;
    provider.respond((_r, res) =>
      ++calls === 1 ? sendJson(res, 503, {}) : sendJson(res, 200, chatCompletion("from provider")),
    );

    const res = await makeAdapter(staleEnv()).chat(request());

    expect(res.choices[0].message.content).toBe("from provider");
    expect(retryDelays).toEqual([2000]);
  });

  it("the log says \"Retrying\" on attempts 1 to 5 and not on the 6th", async () => {
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => void lines.push(String(message)));
    answer503();

    await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 503 });

    expect(lines.filter((l) => /Retrying/.test(l))).toHaveLength(5);
    expect(lines.filter((l) => /Attempt 6\/6/.test(l) && /Retrying/.test(l))).toEqual([]);
  });
});

describe("RX-160 AC4: LLM_DEFAULT_MAX_TOKENS", () => {
  const env = (): Env => ({ LLM_API_KEY: ENV_KEY, LLM_DEFAULT_MAX_TOKENS: "16000" });

  it("no caller value → max_tokens 16000 (chat and chatStream)", async () => {
    const adapter = makeAdapter(env());
    await adapter.chat(request());
    provider.respond((_r, res) => sendSse(res, []));
    await drain(adapter.chatStream(request()));

    expect(provider.requests.map((r) => r.body.max_tokens)).toEqual([16000, 16000]);
  });

  it("control: a caller value wins; unset → 4096 as today", async () => {
    await makeAdapter(env()).chat(request({ max_tokens: 100 }));
    await makeAdapter({ LLM_API_KEY: ENV_KEY }).chat(request());

    expect(provider.requests.map((r) => r.body.max_tokens)).toEqual([100, 4096]);
  });

  it("negative: a value that is not a positive integer is refused at construction", () => {
    expect(() => makeAdapter({ ...env(), LLM_DEFAULT_MAX_TOKENS: "lots" })).toThrow(/LLM_DEFAULT_MAX_TOKENS/);
  });
});

describe("RX-160 AC7: keys never reach a log line", () => {
  it("negative: no Logger or console output carries a key, across retries and stream errors", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    for (const m of ["log", "warn", "error", "debug", "verbose"] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capture);
    for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
    const adapter = makeAdapter(staleEnv());
    answer503();

    await expect(drain(adapter.chatStream(request()))).rejects.toMatchObject({ status: 503 });
    await expect(adapter.chat(request())).rejects.toMatchObject({ status: 503 });
    provider.respond((_r, res) => sendJson(res, 200, chatCompletion("ok")));
    await adapter.chat(request({ max_tokens: 10 })); // max_tokens <= 50 also logs the raw choice

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((l) => /rx1(60|78)-marker-key/.test(l))).toEqual([]);
    expect(lines.some((l) => /503/.test(l))).toBe(true);
  });
});

describe("RX-178: reasoning handling on a dashed slug", () => {
  const DASHED = "x/claude-opus-5-5";

  it("a dashed slug of a reasoning model gets reasoning_effort and the max_tokens floor (chat and chatStream)", async () => {
    const adapter = makeAdapter({ LLM_API_KEY: ENV_KEY });
    const params = request({ connection: connection({ slug: DASHED }), reasoning_effort: "high", max_tokens: 100 });

    await adapter.chat(params);
    provider.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"x"}}]}']));
    await drain(adapter.chatStream(params));

    expect(provider.requests.map((r) => [r.body.model, r.body.reasoning_effort, r.body.max_tokens])).toEqual([
      [DASHED, "high", 2000],
      [DASHED, "high", 2000],
    ]);
    expect(adapter.resolveMaxTokens(params)).toBe(2000);
  });

  it("control: a non-reasoning slug gets neither", async () => {
    await makeAdapter({ LLM_API_KEY: ENV_KEY }).chat(request({ reasoning_effort: "high", max_tokens: 100 }));

    expect(provider.requests[0].body.reasoning_effort).toBeUndefined();
    expect(provider.requests[0].body.max_tokens).toBe(100);
  });
});

describe("RX-160 AC9: OpenRouter headers only for OpenRouter's base URL", () => {
  it("non-OpenRouter connection → no HTTP-Referer / X-Title", async () => {
    await makeAdapter({ LLM_API_KEY: ENV_KEY }).chat(request());

    expect(provider.requests[0].headers["http-referer"]).toBeUndefined();
    expect(provider.requests[0].headers["x-title"]).toBeUndefined();
  });

  it("control: a connection on OpenRouter's base URL gets them, with its own key", async () => {
    const adapter = makeAdapter({ OPENROUTER_API_KEY: OPENROUTER_KEY });

    await expect(adapter.chat(request({ connection: connection({ baseUrl: OPENROUTER_URL }) }))).rejects.toThrow(
      /outbound call to openrouter.ai blocked/,
    );

    expect(blocker.blocked).toHaveLength(1);
    const sent = blocker.blocked[0];
    expect(sent.url).toBe(`${OPENROUTER_URL}/chat/completions`);
    expect(sent.headers.Authorization).toBe(`Bearer ${CONNECTION_KEY}`);
    expect(sent.headers["HTTP-Referer"]).toBe("https://chat.renovix.id");
    expect(sent.headers["X-Title"]).toBe("Renovix AI");
  });
});

// RX-161: transport per R-12 (fetch, Retry-After, plain-text 502, reasoning floor,
// empty answers, client disconnect). Only the local stubs are called.
describe("RX-161: provider transport", () => {
  const stubOnly = (): Env => ({ LLM_API_KEY: ENV_KEY });
  const answer = (status: number, headers: Record<string, string>, text: string) =>
    provider.respond((_r, res) => {
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

  describe("AC-a (RX-178): 503 with Retry-After while the removed fallback is still configured", () => {
    it("chat: one retry of the same connection after the stated wait; the fallback receives 0", async () => {
      unavailable("30");

      await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 503 });

      expect(provider.requests).toHaveLength(2);
      expect(retryDelays).toEqual([30000]);
      expect(envStub.requests).toHaveLength(0);
    });
  });

  describe("AC-b: 503 with Retry-After", () => {
    it("chat: exactly one retry, after the stated wait", async () => {
      let calls = 0;
      provider.respond((_r, res) => {
        if (++calls > 1) return sendJson(res, 200, chatCompletion("from provider"));
        res.writeHead(503, { "Retry-After": "7" });
        res.end();
      });

      const res = await makeAdapter(stubOnly()).chat(request());

      expect(res.choices[0].message.content).toBe("from provider");
      expect(provider.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chat: the retry answers 503 again → it surfaces, no back-off loop", async () => {
      unavailable("7");

      await expect(makeAdapter(stubOnly()).chat(request())).rejects.toMatchObject({ status: 503 });

      expect(provider.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chatStream: exactly one retry, after the stated wait", async () => {
      let calls = 0;
      provider.respond((_r, res) => {
        if (++calls > 1) return sendSse(res, ['{"retried":true}']);
        res.writeHead(503, { "Retry-After": "7" });
        res.end();
      });

      expect(await drain(makeAdapter(stubOnly()).chatStream(request()))).toEqual(['{"retried":true}']);
      expect(provider.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("control: a 503 without Retry-After keeps today's 6-attempt back-off", async () => {
      answer503();

      await expect(makeAdapter(stubOnly()).chat(request())).rejects.toMatchObject({ status: 503 });

      expect(provider.requests).toHaveLength(6);
    });
  });

  describe("AC-c: 502 with a plain-text body", () => {
    // RNX-190 (D197): the error no longer carries the provider's text; it surfaces as the typed "unavailable".
    it("chat with Retry-After: one retry, then the 502 surfaces typed, not a JSON error, without its text", async () => {
      plain502({ "Retry-After": "7" });

      const thrown = await makeAdapter(stubOnly()).chat(request()).catch((err) => err);

      expect(thrown).toMatchObject({ name: "ProviderHttpError", status: 502, kind: "unavailable" });
      expect(thrown).not.toHaveProperty("bodyText");
      expect(thrown).not.toBeInstanceOf(SyntaxError);
      expect(provider.requests).toHaveLength(2);
      expect(retryDelays).toEqual([7000]);
    });

    it("chat without Retry-After, the removed fallback configured (D156 is gone): the 6-attempt back-off; fallback 0", async () => {
      plain502();

      await expect(makeAdapter(staleEnv()).chat(request())).rejects.toMatchObject({ status: 502 });

      expect(provider.requests).toHaveLength(6);
      expect(envStub.requests).toHaveLength(0);
    });

    it("chatStream without Retry-After: the 502 surfaces typed, without its text; fallback 0", async () => {
      plain502();

      const thrown = await drain(makeAdapter(staleEnv()).chatStream(request())).catch((err: unknown) => err);

      expect(thrown).toMatchObject({ status: 502, kind: "unavailable" });
      expect(thrown).not.toHaveProperty("bodyText");
      expect(provider.requests).toHaveLength(1);
      expect(envStub.requests).toHaveLength(0);
    });
  });

  describe("AC-d: max_tokens floor for reasoning models", () => {
    const reasoningConnection = () => connection({ slug: "deepseek/deepseek-v4-pro" });

    it("a reasoning model with max_tokens 100 → the body carries 2000 (chat and chatStream)", async () => {
      const adapter = makeAdapter(stubOnly());
      const reasoning = request({ connection: reasoningConnection(), max_tokens: 100 });

      await adapter.chat(reasoning);
      provider.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"x"}}]}']));
      await drain(adapter.chatStream(reasoning));

      expect(provider.requests.map((r) => r.body.max_tokens)).toEqual([2000, 2000]);
    });

    it("control: a non-reasoning model keeps 100; a reasoning model above the floor keeps its value", async () => {
      const adapter = makeAdapter(stubOnly());

      await adapter.chat(request({ max_tokens: 100 }));
      await adapter.chat(request({ connection: reasoningConnection(), max_tokens: 3000 }));

      expect(provider.requests.map((r) => r.body.max_tokens)).toEqual([100, 3000]);
    });
  });

  describe("RX-22: resolveMaxTokens is exactly the max_tokens the body carries (the credit estimate's M)", () => {
    it("reasoning floor (dotted and dashed slug), caller value and default, each equal to what the stub receives", async () => {
      const adapter = makeAdapter({ ...stubOnly(), LLM_DEFAULT_MAX_TOKENS: "16000" });
      const cases = [
        request({ connection: connection({ slug: "deepseek/deepseek-v4-pro" }), max_tokens: 100 }),
        request({ connection: connection({ slug: "x/claude-opus-5-5" }), max_tokens: 100 }),
        request({ max_tokens: 100 }),
        request(),
      ];

      for (const params of cases) await adapter.chat(params);

      expect(cases.map((params) => adapter.resolveMaxTokens(params))).toEqual([2000, 2000, 100, 16000]);
      expect(provider.requests.map((r) => r.body.max_tokens)).toEqual([2000, 2000, 100, 16000]);
    });
  });

  describe("RX-22: usage with cached input", () => {
    it("chat maps prompt_tokens_details.cached_tokens into cachedTokens (0 when absent)", async () => {
      const adapter = makeAdapter(stubOnly());
      provider.respond((_r, res) =>
        sendJson(res, 200, {
          ...chatCompletion("ok"),
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 60 } },
        }),
      );
      const cached = await adapter.chat(request());
      provider.respond((_r, res) => sendJson(res, 200, chatCompletion("ok")));
      const uncached = await adapter.chat(request());

      expect(cached.usage).toEqual({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, cachedTokens: 60 });
      expect(uncached.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cachedTokens: 0 });
    });
  });

  describe("AC-e: empty content with finish_reason length", () => {
    const EMPTY_ANSWER = /Model fake\/standard-model returned an empty answer: max_tokens \(100\)/;

    it("negative, chat: the caller gets a clear error naming the model and max_tokens", async () => {
      provider.respond((_r, res) =>
        sendJson(res, 200, {
          ...chatCompletion(""),
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
        }),
      );

      await expect(makeAdapter(stubOnly()).chat(request({ max_tokens: 100 }))).rejects.toThrow(EMPTY_ANSWER);
    });

    it("negative, chatStream: the error, and nothing is yielded", async () => {
      provider.respond((_r, res) =>
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
      provider.respond((_r, res) => sendSse(res, cutOff));
      expect(await drain(adapter.chatStream(request()))).toEqual(cutOff);
      provider.respond((_r, res) => sendJson(res, 200, chatCompletion("")));

      const res = await adapter.chat(request());

      expect(res.choices[0]).toMatchObject({ message: { content: "" }, finish_reason: "stop" });
    });
  });

  describe("AC-f: the caller's signal aborts the upstream stream", () => {
    /** The stub sends one chunk and never ends; `closed` resolves when the connection to it closes. */
    const hangAfterFirstChunk = (): Promise<void> =>
      new Promise((closed) =>
        provider.respond((_r, res) => {
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
      expect(provider.requests[0].body.signal).toBeUndefined();
      expect(provider.requests[0].body.connection).toBeUndefined();
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
      while (provider.requests.length === 0) await new Promise((r) => realSetTimeout(r, 5));
      await new Promise((r) => realSetTimeout(r, 50));
      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(1);

      disconnected.abort();

      const outcome = await Promise.race([reading, new Promise((r) => realSetTimeout(() => r("still waiting"), 500))]);
      expect(outcome).toBe("AbortError");
      expect(provider.requests).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("a signal that never fires → the connection is retried once after the stated wait (real 1 s)", async () => {
      setTimeoutSpy.mockRestore();
      let calls = 0;
      provider.respond((_r, res) => {
        if (++calls > 1) return sendSse(res, ['{"retried":true}']);
        res.writeHead(503, { "Retry-After": "1" });
        res.end();
      });
      const startedAt = Date.now();

      const payloads = await drain(makeAdapter(stubOnly()).chatStream(request({ signal: new AbortController().signal })));

      expect(payloads).toEqual(['{"retried":true}']);
      expect(provider.requests).toHaveLength(2);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    }, 10000);
  });

  it("the plain and the streaming request both carry Accept and Content-Type JSON", async () => {
    const adapter = makeAdapter(stubOnly());
    await adapter.chat(request());
    provider.respond((_r, res) => sendSse(res, []));
    await drain(adapter.chatStream(request()));

    expect(provider.requests.map((r) => [r.headers.accept, r.headers["content-type"]])).toEqual([
      ["application/json", "application/json"],
      ["application/json", "application/json"],
    ]);
  });
});

// RX-21 review B1: OpenRouter's /models pricing is already USD per token
// (its documented openai/gpt-4 sample); listModels returns it unchanged.
// RX-178: GET /models stays on the env endpoint (LLM_BASE_URL with LLM_API_KEY) for the price refresh.
describe("RX-21: listModels reads OpenRouter's per-token prices", () => {
  it("the documented gpt-4 sample comes back as \"0.00003\" / \"0.00006\", not divided again", async () => {
    envStub.respond((_r, res) =>
      sendJson(res, 200, {
        data: [
          {
            id: "openai/gpt-4",
            pricing: { prompt: "0.00003", completion: "0.00006", input_cache_read: "0.000015" },
          },
        ],
      }),
    );
    const adapter = makeAdapter({ LLM_BASE_URL: envStub.baseUrl, LLM_API_KEY: ENV_KEY });

    const models = await adapter.listModels();

    expect(envStub.requests[0].url).toBe("/v1/models");
    expect(envStub.requests[0].headers.authorization).toBe(`Bearer ${ENV_KEY}`);
    expect(models).toEqual([
      { providerId: "openai/gpt-4", inputPrice: "0.00003", outputPrice: "0.00006", cachedInputPrice: "0.000015" },
    ]);
  });
});

// RNX-190 (D197, D208): a provider 401 body can echo the key's last characters and its SHA-256 (RX-174). The error a
// chat call rejects with must not carry them: not in a log line written meanwhile (Nest's Logger is not mocked), and
// not in the error itself as a log would print it (util.inspect, as Nest's ExceptionsHandler and a cron job log an
// error nobody caught), as JSON, as a string or as its stack.
describe("RNX-190 AC1: a provider 401 body with a planted key suffix and SHA-256", () => {
  const leaksOf = (err: unknown, lines: string[]): string[] =>
    [inspect(err), JSON.stringify(err), String(err), (err as Error).stack ?? "", ...lines].filter(plantedProviderSecret.isFoundIn);

  beforeEach(() => {
    provider.respond((_r, res) => sendJson(res, 401, plantedProviderSecret.body));
    envStub.respond((_r, res) => sendJson(res, 401, plantedProviderSecret.body));
  });

  it("control: the stub's answer carries both planted values, and the search finds them there", async () => {
    const answer = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    const text = await answer.text();

    expect([answer.status, text.includes(plantedProviderSecret.keySuffix), text.includes(plantedProviderSecret.sha256)]).toEqual([401, true, true]);
  });

  it("non-stream chat: the 401 surfaces; neither value is in a log line or in the error", async () => {
    const output = captureOutput();

    const thrown = await makeAdapter(staleEnv()).chat(request()).catch((err: unknown) => err);

    expect({ status: (thrown as { status?: number }).status, leaks: leaksOf(thrown, output.lines) }).toEqual({ status: 401, leaks: [] });
  });

  it("chatStream: the 401 surfaces; neither value is in a log line or in the error", async () => {
    const output = captureOutput();

    const thrown = await drain(makeAdapter(staleEnv()).chatStream(request())).catch((err: unknown) => err);

    expect({ status: (thrown as { status?: number }).status, leaks: leaksOf(thrown, output.lines) }).toEqual({ status: 401, leaks: [] });
  });

  it("listModels (the price refresh): the 401 surfaces; neither value is in a log line or in the error", async () => {
    const output = captureOutput();

    const thrown = await makeAdapter({ LLM_BASE_URL: envStub.baseUrl, LLM_API_KEY: ENV_KEY }).listModels().catch((err: unknown) => err);

    expect({ status: (thrown as { status?: number }).status, leaks: leaksOf(thrown, output.lines) }).toEqual({ status: 401, leaks: [] });
  });
});

// RNX-190 (D199): an upstream failure is one of four typed errors with a fixed text: 401 or 403 → unauthorized; 400,
// 404 or 422 about the model → model not found; a timeout → timeout; anything else → unavailable. The status stays.
describe("RNX-190 AC2: typed upstream errors with fixed text", () => {
  const modelBody = { error: { message: `The model \`${SLUG}\` does not exist or you do not have access to it.` } };
  const cases: Array<[string, number, unknown, { kind: string; message: string }]> = [
    ["401", 401, { error: { message: "invalid key" } }, { kind: "unauthorized", message: "Provider rejected the credentials (401)" }],
    ["403", 403, { error: { message: "forbidden" } }, { kind: "unauthorized", message: "Provider rejected the credentials (403)" }],
    ["404 naming the model", 404, modelBody, { kind: "model_not_found", message: "Model not found at the provider (404)" }],
    ["400 naming the model", 400, modelBody, { kind: "model_not_found", message: "Model not found at the provider (400)" }],
    ["422 naming the model", 422, modelBody, { kind: "model_not_found", message: "Model not found at the provider (422)" }],
    ["404 not naming the model", 404, { error: { message: "no route" } }, { kind: "unavailable", message: "Provider unavailable (404)" }],
    ["503", 503, { error: { message: "overloaded" } }, { kind: "unavailable", message: "Provider unavailable (503)" }],
  ];
  /** The connect or request timeout fires at once: the signal is already aborted with a TimeoutError. */
  const timedOutSignal = () => AbortSignal.abort(new DOMException("timed out", "TimeoutError"));

  it.each(cases)("chat: %s → its typed error with its fixed text", async (_name, status, body, expected) => {
    provider.respond((_r, res) => sendJson(res, status, body));

    const thrown = await makeAdapter(staleEnv()).chat(request()).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ name: "ProviderHttpError", status, ...expected });
  });

  it.each(cases)("chatStream: %s → its typed error with its fixed text", async (_name, status, body, expected) => {
    provider.respond((_r, res) => sendJson(res, status, body));

    const thrown = await drain(makeAdapter(staleEnv()).chatStream(request())).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ name: "ProviderHttpError", status, ...expected });
  });

  it("chat: no answer within the timeout on every attempt → the timeout error with its fixed text, after the 6 attempts", async () => {
    jest.spyOn(AbortSignal, "timeout").mockImplementation(timedOutSignal);

    const thrown = await makeAdapter(staleEnv()).chat(request()).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ name: "ProviderTimeoutError", kind: "timeout", message: "Provider timed out" });
    expect(retryDelays).toHaveLength(5);
  });

  it("chatStream: the connect timeout → the timeout error with its fixed text", async () => {
    jest.spyOn(AbortSignal, "any").mockImplementation(timedOutSignal);

    const thrown = await drain(makeAdapter(staleEnv()).chatStream(request())).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ name: "ProviderTimeoutError", kind: "timeout", message: "Provider timed out" });
  });

  it("chat: a 2xx answer that is not JSON fails with a fixed text, never the parse error (it quotes the body)", async () => {
    provider.respond((_r, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`sk-...${plantedProviderSecret.keySuffix} not json`);
    });

    const thrown = await makeAdapter(staleEnv()).chat(request()).catch((err: unknown) => err);

    expect({ message: (thrown as Error).message, leaks: [inspect(thrown)].filter(plantedProviderSecret.isFoundIn) }).toEqual({
      message: "The provider answered with something other than JSON",
      leaks: [],
    });
  });
});
