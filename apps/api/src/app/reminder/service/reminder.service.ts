import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import { CronExpressionParser } from "cron-parser";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { UserRepository } from "../../auth/repository/user.repository";
import { ChannelRepository } from "../../channel/repository/channel.repository";
import { ChannelAgentRepository } from "../../channel/repository/channel-agent.repository";
import { ChannelChatRoomRepository } from "../../channel/repository/channel-chat-room.repository";
import { ReminderRepository } from "../repository/reminder.repository";

@Injectable()
export class ReminderService {
  constructor(
    private readonly reminders: ReminderRepository,
    private readonly channels: ChannelRepository,
    private readonly channelAgents: ChannelAgentRepository,
    private readonly chatRooms: ChannelChatRoomRepository,
    private readonly agents: AgentRepository,
    private readonly policy: AgentRunPolicyService,
    private readonly users: UserRepository,
  ) {}

  async create(
    userId: string,
    data: {
      agentId: string;
      channelId: string;
      chatRoomId: string;
      prompt: string;
      description?: string;
      cronExpression: string;
      timezone?: string;
    },
  ) {
    // RNX-33: without a timezone, the user's saved one (the profile step); "UTC" when the user has none saved
    const timezone = data.timezone || (await this.users.findTimezone(userId))?.timezone || "UTC";
    // Validate cron expression
    let nextRunAt: Date;
    try {
      const interval = CronExpressionParser.parse(data.cronExpression, {
        tz: timezone,
      });
      nextRunAt = interval.next().toDate();
    } catch (err: any) {
      throw new BadRequestException(`Invalid cron expression: ${err.message}`);
    }

    // Verify the user owns the channel and agent is in the channel
    const channel = await this.channels.findUserChannel(data.channelId, userId);
    if (!channel) {
      throw new NotFoundException("Channel not found");
    }

    const channelAgent = await this.channelAgents.findChannelAgent(data.channelId, data.agentId);
    if (!channelAgent) {
      throw new BadRequestException("Agent is not assigned to this channel");
    }

    // RNX-260 (D259, 76): only an agent the caller may run now (the run policy; 404 otherwise), as when it was added
    const agent = await this.agents.findAgentForRun(data.agentId);
    if (!agent) throw new NotFoundException("Agent not found");
    await this.policy.assertRunScope(agent, userId);

    // Verify chat room belongs to channel
    const chatRoom = await this.chatRooms.findChannelChatRoom(data.channelId, data.chatRoomId);
    if (!chatRoom) {
      throw new NotFoundException("Chat room not found in this channel");
    }

    return this.reminders.createReminder(userId, {
      agentId: data.agentId,
      channelId: data.channelId,
      chatRoomId: data.chatRoomId,
      prompt: data.prompt,
      description: data.description,
      cronExpression: data.cronExpression,
      timezone,
      nextRunAt,
    });
  }

  async list(userId: string) {
    return this.reminders.listUserReminders(userId);
  }

  async findById(userId: string, id: string) {
    const reminder = await this.reminders.findUserReminderWithRelations(userId, id);
    if (!reminder) throw new NotFoundException("Reminder not found");
    return reminder;
  }

  async update(
    userId: string,
    id: string,
    data: {
      prompt?: string;
      description?: string;
      cronExpression?: string;
      timezone?: string;
      status?: "ACTIVE" | "PAUSED";
    },
  ) {
    const reminder = await this.reminders.findUserReminder(userId, id);
    if (!reminder) throw new NotFoundException("Reminder not found");

    const updateData: Prisma.ReminderUncheckedUpdateInput = {};

    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;

    // If cron or timezone changed, recompute nextRunAt
    if (data.cronExpression || data.timezone) {
      const cronExpression = data.cronExpression || reminder.cronExpression;
      const timezone = data.timezone || reminder.timezone;

      try {
        const interval = CronExpressionParser.parse(cronExpression, {
          tz: timezone,
        });
        updateData.nextRunAt = interval.next().toDate();
        updateData.cronExpression = cronExpression;
        updateData.timezone = timezone;
      } catch (err: any) {
        throw new BadRequestException(
          `Invalid cron expression: ${err.message}`,
        );
      }
    }

    // If resuming, reset consecutive failures
    if (data.status === "ACTIVE") {
      updateData.consecutiveFailures = 0;
      updateData.lastError = null;
    }

    return this.reminders.updateReminder(id, updateData);
  }

  async softDelete(userId: string, id: string) {
    const reminder = await this.reminders.findUserReminder(userId, id);
    if (!reminder) throw new NotFoundException("Reminder not found");

    return this.reminders.updateReminder(id, { deletedAt: new Date(), status: "PAUSED" });
  }

  async getDueReminders(limit = 20) {
    return this.reminders.findDueReminders(limit);
  }

  async markExecuted(id: string, cronExpression: string, timezone: string) {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
    });
    const nextRunAt = interval.next().toDate();

    return this.reminders.updateReminder(id, {
      lastRunAt: new Date(),
      nextRunAt,
      consecutiveFailures: 0,
      lastError: null,
    });
  }

  /**
   * RNX-119: a fire the run policy refused (the agent is no longer runnable by the reminder's owner, its workspace is
   * archived or deleted (RNX-260), or the owner has no active subscription) is skipped: only the next fire time is
   * set. It is not a run and not a failure.
   */
  async markSkipped(id: string, cronExpression: string, timezone: string) {
    const nextRunAt = CronExpressionParser.parse(cronExpression, { tz: timezone }).next().toDate();
    return this.reminders.updateReminder(id, { nextRunAt });
  }

  async markFailed(id: string, error: string, consecutiveFailures: number) {
    const maxRetries = 3;
    const update: Prisma.ReminderUncheckedUpdateInput = {
      consecutiveFailures,
      lastError: error,
    };

    if (consecutiveFailures >= maxRetries) {
      update.status = "FAILED";
    }

    return this.reminders.updateReminder(id, update);
  }
}
