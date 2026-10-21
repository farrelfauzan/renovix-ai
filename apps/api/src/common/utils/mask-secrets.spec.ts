import { maskSecrets } from "./mask-secrets";

describe("RNX-17: maskSecrets", () => {
  it("masks secret keys at any depth and leaves the other fields as they are", () => {
    const input = {
      headers: { authorization: "Bearer abc", cookie: "a=1", "x-api-key": "k1", "content-type": "application/json" },
      body: { password: "p1", provider: { apiKey: "k2", encryptedApiKey: "k3", baseUrl: "https://x.test" } },
      session: { accessToken: "t1", refresh_token: "t2" },
      usage: { prompt_tokens: 5, maxTokens: 10, tokensOut: 3 },
    };

    const actual = maskSecrets(input);

    expect(actual).toEqual({
      headers: { authorization: "[REDACTED]", cookie: "[REDACTED]", "x-api-key": "[REDACTED]", "content-type": "application/json" },
      body: { password: "[REDACTED]", provider: { apiKey: "[REDACTED]", encryptedApiKey: "[REDACTED]", baseUrl: "https://x.test" } },
      session: { accessToken: "[REDACTED]", refresh_token: "[REDACTED]" },
      usage: { prompt_tokens: 5, maxTokens: 10, tokensOut: 3 },
    });
    expect(input.headers.authorization).toBe("Bearer abc");
  });

  it.each([
    ["Sent Bearer abc.def-123", "Sent Bearer [REDACTED]"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: [REDACTED]"],
    ["Cookie: session_token=abc; theme=dark", "Cookie: [REDACTED]"],
    ['{"authorization":"Bearer abc","cookie":"a=1; b=2","host":"h"}', '{"authorization":"[REDACTED]","cookie":"[REDACTED]","host":"h"}'],
    ["login password=hunter2 ok", "login password=[REDACTED] ok"],
    ['{"apiKey":"k1","password":"p1"}', '{"apiKey":"[REDACTED]","password":"[REDACTED]"}'],
    ["/callback?token=abc&state=1", "/callback?token=[REDACTED]&state=1"],
    ["Incorrect API key provided: sk-or-v1-abcdef123", "Incorrect API key provided: [REDACTED]"],
    ["key sk_live_0123456789 refused", "key [REDACTED] refused"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here", "jwt [REDACTED] here"],
    ["connect postgresql://renovix:s3cret@db:5432/app", "connect postgresql://renovix:[REDACTED]@db:5432/app"],
  ])("masks the secret in %j", (input, expected) => {
    expect(maskSecrets(input)).toBe(expected);
  });

  it.each([
    "Authentication required",
    "Missing or invalid Authorization header",
    "Basic plan renewed for task-runner",
    "usage prompt_tokens: 5 completion_tokens: 3",
    "OpenRouter stream error (127.0.0.1:4000, 401): Provider error (status 401)",
  ])("leaves %j as it is", (input) => {
    expect(maskSecrets(input)).toBe(input);
  });

  it("masks an error's message, stack, own fields and cause, and keeps it an error with its name", () => {
    const cause = new Error("cause with Bearer abc");
    const input = Object.assign(new TypeError("failed with sk-or-v1-abcdef123", { cause }), {
      config: { headers: { Authorization: "Bearer abc" } },
    });

    const actual = maskSecrets(input) as Error & { config: unknown };

    expect(actual).toBeInstanceOf(Error);
    expect(actual.name).toBe("TypeError");
    expect(actual.message).toBe("failed with [REDACTED]");
    expect(actual.stack).toContain("failed with [REDACTED]");
    expect(actual.stack).not.toContain("sk-or-v1");
    expect(actual.config).toEqual({ headers: { Authorization: "[REDACTED]" } });
    expect((actual.cause as Error).message).toBe("cause with Bearer [REDACTED]");
  });

  it("prints a value with toJSON (a Date, a Decimal) as JSON would, masked", () => {
    const input = { at: new Date("2026-10-21T00:00:00.000Z"), amount: { toJSON: () => "1.5" }, note: { toJSON: () => "Bearer abc" } };

    expect(maskSecrets(input)).toEqual({ at: "2026-10-21T00:00:00.000Z", amount: "1.5", note: "Bearer [REDACTED]" });
  });

  it("masks inside arrays, maps and sets, and survives a circular object", () => {
    const circular: Record<string, unknown> = { token: "t1" };
    circular.self = circular;

    const actual = maskSecrets([new Map([["password", "p1"]]), new Set(["Bearer abc"]), circular]);

    expect(actual).toEqual([{ password: "[REDACTED]" }, ["Bearer [REDACTED]"], { token: "[REDACTED]", self: "[Circular]" }]);
  });
});
