import { ConfigService } from "@nestjs/config";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { blockOutbound, chatCompletion, OutboundBlocker, sendJson, startStubHttpServer, StubHttpServer } from "../../../test/llm-stub";

// RX-177: the provider test request goes to the provider record's own base URL and key, once, with a
// short timeout, no retry, no env fallback and no LLM_MODEL_ID_MAP. Local stubs only; every other host is blocked.

const ENV_KEY = "fake-env-key-rx177-not-real";
const RECORD_KEY = "fake-record-key-rx177-not-real-Kk55";
const ENV_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_MODEL_ID_MAP"] as const;
const savedEnv = ENV_KEYS.map((key) => process.env[key]);
let blocker: OutboundBlocker;
let envPrimary: StubHttpServer;
let envFallback: StubHttpServer;
let record: StubHttpServer;
let adapter: OpenRouterAdapter;

beforeAll(async () => {
  [envPrimary, envFallback, record] = await Promise.all([startStubHttpServer(), startStubHttpServer(), startStubHttpServer()]);
  Object.assign(process.env, {
    LLM_BASE_URL: envPrimary.baseUrl,
    LLM_API_KEY: ENV_KEY,
    LLM_FALLBACK_BASE_URL: envFallback.baseUrl,
    LLM_FALLBACK_API_KEY: ENV_KEY,
    LLM_MODEL_ID_MAP: JSON.stringify({ "cc/claude-sonnet-5": "mapped-id" }),
  });
  adapter = new OpenRouterAdapter(new ConfigService());
});

beforeEach(() => {
  blocker = blockOutbound();
  for (const server of [envPrimary, envFallback, record]) server.requests.length = 0;
  envPrimary.respond((_r, res) => sendJson(res, 200, chatCompletion("env primary")));
  envFallback.respond((_r, res) => sendJson(res, 200, chatCompletion("env fallback")));
});

afterEach(() => {
  blocker.restore();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([envPrimary.close(), envFallback.close(), record.close()]);
  ENV_KEYS.forEach((key, i) => {
    if (savedEnv[i] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[i];
  });
});

describe("OpenRouterAdapter.testConnection (RX-177)", () => {
  it("sends one minimal request to the record's base URL with its key and the slug as is", async () => {
    record.respond((_r, res) => sendJson(res, 200, chatCompletion("pong")));

    const actual = await adapter.testConnection({ baseUrl: record.baseUrl, apiKey: RECORD_KEY, slug: "cc/claude-sonnet-5" });

    expect(actual).toEqual({ isSuccessful: true, reason: null });
    expect(record.requests).toHaveLength(1);
    expect(record.requests[0].url).toBe("/v1/chat/completions");
    expect(record.requests[0].headers.authorization).toBe(`Bearer ${RECORD_KEY}`);
    expect(record.requests[0].body).toEqual({ model: "cc/claude-sonnet-5", messages: [{ role: "user", content: "ping" }], max_tokens: 16 });
    expect([envPrimary.requests, envFallback.requests, blocker.blocked]).toEqual([[], [], []]);
  });

  it("a 503 is one attempt: no retry, no fallback; the reason names the status and never the key", async () => {
    record.respond((_r, res) => sendJson(res, 503, { error: `upstream down for ${RECORD_KEY}` }));

    const actual = await adapter.testConnection({ baseUrl: record.baseUrl, apiKey: RECORD_KEY, slug: "cc/claude-sonnet-5" });

    expect(actual.isSuccessful).toBe(false);
    expect(actual.reason).toBe("The provider answered 503: the request was refused");
    expect(record.requests).toHaveLength(1);
    expect(envFallback.requests).toEqual([]);
  });

  it("a 2xx answer without choices is a failure", async () => {
    record.respond((_r, res) => sendJson(res, 200, { hello: "not a chat completion" }));

    const actual = await adapter.testConnection({ baseUrl: record.baseUrl, apiKey: RECORD_KEY, slug: "x/y" });

    expect(actual).toEqual({ isSuccessful: false, reason: "The provider answered without a chat completion (no choices)" });
  });

  it("gives up after 15 seconds with a readable reason", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    record.respond(() => undefined);
    timeout.mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));

    const actual = await adapter.testConnection({ baseUrl: record.baseUrl, apiKey: RECORD_KEY, slug: "x/y" });

    expect(timeout).toHaveBeenCalledWith(15000);
    expect(actual).toEqual({ isSuccessful: false, reason: "No answer within 15 seconds" });
  });

  it("an unreachable host resolves with the network error; nothing is thrown", async () => {
    const actual = await adapter.testConnection({ baseUrl: "https://unreachable.invalid/v1", apiKey: RECORD_KEY, slug: "x/y" });

    expect(actual.isSuccessful).toBe(false);
    expect(actual.reason).toContain("The request failed");
    expect(actual.reason).not.toContain(RECORD_KEY);
    expect(blocker.blocked.map((request) => request.url)).toEqual(["https://unreachable.invalid/v1/chat/completions"]);
  });
});
