import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { SubscriptionPlanRepository } from "../../billing/repository/subscription-plan.repository";
import { UserSubscriptionRepository } from "../../billing/repository/user-subscription.repository";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import type { CreateAgentDto } from "../dto/create-agent.dto";
import type { UpdateAgentDto } from "../dto/update-agent.dto";
import {
  WHATSAPP_WEBHOOK_SECRET_REQUIRED,
  WhatsappChannelConfigSchema,
} from "../dto/agent-chat.dto";
import { ownSubAgents } from "../utils/own-sub-agents";
import { slugify } from "../../../common/utils/slugify";
import { AgentRepository } from "../repository/agent.repository";
import { AgentToolRepository } from "../repository/agent-tool.repository";
import { AgentIntegrationRepository } from "../repository/agent-integration.repository";
import { AgentKnowledgeBaseRepository } from "../repository/agent-knowledge-base.repository";
import { AgentChannelRepository } from "../repository/agent-channel.repository";

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

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

    // A parentAgentId is only allowed on a sub-agent and must be one of the
    // caller's own parent agents (RX-112)
    if (dto.parentAgentId) {
      if (dto.agentType !== "sub_agent") {
        throw new BadRequestException(
          "Only a sub-agent can have a parentAgentId",
        );
      }
      const parent = await this.agents.findUserAgent(dto.parentAgentId, userId);
      if (!parent) {
        throw new BadRequestException("Parent agent not found");
      }
      if (parent.agentType !== "parent") {
        throw new BadRequestException(
          "Parent agent must have agent type 'parent'",
        );
      }
    }

    const slug = await this.generateUniqueSlug(userId, dto.name);

    return this.agents.createAgent(userId, {
      name: dto.name,
      slug,
      description: dto.description,
      avatar: dto.avatar,
      systemPrompt: dto.systemPrompt,
      model: dto.model,
      temperature: dto.temperature ?? 0.7,
      maxTokens: dto.maxTokens,
      isPublic: dto.isPublic ?? false,
      agentType: dto.agentType ?? "standalone",
      parentAgentId: dto.parentAgentId,
    });
  }

  async list(userId: string) {
    const agents = await this.agents.listTopLevelAgents(userId);
    return agents.map((agent) => ({
      ...agent,
      subAgents: ownSubAgents(agent, agent.subAgents, this.logger),
    }));
  }

  async findById(userId: string, agentId: string) {
    const agent = await this.agents.findAgentDetail(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    agent.subAgents = ownSubAgents(agent, agent.subAgents, this.logger);
    return agent;
  }

  async update(userId: string, agentId: string, dto: UpdateAgentDto) {
    const agent = await this.agents.findUserAgent(agentId, userId);

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    const data: Record<string, any> = {};

    const nextAgentType = dto.agentType ?? agent.agentType;
    const nextParentAgentId =
      dto.parentAgentId !== undefined ? dto.parentAgentId : agent.parentAgentId;

    if (nextAgentType !== "sub_agent" && dto.parentAgentId) {
      throw new BadRequestException(
        "Only a sub-agent can have a parentAgentId",
      );
    }
    if (nextAgentType === "sub_agent") {
      if (!nextParentAgentId) {
        throw new BadRequestException("Sub-agent must have a parentAgentId");
      }
      if (nextParentAgentId === agentId) {
        throw new BadRequestException("Agent cannot be its own parent");
      }

      const parent = await this.agents.findUserAgentType(
        nextParentAgentId,
        userId,
      );

      if (!parent) {
        throw new BadRequestException("Parent agent not found");
      }
      if (parent.agentType !== "parent") {
        throw new BadRequestException(
          "Parent agent must have agent type 'parent'",
        );
      }
    }
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = await this.generateUniqueSlug(userId, dto.name);
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.temperature !== undefined) data.temperature = dto.temperature;
    if (dto.maxTokens !== undefined) data.maxTokens = dto.maxTokens;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if (dto.agentType !== undefined) data.agentType = dto.agentType;
    if (dto.parentAgentId !== undefined) data.parentAgentId = dto.parentAgentId;
    if (dto.agentType !== undefined && dto.agentType !== "sub_agent") {
      data.parentAgentId = null;
    }

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

  async cloneFromTemplate(userId: string, templateId: string) {
    const template = await this.agents.findPublicTemplate(templateId);

    if (!template) {
      throw new NotFoundException("Template not found");
    }

    await this.checkSubscription(userId);
    await this.checkAgentLimit(userId);

    const slug = await this.generateUniqueSlug(userId, template.name);

    const agent = await this.agents.createAgent(userId, {
      name: template.name,
      slug,
      description: template.description,
      avatar: template.avatar,
      systemPrompt: template.systemPrompt,
      model: template.model,
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      isPublic: false,
      agentType:
        template.agentType === "parent" ? "standalone" : template.agentType,
    });

    // Clone tools
    if (template.tools.length > 0) {
      await this.agentTools.createAgentTools(
        agent.id,
        template.tools.map((t) => ({
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
        tokensUsed: subscription.tokensUsed.toString(),
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
          messagesUsed: 0,
          tokensUsed: 0,
        },
      );
      return {
        subscription: {
          ...updated,
          tokensUsed: updated.tokensUsed.toString(),
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
        tokensUsed: subscription.tokensUsed.toString(),
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

    const response = await this.providerRouter.chat("openrouter", {
      providerId: "deepseek/deepseek-v4-pro",
      model: "deepseek/deepseek-v4-pro",
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
