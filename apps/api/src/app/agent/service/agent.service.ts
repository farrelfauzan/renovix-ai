import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
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
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { TransactionService } from "../../prisma/transaction.service";

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
    private readonly knowledgeBases: KnowledgeBaseRepository,
    private readonly providerRouter: ProviderRouter,
    private readonly workspaceService: WorkspaceService,
    private readonly registry: ModelRegistryService,
    private readonly workspaces: WorkspaceRepository,
    private readonly policy: AgentRunPolicyService,
    private readonly entitlements: EntitlementService,
    private readonly transactions: TransactionService,
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
    // The workspace must be the caller's own (403); without one the agent goes into the caller's default
    // workspace (RNX-117), created here for an account without one (RNX-203).
    if (dto.workspaceId) await this.resolveTargetWorkspace(userId, dto.workspaceId);
    else await this.checkAgentLimit(userId);
    await this.checkModelTier(userId, dto.model);
    const workspaceId = await this.resolveTargetWorkspace(userId, dto.workspaceId);
    const slug = await this.generateUniqueSlug(userId, dto.name);

    return this.transactions.run(async (tx) => {
      await this.agents.acquireAccountEntitlementLock(userId, tx);
      await this.checkAgentLimit(userId, tx);
      return this.agents.createAgent(userId, { workspaceId, name: dto.name, slug, description: dto.description, avatar: dto.avatar, systemPrompt: dto.systemPrompt, model: dto.model, temperature: dto.temperature ?? 0.7, maxTokens: dto.maxTokens, isPublic: dto.isPublic ?? false }, tx);
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
    const agent = await this.verifyOwnership(userId, agentId);
    if (dto.model !== undefined && dto.model !== agent.model) await this.checkModelTier(userId, dto.model);

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
    await this.verifyOwnership(userId, agentId);

    await this.agents.deleteAgent(agentId);
    return { deleted: true };
  }

  async publish(userId: string, agentId: string) {
    await this.verifyOwnership(userId, agentId);

    return this.agents.updateAgentStatus(agentId, "active");
  }

  async updateStatus(userId: string, agentId: string, status: string) {
    await this.verifyOwnership(userId, agentId);

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

    if (dto.workspaceId) await this.resolveTargetWorkspace(userId, dto.workspaceId);
    else await this.checkAgentLimit(userId);
    await this.checkModelTier(userId, template.model);
    const workspaceId = await this.resolveTargetWorkspace(userId, dto.workspaceId);
    const slug = await this.generateUniqueSlug(userId, template.name);

    const agent = await this.transactions.run(async (tx) => {
      await this.agents.acquireAccountEntitlementLock(userId, tx);
      await this.checkAgentLimit(userId, tx);
      return this.agents.createAgent(userId, {
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
      }, tx);
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
    return this.transactions.run(async (tx) => {
      await this.agentIntegrations.acquireAccountEntitlementLock(userId, tx);
      await this.checkIntegrationLimit(userId, agentId, tx);
      return this.agentIntegrations.createAgentIntegration(agentId, { provider, config, scopes, status: "connected" }, tx);
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
      // A workspace base: only to an agent in the same workspace, by its
      // owner (RX-113; RNX-260: collaborators do not manage agents, D259)
      if (agent.workspaceId !== kb.workspaceId) {
        throw new NotFoundException("Knowledge base not found");
      }
      await this.workspaceService.requireRole(kb.workspaceId, userId, [
        "owner",
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
    await this.entitlements.requireChannel(userId, channelType);

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

  /**
   * RNX-251: the caller's package (their purchase snapshots, bought or granted by a code, through EntitlementService),
   * or null without one; the chat shows the agents page only with one.
   */
  async getSubscription(userId: string) {
    return { subscription: await this.entitlements.getForUser(userId) };
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

  /**
   * The agent, when this user owns its workspace (RNX-203), for a write. RNX-260 (D259): 403 for anyone else inside
   * the agent's workspace (a collaborator, run policy), 404 for anyone outside it (as for an agent they cannot see).
   */
  private async verifyOwnership(userId: string, agentId: string) {
    const agent = await this.agents.findUserAgent(agentId, userId);
    if (agent) return agent;
    const target = await this.agents.findAgentWorkspaceId(agentId);
    if (target && (await this.policy.isInsideWorkspace(target.workspaceId, userId))) {
      throw new ForbiddenException("Only the workspace owner can change this agent");
    }
    throw new NotFoundException("Agent not found");
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

  private async checkAgentLimit(userId: string, tx?: import("../../prisma/db-transaction").DbTransaction) {
    const count = await this.agents.countAgentsByUser(userId, tx);
    await this.entitlements.requireLimit(userId, "maxAgents", count, tx);
  }

  private async checkIntegrationLimit(userId: string, agentId: string, tx?: import("../../prisma/db-transaction").DbTransaction) {
    const count = await this.agentIntegrations.countAgentIntegrations(agentId, tx);
    await this.entitlements.requireLimit(userId, "maxConnectedTools", count, tx);
  }

  /**
   * RNX-76 B2b (Q7): the model (a slug, or a provider model id, as an agent run resolves it) must be known (400
   * otherwise) and of a tier the user's packages allow (400 PACKAGE_LIMIT_REACHED otherwise). Reads only.
   */
  private async checkModelTier(userId: string, model: string) {
    const modelConfig = await this.registry.resolveModel(model);
    if (!modelConfig) throw new ModelUnavailableException();
    await this.entitlements.requireModelTier(userId, modelConfig.tier);
  }
}
