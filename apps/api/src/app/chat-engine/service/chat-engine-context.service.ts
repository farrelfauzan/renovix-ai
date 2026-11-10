import { Injectable } from "@nestjs/common";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { CHAT_ENGINE_KNOWLEDGE_TOP_K_PER_BASE } from "../config/chat-engine.config";
import type { ChatContextRequest } from "../types/chat-context-request";
import type { ChatEngineContext } from "../types/chat-engine-context";

/**
 * RNX-281: builds the run's context from what the runner is permitted to read only: the memory of the run's scope
 * (AgentMemoryService: no workspace memory outside the workspace, R17), the knowledge bases the runner may search
 * (WorkspaceKnowledgeService.canSearchKnowledgeBase, checked before any embedding call) and the tools the agent offers.
 */
@Injectable()
export class ChatEngineContextService {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly knowledgeBases: KnowledgeBaseRepository,
    private readonly workspaceKnowledge: WorkspaceKnowledgeService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** The context for this runner and scope; a base the runner may not search adds nothing and a failing base is skipped. */
  async buildContext(request: ChatContextRequest): Promise<ChatEngineContext> {
    const memory = await this.memory.getMemoryContext(request.agentId, request.runnerUserId, request.scope);
    const chunks: string[] = [];
    for (const knowledgeBaseId of request.knowledgeBaseIds) {
      chunks.push(...(await this.searchBase(request.runnerUserId, knowledgeBaseId, request.query)));
    }
    return { scope: request.scope, memory, knowledge: chunks.join("\n\n---\n\n"), offeredTools: request.offeredTools };
  }

  /** One base's chunk texts for this runner, or none when they may not search it or the search fails. */
  private async searchBase(runnerUserId: string, knowledgeBaseId: string, query: string): Promise<string[]> {
    const base = await this.knowledgeBases.findKnowledgeBaseById(knowledgeBaseId);
    if (!base || !(await this.workspaceKnowledge.canSearchKnowledgeBase(runnerUserId, base))) return [];
    try {
      const results = base.workspaceId
        ? await this.workspaceKnowledge.searchKnowledgeBase(base.id, query, CHAT_ENGINE_KNOWLEDGE_TOP_K_PER_BASE)
        : await this.knowledge.searchChunks(runnerUserId, query, { knowledgeBaseId: base.id, topK: CHAT_ENGINE_KNOWLEDGE_TOP_K_PER_BASE });
      return results.map((result) => result.content);
    } catch {
      return [];
    }
  }
}
