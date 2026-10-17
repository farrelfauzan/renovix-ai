import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The agents a channel is returned with after a create and an update, and in the list. */
const CHANNEL_AGENTS = {
  agents: {
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
 * The writes by id (`updateChannel`, `deleteChannel`) take no user: the service checks the owner with
 * `findUserChannel` or `findUserChannelWorkspace` first.
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

  /** This user's channels, newest first, each with its agents and agent count. */
  listUserChannels(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        ...CHANNEL_AGENTS,
        _count: { select: { agents: true } },
      },
    });
  }

  /** The channel with this id if it belongs to this user. */
  findUserChannel(channelId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
    });
  }

  /** This user's channel with its agents (with their model and description). */
  findUserChannelWithAgents(
    channelId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.findFirst({
      where: { id: channelId, userId },
      include: {
        agents: {
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

  /** Updates the channel with this id and returns it with its agents. */
  updateChannel(
    channelId: string,
    data: Prisma.ChannelUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channel.update({
      where: { id: channelId },
      data,
      include: CHANNEL_AGENTS,
    });
  }

  /** Deletes the channel with this id. */
  deleteChannel(channelId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channel.delete({ where: { id: channelId } });
  }
}
