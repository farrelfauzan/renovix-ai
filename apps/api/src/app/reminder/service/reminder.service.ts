import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ReminderStatus } from "@generated/prisma/client.js";
import { CronExpressionParser } from "cron-parser";

@Injectable()
export class ReminderService {
  constructor(private readonly prisma: PrismaService) {}

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
    // Validate cron expression
    const timezone = data.timezone || "UTC";
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
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, userId },
    });
    if (!channel) {
      throw new NotFoundException("Channel not found");
    }

    const channelAgent = await this.prisma.channelAgent.findFirst({
      where: { channelId: data.channelId, agentId: data.agentId },
    });
    if (!channelAgent) {
      throw new BadRequestException("Agent is not assigned to this channel");
    }

    // Verify chat room belongs to channel
    const chatRoom = await this.prisma.channelChatRoom.findFirst({
      where: { id: data.chatRoomId, channelId: data.channelId },
    });
    if (!chatRoom) {
      throw new NotFoundException("Chat room not found in this channel");
    }

    return this.prisma.reminder.create({
      data: {
        userId,
        agentId: data.agentId,
        channelId: data.channelId,
        chatRoomId: data.chatRoomId,
        prompt: data.prompt,
        description: data.description,
        cronExpression: data.cronExpression,
        timezone,
        nextRunAt,
      },
    });
  }

  async list(userId: string) {
    return this.prisma.reminder.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        agent: {
          select: { id: true, name: true, avatar: true, avatarColor: true },
        },
        channel: { select: { id: true, name: true } },
      },
    });
  }

  async findById(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        agent: {
          select: { id: true, name: true, avatar: true, avatarColor: true },
        },
        channel: { select: { id: true, name: true } },
      },
    });
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
      status?: ReminderStatus;
    },
  ) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!reminder) throw new NotFoundException("Reminder not found");

    const updateData: any = {};

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
    if (data.status === ReminderStatus.ACTIVE) {
      updateData.consecutiveFailures = 0;
      updateData.lastError = null;
    }

    return this.prisma.reminder.update({
      where: { id },
      data: updateData,
    });
  }

  async softDelete(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!reminder) throw new NotFoundException("Reminder not found");

    return this.prisma.reminder.update({
      where: { id },
      data: { deletedAt: new Date(), status: ReminderStatus.PAUSED },
    });
  }

  async getDueReminders(limit = 20) {
    return this.prisma.reminder.findMany({
      where: {
        status: ReminderStatus.ACTIVE,
        deletedAt: null,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { nextRunAt: "asc" },
      take: limit,
      include: {
        agent: {
          include: {
            tools: { where: { enabled: true } },
          },
        },
        channel: true,
      },
    });
  }

  async markExecuted(id: string, cronExpression: string, timezone: string) {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
    });
    const nextRunAt = interval.next().toDate();

    return this.prisma.reminder.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        consecutiveFailures: 0,
        lastError: null,
      },
    });
  }

  /**
   * RNX-119: a fire the run policy refused (the agent is no longer runnable by the reminder's owner, or the owner has
   * no active subscription) is skipped: only the next fire time is set. It is not a run and not a failure.
   */
  async markSkipped(id: string, cronExpression: string, timezone: string) {
    const nextRunAt = CronExpressionParser.parse(cronExpression, { tz: timezone }).next().toDate();
    return this.prisma.reminder.update({ where: { id }, data: { nextRunAt } });
  }

  async markFailed(id: string, error: string, consecutiveFailures: number) {
    const maxRetries = 3;
    const update: any = {
      consecutiveFailures,
      lastError: error,
    };

    if (consecutiveFailures >= maxRetries) {
      update.status = ReminderStatus.FAILED;
    }

    return this.prisma.reminder.update({
      where: { id },
      data: update,
    });
  }
}
