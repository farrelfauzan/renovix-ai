import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";

@Injectable()
export class AgentMemoryService {
  private readonly logger = new Logger(AgentMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRouter: ProviderRouter,
    private readonly registry: ModelRegistryService,
  ) {}

  async getMemoryContext(agentId: string, userId: string): Promise<string> {
    // Resolve workspace from agent
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });

    const parts: string[] = [];

    // Workspace memories (shared across all agents in workspace)
    if (agent?.workspaceId) {
      const workspaceMemories = await this.prisma.workspaceMemory.findMany({
        where: {
          workspaceId: agent.workspaceId,
          status: "active",
        },
        orderBy: { confidence: "desc" },
        take: 20,
      });
      parts.push(...workspaceMemories.map((m) => `- [${m.type}] ${m.content}`));
    }

    // User memories (personal to the user)
    const userMemories = await this.prisma.userMemory.findMany({
      where: {
        userId,
        status: "active",
      },
      orderBy: { confidence: "desc" },
      take: 10,
    });
    parts.push(...userMemories.map((m) => `- [${m.type}] ${m.content}`));

    return parts.join("\n");
  }

  /**
   * Get only workspace-scoped memories for agent chat (no user memories).
   */
  async getWorkspaceMemoryContext(agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });

    if (!agent?.workspaceId) return "";

    const memories = await this.prisma.workspaceMemory.findMany({
      where: {
        workspaceId: agent.workspaceId,
        status: "active",
      },
      orderBy: { confidence: "desc" },
      take: 20,
    });

    if (memories.length === 0) return "";

    return memories.map((m) => `- [${m.type}] ${m.content}`).join("\n");
  }

  async extractAndStore(
    agentId: string,
    userId: string,
    userMessage: string,
    assistantResponse: string,
    channelId?: string,
  ): Promise<void> {
    try {
      const cheapestModel = await this.registry.getCheapestModel();
      if (!cheapestModel) return;

      const extractionPrompt = `Analyze this conversation and extract key facts about the user that would be useful to remember for future conversations.

User message: "${userMessage}"
Assistant response: "${assistantResponse}"

Extract facts in JSON format. Return an empty array if no notable facts.
Format: [{"type": "interest|preference|context", "content": "the fact", "confidence": 0.5-1.0}]

Rules:
- Only extract genuinely useful facts (preferences, interests, context)
- Do not extract trivial or obvious information
- Confidence should reflect how certain the fact is
- Return [] if nothing noteworthy`;

      const response = await this.providerRouter.chat(cheapestModel.provider, {
        model: cheapestModel.slug,
        providerId: cheapestModel.providerId,
        messages: [
          {
            role: "system",
            content:
              "You extract user facts from conversations. Respond only with valid JSON.",
          },
          { role: "user", content: extractionPrompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) return;

      // Parse JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const facts = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(facts) || facts.length === 0) return;

      // Resolve workspace from channel or agent
      let workspaceId: string | null = null;
      if (channelId) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { channelId },
          select: { id: true },
        });
        workspaceId = workspace?.id ?? null;
      }
      if (!workspaceId) {
        const agent = await this.prisma.agent.findUnique({
          where: { id: agentId },
          select: { workspaceId: true },
        });
        workspaceId = agent?.workspaceId ?? null;
      }

      // Store each fact
      for (const fact of facts.slice(0, 3)) {
        if (!fact.content || !fact.type) continue;

        if (workspaceId) {
          // Store to workspace memory
          const existing = await this.prisma.workspaceMemory.findFirst({
            where: {
              workspaceId,
              content: { contains: fact.content.substring(0, 50) },
              status: "active",
            },
          });

          if (existing) {
            await this.prisma.workspaceMemory.update({
              where: { id: existing.id },
              data: {
                confidence: Math.min(1, existing.confidence + 0.1),
                lastConfirmedAt: new Date(),
              },
            });
          } else {
            await this.prisma.workspaceMemory.create({
              data: {
                workspaceId,
                type: fact.type,
                content: fact.content,
                confidence: fact.confidence || 0.75,
                sourceRunId: `agent:${agentId}`,
                createdById: userId,
                status: "active",
              },
            });
          }
        } else {
          // Fallback to user memory
          const existing = await this.prisma.userMemory.findFirst({
            where: {
              userId,
              content: { contains: fact.content.substring(0, 50) },
              status: "active",
            },
          });

          if (existing) {
            await this.prisma.userMemory.update({
              where: { id: existing.id },
              data: {
                confidence: Math.min(1, existing.confidence + 0.1),
                lastConfirmedAt: new Date(),
              },
            });
          } else {
            await this.prisma.userMemory.create({
              data: {
                userId,
                type: fact.type,
                content: fact.content,
                confidence: fact.confidence || 0.75,
                sourceConversationId: `agent:${agentId}`,
                status: "active",
              },
            });
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Memory extraction failed: ${err.message}`);
    }
  }

  async storeExplicit(
    agentId: string,
    userId: string,
    fact: string,
    type: string,
    channelId?: string,
  ): Promise<void> {
    // Resolve workspace: first try via channel, then via agent
    let workspaceId: string | null = null;

    if (channelId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { channelId },
        select: { id: true },
      });
      workspaceId = workspace?.id ?? null;
    }

    if (!workspaceId) {
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: { workspaceId: true },
      });
      workspaceId = agent?.workspaceId ?? null;
    }

    this.logger.log(
      `[storeExplicit] agentId=${agentId} userId=${userId} channelId=${channelId ?? "null"} workspaceId=${workspaceId ?? "null"} type=${type} fact="${fact.slice(0, 100)}"`,
    );

    if (workspaceId) {
      // Store as workspace memory (shared across all agents in the workspace)
      await this.prisma.workspaceMemory.create({
        data: {
          workspaceId,
          type,
          content: fact,
          confidence: 1.0,
          sourceRunId: `agent:${agentId}`,
          createdById: userId,
          status: "active",
        },
      });
      this.logger.log(`[storeExplicit] Stored workspace memory successfully`);
    } else {
      // Fallback to user memory for standalone agents without a workspace
      await this.prisma.userMemory.create({
        data: {
          userId,
          type,
          content: fact,
          confidence: 1.0,
          sourceConversationId: `agent:${agentId}`,
          status: "active",
        },
      });
      this.logger.log(`[storeExplicit] Stored user memory successfully`);
    }
  }
}
