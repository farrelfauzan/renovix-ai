import { Test } from "@nestjs/testing";
import { ProvidersModule } from "./providers.module";
import { ProviderRouter } from "./provider-router";
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
