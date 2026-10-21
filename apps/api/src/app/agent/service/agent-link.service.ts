import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AgentRepository } from "../repository/agent.repository";
import { AgentLinkRepository } from "../repository/agent-link.repository";
import type { CallableAgent } from "../types/callable-agent";
import type { RunScope } from "../types/run-scope";

/**
 * RNX-118 (PRD 10, D81): agent links ("Can call"). Only the workspace owner of the caller agent (RNX-203:
 * `workspace.ownerId`) lists, adds or removes its links (403 for anyone else), and both agents are in one workspace
 * (403 otherwise). At run time the linked callees are callable only in a run inside the workspace (RNX-119: the run
 * policy's scope, AgentRunPolicyService); anyone else runs the agent stand-alone (R17).
 */
@Injectable()
export class AgentLinkService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly links: AgentLinkRepository,
  ) {}

  /** The links of this agent, each with the callee's public fields: 404 for no agent, 403 for a non-owner. */
  async listLinks(userId: string, agentId: string) {
    await this.findOwnedAgent(userId, agentId);
    return this.links.listLinks(agentId);
  }

  /** Links this agent to the callee: 400 for itself, 404 for no callee, 403 for a callee in another workspace. */
  async addLink(userId: string, agentId: string, calleeAgentId: string) {
    const caller = await this.findOwnedAgent(userId, agentId);
    if (calleeAgentId === agentId) throw new BadRequestException("An agent cannot call itself");
    const callee = await this.agents.findAgentWorkspaceOwner(calleeAgentId);
    if (!callee) throw new NotFoundException("Agent not found");
    if (callee.workspaceId !== caller.workspaceId) {
      throw new ForbiddenException("Both agents must be in the same workspace");
    }
    return this.links.createLink(agentId, calleeAgentId);
  }

  /** Removes the link: 404 when there is none. */
  async removeLink(userId: string, agentId: string, calleeAgentId: string): Promise<void> {
    await this.findOwnedAgent(userId, agentId);
    if ((await this.links.deleteLink(agentId, calleeAgentId)) === 0) {
      throw new NotFoundException("Link not found");
    }
  }

  /**
   * The agents this agent may call in a run with this scope (RNX-119: from the run policy): its active linked callees
   * in its workspace, or none for a run outside it (R17: a public agent stands alone).
   */
  async listCallableAgents(
    agent: { readonly id: string; readonly workspaceId: string },
    scope: RunScope,
  ): Promise<CallableAgent[]> {
    if (scope !== "inside") return [];
    return this.links.listCallableAgents(agent.id, agent.workspaceId);
  }

  /** The agent if this user owns its workspace: 404 when it does not exist, 403 when someone else owns it. */
  private async findOwnedAgent(userId: string, agentId: string) {
    const agent = await this.agents.findAgentWorkspaceOwner(agentId);
    if (!agent) throw new NotFoundException("Agent not found");
    if (agent.workspace.ownerId !== userId) {
      throw new ForbiddenException("Only the workspace owner can change this agent's links");
    }
    return agent;
  }
}
