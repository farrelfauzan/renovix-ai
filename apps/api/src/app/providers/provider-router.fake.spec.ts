import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ProvidersModule } from "./providers.module";
import { ProviderRouter } from "./provider-router";
import { FAKE_REPLY } from "./fake.adapter";
import { EmbeddingService } from "../knowledge/service/embedding.service";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";

describe("RX-8: fake provider through ProviderRouter", () => {
  const request = { model: "test-model", providerId: "vendor/test-model", messages: [] };
  const turn = {
    content: "Let me check. ",
    toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  };
  let fake: FakeProviderAdapter;
  let router: ProviderRouter;

  beforeEach(async () => {
    fake = new FakeProviderAdapter();
    const moduleRef = await withFakeProvider(
      Test.createTestingModule({ imports: [ProvidersModule] }),
      fake,
    ).compile();
    router = moduleRef.get(ProviderRouter);
  });

  it("chat returns the scripted text, tool call and usage", async () => {
    fake.enqueue(turn);

    const res = await router.chat("openrouter", request);

    expect(res.choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: "Let me check. ",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "calculator", arguments: '{"expression":"2+2"}' },
          },
        ],
      },
    });
    expect(res.usage).toEqual({ prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
    expect(fake.requests).toEqual([request]);
  });

  it("chatStream yields OpenRouter-shaped JSON chunks the chat engine can assemble", async () => {
    fake.enqueue(turn);

    // Same parsing as AgentRunService.streamExecution.
    let content = "";
    let usage: unknown;
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    for await (const raw of router.chatStream("openrouter", request)) {
      const parsed = JSON.parse(raw);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      for (const tc of delta?.tool_calls ?? []) {
        if (tc.id) toolCalls.push({ id: tc.id, name: tc.function?.name ?? "", arguments: "" });
        if (tc.function?.arguments) toolCalls[toolCalls.length - 1].arguments += tc.function.arguments;
      }
      if (parsed.usage) usage = parsed.usage;
    }

    expect(content).toBe("Let me check. ");
    expect(toolCalls).toEqual([
      { id: "call_1", name: "calculator", arguments: '{"expression":"2+2"}' },
    ]);
    expect(usage).toEqual({ prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
  });

  it("fails loudly when the script runs out", async () => {
    await expect(fake.chat(request)).rejects.toThrow(/no scripted turn/);
  });
});

describe("RX-161 AC-g: LLM_PROVIDER=fake makes no outbound fetch", () => {
  const ENV_KEYS = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY"] as const;
  const savedEnv = ENV_KEYS.map((k) => process.env[k]);

  afterEach(() => {
    jest.restoreAllMocks();
    ENV_KEYS.forEach((k, i) => {
      if (savedEnv[i] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[i];
    });
  });

  it("chat, chatStream and embed answer locally; any fetch fails the test", async () => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    process.env.LLM_PROVIDER = "fake";
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("RX-161 test: outbound fetch in fake mode");
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      providers: [EmbeddingService],
    }).compile();
    const router = moduleRef.get(ProviderRouter);
    const request = { model: "test-model", providerId: "vendor/test-model", messages: [] };

    const chat = await router.chat("openrouter", request);
    const payloads: string[] = [];
    for await (const p of router.chatStream("openrouter", request)) payloads.push(p);
    const [embedding] = await moduleRef.get(EmbeddingService).embed(["a"]);

    expect(chat.choices[0].message.content).toBe(FAKE_REPLY);
    expect(payloads.length).toBeGreaterThan(0);
    expect(embedding.embedding).toHaveLength(1024);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
