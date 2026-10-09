import { readFileSync } from "fs";
import { join } from "path";
import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { resolveLlmProvider } from "./llm-provider";
import { ProvidersModule } from "./providers.module";
import { ProviderRouter } from "./provider-router";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { FakeProviderAdapter } from "./fake.adapter";

describe("RX-88: resolveLlmProvider (boot guard)", () => {
  it.each([
    [{}, "openrouter"],
    [{ LLM_PROVIDER: "" }, "openrouter"],
    [{ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" }, "openrouter"],
    [{ LLM_PROVIDER: "fake" }, "fake"],
    [{ LLM_PROVIDER: "fake", NODE_ENV: "development" }, "fake"],
  ])("%j → %s", (env, expected) => {
    expect(resolveLlmProvider(env)).toBe(expected);
  });

  it("AC1: fake in production is refused", () => {
    expect(() =>
      resolveLlmProvider({ LLM_PROVIDER: "fake", NODE_ENV: "production" }),
    ).toThrow("LLM_PROVIDER=fake is not allowed in production");
  });

  it("AC2: fake next to a real OPENROUTER_API_KEY is refused without printing the key", () => {
    const key = "sk-or-v1-secret-value-123";
    let message = "";
    try {
      resolveLlmProvider({ LLM_PROVIDER: "fake", OPENROUTER_API_KEY: key });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("OPENROUTER_API_KEY is set");
    expect(message).not.toContain(key);
  });

  it("AC3: an unknown value is refused", () => {
    expect(() => resolveLlmProvider({ LLM_PROVIDER: "openai" })).toThrow(
      'LLM_PROVIDER must be "openrouter" or "fake" (got "openai")',
    );
  });

  it("AC1: main.ts calls it before NestFactory.create", () => {
    const main = readFileSync(join(__dirname, "../../main.ts"), "utf8");
    const guard = main.indexOf("resolveLlmProvider(process.env)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(main.indexOf("NestFactory.create"));
  });
});

describe("RX-88: ProvidersModule picks the adapter from LLM_PROVIDER", () => {
  const keys = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "NODE_ENV"] as const;
  const saved = keys.map((k) => process.env[k]);
  afterEach(() => {
    jest.restoreAllMocks();
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  });

  const compile = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ProvidersModule,
      ],
    }).compile();

  it("AC3: unset → OpenRouterAdapter behind the router (today's behaviour)", async () => {
    delete process.env.LLM_PROVIDER;
    process.env.OPENROUTER_API_KEY = "dummy-not-real";

    const moduleRef = await compile();

    expect(moduleRef.get(OpenRouterAdapter)).toBeInstanceOf(OpenRouterAdapter);
    const router = moduleRef.get(ProviderRouter);
    await expect(router.chat("other", { model: "m", providerId: "p", messages: [] })).rejects.toThrow(
      "No adapter found for provider: other",
    );
  });

  it("AC3: an unknown value fails the module", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENROUTER_API_KEY = "dummy-not-real";

    await expect(compile()).rejects.toThrow(/LLM_PROVIDER must be/);
  });

  it("fake → the canned fake for every provider name, OpenRouterAdapter never built, warning logged", async () => {
    process.env.LLM_PROVIDER = "fake";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.NODE_ENV;
    const warn = jest.spyOn(Logger.prototype, "warn");

    const moduleRef = await compile();

    expect(moduleRef.get(OpenRouterAdapter)).toBeInstanceOf(FakeProviderAdapter);
    expect(warn).toHaveBeenCalledWith(
      "LLM provider: FAKE — no real model calls. Never use in production.",
    );
    const router = moduleRef.get(ProviderRouter);
    for (const provider of ["openrouter", "anything-else"]) {
      const res = await router.chat(provider, { model: "m", providerId: "p", messages: [] });
      expect(res.choices[0].message.content).toContain("canned reply");
    }
  });
});
