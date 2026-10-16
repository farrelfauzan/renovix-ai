import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { extractRecentUserMessages } from "../utils/extract-recent-user-messages";
import { scoreTemplateForText } from "../utils/score-template-for-text";

export interface PromptTemplate {
  slug: string;
  name: string;
  content: string;
  keywords: string[];
  priority: number;
  outputFormat: string | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

@Injectable()
export class PromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);

  private cachedTemplates: PromptTemplate[] = [];
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  private async getTemplates(): Promise<PromptTemplate[]> {
    const now = Date.now();

    if (this.cachedTemplates.length > 0 && now < this.cacheExpiresAt) {
      return this.cachedTemplates;
    }

    const templates = await this.prisma.promptTemplate.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
    });

    this.cachedTemplates = templates.map((t) => ({
      slug: t.slug,
      name: t.name,
      content: t.content,
      keywords: t.keywords,
      priority: t.priority,
      outputFormat: t.outputFormat,
    }));
    this.cacheExpiresAt = now + this.cacheTtlMs;

    this.logger.debug(
      `Loaded ${templates.length} active prompt template(s) from DB`,
    );

    return this.cachedTemplates;
  }

  /**
   * Scores each template against the user's text using keyword matching.
   * Returns the best matching template, or null if no template has any match.
   */
  async classify(messages: ChatMessage[]): Promise<PromptTemplate | null> {
    const templates = await this.getTemplates();

    if (templates.length === 0) {
      return null;
    }

    const recentUserMessages = extractRecentUserMessages(messages);
    if (recentUserMessages.length === 0) {
      return null;
    }

    // Hard-prioritize latest-turn document template matches.
    const latestUserText = recentUserMessages[recentUserMessages.length - 1];
    let latestBestDocumentTemplate: PromptTemplate | null = null;
    let latestBestDocumentScore = 0;

    for (const template of templates) {
      if (!template.outputFormat) {
        continue;
      }

      const score = scoreTemplateForText(template, latestUserText);
      const finalScore = score * 100 + template.priority;

      if (score > 0 && finalScore > latestBestDocumentScore) {
        latestBestDocumentScore = finalScore;
        latestBestDocumentTemplate = template;
      }
    }

    if (latestBestDocumentTemplate) {
      this.logger.debug(
        `Classified intent as "${latestBestDocumentTemplate.slug}" via latest-turn document template match (score: ${latestBestDocumentScore})`,
      );
      return latestBestDocumentTemplate;
    }

    // Otherwise, prioritize any latest-turn template match.
    let latestBestTemplate: PromptTemplate | null = null;
    let latestBestScore = 0;

    for (const template of templates) {
      const score = scoreTemplateForText(template, latestUserText);
      const finalScore = score * 100 + template.priority;

      if (score > 0 && finalScore > latestBestScore) {
        latestBestScore = finalScore;
        latestBestTemplate = template;
      }
    }

    if (latestBestTemplate) {
      this.logger.debug(
        `Classified intent as "${latestBestTemplate.slug}" via latest user-message keyword match (score: ${latestBestScore})`,
      );
      return latestBestTemplate;
    }

    let bestTemplate: PromptTemplate | null = null;
    let bestScore = 0;

    for (const template of templates) {
      // Document-export templates should only be triggered by latest-turn intent,
      // not carried over from prior messages.
      if (template.outputFormat) {
        continue;
      }

      let score = 0;

      // Recency weighted keyword scoring (latest message has strongest influence)
      for (let i = 0; i < recentUserMessages.length; i++) {
        const text = recentUserMessages[i];
        const recencyWeight = i + 1; // oldest=1 ... newest=3

        score += scoreTemplateForText(template, text) * recencyWeight;
      }

      // Use priority as tiebreaker
      const finalScore = score * 100 + template.priority;

      if (score > 0 && finalScore > bestScore) {
        bestScore = finalScore;
        bestTemplate = template;
      }
    }

    if (bestTemplate) {
      this.logger.debug(
        `Classified intent as "${bestTemplate.slug}" (score: ${bestScore})`,
      );
    }

    return bestTemplate;
  }
}
