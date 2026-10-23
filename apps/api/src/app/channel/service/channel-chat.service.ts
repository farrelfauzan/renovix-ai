import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import type { CallableAgent } from "../../agent/types/callable-agent";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import type { AgentRunBudget } from "../../agent/types/agent-run-budget";
import type { ChannelChatResult } from "../types/channel-chat-result";
import type { ChannelToolLoop } from "../types/channel-tool-loop";
import { createMcpRunSession } from "../../agent/utils/create-mcp-run-session";

const MAX_TOOL_ITERATIONS = 30;

@Injectable()
export class ChannelChatService {
  private readonly logger = new Logger(ChannelChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModelRegistryService,
    private readonly channelService: ChannelService,
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    private readonly guardrail: GuardrailService,
    private readonly meter: AgentRunMeterService,
    private readonly links: AgentLinkService,
    private readonly policy: AgentRunPolicyService,
  ) {}

  /**
   * The refusals of a channel chat message, checked before any work on the chat route (the SSE headers, the classifier
   * call, the message), reads only. RX-178 (review B1): the room access check (403/404), RNX-119: then the run policy
   * on this run (404 "Agent not found" when the caller may no longer run the agent), RNX-260: then 409 in an archived
   * or deleted workspace, then the fixed 400
   * (ModelUnavailableException) for a model that cannot be resolved, RNX-119: then 403 without an active subscription
   * (D192). RNX-200: then the run's own pre-checks (the 400 for a model without credit rates, 402 RUN_CAP_EXCEEDED,
   * 402 CREDITS_EXHAUSTED) on a lower bound of the first call: the agent's system prompt, the message and max_tokens
   * (a document format only raises it).
   */
  async assertRunCanStart(userId: string, channelId: string, agentId: string, message: string): Promise<void> {
    const { agent } = await this.channelService.resolveChannelAgent(userId, channelId, agentId);
    await this.policy.assertRunStart(agent, userId);
    const modelEntry = await this.registry.resolveModel(agent.model);
    if (!modelEntry) throw new ModelUnavailableException();
    const connection = await this.registry.resolveConnection(modelEntry.slug);
    await this.policy.assertActiveSubscription(userId);
    await this.meter.assertRunCanStart({
      runnerUserId: userId,
      firstCall: {
        model: modelEntry.slug,
        connection,
        messages: [
          { role: "system", content: agent.systemPrompt || "You are a helpful assistant." },
          { role: "user", content: message },
        ],
        max_tokens: agent.maxTokens ?? 4096,
      },
    });
  }

  /**
   * One channel chat message as one run; RNX-222: the result carries the document its own `create_document` made.
   * RNX-119: the run policy and the subscription gate (D192) are checked on every message, not only when the agent was
   * added; the caller runs and pays (their own paid wallet).
   */
  async chat(
    userId: string,
    channelId: string,
    agentId: string,
    message: string,
    options?: { documentFormat?: string },
  ): Promise<ChannelChatResult> {
    this.logger.debug(
      `chat called with userId=${userId} channelId=${channelId} agentId=${agentId} message=${message.length} chars options=${JSON.stringify(options)}`,
    );
    // Resolve the channel agent (verifies access)
    const channelAgent = await this.channelService.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const agent = channelAgent.agent;
    const scope = await this.policy.assertRunStart(agent, userId);
    await this.policy.assertActiveSubscription(userId);

    // Input guardrail check — soft decline, returns a polite message
    const inputCheck = await this.guardrail.checkInput(
      message,
      userId,
      agentId,
    );
    if (inputCheck.blocked) {
      const declineMessage =
        inputCheck.userMessage || "I'm not able to help with that request.";
      // Save both messages so the conversation history reflects the interaction
      await this.channelService.saveMessage(channelAgent.id, userId, {
        role: "user",
        content: message,
      });
      const savedMsg = await this.channelService.saveMessage(
        channelAgent.id,
        userId,
        { role: "assistant", content: declineMessage },
      );
      return {
        content: declineMessage,
        totalTokens: 0,
        assistantMessageId: savedMsg.id,
      };
    }

    // RNX-118: the linked agents it may call, none when the caller is outside the agent's workspace (R17)
    const callableAgents = await this.links.listCallableAgents(agent, scope);

    // Build context
    const modelEntry = await this.registry.resolveModel(agent.model);
    if (!modelEntry) throw new ModelUnavailableException();
    const connection = await this.registry.resolveConnection(modelEntry.slug);

    // Get recent history for this agent in the channel room
    const chatRoom = await this.channelService.getOrCreateChatRoom(
      channelAgent.channelId,
    );
    // RNX-200: read before the user message is saved (once the run's reservation holds), so the 19 newest earlier
    // messages and this one make the 20 the prompt had before.
    const history = await this.prisma.channelMessage.findMany({
      where: {
        chatRoomId: chatRoom.id,
        agentId: channelAgent.agentId,
      },
      orderBy: { createdAt: "desc" },
      take: 19,
    });
    history.reverse();

    // Build system prompt with the callable agents
    let systemContent = agent.systemPrompt || "You are a helpful assistant.";

    // Inject workspace memories (RNX-119, R17: none for a run outside the workspace)
    const memoryContext = await this.memoryService.getWorkspaceMemoryContext(
      agent.id,
      scope,
      channelId,
    );
    if (memoryContext) {
      systemContent += `\n\n## Workspace Memory\nHere are important facts you should remember:\n${memoryContext}`;
    }

    // Memory instruction
    systemContent += `\n\n## Memory Policy\nAfter completing an important task (creating documents, spreadsheets, setting up resources, etc.), use the memory_store tool to save key details (IDs, URLs, names, structure) so you can reference them in future conversations.`;

    if (callableAgents.length > 0) {
      const callableList = callableAgents
        .map(
          (callee) =>
            `- ${callee.name} (id: ${callee.id})${callee.description ? `: ${callee.description}` : ""}`,
        )
        .join("\n");
      systemContent += `\n\n## Callable Agents\n${callableList}\n\nCall policy:\n- Use the call_agent tool to give one of these agents a task.\n- Never invent agent names or IDs not in this list.`;
    }

    // When generating a document, instruct agent to research first
    if (options?.documentFormat) {
      this.logger.debug(
        `Injecting document generation instructions for format=${options.documentFormat}`,
      );
      const formatLabel =
        { pdf: "PDF", docx: "Word document", xlsx: "Excel spreadsheet" }[
          options.documentFormat
        ] || options.documentFormat;
      systemContent += `\n\n## Document Generation Mode\nThe user wants a ${formatLabel} document. Follow these steps:\n1. If you have tools available (web_search, call_agent), USE THEM FIRST to research the topic thoroughly before writing.\n2. Write comprehensive, well-structured markdown content with proper headings, sections, and details.\n3. The markdown you produce will be automatically converted to ${formatLabel}. Focus on quality content.`;
    }

    // Build messages
    const currentMessages: any[] = [
      { role: "system", content: systemContent },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Build tool schemas including MCP tools (RNX-118: call_agent with callable agents). RNX-217: the MCP connections
    // are this run's own (mcpSession), closed on every path (success, refusal, provider error, budget stop).
    const workspaceId = channelAgent.channel?.workspace?.id || undefined;
    const mcpSession = createMcpRunSession();
    try {
      const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
        agent.tools,
        agent.id,
        userId,
        workspaceId,
        {
          injectCallAgent: callableAgents.length > 0,
          mcpSession,
        },
      );

      this.logger.debug(
        `Initial chat setup complete. model=${modelEntry.slug} tools=${toolSchemas.length} messages=${currentMessages.length}`,
      );

      // One run on the ledger (RX-22b): a new runId, one reservation, a usage entry per model call (root and
      // sub-agents) and a budget stop before each call (docs/credits.md section 13).
      const loop: ChannelToolLoop = {
        userId,
        channelId,
        agentId,
        message,
        channelAgent,
        modelEntry,
        connection,
        currentMessages,
        toolSchemas,
        mcpSession,
        callableAgents,
        scope,
        maxTokens: options?.documentFormat
          ? Math.max(agent.maxTokens ?? 4096, 8192)
          : (agent.maxTokens ?? 4096),
      };
      const metered = await this.meter.meterRun(
        {
          runnerUserId: userId,
          workspaceId,
          firstCall: {
            model: modelEntry.slug,
            connection,
            messages: currentMessages,
            tools: toolSchemas,
            max_tokens: loop.maxTokens,
          },
          linkedAgents: callableAgents,
        },
        async (meteredRun) => {
          // RNX-200: saved once the reservation holds; a refused message saves nothing.
          await this.channelService.saveMessage(channelAgent.id, userId, { role: "user", content: message });
          return this.runToolLoop(loop, meteredRun);
        },
      );
      if (metered.status === "completed") return { ...metered.value, document: mcpSession.document };
      const stopContent = budgetStopMessage(metered.held);
      const stopMessage = await this.channelService.saveMessage(
        channelAgent.id,
        userId,
        { role: "assistant", content: stopContent },
      );
      return {
        content: stopContent,
        totalTokens: 0,
        assistantMessageId: stopMessage.id,
        document: mcpSession.document,
      };
    } finally {
      await this.toolService.cleanupMcpConnections(mcpSession);
    }
  }

  /** The tool loop of one channel chat message, every model call metered on the run (RX-22b). */
  private async runToolLoop(
    loop: ChannelToolLoop,
    meteredRun: AgentRunBudget,
  ): Promise<ChannelChatResult> {
    const { userId, channelId, agentId, message, channelAgent } = loop;
    const { modelEntry, connection, currentMessages, toolSchemas, mcpSession, callableAgents, scope } = loop;
    const agent = channelAgent.agent;

    // Tool execution loop
    let iterations = 0;
    let totalTokens = 0;
    let accumulatedContent = "";

    while (iterations < MAX_TOOL_ITERATIONS) {
      const callParams: any = {
        model: modelEntry.slug,
        connection,
        messages: currentMessages,
        temperature: agent.temperature,
        max_tokens: loop.maxTokens,
      };

      if (toolSchemas.length > 0) {
        callParams.tools = toolSchemas;
        callParams.tool_choice = "auto";
      }

      const payloadSize = (JSON.stringify(callParams).length / 1024).toFixed(1);
      this.logger.log(
        `[chat] iteration=${iterations} | model=${modelEntry.slug} messages=${currentMessages.length} tools=${toolSchemas.length} payload=${payloadSize}KB`,
      );

      const startTime = Date.now();
      const metered = await this.meter.callModel(meteredRun, {
        agentId: agent.id,
        parentCallId: null,
        request: callParams,
      });
      const response: any = metered.response;
      const elapsed = Date.now() - startTime;

      const choice = response.choices?.[0];
      totalTokens += response.usage?.total_tokens || 0;

      this.logger.log(
        `[chat] iteration=${iterations} | RESPONSE in ${elapsed}ms | prompt=${response.usage?.prompt_tokens ?? "?"} completion=${response.usage?.completion_tokens ?? "?"} total=${response.usage?.total_tokens ?? "?"} cumulative=${totalTokens} | finish_reason=${choice?.finish_reason}`,
      );

      if (!choice) {
        break;
      }

      // If tool calls, execute them and loop
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        this.logger.log(
          `[chat] Tool calls: ${choice.message.tool_calls.map((tc: any) => tc.function.name).join(", ")}`,
        );

        currentMessages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            let result: string;

            if (toolCall.function.name === "call_agent") {
              result = await this.executeSubAgent(agent, callableAgents, args, meteredRun, metered.callId);
            } else {
              result = await this.toolService.executeTool(
                toolCall.function.name,
                args,
                agent,
                mcpSession,
                scope,
                userId,
                channelId,
              );
            }

            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content:
                result.length > 4000
                  ? result.slice(0, 4000) + "\n...[truncated]"
                  : result,
            });
          } catch (err: any) {
            // The budget stop ends the whole run (docs/credits.md section 13.4), not just this tool call.
            if (err instanceof RunBudgetStoppedError) throw err;
            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Error: ${err.message}`,
            });
          }
        }

        iterations++;
        continue;
      }

      // Handle truncated response (hit max_tokens)
      if (choice.finish_reason === "length" && choice.message?.content) {
        this.logger.warn(
          `[chat] Response truncated (finish_reason=length) at iteration=${iterations}, continuing generation...`,
        );
        accumulatedContent += choice.message.content;
        // Push partial content as assistant message and ask to continue
        currentMessages.push({
          role: "assistant",
          content: choice.message.content,
        });
        currentMessages.push({
          role: "user",
          content:
            "Continue from where you left off. Do not repeat what you already said.",
        });
        iterations++;
        continue;
      }

      // Final text response
      const rawContent = accumulatedContent + (choice.message?.content || "");

      // Output guardrail check
      const outputCheck = await this.guardrail.checkOutput(
        rawContent,
        userId,
        agentId,
      );
      const fullContent = outputCheck.blocked
        ? outputCheck.sanitized || "I'm unable to provide that response."
        : outputCheck.content || rawContent;

      // Save assistant message
      if (fullContent) {
        const savedMessage = await this.channelService.saveMessage(
          channelAgent.id,
          userId,
          {
            role: "assistant",
            content: fullContent,
            tokens: totalTokens,
          },
        );

        // Extract and store memory asynchronously
        this.memoryService
          .extractAndStore(agent.id, userId, message, fullContent, scope, channelId)
          .catch((err: any) =>
            this.logger.error(`Memory extraction failed: ${err.message}`),
          );

        return {
          content: fullContent,
          totalTokens,
          assistantMessageId: savedMessage.id,
        };
      }

      return { content: fullContent, totalTokens };
    }

    // Hit max iterations — save what we have and inform user
    this.logger.warn(
      `[chat] Reached MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for agent=${agent.id}`,
    );
    const fallbackContent =
      "I've completed as much as I could, but the task required more steps than I can handle in a single turn. Please ask me to continue where I left off.";
    const savedMsg = await this.channelService.saveMessage(
      channelAgent.id,
      userId,
      { role: "assistant", content: fallbackContent, tokens: totalTokens },
    );

    return {
      content: fallbackContent,
      totalTokens,
      assistantMessageId: savedMsg.id,
    };
  }

  /**
   * One hop (RX-22b), behind call_agent (RNX-118): the called agent's model call is metered on the run, with the
   * calling model call as its parent. Only an agent of `callableAgents` (a linked callee in the caller's workspace,
   * none for a caller outside it) is called; any other name is refused and nothing runs.
   */
  private async executeSubAgent(
    parentAgent: any,
    callableAgents: CallableAgent[],
    args: any,
    meteredRun: AgentRunBudget,
    parentCallId: string,
  ): Promise<string> {
    const rawIdentifier = typeof args?.agent === "string" ? args.agent.trim() : "";
    const task = typeof args?.task === "string" ? args.task.trim() : "";
    const taskContext = typeof args?.context === "string" ? args.context.trim() : "";

    if (!rawIdentifier) return "Error: Missing agent.";
    if (!task) return "Error: Missing task for the called agent.";

    const subAgent = callableAgents.find(
      (callee) => callee.id === rawIdentifier || callee.name.toLowerCase() === rawIdentifier.toLowerCase(),
    );

    if (!subAgent) {
      this.logger.warn(
        `[executeSubAgent] Not callable: "${rawIdentifier}" for caller ${parentAgent.id}`,
      );
      return "Error: Agent not found or not linked.";
    }

    const modelEntry = await this.registry.resolveModel(subAgent.model);
    if (!modelEntry)
      return `Error: Sub-agent model "${subAgent.model}" unavailable.`;

    this.logger.log(
      `[executeSubAgent] Running: ${subAgent.name} (${subAgent.id}) | model=${modelEntry.slug} | task="${task.slice(0, 80)}"`,
    );

    const subMessages: any[] = [
      {
        role: "system",
        content: subAgent.systemPrompt || "You are a helpful assistant.",
      },
      {
        role: "user",
        content: `Task from agent "${parentAgent.name}": ${task}${taskContext ? `\n\nContext: ${taskContext}` : ""}`,
      },
    ];

    // Don't pass tools to the called agent — it should respond with text only
    const startTime = Date.now();
    const connection = await this.registry.resolveConnection(modelEntry.slug);
    const { response } = await this.meter.callModel(meteredRun, {
      agentId: subAgent.id,
      parentCallId,
      request: {
        model: modelEntry.slug,
        connection,
        messages: subMessages,
        temperature: subAgent.temperature,
        max_tokens: subAgent.maxTokens ?? 4096,
      },
    });

    const result =
      response.choices?.[0]?.message?.content ||
      "Sub-agent returned empty response.";
    this.logger.log(
      `[executeSubAgent] Done in ${Date.now() - startTime}ms | tokens=${response.usage?.total_tokens ?? "?"} | result=${result.slice(0, 150)}`,
    );

    return result;
  }
}
