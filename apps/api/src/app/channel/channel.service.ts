import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ChannelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    data: { name: string; icon?: string; color?: string },
  ) {
    return this.prisma.channel.create({
      data: {
        userId,
        name: data.name,
        icon: data.icon,
        color: data.color,
      },
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
              },
            },
          },
        },
      },
    });
  }

  async list(userId: string) {
    return this.prisma.channel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
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
              },
            },
          },
        },
        _count: { select: { agents: true } },
      },
    });
  }

  async findById(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({
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

    if (!channel) throw new NotFoundException("Channel not found");
    return channel;
  }

  async update(
    userId: string,
    channelId: string,
    data: { name?: string; icon?: string; color?: string },
  ) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    return this.prisma.channel.update({
      where: { id: channelId },
      data,
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
              },
            },
          },
        },
      },
    });
  }

  async delete(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    await this.prisma.channel.delete({ where: { id: channelId } });
    return { deleted: true };
  }

  // ─── Agent Management ───

  async addAgent(
    userId: string,
    channelId: string,
    agentId: string,
    role: string = "primary",
  ) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        OR: [{ userId }, { isPublic: true, status: "active" }],
      },
    });
    if (!agent) throw new NotFoundException("Agent not found");

    return this.prisma.channelAgent.create({
      data: { channelId, agentId, role },
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
    });
  }

  async removeAgent(userId: string, channelId: string, agentId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    const link = await this.prisma.channelAgent.findFirst({
      where: { channelId, agentId },
    });
    if (!link) throw new NotFoundException("Agent not linked to this channel");

    // Clear chat history for this agent in this channel before unlinking.
    await this.prisma.channelMessage.deleteMany({
      where: {
        agentId,
        chatRoom: { channelId },
      },
    });

    await this.prisma.channelAgent.delete({ where: { id: link.id } });
    return { deleted: true };
  }

  // ─── Messages (scoped per user per agent room) ───

  async getMessages(
    userId: string,
    channelId: string,
    agentId: string,
    limit = 50,
    offset = 0,
  ) {
    const channelAgent = await this.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const chatRoom = await this.getOrCreateChatRoom(channelAgent.channelId);

    const rows = await this.prisma.channelMessage.findMany({
      where: { chatRoomId: chatRoom.id, agentId: channelAgent.agentId },
      orderBy: { createdAt: "asc" },
      take: limit,
      skip: offset,
    });

    return rows.map((row) => {
      const document = this.extractDocumentFromMetadata(row.metadata);
      return document ? { ...row, document } : row;
    });
  }

  async attachDocumentToMessage(
    userId: string,
    channelId: string,
    agentId: string,
    messageId: string,
    content: string,
    document: {
      format: string;
      url: string;
      filename: string;
      expiresAt: string;
    },
  ) {
    const channelAgent = await this.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const chatRoom = await this.getOrCreateChatRoom(channelAgent.channelId);

    await this.prisma.channelMessage.updateMany({
      where: {
        id: messageId,
        role: "assistant",
        agentId: channelAgent.agentId,
        chatRoomId: chatRoom.id,
      },
      data: {
        content,
        metadata: {
          document,
        },
      },
    });
  }

  async clearMessages(userId: string, channelId: string, agentId: string) {
    const channelAgent = await this.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const chatRoom = await this.getOrCreateChatRoom(channelAgent.channelId);

    await this.prisma.channelMessage.deleteMany({
      where: { chatRoomId: chatRoom.id, agentId: channelAgent.agentId },
    });
    return { cleared: true };
  }

  async saveMessage(
    channelAgentId: string,
    _userId: string,
    data: {
      role: string;
      content: string;
      tokens?: number;
      cost?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const channelAgent = await this.prisma.channelAgent.findUnique({
      where: { id: channelAgentId },
      select: { channelId: true, agentId: true },
    });
    if (!channelAgent) {
      throw new NotFoundException("Channel agent not found");
    }

    const chatRoom = await this.getOrCreateChatRoom(channelAgent.channelId);
    const createData: any = {
      chatRoomId: chatRoom.id,
      agentId: channelAgent.agentId,
      role: data.role,
      content: data.content,
      tokens: data.tokens,
      cost: data.cost,
    };
    if (data.metadata) {
      createData.metadata = data.metadata;
    }

    return this.prisma.channelMessage.create({
      data: createData,
    });
  }

  async getOrCreateChatRoom(channelId: string) {
    const existing = await this.prisma.channelChatRoom.findFirst({
      where: {
        channelId,
        name: "general",
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.channelChatRoom.create({
      data: {
        channelId,
        name: "general",
      },
    });
  }

  // ─── Helpers ───

  async resolveChannelAgent(
    userId: string,
    channelId: string,
    agentId: string,
  ) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      include: { workspace: true },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    const channelAgent = await this.prisma.channelAgent.findFirst({
      where: { channelId, agentId },
      include: {
        channel: { include: { workspace: true } },
        agent: {
          include: {
            tools: { where: { enabled: true } },
            knowledgeBases: true,
            integrations: { where: { status: "connected" } },
          },
        },
      },
    });
    if (!channelAgent) throw new NotFoundException("Agent not in this channel");

    return channelAgent;
  }

  private extractDocumentFromMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }

    const doc = (metadata as Record<string, unknown>).document;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return null;
    }

    const document = doc as Record<string, unknown>;
    const format = typeof document.format === "string" ? document.format : null;
    const url = typeof document.url === "string" ? document.url : null;
    const filename =
      typeof document.filename === "string" ? document.filename : null;
    const expiresAt =
      typeof document.expiresAt === "string" ? document.expiresAt : null;

    if (!format || !url || !filename || !expiresAt) {
      return null;
    }

    return { format, url, filename, expiresAt };
  }
}
