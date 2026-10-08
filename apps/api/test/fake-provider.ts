import { TestingModuleBuilder } from "@nestjs/testing";
import { OpenRouterAdapter } from "../src/app/providers/openrouter.adapter";
import {
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from "../src/app/providers/provider.interface";

/** One scripted model reply: text, tool calls, or both. */
export interface FakeTurn {
  content?: string;
  toolCalls?: { id?: string; name: string; arguments: object | string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * A ProviderAdapter that replays scripted turns, one per chat/chatStream
 * call, and records every request. No network. It mirrors OpenRouterAdapter:
 * `chat` returns the mapped response (tool calls on `message.tool_calls`);
 * `chatStream` yields the JSON payload of each SSE `data:` line, without
 * `[DONE]`, ending with OpenRouter's usage chunk.
 */
export class FakeProviderAdapter implements ProviderAdapter {
  readonly requests: ChatRequest[] = [];
  private readonly turns: FakeTurn[];

  constructor(turns: FakeTurn[] = []) {
    this.turns = [...turns];
  }

  enqueue(...turns: FakeTurn[]) {
    this.turns.push(...turns);
    return this;
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const turn = this.next(params);
    const toolCalls = toolCallsOf(turn);
    const message = {
      role: "assistant" as const,
      content: turn.content ?? "",
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    };
    return {
      id: `gen-fake-${this.requests.length}`,
      model: params.model,
      choices: [{ index: 0, message, finish_reason: finishReason(turn) }],
      usage: usageOf(turn),
    };
  }

  async *chatStream(params: ChatRequest): AsyncGenerator<string, void, unknown> {
    const turn = this.next(params);
    const id = `gen-fake-${this.requests.length}`;
    const chunk = (choice: object, extra: object = {}) =>
      JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: 0,
        model: params.providerId,
        choices: [{ index: 0, finish_reason: null, ...choice }],
        ...extra,
      });

    for (const piece of (turn.content ?? "").split(/(?<=\s)/).filter(Boolean)) {
      yield chunk({ delta: { role: "assistant", content: piece } });
    }
    for (const [index, call] of toolCallsOf(turn).entries()) {
      const { name, arguments: args } = call.function;
      const half = Math.ceil(args.length / 2);
      yield chunk({
        delta: {
          tool_calls: [
            { index, id: call.id, type: "function", function: { name, arguments: "" } },
          ],
        },
      });
      yield chunk({ delta: { tool_calls: [{ index, function: { arguments: args.slice(0, half) } }] } });
      yield chunk({ delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] } });
    }
    const finish_reason = finishReason(turn);
    yield chunk({ delta: {}, finish_reason });
    yield chunk(
      { delta: { role: "assistant", content: "" }, finish_reason },
      { usage: usageOf(turn) },
    );
  }

  private next(params: ChatRequest): FakeTurn {
    this.requests.push(params);
    const turn = this.turns.shift();
    if (!turn) {
      throw new Error(
        `FakeProviderAdapter: no scripted turn left for request ${this.requests.length}`,
      );
    }
    return turn;
  }
}

/** Installs the fake in place of OpenRouterAdapter, so ProviderRouter's "openrouter" key uses it. */
export function withFakeProvider(
  builder: TestingModuleBuilder,
  fake: FakeProviderAdapter,
) {
  return builder.overrideProvider(OpenRouterAdapter).useValue(fake);
}

function toolCallsOf(turn: FakeTurn) {
  return (turn.toolCalls ?? []).map((call, i) => ({
    id: call.id ?? `call_fake_${i}`,
    type: "function" as const,
    function: {
      name: call.name,
      arguments:
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments),
    },
  }));
}

function finishReason(turn: FakeTurn) {
  return turn.toolCalls?.length ? "tool_calls" : "stop";
}

function usageOf(turn: FakeTurn) {
  const { prompt_tokens, completion_tokens } = turn.usage ?? {
    prompt_tokens: 10,
    completion_tokens: 5,
  };
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}
