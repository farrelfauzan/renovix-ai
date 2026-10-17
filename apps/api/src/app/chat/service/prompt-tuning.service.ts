import { Injectable, Logger } from "@nestjs/common";
import { SystemPromptRepository } from "../repository/system-prompt.repository";
import { PromptTemplateService } from "./prompt-template.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UserMemoryService } from "../../memory/service/user-memory.service";
import { formatMemoryContext } from "../utils/format-memory-context";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MatchedTemplate {
  slug: string;
  name: string;
  outputFormat: string | null;
}

interface TemplateWithContent extends MatchedTemplate {
  content: string;
}

export interface TuningResult {
  tunedMessages: ChatMessage[];
  matchedTemplate: MatchedTemplate | null;
}

@Injectable()
export class PromptTuningService {
  private readonly logger = new Logger(PromptTuningService.name);

  private cachedPrompt: string | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs = 60_000; // 60 seconds

  constructor(
    private readonly systemPrompts: SystemPromptRepository,
    private readonly promptTemplate: PromptTemplateService,
    private readonly systemKnowledge: SystemKnowledgeService,
    private readonly knowledgeService: KnowledgeService,
    private readonly userMemory: UserMemoryService,
  ) {}

  /**
   * Fetches all active system prompts from DB, ordered by priority desc,
   * and concatenates them into one string. Cached for 60s.
   */
  private async getSystemPrompt(): Promise<string | null> {
    const now = Date.now();

    if (this.cachedPrompt !== null && now < this.cacheExpiresAt) {
      return this.cachedPrompt;
    }

    const prompts = await this.systemPrompts.listActiveSystemPrompts();

    if (prompts.length === 0) {
      this.cachedPrompt = null;
      this.cacheExpiresAt = now + this.cacheTtlMs;
      return null;
    }

    this.cachedPrompt = prompts.map((p) => p.content).join("\n\n");
    this.cacheExpiresAt = now + this.cacheTtlMs;

    this.logger.debug(
      `Loaded ${prompts.length} active system prompt(s) from DB`,
    );

    return this.cachedPrompt;
  }

  /**
   * Builds the full system prompt by combining:
   * 1. Base system prompt (global, from SystemPrompt table)
   * 2. Category-specific template (from PromptTemplate table, matched by intent)
   * Returns both the prompt string and the matched template (if any).
   */
  private async buildSystemPrompt(messages: ChatMessage[]): Promise<{
    prompt: string | null;
    matchedTemplate: TemplateWithContent | null;
  }> {
    const [basePrompt, template] = await Promise.all([
      this.getSystemPrompt(),
      this.promptTemplate.classify(messages),
    ]);

    if (!basePrompt && !template) {
      return { prompt: null, matchedTemplate: null };
    }

    const parts: string[] = [];

    if (basePrompt) {
      parts.push(basePrompt);
    }

    if (template) {
      parts.push(`[${template.name} Mode]\n${template.content}`);

      if (template.outputFormat) {
        parts.push(
          `[Document Output Rules]\nYour next reply will be converted directly into a ${template.outputFormat.toUpperCase()} file.\n- Return only the actual document content in Markdown.\n- Do not write confirmation/meta text like "I've generated your document".\n- Do not explain what you are doing.\n- Start with a clear title heading and include concrete sections/tables/lists as needed.`,
        );
      }
    }

    const matchedTemplate = template
      ? {
          slug: template.slug,
          name: template.name,
          outputFormat: template.outputFormat,
          content: template.content,
        }
      : null;

    return { prompt: parts.join("\n\n"), matchedTemplate };
  }

  /**
   * Injects the system prompt into the messages array.
   * - Combines the base system prompt with a category-specific template
   *   matched from the user's message intent.
   * - Retrieves relevant system knowledge base context via vector search.
   * - If user already has a system message, prepends our prompt to it.
   * - Otherwise inserts a new system message at index 0.
   * Returns a new array (does not mutate the original).
   */
  async applyTuning(
    messages: ChatMessage[],
    userId?: string,
  ): Promise<TuningResult> {
    // Extract the latest user message for RAG query
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");

    const [
      { prompt: systemPrompt, matchedTemplate },
      ragChunks,
      userRagChunks,
      userMemories,
    ] = await Promise.all([
      this.buildSystemPrompt(messages),
      lastUserMsg
        ? this.systemKnowledge.searchSystemKB(lastUserMsg.content)
        : Promise.resolve([]),
      lastUserMsg && userId
        ? this.knowledgeService
            .searchChunks(userId, lastUserMsg.content, { topK: 5 })
            .catch((err) => {
              this.logger.error(`Failed to search user KB: ${err.message}`);
              return [];
            })
        : Promise.resolve([]),
      userId
        ? this.userMemory.getRelevantMemories(userId, 8).catch((err) => {
            this.logger.error(`Failed to retrieve user memory: ${err.message}`);
            return [];
          })
        : Promise.resolve([]),
    ]);

    // Build the full context
    const parts: string[] = [];

    if (systemPrompt) {
      parts.push(systemPrompt);
    }

    if (ragChunks.length > 0) {
      const context = ragChunks.map((c) => c.content).join("\n\n---\n\n");
      parts.push(
        `[Relevant Knowledge]\nUse the following context to answer the user's question if relevant:\n\n${context}`,
      );
    }

    if (userRagChunks.length > 0) {
      const userContext = userRagChunks
        .filter((c) => c.similarity > 0.3)
        .map((c) => c.content)
        .join("\n\n---\n\n");
      if (userContext) {
        parts.push(
          `[User's Knowledge Base]\nThe user has provided the following reference documents. Use this context to answer their question if relevant:\n\n${userContext}`,
        );
      }
    }

    if (userMemories.length > 0) {
      const memoryLines = formatMemoryContext(userMemories);
      if (memoryLines) {
        parts.push(memoryLines);
      }
    }

    if (parts.length === 0) {
      return { tunedMessages: messages, matchedTemplate };
    }

    const fullPrompt = parts.join("\n\n");
    const result = [...messages];
    const systemIndex = result.findIndex((m) => m.role === "system");

    if (systemIndex !== -1) {
      // Merge: our prompt first, then user's system prompt
      result[systemIndex] = {
        ...result[systemIndex],
        content: `${fullPrompt}\n\n${result[systemIndex].content}`,
      };
    } else {
      // Insert system message at the beginning
      result.unshift({
        role: "system",
        content: fullPrompt,
      });
    }

    return { tunedMessages: result, matchedTemplate };
  }
}
