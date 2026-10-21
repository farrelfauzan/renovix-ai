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
 * the owner with `findUserAgent` first. RNX-203: a user owns an agent when they own its workspace
 * (`agent.workspace.ownerId`); `agent.userId` is the creator, kept for information, the slug key and the quota.
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

  /** The agent with this id if this user owns its workspace (RNX-203). */
  findUserAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: agentId, workspace: { ownerId: userId } },
    });
  }

  /** The id and workspace (with its owner) of the agent with this id, if it exists (RNX-118: the link routes). */
  findAgentWorkspaceOwner(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findUnique({
      where: { id: agentId },
      select: { id: true, workspaceId: true, workspace: { select: { ownerId: true } } },
    });
  }

  /** The agent with this id in a workspace this user owns (RNX-203), with every relation and its knowledge bases. */
  findAgentDetail(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: { id: agentId, workspace: { ownerId: userId } },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: { include: { knowledgeBase: true } },
        channels: true,
        _count: { select: { runs: true } },
      },
    });
  }

  /**
   * The agent with this id that this user may run (one in a workspace they own, RNX-203, or any public active one),
   * with its enabled tools, its knowledge bases and its connected integrations (RX-134). RNX-118: the agents it may
   * call come from AgentLinkService.
   */
  findRunnableAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: {
        id: agentId,
        OR: [{ workspace: { ownerId: userId } }, { isPublic: true, status: "active" }],
      },
      include: {
        tools: { where: { enabled: true } },
        knowledgeBases: true,
        integrations: { where: { status: "connected" } },
      },
    });
  }

  /**
   * The agent with this id if this user may add it to a channel: one in a workspace they own (RNX-203), or any
   * public active one (RX-136).
   */
  findUsableAgent(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findFirst({
      where: {
        id: agentId,
        OR: [{ workspace: { ownerId: userId } }, { isPublic: true, status: "active" }],
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

  /** The agents in the workspaces this user owns (RNX-203), newest change first, each with its relations. */
  listOwnedAgents(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findMany({
      where: { workspace: { ownerId: userId } },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
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

  /** How many agents this user has created (the plan quota counts by creator). */
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

  /** The workspace id of the agent with this id and whether it is a default workspace (RNX-117), if the agent exists. */
  findAgentWorkspaceId(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true, workspace: { select: { isDefault: true } } },
    });
  }
}
