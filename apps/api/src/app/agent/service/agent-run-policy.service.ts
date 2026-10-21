import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceRepository } from "../../workspace/repository/workspace.repository";
import { WorkspaceMemberRepository } from "../../workspace/repository/workspace-member.repository";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UserSubscriptionRepository } from "../../billing/repository/user-subscription.repository";
import type { RunScope } from "../types/run-scope";
import type { RunPolicyAgent } from "../types/run-policy-agent";
import type { RunDecision } from "../types/run-decision";

/**
 * RNX-119 (D257): the one run policy, used by every run entry (agent chat, channel chat, reminder fire). The runner
 * may run the agent INSIDE its workspace when they own it or are a current (active) member of it and the owner's plan
 * allows collaboration (D64, WorkspaceQuotaService.isCollaborationAllowed); OUTSIDE it when the agent is public and
 * active (R17: alone); anyone else is refused (404, as for an agent they cannot see). The runner pays (their own
 * paid wallet), so the D192 active-subscription gate applies to the runner on every entry.
 */
@Injectable()
export class AgentRunPolicyService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly workspaceMembers: WorkspaceMemberRepository,
    private readonly quotaService: WorkspaceQuotaService,
    private readonly subscriptions: UserSubscriptionRepository,
  ) {}

  /** Where this runner's run of this agent happens, or null when they may not run it. */
  async findRunScope(agent: RunPolicyAgent, runnerUserId: string): Promise<RunScope | null> {
    if (await this.isInsideWorkspace(agent.workspaceId, runnerUserId)) return "inside";
    return agent.isPublic && agent.status === "active" ? "outside" : null;
  }

  /** The run's scope; 404 "Agent not found" for an agent this runner may not run (as for an agent they cannot see). */
  async assertRunScope(agent: RunPolicyAgent, runnerUserId: string): Promise<RunScope> {
    const scope = await this.findRunScope(agent, runnerUserId);
    if (!scope) throw new NotFoundException("Agent not found");
    return scope;
  }

  /**
   * The agent subscription gate (D192, D202 item 8): 403 unless the runner has an active subscription. A read only:
   * no counter is written (RX-22b, D190); credits are charged through the run's reservation.
   */
  async assertActiveSubscription(runnerUserId: string): Promise<void> {
    if (!(await this.hasActiveSubscription(runnerUserId))) {
      throw new ForbiddenException("Active subscription required to use AI Agents.");
    }
  }

  /** The policy and the subscription gate in one answer, for an entry that skips instead of answering (a reminder). */
  async decideRun(agent: RunPolicyAgent, runnerUserId: string): Promise<RunDecision> {
    const scope = await this.findRunScope(agent, runnerUserId);
    if (!scope) return { allowed: false, reason: "not_runnable" };
    if (!(await this.hasActiveSubscription(runnerUserId))) return { allowed: false, reason: "no_subscription" };
    return { allowed: true, scope };
  }

  /** The workspace owner (by `ownerId`), or an active member of a workspace whose owner's plan allows collaboration. */
  async isInsideWorkspace(workspaceId: string, userId: string): Promise<boolean> {
    if (await this.workspaces.findOwnedWorkspace(workspaceId, userId)) return true;
    const member = await this.workspaceMembers.findMembership(workspaceId, userId);
    if (member?.status !== "active") return false;
    return this.quotaService.isCollaborationAllowed(workspaceId, userId);
  }

  private async hasActiveSubscription(userId: string): Promise<boolean> {
    const subscription = await this.subscriptions.findSubscriptionByUserId(userId);
    return subscription?.status === "active";
  }
}
