import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The relations an agent is returned with after a create, an update and a template clone. */
const AGENT_RELATIONS = {
  tools: true,
  integrations: true,
  knowledgeBases: true,
  channels: true,
  _count: { select: { runs: true } },
} satisfies Prisma.AgentInclude;

/**
 * The queries on `agents` (RX-133). Every method takes the transaction as its optional last argument.
 * The writes by id (`updateAgent`, `updateAgentStatus`, `deleteAgent`) take no user: the service checks
 * the owner with `findUserAgent` first.
 */
@Injectable()
export class AgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's agent with this slug, if there is one. */
  findAgentBySlug(userId: string, slug: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findUnique({
      where: { userId_slug: { userId, slug } },
    });
  }

  /** The agent with this id if it belongs to this user. */
  findUserAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: agentId, userId },
    });
  }

  /** The id and type of the agent with this id if it belongs to this user. */
  findUserAgentType(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: agentId, userId },
      select: { id: true, agentType: true },
    });
  }

  /** This user's agent with every relation, its knowledge bases and its sub-agents (with their tools and run count). */
  findAgentDetail(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: agentId, userId },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: { include: { knowledgeBase: true } },
        channels: true,
        subAgents: {
          include: {
            tools: true,
            _count: { select: { runs: true } },
          },
        },
        _count: { select: { runs: true } },
      },
    });
  }

  /**
   * The agent with this id that this user may run (their own, or any public active one), with its enabled tools,
   * its knowledge bases, its connected integrations and its active sub-agents (RX-134), with each sub-agent's system
   * prompt and max_tokens for the run's pre-run estimate (RX-22b).
   */
  findRunnableAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: {
        id: agentId,
        OR: [{ userId }, { isPublic: true, status: "active" }],
      },
      include: {
        tools: { where: { enabled: true } },
        knowledgeBases: true,
        integrations: { where: { status: "connected" } },
        subAgents: {
          where: { status: "active" },
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            model: true,
            userId: true,
            systemPrompt: true,
            maxTokens: true,
          },
        },
      },
    });
  }

  /**
   * This user's sub-agent under this parent agent, named by its id or by its name (any case), with its enabled
   * tools, its knowledge bases and its connected integrations (RX-134).
   */
  findDelegateSubAgent(
    parentAgentId: string,
    userId: string,
    identifier: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agent.findFirst({
      where: {
        parentAgentId,
        userId,
        agentType: "sub_agent",
        OR: [
          { id: identifier },
          { name: { equals: identifier, mode: "insensitive" } },
        ],
      },
      include: {
        tools: { where: { enabled: true } },
        knowledgeBases: true,
        integrations: { where: { status: "connected" } },
      },
    });
  }

  /** The agent with this id if this user may add it to a channel: their own, or any public active one (RX-136). */
  findUsableAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: {
        id: agentId,
        OR: [{ userId }, { isPublic: true, status: "active" }],
      },
    });
  }

  /** The agent with this id and its relations. */
  findAgentWithRelations(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findUnique({
      where: { id: agentId },
      include: AGENT_RELATIONS,
    });
  }

  /** This user's agents that have no parent, newest change first, each with its relations and sub-agents. */
  listTopLevelAgents(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findMany({
      where: { userId, parentAgentId: null },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        subAgents: {
          select: { id: true, name: true, status: true, userId: true },
        },
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /** The 50 newest public active agents, with the owner's email. */
  listPublicAgents(tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findMany({
      where: { isPublic: true, status: "active" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        avatar: true,
        agentType: true,
        model: true,
        _count: { select: { runs: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /** The public active agent with this id, with its tools. */
  findPublicTemplate(templateId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: templateId, isPublic: true, status: "active" },
      include: { tools: true },
    });
  }

  /** How many agents this user has. */
  countAgentsByUser(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.count({ where: { userId } });
  }

  /** Creates an agent of this user and returns it with its relations. */
  createAgent(
    userId: string,
    data: Omit<Prisma.AgentUncheckedCreateInput, "userId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agent.create({
      data: { userId, ...data },
      include: AGENT_RELATIONS,
    });
  }

  /** Updates the agent with this id and returns it with its relations. */
  updateAgent(
    agentId: string,
    data: Prisma.AgentUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agent.update({
      where: { id: agentId },
      data,
      include: AGENT_RELATIONS,
    });
  }

  /** Sets the status of the agent with this id and returns the agent. */
  updateAgentStatus(agentId: string, status: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.update({
      where: { id: agentId },
      data: { status },
    });
  }

  /** Deletes the agent with this id. */
  deleteAgent(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.delete({ where: { id: agentId } });
  }

  /** The workspace id of the agent with this id (null for an agent outside a workspace), if the agent exists. */
  findAgentWorkspaceId(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });
  }
}
