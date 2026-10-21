import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { SubscriptionPlanRepository } from "../../billing/repository/subscription-plan.repository";
import { UserSubscriptionRepository } from "../../billing/repository/user-subscription.repository";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceRepository } from "../../workspace/repository/workspace.repository";
import type { CreateAgentDto } from "../dto/create-agent.dto";
import type { UpdateAgentDto } from "../dto/update-agent.dto";
import type { CloneAgentDto } from "../dto/clone-agent.dto";
import {
  WHATSAPP_WEBHOOK_SECRET_REQUIRED,
  WhatsappChannelConfigSchema,
} from "../dto/agent-chat.dto";
import { slugify } from "../../../common/utils/slugify";
import { AgentRepository } from "../repository/agent.repository";
import { AgentToolRepository } from "../repository/agent-tool.repository";
import { AgentIntegrationRepository } from "../repository/agent-integration.repository";
import { AgentKnowledgeBaseRepository } from "../repository/agent-knowledge-base.repository";
import { AgentChannelRepository } from "../repository/agent-channel.repository";

/** RNX-118: the tool type that call_agent replaced; a template row of it is not cloned. */
const REMOVED_DELEGATE_TOOL = "delegate_to_subagent";

@Injectable()
export class AgentService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly agentTools: AgentToolRepository,
    private readonly agentIntegrations: AgentIntegrationRepository,
    private readonly agentKnowledgeBases: AgentKnowledgeBaseRepository,
    private readonly agentChannels: AgentChannelRepository,
    private readonly subscriptions: UserSubscriptionRepository,
    private readonly plans: SubscriptionPlanRepository,
    private readonly knowledgeBases: KnowledgeBaseRepository,
    private readonly providerRouter: ProviderRouter,
    private readonly workspaceService: WorkspaceService,
    private readonly registry: ModelRegistryService,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  private async generateUniqueSlug(
    userId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.agents.findAgentBySlug(userId, slug);
      if (!existing) return slug;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  async create(userId: string, dto: CreateAgentDto) {
    // Check subscription
    await this.checkSubscription(userId);

    // Check agent limit
    await this.checkAgentLimit(userId);

    // The workspace must be the caller's own (403); without one the agent goes into the caller's default
    // workspace (RNX-117), created here for an account without one (RNX-203).
    const workspaceId = await this.resolveTargetWorkspace(userId, dto.workspaceId);

    const slug = await this.generateUniqueSlug(userId, dto.name);

    return this.agents.createAgent(userId, {
      workspaceId,
      name: dto.name,
      slug,
      description: dto.description,
      avatar: dto.avatar,
      systemPrompt: dto.systemPrompt,
      model: dto.model,
      temperature: dto.temperature ?? 0.7,
      maxTokens: dto.maxTokens,
      isPublic: dto.isPublic ?? false,
    });
  }

  async list(userId: string) {
    return this.agents.listOwnedAgents(userId);
  }

  async findById(userId: string, agentId: string) {
    const agent = await this.agents.findAgentDetail(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return agent;
  }

  async update(userId: string, agentId: string, dto: UpdateAgentDto) {
    const agent = await this.agents.findUserAgent(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    const data: Record<string, any> = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
      // The slug is unique per creator (RNX-203: the caller may own the workspace without being the creator)
      data.slug = await this.generateUniqueSlug(agent.userId, dto.name);
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.temperature !== undefined) data.temperature = dto.temperature;
    if (dto.maxTokens !== undefined) data.maxTokens = dto.maxTokens;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;

    return this.agents.updateAgent(agentId, data);
  }

  async delete(userId: string, agentId: string) {
    const agent = await this.agents.findUserAgent(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    await this.agents.deleteAgent(agentId);
    return { deleted: true };
  }

  async publish(userId: string, agentId: string) {
    const agent = await this.agents.findUserAgent(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return this.agents.updateAgentStatus(agentId, "active");
  }

  async updateStatus(userId: string, agentId: string, status: string) {
    const agent = await this.agents.findUserAgent(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return this.agents.updateAgentStatus(agentId, status);
  }

  async listPublic() {
    return this.agents.listPublicAgents();
  }

  async cloneFromTemplate(
    userId: string,
    templateId: string,
    dto: CloneAgentDto = {},
  ) {
    const template = await this.agents.findPublicTemplate(templateId);

    if (!template) {
      throw new NotFoundException("Template not found");
    }

    await this.checkSubscription(userId);
    await this.checkAgentLimit(userId);

    const workspaceId = await this.resolveTargetWorkspace(userId, dto.workspaceId);
    const slug = await this.generateUniqueSlug(userId, template.name);

    const agent = await this.agents.createAgent(userId, {
      workspaceId,
      name: template.name,
      slug,
      description: template.description,
      avatar: template.avatar,
      systemPrompt: template.systemPrompt,
      model: template.model,
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      isPublic: false,
    });

    // Clone tools; RNX-118: never the old delegate_to_subagent row, and a clone gets no links
    const tools = template.tools.filter((t) => t.toolType !== REMOVED_DELEGATE_TOOL);
    if (tools.length > 0) {
      await this.agentTools.createAgentTools(
        agent.id,
        tools.map((t) => ({
          toolType: t.toolType,
          config: t.config ?? undefined,
          enabled: t.enabled,
        })),
      );
    }

    return this.agents.findAgentWithRelations(agent.id);
  }

  // ─── Tools ───

  async attachTool(
    userId: string,
    agentId: string,
    toolType: string,
    config?: Record<string, any>,
    enabled = true,
  ) {
    await this.verifyOwnership(userId, agentId);

    return this.agentTools.createAgentTool(agentId, {
      toolType,
      config,
      enabled,
    });
  }

  async removeTool(userId: string, agentId: string, toolId: string) {
    await this.verifyOwnership(userId, agentId);

    const tool = await this.agentTools.findAgentTool(toolId, agentId);
    if (!tool) throw new NotFoundException("Tool not found");

    await this.agentTools.deleteAgentTool(toolId);
    return { deleted: true };
  }

  // ─── Integrations ───

  async attachIntegration(
    userId: string,
    agentId: string,
    provider: string,
    config: Record<string, any>,
    scopes: string[],
  ) {
    await this.verifyOwnership(userId, agentId);
    await this.checkIntegrationLimit(userId, agentId);

    return this.agentIntegrations.createAgentIntegration(agentId, {
      provider,
      config,
      scopes,
      status: "connected",
    });
  }

  async removeIntegration(
    userId: string,
    agentId: string,
    integrationId: string,
  ) {
    await this.verifyOwnership(userId, agentId);

    const integration = await this.agentIntegrations.findAgentIntegration(
      integrationId,
      agentId,
    );
    if (!integration) throw new NotFoundException("Integration not found");

    await this.agentIntegrations.deleteAgentIntegration(integrationId);
    return { deleted: true };
  }

  // ─── Knowledge Bases ───

  async attachKnowledgeBase(
    userId: string,
    agentId: string,
    knowledgeBaseId: string,
  ) {
    const agent = await this.verifyOwnership(userId, agentId);

    const kb = await this.knowledgeBases.findKnowledgeBaseById(knowledgeBaseId);
    if (!kb) throw new NotFoundException("Knowledge base not found");

    if (kb.workspaceId) {
      // A workspace base: only to an agent in the same workspace, by a
      // current owner or admin of that workspace (RX-113)
      // RNX-203: verifyOwnership already requires the workspace owner, so the
      // admin case cannot be reached through the agent routes today; kept for
      // RX-119 (collaborators managing agents), which owns that branch.
      if (agent.workspaceId !== kb.workspaceId) {
        throw new NotFoundException("Knowledge base not found");
      }
      await this.workspaceService.requireRole(kb.workspaceId, userId, [
        "owner",
        "admin",
      ]);
    } else if (kb.userId !== userId) {
      // A personal base: only its owner's own agents
      throw new NotFoundException("Knowledge base not found");
    }

    return this.agentKnowledgeBases.createAgentKnowledgeBase(
      agentId,
      knowledgeBaseId,
    );
  }

  async removeKnowledgeBase(
    userId: string,
    agentId: string,
    knowledgeBaseId: string,
  ) {
    await this.verifyOwnership(userId, agentId);

    const akb = await this.agentKnowledgeBases.findAgentKnowledgeBase(
      agentId,
      knowledgeBaseId,
    );
    if (!akb)
      throw new NotFoundException("Knowledge base attachment not found");

    await this.agentKnowledgeBases.deleteAgentKnowledgeBase(akb.id);
    return { deleted: true };
  }

  // ─── Channels ───

  async deployChannel(
    userId: string,
    agentId: string,
    channelType: string,
    config?: Record<string, any>,
  ) {
    await this.verifyOwnership(userId, agentId);
    await this.checkChannelAccess(userId, channelType);

    return this.agentChannels.createAgentChannel(agentId, {
      channelType,
      config,
      status: "active",
    });
  }

  async updateChannel(
    userId: string,
    agentId: string,
    channelId: string,
    config: Record<string, any>,
  ) {
    await this.verifyOwnership(userId, agentId);

    const channel = await this.agentChannels.findAgentChannel(
      channelId,
      agentId,
    );
    if (!channel) throw new NotFoundException("Channel not found");
    if (
      channel.channelType === "whatsapp" &&
      !WhatsappChannelConfigSchema.safeParse(config).success
    ) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: { webhookSecret: [WHATSAPP_WEBHOOK_SECRET_REQUIRED] },
        },
      });
    }

    return this.agentChannels.updateAgentChannelConfig(channelId, config);
  }

  async removeChannel(userId: string, agentId: string, channelId: string) {
    await this.verifyOwnership(userId, agentId);

    const channel = await this.agentChannels.findAgentChannel(
      channelId,
      agentId,
    );
    if (!channel) throw new NotFoundException("Channel not found");

    await this.agentChannels.deleteAgentChannel(channelId);
    return { deleted: true };
  }

  // ─── Subscription ───

  async getSubscription(userId: string) {
    const subscription =
      await this.subscriptions.findSubscriptionWithPlan(userId);
    if (!subscription) {
      return { subscription: null };
    }

    return {
      subscription: {
        ...subscription,
        plan: {
          ...subscription.plan,
          maxTokensPerMonth: subscription.plan.maxTokensPerMonth.toString(),
          priceMonthly: subscription.plan.priceMonthly
            ? Number(subscription.plan.priceMonthly)
            : null,
        },
      },
    };
  }

  async subscribe(userId: string, tier: string) {
    const plan = await this.plans.findPlanBySlug(tier);
    if (!plan) throw new BadRequestException("Invalid plan tier");

    // Check if user already has active subscription
    const existing = await this.subscriptions.findSubscriptionByUserId(userId);

    if (existing && existing.status === "active") {
      // Upgrade/downgrade
      const updated = await this.subscriptions.updateSubscriptionWithPlan(
        userId,
        {
          planId: plan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      );
      return {
        subscription: {
          ...updated,
          plan: {
            ...updated.plan,
            maxTokensPerMonth: updated.plan.maxTokensPerMonth.toString(),
            priceMonthly: updated.plan.priceMonthly
              ? Number(updated.plan.priceMonthly)
              : null,
          },
        },
      };
    }

    // Create new subscription
    const subscription = await this.subscriptions.createSubscriptionWithPlan(
      userId,
      {
        planId: plan.id,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    );

    return {
      subscription: {
        ...subscription,
        plan: {
          ...subscription.plan,
          maxTokensPerMonth: subscription.plan.maxTokensPerMonth.toString(),
          priceMonthly: subscription.plan.priceMonthly
            ? Number(subscription.plan.priceMonthly)
            : null,
        },
      },
    };
  }

  // ─── Prompt Generation ───

  async generatePrompt(name: string, description?: string) {
    const userMessage = description
      ? `Agent name: "${name}"\nDescription: "${description}"`
      : `Agent name: "${name}"`;

    // RX-178: the cheapest resolvable Standard model, never a hard-coded vendor id.
    const connection = await this.registry.resolveCheapestConnection("standard");
    const response = await this.providerRouter.chat({
      connection,
      model: connection.slug,
      messages: [
        {
          role: "system",
          content:
            "You are a prompt engineering assistant. Given an AI agent's name and optional description, generate a concise system prompt (1 paragraph, 3-5 sentences) that defines the agent's role, personality, and behavior. Be specific and actionable. Output ONLY the system prompt text, no explanation or formatting. Do not wrap in quotes.",
        },
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      max_tokens: 1024,
      reasoning_effort: "high",
    });

    const content = response.choices?.[0]?.message?.content?.trim() || "";
    return { prompt: content };
  }

  // ─── Helpers ───

  private async verifyOwnership(userId: string, agentId: string) {
    const agent = await this.agents.findUserAgent(agentId, userId);
    if (!agent) throw new NotFoundException("Agent not found");
    return agent;
  }

  /**
   * The workspace a new agent goes into (RNX-203): the given one if the caller owns it (else 403, nothing
   * stored), otherwise the caller's default workspace (RNX-117).
   */
  private async resolveTargetWorkspace(
    userId: string,
    workspaceId?: string,
  ): Promise<string> {
    if (!workspaceId) {
      return (await this.workspaces.ensureDefaultWorkspace(userId)).id;
    }
    const owned = await this.workspaces.findOwnedWorkspace(workspaceId, userId);
    if (!owned) throw new ForbiddenException("You do not own this workspace");
    return owned.id;
  }

  private async checkSubscription(userId: string) {
    const subscription =
      await this.subscriptions.findSubscriptionWithPlan(userId);

    if (!subscription || subscription.status !== "active") {
      throw new ForbiddenException(
        "Active subscription required to use AI Agents. Please subscribe to access this feature.",
      );
    }

    return subscription;
  }

  private async checkAgentLimit(userId: string) {
    const subscription =
      await this.subscriptions.findSubscriptionWithPlan(userId);
    if (!subscription) return;

    const maxAgents = subscription.plan.maxAgents;
    const count = await this.agents.countAgentsByUser(userId);

    if (count >= maxAgents) {
      throw new BadRequestException(
        `Agent limit reached for your ${subscription.plan.name} plan (${maxAgents} agents). Please upgrade to create more.`,
      );
    }
  }

  private async checkIntegrationLimit(userId: string, agentId: string) {
    const subscription =
      await this.subscriptions.findSubscriptionWithPlan(userId);
    if (!subscription) return;

    const max = subscription.plan.maxIntegrations;
    const count = await this.agentIntegrations.countAgentIntegrations(agentId);

    if (count >= max) {
      throw new BadRequestException(
        `Integration limit reached for your ${subscription.plan.name} plan. Please upgrade.`,
      );
    }
  }

  private async checkChannelAccess(userId: string, channelType: string) {
    const subscription =
      await this.subscriptions.findSubscriptionWithPlan(userId);
    if (!subscription) return;

    const allowed = subscription.plan.allowedChannels;
    if (!allowed.includes(channelType)) {
      throw new ForbiddenException(
        `${channelType} channel is not available on your ${subscription.plan.name} plan. Please upgrade.`,
      );
    }
  }
}
