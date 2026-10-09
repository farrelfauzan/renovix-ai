import { ChatRequest, ChatResponse, ProviderAdapter } from "./provider.interface";

/** One scripted model reply: text, tool calls, or both. */
export interface FakeTurn {
  content?: string;
  toolCalls?: { id?: string; name: string; arguments: object | string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** Text of every canned reply (LLM_PROVIDER=fake). */
export const FAKE_REPLY =
  "This is a canned reply from the fake LLM provider. No real model was called.";

/** In the last user message, asks the canned fake for a tool call. */
export const FAKE_TOOL_KEYWORD = "[[fake:tool]]";

/**
 * A ProviderAdapter that replays scripted turns, one per chat/chatStream
 * call, and records every request. No network. It mirrors OpenRouterAdapter:
 * `chat` returns the mapped response (tool calls on `message.tool_calls`);
 * `chatStream` yields the JSON payload of each SSE `data:` line, without
 * `[DONE]`, ending with OpenRouter's usage chunk.
 *
 * With `{ canned: true }` (the runtime LLM_PROVIDER=fake mode, RX-88) a call
 * with no scripted turn left gets `cannedTurn` instead of throwing, and is
 * not recorded in `requests`.
 */
export class FakeProviderAdapter implements ProviderAdapter {
  readonly requests: ChatRequest[] = [];
  private readonly turns: FakeTurn[];

  constructor(
    turns: FakeTurn[] = [],
    private readonly options: { canned?: boolean } = {},
  ) {
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
    if (this.options.canned && this.turns.length === 0) {
      return cannedTurn(params);
    }
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

/**
 * The runtime fake's deterministic reply. If the last user message contains
 * FAKE_TOOL_KEYWORD, tools are offered and the last message is not a tool
 * result: one call to the first offered tool with `{}` as arguments.
 * Otherwise FAKE_REPLY (so the agent loop ends after the tool result).
 * Usage: about 4 characters per token of the messages and of the reply.
 */
function cannedTurn(params: ChatRequest): FakeTurn {
  const messages = params.messages as { role: string; content: unknown }[];
  const text = (m: { content: unknown }) =>
    typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
  const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
  const prompt_tokens = tokens(messages.map(text).join("\n"));
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const tool: string | undefined = params.tools?.[0]?.function?.name;

  if (
    tool &&
    lastUser &&
    text(lastUser).includes(FAKE_TOOL_KEYWORD) &&
    messages[messages.length - 1]?.role !== "tool"
  ) {
    return {
      toolCalls: [{ name: tool, arguments: {} }],
      usage: { prompt_tokens, completion_tokens: tokens(tool) + 1 },
    };
  }
  return {
    content: FAKE_REPLY,
    usage: { prompt_tokens, completion_tokens: tokens(FAKE_REPLY) },
  };
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
