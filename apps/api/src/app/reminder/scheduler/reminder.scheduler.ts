import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { ReminderService } from "../service/reminder.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import type { AgentRunBudget } from "../../agent/types/agent-run-budget";
import type { ReminderToolLoop } from "../types/reminder-tool-loop";
import { createMcpRunSession } from "../../agent/utils/create-mcp-run-session";
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
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    private readonly meter: AgentRunMeterService,
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
    const connection = await this.registry.resolveConnection(modelEntry.slug);

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

    // Build tool schemas. RNX-217: the MCP connections are this run's own (mcpSession), closed on every path.
    const mcpSession = createMcpRunSession();
    try {
      const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
        agent.tools,
        agent.id,
        reminder.userId,
        agent.workspaceId || undefined,
        { mcpSession },
      );

      // One run on the ledger (RX-22b), paid by the reminder's owner: a new runId, one reservation, a usage entry per
      // model call and a budget stop before each call (docs/credits.md section 13).
      const metered = await this.meter.meterRun(
        {
          runnerUserId: reminder.userId,
          firstCall: {
            model: modelEntry.slug,
            connection,
            messages,
            tools: toolSchemas,
            max_tokens: agent.maxTokens ?? 4096,
          },
          linkedAgents: [],
        },
        (meteredRun) =>
          this.runReminderLoop(
            { reminder, chatRoom, modelEntry, connection, messages, toolSchemas, mcpSession },
            meteredRun,
          ),
      );
      if (metered.status === "completed") return;
      await this.prisma.channelMessage.create({
        data: {
          chatRoomId: chatRoom.id,
          agentId: agent.id,
          role: "assistant",
          content: budgetStopMessage(metered.held),
          metadata: {
            source: "reminder",
            reminderId: reminder.id,
            scheduledAt: reminder.nextRunAt.toISOString(),
            error: "budget_stopped",
          },
        },
      });
    } finally {
      await this.toolService.cleanupMcpConnections(mcpSession);
    }
  }

  /** The tool loop of one reminder run, every model call metered on the run (RX-22b). */
  private async runReminderLoop(
    loop: ReminderToolLoop,
    meteredRun: AgentRunBudget,
  ): Promise<void> {
    const { reminder, chatRoom, modelEntry, connection, messages, toolSchemas, mcpSession } = loop;
    const agent = reminder.agent;

    // Execute LLM call with tool loop
    let iterations = 0;
    let totalTokens = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      const callParams: any = {
        model: modelEntry.slug,
        connection,
        messages,
        temperature: agent.temperature,
        max_tokens: agent.maxTokens ?? 4096,
      };

      if (toolSchemas.length > 0) {
        callParams.tools = toolSchemas;
        callParams.tool_choice = "auto";
      }

      const metered = await this.meter.callModel(meteredRun, {
        agentId: agent.id,
        parentCallId: null,
        request: callParams,
      });
      const response: any = metered.response;

      const choice = response.choices?.[0];
      totalTokens += response.usage?.total_tokens || 0;

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
              mcpSession,
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
}
