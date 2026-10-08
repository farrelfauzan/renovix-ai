import { Injectable, Logger } from "@nestjs/common";
import { UserMemoryService } from "./user-memory.service";
import { MemoryPolicyService } from "./memory-policy.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderRouter } from "../providers/provider-router";
import { ModelRegistryService } from "../config/model-registry.service";

interface ChatMessage {
  role: string;
  content: string;
}

interface ExtractedFact {
  type: "interest" | "preference" | "context" | "exclusion";
  content: string;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Analyze the user's messages in this conversation and extract stable, long-term facts about the user.

Rules:
- Only extract facts explicitly stated or strongly implied by the USER (not the assistant).
- Ignore greetings, jokes, small talk, one-off questions, and transient details.
- Focus on: interests, preferences, identity/context, and exclusions.
- Each fact must be a concise single sentence.
- Assign confidence 0.55-1.0 based on how explicitly stated the fact is.
- Return an empty array if no meaningful facts are found.

Categories:
- "interest": topics, domains, technologies the user cares about
- "preference": how the user wants responses (tone, format, style)
- "context": role, project, stack, background (non-sensitive)
- "exclusion": things the user explicitly does NOT want stored or assumed

Respond ONLY with a JSON array. No other text.
Example: [{"type":"interest","content":"Focuses on fintech products","confidence":0.85}]`;

@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);

  constructor(
    private readonly memoryService: UserMemoryService,
    private readonly policyService: MemoryPolicyService,
    private readonly prisma: PrismaService,
    private readonly providerRouter: ProviderRouter,
    private readonly modelRegistry: ModelRegistryService,
  ) {}

  /**
   * Extract memory facts from a conversation.
   * Called fire-and-forget after conversation is saved.
   */
  async extract(userId: string, conversationId: string): Promise<void> {
    console.log(
      `Starting memory extraction for conversation ${conversationId} of user ${userId}`,
    );
    try {
      // Check eligibility: user must have topped up at least once
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          balance: true,
          transactions: {
            take: 1,
            where: { type: "topup", status: "success" },
          },
        },
      });

      if (!user || user.transactions.length === 0) {
        this.logger.debug(
          `Skipping extraction: user ${userId} never topped up`,
        );
        return;
      }

      // Check 5-conversation window
      const isWithinWindow = await this.isConversationInWindow(
        userId,
        conversationId,
      );
      if (!isWithinWindow) {
        this.logger.debug(
          `Skipping extraction: conversation ${conversationId} outside 5-window`,
        );
        return;
      }

      // Load conversation messages
      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      });

      // Must have at least 2 user messages to qualify
      const userMessages = messages.filter((m) => m.role === "user");
      if (userMessages.length < 2) {
        this.logger.debug(
          `Skipping extraction: conversation ${conversationId} has fewer than 2 user messages`,
        );
        return;
      }

      // Call LLM for extraction
      const facts = await this.callExtractionLLM(messages);

      if (facts.length === 0) {
        this.logger.debug(
          `No facts extracted from conversation ${conversationId}`,
        );
        return;
      }

      // Process and store each fact
      let stored = 0;
      for (const fact of facts) {
        const wasStored = await this.processFact(userId, fact, conversationId);
        if (wasStored) stored++;
      }

      this.logger.log(
        `Extracted ${stored} memories from conversation ${conversationId} for user ${userId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Memory extraction failed for conversation ${conversationId}: ${err.message}`,
        err.stack,
      );
    }
  }

  private async isConversationInWindow(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    // Get latest 5 qualifying conversations (at least 2 user messages)
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 20, // fetch more to filter
      select: {
        id: true,
        _count: { select: { messages: { where: { role: "user" } } } },
      },
    });

    const qualifying = conversations
      .filter((c) => c._count.messages >= 2)
      .slice(0, 5);

    return qualifying.some((c) => c.id === conversationId);
  }

  private async callExtractionLLM(
    messages: ChatMessage[],
  ): Promise<ExtractedFact[]> {
    // Build a condensed version of user messages for extraction
    const userContent = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n---\n");

    const model = await this.modelRegistry.getCheapestModel("standard");
    if (!model) {
      this.logger.warn(
        "Skipping memory extraction: no active standard-tier model",
      );
      return [];
    }

    const response = await this.providerRouter.chat("openrouter", {
      model: model.slug,
      providerId: model.providerId,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Extract memory facts from these user messages:\n\n${userContent}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) return [];

    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonStr = content.replace(/^```json?\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (item: any) =>
          item &&
          typeof item.type === "string" &&
          typeof item.content === "string" &&
          typeof item.confidence === "number" &&
          ["interest", "preference", "context", "exclusion"].includes(
            item.type,
          ) &&
          item.confidence >= 0.55 &&
          item.confidence <= 1.0,
      );
    } catch {
      // The model output may contain user facts: log its size only.
      this.logger.warn(
        `Failed to parse extraction response (${content.length} chars)`,
      );
      return [];
    }
  }

  private async processFact(
    userId: string,
    fact: ExtractedFact,
    conversationId: string,
  ): Promise<boolean> {
    // Policy check
    const policyResult = this.policyService.validateMemoryCandidate(
      fact.content,
    );
    if (!policyResult.allowed) {
      this.logger.debug(
        `Rejected memory candidate: ${policyResult.reason} — "${fact.content}"`,
      );
      return false;
    }

    // Deduplication check
    const duplicate = await this.memoryService.findDuplicate(
      userId,
      fact.content,
      fact.type,
    );
    if (duplicate) {
      // Update confidence/confirmation of existing memory
      await this.memoryService.confirmMemory(userId, duplicate.id);
      this.logger.debug(
        `Deduplicated memory: confirmed existing ${duplicate.id}`,
      );
      return false;
    }

    // Archive conflicting memories (e.g., user changed stack)
    await this.memoryService.archiveConflicting(
      userId,
      fact.content,
      fact.type,
    );

    // Store only if confidence >= 0.75 as active
    const status = fact.confidence >= 0.75 ? "active" : "archived";

    await this.memoryService.create(userId, {
      type: fact.type,
      content: fact.content,
      confidence: fact.confidence,
      sourceConversationId: conversationId,
    });

    return status === "active";
  }
}
