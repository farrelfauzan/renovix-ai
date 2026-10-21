import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { ChannelAgentRepository } from "../repository/channel-agent.repository";
import { ChannelChatRoomRepository } from "../repository/channel-chat-room.repository";
import { ChannelMessageRepository } from "../repository/channel-message.repository";
import { ChannelRepository } from "../repository/channel.repository";
import { extractDocumentFromMetadata } from "../utils/extract-document-from-metadata";

@Injectable()
export class ChannelService {
  constructor(
    private readonly channels: ChannelRepository,
    private readonly channelAgents: ChannelAgentRepository,
    private readonly channelMessages: ChannelMessageRepository,
    private readonly chatRooms: ChannelChatRoomRepository,
    private readonly agents: AgentRepository,
    private readonly policy: AgentRunPolicyService,
  ) {}

  async create(
    userId: string,
    data: { name: string; icon?: string; color?: string },
  ) {
    return this.channels.createChannel(userId, data);
  }

  async list(userId: string) {
    return this.channels.listUserChannels(userId);
  }

  async findById(userId: string, channelId: string) {
    const channel = await this.channels.findUserChannelWithAgents(
      channelId,
      userId,
    );

    if (!channel) throw new NotFoundException("Channel not found");
    return channel;
  }

  async update(
    userId: string,
    channelId: string,
    data: { name?: string; icon?: string; color?: string },
  ) {
    const channel = await this.channels.findUserChannel(channelId, userId);
    if (!channel) throw new NotFoundException("Channel not found");

    return this.channels.updateChannel(channelId, data);
  }

  async delete(userId: string, channelId: string) {
    const channel = await this.channels.findUserChannelWorkspace(
      channelId,
      userId,
    );
    if (!channel) throw new NotFoundException("Channel not found");
    // A channel that has a workspace is not deleted (RX-144): this 409 is the first answer, and the database
    // refuses the delete as well (RNX-202: Workspace.channel onDelete: Restrict), which closes the gap between
    // this read and the delete below.
    if (channel.workspace) {
      throw new ConflictException(
        "This channel belongs to a workspace and cannot be deleted",
      );
    }

    await this.channels.deleteChannel(channelId);
    return { deleted: true };
  }

  // ─── Agent Management ───

  /** Adds an agent to the caller's channel: 404 unless the run policy lets the caller run it (RNX-119, also per run). */
  async addAgent(
    userId: string,
    channelId: string,
    agentId: string,
    role: string = "primary",
  ) {
    const channel = await this.channels.findUserChannel(channelId, userId);
    if (!channel) throw new NotFoundException("Channel not found");

    const agent = await this.agents.findAgentForRun(agentId);
    if (!agent) throw new NotFoundException("Agent not found");
    await this.policy.assertRunScope(agent, userId);

    return this.channelAgents.createChannelAgent(channelId, agentId, role);
  }

  async removeAgent(userId: string, channelId: string, agentId: string) {
    const channel = await this.channels.findUserChannel(channelId, userId);
    if (!channel) throw new NotFoundException("Channel not found");

    const link = await this.channelAgents.findChannelAgent(channelId, agentId);
    if (!link) throw new NotFoundException("Agent not linked to this channel");

    // Clear chat history for this agent in this channel before unlinking.
    await this.channelMessages.deleteChannelAgentMessages(channelId, agentId);

    await this.channelAgents.deleteChannelAgent(link.id);
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

    const rows = await this.channelMessages.listRoomAgentMessages(
      chatRoom.id,
      channelAgent.agentId,
      limit,
      offset,
    );

    return rows.map((row) => {
      const document = extractDocumentFromMetadata(row.metadata);
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

    await this.channelMessages.updateAssistantMessage(
      messageId,
      chatRoom.id,
      channelAgent.agentId,
      {
        content,
        metadata: {
          document,
        },
      },
    );
  }

  async clearMessages(userId: string, channelId: string, agentId: string) {
    const channelAgent = await this.resolveChannelAgent(
      userId,
      channelId,
      agentId,
    );
    const chatRoom = await this.getOrCreateChatRoom(channelAgent.channelId);

    await this.channelMessages.deleteRoomAgentMessages(
      chatRoom.id,
      channelAgent.agentId,
    );
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
    const channelAgent =
      await this.channelAgents.findChannelAgentIds(channelAgentId);
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

    return this.channelMessages.createChannelMessage(createData);
  }

  async getOrCreateChatRoom(channelId: string) {
    const existing = await this.chatRooms.findChatRoomByName(
      channelId,
      "general",
    );

    if (existing) {
      return existing;
    }

    return this.chatRooms.createChatRoom(channelId, "general");
  }

  // ─── Helpers ───

  async resolveChannelAgent(
    userId: string,
    channelId: string,
    agentId: string,
  ) {
    const channel = await this.channels.findUserChannelWithWorkspace(
      channelId,
      userId,
    );
    if (!channel) throw new NotFoundException("Channel not found");

    const channelAgent = await this.channelAgents.findChannelAgentWithAgent(
      channelId,
      agentId,
    );
    if (!channelAgent) throw new NotFoundException("Agent not in this channel");

    return channelAgent;
  }
}
