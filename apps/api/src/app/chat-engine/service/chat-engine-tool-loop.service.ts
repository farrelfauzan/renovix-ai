import { BadRequestException, Injectable } from "@nestjs/common";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import type { ToolSchema } from "../../agent/types/tool-schema";
import { createMcpRunSession } from "../../agent/utils/create-mcp-run-session";
import { rememberOfferedTools } from "../../agent/utils/remember-offered-tools";
import { CHANNEL_CHAT_CONTINUE_PROMPT } from "../../channel/config/channel-chat-continue-prompt";
import { ChatEngineExecution } from "../ports/chat-engine-execution.port";
import { ChatEnginePeerCall } from "../ports/chat-engine-peer-call.port";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatExecutionInput } from "../types/chat-execution-input";
import type { ChatModelReply } from "../types/chat-model-reply";
import type { ChatToolCall } from "../types/chat-tool-call";
import type { ChatToolLoopRun } from "../types/chat-tool-loop-run";
import { loopProfileOf } from "../utils/loop-profile-of";
import { toInitialMessages } from "../utils/to-initial-messages";
import { toLoopModelRequest } from "../utils/to-loop-model-request";
import { truncateToolResult } from "../utils/truncate-tool-result";

/**
 * RNX-283: the engine's execution: a bounded tool loop over the metered model call (`callModel`), the agent's tools
 * (AgentToolService, with its RNX-276 offer check and timeout cleanup) and the empty peer port. Only tools that are
 * both the agent's and in the request's offered list are offered, and only those can run (code_exec is never one).
 * Each source keeps its legacy loop behaviour (its ChatEngineLoopProfile): the round limit and its message, length
 * continuation, tool-result truncation and a response without a choice. A malformed call or a failing or timed-out
 * tool gives the model an "Error: …" tool result, as the legacy loops do; the budget stop is never swallowed. The
 * abort signal is checked before every tool call (the meter checks it around every model call). One text chunk, the
 * raw answer, ends the loop; the engine approves it before anything is stored. The run's MCP connections are closed
 * on every path.
 */
@Injectable()
export class ChatEngineToolLoop extends ChatEngineExecution {
  constructor(
    private readonly tools: AgentToolService,
    private readonly peers: ChatEnginePeerCall,
  ) {
    super();
  }

  /** Runs the loop for this input and yields each tool result, then the raw answer. */
  async *execute(input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
    const profile = loopProfileOf(input.source);
    const mcpSession = createMcpRunSession();
    try {
      const tools = await this.offerTools(input, mcpSession);
      yield* this.runLoop({ input, profile, mcpSession, tools, messages: toInitialMessages(input), iterations: 0 });
    } finally {
      await this.tools.cleanupMcpConnections(mcpSession);
    }
  }

  /** The agent's tool schemas that the request offers; the run's session then allows exactly those names (RNX-276). */
  private async offerTools(input: ChatExecutionInput, mcpSession: ChatToolLoopRun["mcpSession"]): Promise<ToolSchema[]> {
    const { agent, principal, context } = input;
    const built = await this.tools.buildToolSchemasWithMcp(agent.tools, agent.id, principal.runnerUserId, agent.workspaceId, { mcpSession });
    const requested = new Set(context.offeredTools.map((tool) => tool.name));
    const offered = built.filter((schema) => requested.has(schema.function.name));
    mcpSession.offeredToolNames.clear();
    rememberOfferedTools(mcpSession, offered);
    return offered;
  }

  /** The model rounds, up to the profile's limit: tool calls loop, a cut answer continues where the source does, any other answer ends it. */
  private async *runLoop(loop: ChatToolLoopRun): AsyncGenerator<ChatExecutionChunk> {
    const { input, profile } = loop;
    let continued = "";
    while (loop.iterations < profile.maxIterations) {
      const { response } = await input.callModel(toLoopModelRequest(loop));
      const choice = response.choices?.[0];
      if (!choice && profile.throwsOnMissingChoice) throw new BadRequestException("No response from LLM");
      if (!choice) break;
      const reply = choice.message as ChatModelReply;
      if (reply?.tool_calls?.length) {
        yield* this.runToolCalls(loop, reply);
        continue;
      }
      if (profile.continuesOnLength && choice.finish_reason === "length" && reply?.content) {
        continued += reply.content;
        loop.messages.push({ role: "assistant", content: reply.content }, { role: "user", content: CHANNEL_CHAT_CONTINUE_PROMPT });
        loop.iterations++;
        continue;
      }
      yield { type: "text", text: continued + (reply?.content || "") };
      return;
    }
    yield { type: "text", text: profile.maxStepsMessage };
  }

  /** One round's tool calls, in order; each result goes back to the model (cut per profile) and out as a chunk. */
  private async *runToolCalls(loop: ChatToolLoopRun, reply: ChatModelReply): AsyncGenerator<ChatExecutionChunk> {
    loop.messages.push(reply);
    for (const toolCall of reply.tool_calls ?? []) {
      loop.input.signal?.throwIfAborted();
      const content = truncateToolResult(await this.runToolCall(loop, toolCall), loop.profile.toolResultMaxChars);
      loop.messages.push({ role: "tool", tool_call_id: toolCall.id, content });
      yield { type: "tool_result", toolName: toolCall.function?.name ?? "", content };
    }
    loop.iterations++;
  }

  /** One tool call's result: call_agent goes to the peer port, any other name to the tool service; a failure is the "Error: …" result, the budget stop ends the run. */
  private async runToolCall(loop: ChatToolLoopRun, toolCall: ChatToolCall): Promise<string> {
    const { input, mcpSession } = loop;
    try {
      const args: unknown = JSON.parse(toolCall.function.arguments);
      if (toolCall.function.name !== "call_agent") {
        return await this.tools.executeTool(toolCall.function.name, args, input.agent, mcpSession, input.context.scope, input.principal.runnerUserId);
      }
      const result = await this.peers.callPeer({ runnerUserId: input.principal.runnerUserId, agentId: input.agent.id, args });
      loop.iterations += loop.profile.agentCallExtraIterations;
      return result;
    } catch (err) {
      if (err instanceof RunBudgetStoppedError) throw err;
      return `Error: ${(err as Error).message}`;
    }
  }
}
