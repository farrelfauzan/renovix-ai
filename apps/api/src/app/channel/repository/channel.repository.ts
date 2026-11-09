import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { LIVE_AGENT } from "../../agent/config/live-agent";
import { LIVE_CHANNEL } from "../config/live-channel";

/** The live agents (RNX-124) a channel is returned with after a create and an update, and in the list. */
const CHANNEL_AGENTS = {
  agents: {
    where: { agent: LIVE_AGENT },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          avatar: true,
          avatarColor: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.ChannelInclude;

/**
 * The queries on `channels` (RX-136). Every method takes the transaction as its optional last argument.
 * The writes by id (`updateChannel`, `softDeleteChannel`) take no user: the service checks the owner with
 * `findUserChannel` or `findUserChannelWorkspace` first. RNX-145: PrismaService hides deleted channels from top-level
 * reads (VISIBLE_ONLY); the writes by id name `deletedAt: null` themselves.
 */
@Injectable()
export class ChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a channel of this user and returns it with its agents. */
  createChannel(
    userId: string,
    data: Pick<Prisma.ChannelUncheckedCreateInput, "name" | "icon" | "color">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.create({
      data: {
        userId,
        name: data.name,
        icon: data.icon,
        color: data.color,
      },
      include: CHANNEL_AGENTS,
    });
  }

  /**
   * This user's live channels (RNX-145: not the channel of a deleted workspace), newest first, each with its live agents
   * and their count (RNX-124).
   */
  listUserChannels(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channel.findMany({
      where: { userId, ...LIVE_CHANNEL },
      orderBy: { createdAt: "desc" },
      include: {
        ...CHANNEL_AGENTS,
        _count: { select: { agents: { where: { agent: LIVE_AGENT } } } },
      },
    });
  }

  /** The channel with this id if it belongs to this user. */
  findUserChannel(channelId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
    });
  }

  /** This user's channel with its live agents (RNX-124), with their model and description. */
  findUserChannelWithAgents(
    channelId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
      include: {
        agents: {
          where: { agent: LIVE_AGENT },
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                avatar: true,
                avatarColor: true,
                status: true,
                model: true,
                description: true,
              },
            },
          },
        },
      },
    });
  }

  /** The id of the workspace of this user's channel, if the channel is theirs (RX-144). */
  findUserChannelWorkspace(
    channelId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
      select: { workspace: { select: { id: true } } },
    });
  }

  /** This user's channel with its workspace. */
  findUserChannelWithWorkspace(
    channelId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
      include: { workspace: true },
    });
  }

  /** Updates the live channel with this id and returns it with its agents; 404 when it is deleted (RNX-145). */
  updateChannel(
    channelId: string,
    data: Prisma.ChannelUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).channel.update({
        where: { id: channelId, deletedAt: null },
        data,
        include: CHANNEL_AGENTS,
      }),
    );
  }

  /**
   * Soft-deletes the live channel with this id, by this user (RNX-145): the row, its rooms, messages, agent links and
   * reminders stay. A channel that has a workspace is never deleted (RX-144; the condition stands in for the foreign
   * key that refused a hard delete, RNX-202). Returns the channel; 404 when it is already deleted or has a workspace.
   */
  softDeleteChannel(channelId: string, deletedById: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).channel.update({
        where: { id: channelId, deletedAt: null, workspace: null },
        data: { deletedAt: new Date(), deletedById },
      }),
    );
  }

  /** Runs a write on one live channel; Prisma's "no such row" (P2025: deleted, or deleted meanwhile) becomes a 404. */
  private async refuseDeleted<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new NotFoundException("Channel not found");
      }
      throw err;
    }
  }
}
