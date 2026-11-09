import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { LIVE_AGENT } from "../../agent/config/live-agent";
import { LIVE_CHANNEL } from "../../channel/config/live-channel";
import { RemindersTableMissingException } from "../errors/reminders-table-missing.exception";

/** The agent and channel a reminder is returned with in the list and the read. */
const REMINDER_RELATIONS = {
  agent: {
    select: { id: true, name: true, avatar: true, avatarColor: true },
  },
  channel: { select: { id: true, name: true } },
} satisfies Prisma.ReminderInclude;

/**
 * The queries on `reminders` (RX-133, RNX-139). Every method takes the transaction as its optional last argument.
 * `updateReminder` takes no user: the service checks the owner with `findUserReminder` first, as before.
 */
@Injectable()
export class ReminderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a reminder of this user. */
  createReminder(
    userId: string,
    data: Omit<Prisma.ReminderUncheckedCreateInput, "userId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).reminder.create({
      data: { userId, ...data },
    });
  }

  /**
   * This user's reminders that are not deleted, of a live agent (RNX-124) and a live channel (RNX-145), newest first,
   * each with its agent and channel.
   */
  listUserReminders(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).reminder.findMany({
      where: { userId, deletedAt: null, agent: LIVE_AGENT, channel: LIVE_CHANNEL },
      orderBy: { createdAt: "desc" },
      include: REMINDER_RELATIONS,
    });
  }

  /**
   * The reminder with this id if it is this user's, not deleted and of a live agent (RNX-124) and a live channel
   * (RNX-145), with its agent and channel.
   */
  findUserReminderWithRelations(userId: string, reminderId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).reminder.findFirst({
      where: { id: reminderId, userId, deletedAt: null, agent: LIVE_AGENT, channel: LIVE_CHANNEL },
      include: REMINDER_RELATIONS,
    });
  }

  /** The reminder with this id if it is this user's, not deleted and of a live agent (RNX-124) and a live channel (RNX-145). */
  findUserReminder(userId: string, reminderId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).reminder.findFirst({
      where: { id: reminderId, userId, deletedAt: null, agent: LIVE_AGENT, channel: LIVE_CHANNEL },
    });
  }

  /** Updates the reminder with this id. */
  updateReminder(reminderId: string, data: Prisma.ReminderUncheckedUpdateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).reminder.update({
      where: { id: reminderId },
      data,
    });
  }

  /**
   * The active, not deleted reminders of a live agent (RNX-124) and a live channel (RNX-145) whose next fire time has
   * come, earliest first, at most `limit`, each with its agent (and the agent's enabled tools) and its channel. The
   * missing table (Prisma P2021) becomes `RemindersTableMissingException`.
   */
  async findDueReminders(limit: number, tx?: DbTransaction) {
    try {
      return await (tx ?? this.prisma).reminder.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          agent: LIVE_AGENT,
          channel: LIVE_CHANNEL,
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
    } catch (err) {
      if (this.isMissingRemindersTable(err)) throw new RemindersTableMissingException();
      throw err;
    }
  }

  private isMissingRemindersTable(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (err.code !== "P2021") return false;
    return String(err.meta?.table ?? "").toLowerCase().includes("reminders");
  }
}
