import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderRouter } from "../providers/provider-router";
import type { CreateAgentDto } from "./dto/create-agent.dto";
import type { UpdateAgentDto } from "./dto/update-agent.dto";

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRouter: ProviderRouter,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async generateUniqueSlug(
    userId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = this.slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.agent.findUnique({
        where: { userId_slug: { userId, slug } },
      });
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

    // If sub_agent, validate parent
    if (dto.agentType === "sub_agent" && dto.parentAgentId) {
      const parent = await this.prisma.agent.findFirst({
        where: { id: dto.parentAgentId, userId },
      });
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

    return this.prisma.agent.create({
      data: {
        userId,
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
      },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        _count: { select: { runs: true } },
      },
    });
  }

  async list(userId: string) {
    return this.prisma.agent.findMany({
      where: { userId, parentAgentId: null },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        subAgents: { select: { id: true, name: true, status: true } },
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findById(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
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

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return agent;
  }

  async update(userId: string, agentId: string, dto: UpdateAgentDto) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    const data: Record<string, any> = {};

    const nextAgentType = dto.agentType ?? agent.agentType;
    const nextParentAgentId =
      dto.parentAgentId !== undefined ? dto.parentAgentId : agent.parentAgentId;

    if (nextAgentType === "sub_agent") {
      if (!nextParentAgentId) {
        throw new BadRequestException("Sub-agent must have a parentAgentId");
      }
      if (nextParentAgentId === agentId) {
        throw new BadRequestException("Agent cannot be its own parent");
      }

      const parent = await this.prisma.agent.findFirst({
        where: { id: nextParentAgentId, userId },
        select: { id: true, agentType: true },
      });

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

    return this.prisma.agent.update({
      where: { id: agentId },
      data,
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        _count: { select: { runs: true } },
      },
    });
  }

  async delete(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    await this.prisma.agent.delete({ where: { id: agentId } });
    return { deleted: true };
  }

  async publish(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: "active" },
    });
  }

  async updateStatus(userId: string, agentId: string, status: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status },
    });
  }

  async listPublic() {
    return this.prisma.agent.findMany({
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

  async cloneFromTemplate(userId: string, templateId: string) {
    const template = await this.prisma.agent.findFirst({
      where: { id: templateId, isPublic: true, status: "active" },
      include: { tools: true },
    });

    if (!template) {
      throw new NotFoundException("Template not found");
    }

    await this.checkSubscription(userId);
    await this.checkAgentLimit(userId);

    const slug = await this.generateUniqueSlug(userId, template.name);

    const agent = await this.prisma.agent.create({
      data: {
        userId,
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
      },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        _count: { select: { runs: true } },
      },
    });

    // Clone tools
    if (template.tools.length > 0) {
      await this.prisma.agentTool.createMany({
        data: template.tools.map((t) => ({
          agentId: agent.id,
          toolType: t.toolType,
          config: t.config ?? undefined,
          enabled: t.enabled,
        })),
      });
    }

    return this.prisma.agent.findUnique({
      where: { id: agent.id },
      include: {
        tools: true,
        integrations: true,
        knowledgeBases: true,
        channels: true,
        _count: { select: { runs: true } },
      },
    });
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

    return this.prisma.agentTool.create({
      data: { agentId, toolType, config, enabled },
    });
  }

  async removeTool(userId: string, agentId: string, toolId: string) {
    await this.verifyOwnership(userId, agentId);

    const tool = await this.prisma.agentTool.findFirst({
      where: { id: toolId, agentId },
    });
    if (!tool) throw new NotFoundException("Tool not found");

    await this.prisma.agentTool.delete({ where: { id: toolId } });
    return { deleted: true };
  }

  async getAvailableTools() {
    return [
      {
        type: "knowledge_retrieval",
        name: "Knowledge Retrieval",
        description: "RAG search on attached knowledge bases",
        configRequired: false,
      },
      {
        type: "web_search",
        name: "Web Search",
        description: "Search the internet for real-time information",
        configRequired: false,
      },
      {
        type: "calculator",
        name: "Calculator",
        description: "Evaluate mathematical expressions",
        configRequired: false,
      },
      {
        type: "code_exec",
        name: "Code Execution",
        description: "Run sandboxed code snippets",
        configRequired: false,
      },
      {
        type: "api_call",
        name: "API Call",
        description: "Call external HTTP APIs",
        configRequired: true,
      },
      {
        type: "memory_store",
        name: "Memory Store",
        description: "Store facts about the conversation user",
        configRequired: false,
      },
      {
        type: "delegate_to_subagent",
        name: "Delegate to Sub-Agent",
        description: "Delegate a task to a sub-agent",
        configRequired: true,
      },
      {
        type: "create_reminder",
        name: "Create Reminder",
        description: "Schedule automated messages on a recurring basis",
        configRequired: false,
      },
    ];
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

    return this.prisma.agentIntegration.create({
      data: { agentId, provider, config, scopes, status: "connected" },
    });
  }

  async removeIntegration(
    userId: string,
    agentId: string,
    integrationId: string,
  ) {
    await this.verifyOwnership(userId, agentId);

    const integration = await this.prisma.agentIntegration.findFirst({
      where: { id: integrationId, agentId },
    });
    if (!integration) throw new NotFoundException("Integration not found");

    await this.prisma.agentIntegration.delete({ where: { id: integrationId } });
    return { deleted: true };
  }

  // ─── Knowledge Bases ───

  async attachKnowledgeBase(
    userId: string,
    agentId: string,
    knowledgeBaseId: string,
  ) {
    await this.verifyOwnership(userId, agentId);

    // Verify KB belongs to user
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, userId },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");

    return this.prisma.agentKnowledgeBase.create({
      data: { agentId, knowledgeBaseId },
    });
  }

  async removeKnowledgeBase(
    userId: string,
    agentId: string,
    knowledgeBaseId: string,
  ) {
    await this.verifyOwnership(userId, agentId);

    const akb = await this.prisma.agentKnowledgeBase.findFirst({
      where: { agentId, knowledgeBaseId },
    });
    if (!akb)
      throw new NotFoundException("Knowledge base attachment not found");

    await this.prisma.agentKnowledgeBase.delete({ where: { id: akb.id } });
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

    return this.prisma.agentChannel.create({
      data: { agentId, channelType, config, status: "active" },
    });
  }

  async updateChannel(
    userId: string,
    agentId: string,
    channelId: string,
    config: Record<string, any>,
  ) {
    await this.verifyOwnership(userId, agentId);

    const channel = await this.prisma.agentChannel.findFirst({
      where: { id: channelId, agentId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    return this.prisma.agentChannel.update({
      where: { id: channelId },
      data: { config },
    });
  }

  async removeChannel(userId: string, agentId: string, channelId: string) {
    await this.verifyOwnership(userId, agentId);

    const channel = await this.prisma.agentChannel.findFirst({
      where: { id: channelId, agentId },
    });
    if (!channel) throw new NotFoundException("Channel not found");

    await this.prisma.agentChannel.delete({ where: { id: channelId } });
    return { deleted: true };
  }

  // ─── Subscription ───

  async getSubscription(userId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
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
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: tier },
    });
    if (!plan) throw new BadRequestException("Invalid plan tier");

    // Check if user already has active subscription
    const existing = await this.prisma.userSubscription.findUnique({
      where: { userId },
    });

    if (existing && existing.status === "active") {
      // Upgrade/downgrade
      const updated = await this.prisma.userSubscription.update({
        where: { userId },
        data: {
          planId: plan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          messagesUsed: 0,
          tokensUsed: 0,
        },
        include: { plan: true },
      });
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
    const subscription = await this.prisma.userSubscription.create({
      data: {
        userId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      include: { plan: true },
    });

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
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, userId },
    });
    if (!agent) throw new NotFoundException("Agent not found");
    return agent;
  }

  private async checkSubscription(userId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });

    if (!subscription || subscription.status !== "active") {
      throw new ForbiddenException(
        "Active subscription required to use AI Agents. Please subscribe to access this feature.",
      );
    }

    return subscription;
  }

  private async checkAgentLimit(userId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    if (!subscription) return;

    const maxAgents = subscription.plan.maxAgents;
    const count = await this.prisma.agent.count({ where: { userId } });

    if (count >= maxAgents) {
      throw new BadRequestException(
        `Agent limit reached for your ${subscription.plan.name} plan (${maxAgents} agents). Please upgrade to create more.`,
      );
    }
  }

  private async checkIntegrationLimit(userId: string, agentId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    if (!subscription) return;

    const max = subscription.plan.maxIntegrations;
    const count = await this.prisma.agentIntegration.count({
      where: { agentId },
    });

    if (count >= max) {
      throw new BadRequestException(
        `Integration limit reached for your ${subscription.plan.name} plan. Please upgrade.`,
      );
    }
  }

  private async checkChannelAccess(userId: string, channelType: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    if (!subscription) return;

    const allowed = subscription.plan.allowedChannels;
    if (!allowed.includes(channelType)) {
      throw new ForbiddenException(
        `${channelType} channel is not available on your ${subscription.plan.name} plan. Please upgrade.`,
      );
    }
  }
}
