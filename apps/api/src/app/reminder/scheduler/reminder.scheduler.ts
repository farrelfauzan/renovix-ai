import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { ReminderService } from "../service/reminder.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProviderRouter } from "../../providers/provider-router";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { UsageService } from "../../usage/service/usage.service";
import { Decimal } from "@prisma/client/runtime/client";
import { Prisma } from "@generated/prisma/client.js";

const MAX_TOOL_ITERATIONS = 15;

@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderService: ReminderService,
    private readonly registry: ModelRegistryService,
    private readonly providerRouter: ProviderRouter,
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    private readonly usage: UsageService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processReminders() {
    if (this.processing) return;
    this.processing = true;

    try {
      const dueReminders = await this.reminderService.getDueReminders();

      if (dueReminders.length > 0) {
        this.logger.log(
          `[processReminders] Found ${dueReminders.length} due reminders`,
        );
      }

      for (const reminder of dueReminders) {
        try {
          await this.executeReminder(reminder);
          await this.reminderService.markExecuted(
            reminder.id,
            reminder.cronExpression,
            reminder.timezone,
          );
          this.logger.log(
            `[processReminders] Executed reminder ${reminder.id} (${reminder.description || reminder.prompt.slice(0, 50)})`,
          );
        } catch (err: any) {
          const failures = reminder.consecutiveFailures + 1;
          await this.reminderService.markFailed(
            reminder.id,
            err.message,
            failures,
          );
          this.logger.error(
            `[processReminders] Reminder ${reminder.id} failed (attempt ${failures}): ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      if (this.isMissingRemindersTableError(err)) {
        this.logger.warn(
          "[processReminders] Reminders table not found. Skipping scheduler until reminder migration is applied.",
        );
        return;
      }
      this.logger.error(
        `[processReminders] Scheduler error: ${err.message}`,
        err.stack,
      );
    } finally {
      this.processing = false;
    }
  }

  private isMissingRemindersTableError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== "P2021") {
      return false;
    }

    const table = String(error.meta?.table ?? "").toLowerCase();
    return table.includes("reminders");
  }

  private async executeReminder(reminder: any) {
    const agent = reminder.agent;

    // Resolve model
    const modelEntry = await this.registry.resolveModel(agent.model);
    if (!modelEntry) {
      throw new Error(`Model "${agent.model}" is not available`);
    }

    // Get the chat room
    const chatRoom = await this.prisma.channelChatRoom.findFirst({
      where: { id: reminder.chatRoomId },
    });
    if (!chatRoom) {
      throw new Error(`Chat room ${reminder.chatRoomId} not found`);
    }

    // Get recent history for context
    const history = await this.prisma.channelMessage.findMany({
      where: {
        chatRoomId: chatRoom.id,
        agentId: agent.id,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    history.reverse();

    // Build system prompt
    let systemContent = agent.systemPrompt || "You are a helpful assistant.";

    // Inject workspace memories
    const memoryContext = await this.memoryService.getWorkspaceMemoryContext(
      agent.id,
    );
    if (memoryContext) {
      systemContent += `\n\n## Workspace Memory\nHere are important facts you should remember:\n${memoryContext}`;
    }

    systemContent += `\n\n## Context\nThis is a scheduled reminder execution. The user set up this reminder to receive this information automatically. Provide the requested information directly without asking for clarification.`;

    // Build messages
    const messages: any[] = [
      { role: "system", content: systemContent },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: reminder.prompt },
    ];

    // Build tool schemas
    const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
      agent.tools,
      agent.id,
      reminder.userId,
      agent.workspaceId || undefined,
    );

    // Execute LLM call with tool loop
    let iterations = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const loopStart = Date.now();

    while (iterations < MAX_TOOL_ITERATIONS) {
      const callParams: any = {
        model: modelEntry.slug,
        providerId: modelEntry.providerId,
        messages,
        temperature: agent.temperature,
        max_tokens: agent.maxTokens ?? 4096,
      };

      if (toolSchemas.length > 0) {
        callParams.tools = toolSchemas;
        callParams.tool_choice = "auto";
      }

      const response: any = await this.providerRouter.chat(
        modelEntry.provider,
        callParams,
      );

      const choice = response.choices?.[0];
      totalTokens += response.usage?.total_tokens || 0;
      totalInputTokens += response.usage?.prompt_tokens || 0;
      totalOutputTokens += response.usage?.completion_tokens || 0;

      if (!choice) break;

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        messages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await this.toolService.executeTool(
              toolCall.function.name,
              args,
              agent,
              reminder.userId,
              reminder.channelId,
            );

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content:
                result.length > 4000
                  ? result.slice(0, 4000) + "\n...[truncated]"
                  : result,
            });
          } catch (err: any) {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Error: ${err.message}`,
            });
          }
        }

        iterations++;
        continue;
      }

      // Final response
      const content = choice.message?.content || "";

      if (content) {
        // Save user message (the reminder prompt) as context
        await this.prisma.channelMessage.create({
          data: {
            chatRoomId: chatRoom.id,
            agentId: agent.id,
            role: "user",
            content: reminder.prompt,
            metadata: {
              source: "reminder",
              reminderId: reminder.id,
              scheduledAt: reminder.nextRunAt.toISOString(),
            },
          },
        });

        // Save assistant response
        await this.prisma.channelMessage.create({
          data: {
            chatRoomId: chatRoom.id,
            agentId: agent.id,
            role: "assistant",
            content,
            tokens: totalTokens,
            metadata: {
              source: "reminder",
              reminderId: reminder.id,
              scheduledAt: reminder.nextRunAt.toISOString(),
            },
          },
        });

        // Log usage
        this.logUsage(
          reminder.userId,
          modelEntry,
          totalInputTokens,
          totalOutputTokens,
          loopStart,
        );
      }

      return;
    }

    // If we hit max iterations, save a fallback
    await this.prisma.channelMessage.create({
      data: {
        chatRoomId: chatRoom.id,
        agentId: agent.id,
        role: "assistant",
        content:
          "I was unable to fully complete this scheduled task. Please try again or adjust the reminder.",
        metadata: {
          source: "reminder",
          reminderId: reminder.id,
          scheduledAt: reminder.nextRunAt.toISOString(),
          error: "max_iterations",
        },
      },
    });
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
            this.logger.error("Failed to log reminder usage", err),
          );
      })
      .catch((err) =>
        this.logger.error("Failed to get pricing for reminder usage log", err),
      );
  }
}
