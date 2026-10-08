import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { ProviderRouter } from "../providers/provider-router";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../agent/agent-tool.service";
import { AgentMemoryService } from "../agent/agent-memory.service";
import { UsageService } from "../usage/usage.service";
import { GuardrailService } from "../guardrail/guardrail.service";

const MAX_TOOL_ITERATIONS = 30;

@Injectable()
export class ChannelChatService {
  private readonly logger = new Logger(ChannelChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModelRegistryService,
    private readonly providerRouter: ProviderRouter,
    private readonly channelService: ChannelService,
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    private readonly usage: UsageService,
    private readonly guardrail: GuardrailService,
  ) {}

  async chat(
    userId: string,
    channelId: string,
    agentId: string,
    message: string,
    options?: { documentFormat?: string },
  ): Promise<{
    content: string;
    totalTokens: number;
    assistantMessageId?: string;
  }> {
    console.log(
      `chat called with userId=${userId} channelId=${channelId} agentId=${agentId} message=${message.length} chars options=${JSON.stringify(options)}`,
    );
    // Resolve the channel agent (verifies access)
    const channelAgent = await this.channelService.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const agent = channelAgent.agent;

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

    // Load sub-agents if this is a parent agent
    const subAgents =
      agent.agentType === "parent"
        ? await this.prisma.agent.findMany({
            where: { parentAgentId: agent.id, status: "active" },
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              model: true,
            },
          })
        : [];

    // Save user message
    await this.channelService.saveMessage(channelAgent.id, userId, {
      role: "user",
      content: message,
    });

    // Build context
    const modelEntry = await this.registry.resolveModel(agent.model);
    if (!modelEntry) {
      throw new BadRequestException(`Model "${agent.model}" is not available`);
    }

    // Get recent history for this agent in the channel room
    const chatRoom = await this.channelService.getOrCreateChatRoom(
      channelAgent.channelId,
    );
    const history = await this.prisma.channelMessage.findMany({
      where: {
        chatRoomId: chatRoom.id,
        agentId: channelAgent.agentId,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    history.reverse();

    // Build system prompt with sub-agent info
    let systemContent = agent.systemPrompt || "You are a helpful assistant.";

    // Inject workspace memories
    const memoryContext = await this.memoryService.getWorkspaceMemoryContext(
      agent.id,
    );
    if (memoryContext) {
      systemContent += `\n\n## Workspace Memory\nHere are important facts you should remember:\n${memoryContext}`;
    }

    // Memory instruction
    systemContent += `\n\n## Memory Policy\nAfter completing an important task (creating documents, spreadsheets, setting up resources, etc.), use the memory_store tool to save key details (IDs, URLs, names, structure) so you can reference them in future conversations.`;

    if (subAgents.length > 0) {
      const subAgentList = subAgents
        .map(
          (sa) =>
            `- ${sa.name} (id: ${sa.id})${sa.description ? `: ${sa.description}` : ""}`,
        )
        .join("\n");
      systemContent += `\n\n## Available Sub-Agents\n${subAgentList}\n\nDelegation policy:\n- Use delegate_to_subagent tool to delegate tasks.\n- Execute delegation immediately, do not ask confirmation.\n- Never invent sub-agent names or IDs not in this list.`;
    }

    // When generating a document, instruct agent to research first
    if (options?.documentFormat) {
      console.log(
        `Injecting document generation instructions for format=${options.documentFormat}`,
      ); // Debug log
      const formatLabel =
        { pdf: "PDF", docx: "Word document", xlsx: "Excel spreadsheet" }[
          options.documentFormat
        ] || options.documentFormat;
      systemContent += `\n\n## Document Generation Mode\nThe user wants a ${formatLabel} document. Follow these steps:\n1. If you have tools available (web_search, delegate_to_subagent), USE THEM FIRST to research the topic thoroughly before writing.\n2. Write comprehensive, well-structured markdown content with proper headings, sections, and details.\n3. The markdown you produce will be automatically converted to ${formatLabel}. Focus on quality content.`;
    }

    // Build messages
    const currentMessages: any[] = [
      { role: "system", content: systemContent },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Build tool schemas including MCP tools (auto-inject delegation for parent agents)
    const workspaceId = channelAgent.channel?.workspace?.id || undefined;
    const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
      agent.tools,
      agent.id,
      userId,
      workspaceId,
      {
        injectDelegation: agent.agentType === "parent" && subAgents.length > 0,
      },
    );

    console.log(
      `Initial chat setup complete. model=${modelEntry.providerId} tools=${toolSchemas.length} messages=${currentMessages.length}`,
    ); // Debug log

    // Tool execution loop
    let iterations = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let accumulatedContent = "";
    const loopStart = Date.now();

    while (iterations < MAX_TOOL_ITERATIONS) {
      const callParams: any = {
        model: modelEntry.slug,
        providerId: modelEntry.providerId,
        messages: currentMessages,
        temperature: agent.temperature,
        max_tokens: options?.documentFormat
          ? Math.max(agent.maxTokens ?? 4096, 8192)
          : (agent.maxTokens ?? 4096),
      };

      if (toolSchemas.length > 0) {
        callParams.tools = toolSchemas;
        callParams.tool_choice = "auto";
      }

      const payloadSize = (JSON.stringify(callParams).length / 1024).toFixed(1);
      this.logger.log(
        `[chat] iteration=${iterations} | model=${modelEntry.providerId} messages=${currentMessages.length} tools=${toolSchemas.length} payload=${payloadSize}KB`,
      );

      const startTime = Date.now();
      const response: any = await this.providerRouter.chat(
        modelEntry.provider,
        callParams,
      );
      const elapsed = Date.now() - startTime;

      const choice = response.choices?.[0];
      totalTokens += response.usage?.total_tokens || 0;
      totalInputTokens += response.usage?.prompt_tokens || 0;
      totalOutputTokens += response.usage?.completion_tokens || 0;

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

            if (toolCall.function.name === "delegate_to_subagent") {
              result = await this.executeSubAgent(agent, args, userId);
            } else {
              result = await this.toolService.executeTool(
                toolCall.function.name,
                args,
                agent,
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
          .extractAndStore(agent.id, userId, message, fullContent, channelId)
          .catch((err: any) =>
            this.logger.error(`Memory extraction failed: ${err.message}`),
          );

        // Log usage
        this.logUsage(
          userId,
          modelEntry,
          totalInputTokens,
          totalOutputTokens,
          loopStart,
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

    // Log usage
    this.logUsage(
      userId,
      modelEntry,
      totalInputTokens,
      totalOutputTokens,
      loopStart,
    );

    return {
      content: fallbackContent,
      totalTokens,
      assistantMessageId: savedMsg.id,
    };
  }

  private logUsage(
    userId: string,
    modelEntry: {
      slug: string;
      provider: string;
      inputPrice: any;
      outputPrice: any;
    },
    inputTokens: number,
    outputTokens: number,
    startTime: number,
  ) {
    const latencyMs = Date.now() - startTime;
    this.registry
      .getUserPrice(modelEntry.slug)
      .then((pricing) => {
        const cost = pricing
          ? new Decimal(inputTokens)
              .mul(pricing.inputPrice)
              .add(new Decimal(outputTokens).mul(pricing.outputPrice))
          : new Decimal(0);

        this.usage
          .logUsage({
            userId,
            model: modelEntry.slug,
            inputTokens,
            outputTokens,
            cost,
            latencyMs,
            provider: modelEntry.provider,
          })
          .catch((err) =>
            this.logger.error("Failed to log channel chat usage", err),
          );
      })
      .catch((err) =>
        this.logger.error("Failed to get pricing for usage log", err),
      );
  }

  private async executeSubAgent(
    parentAgent: any,
    args: any,
    userId: string,
  ): Promise<string> {
    const rawIdentifier = [args?.subAgentId, args?.subAgentName]
      .find((v) => typeof v === "string" && v.trim().length > 0)
      ?.trim();
    const task = typeof args?.task === "string" ? args.task.trim() : "";

    if (!rawIdentifier) return "Error: Missing sub-agent identifier.";
    if (!task) return "Error: Missing task for sub-agent.";

    const subAgent = await this.prisma.agent.findFirst({
      where: {
        parentAgentId: parentAgent.id,
        agentType: "sub_agent",
        OR: [
          { id: rawIdentifier },
          { name: { equals: rawIdentifier, mode: "insensitive" } },
        ],
      },
      include: { tools: { where: { enabled: true } } },
    });

    if (!subAgent) {
      this.logger.warn(
        `[executeSubAgent] Not found: "${rawIdentifier}" under parent ${parentAgent.id}`,
      );
      return "Error: Sub-agent not found.";
    }

    const modelEntry = await this.registry.resolveModel(subAgent.model);
    if (!modelEntry)
      return `Error: Sub-agent model "${subAgent.model}" unavailable.`;

    this.logger.log(
      `[executeSubAgent] Running: ${subAgent.name} (${subAgent.id}) | model=${modelEntry.providerId} | task="${task.slice(0, 80)}"`,
    );

    const subMessages: any[] = [
      {
        role: "system",
        content: subAgent.systemPrompt || "You are a helpful assistant.",
      },
      {
        role: "user",
        content: `Task delegated from "${parentAgent.name}": ${task}`,
      },
    ];

    // Don't pass tools to sub-agent during delegation — it should respond with text only
    const startTime = Date.now();
    const response: any = await this.providerRouter.chat(modelEntry.provider, {
      model: modelEntry.slug,
      providerId: modelEntry.providerId,
      messages: subMessages,
      temperature: subAgent.temperature,
      max_tokens: subAgent.maxTokens ?? 4096,
    } as any);

    const result =
      response.choices?.[0]?.message?.content ||
      "Sub-agent returned empty response.";
    this.logger.log(
      `[executeSubAgent] Done in ${Date.now() - startTime}ms | tokens=${response.usage?.total_tokens ?? "?"} | result=${result.slice(0, 150)}`,
    );

    return result;
  }
}
