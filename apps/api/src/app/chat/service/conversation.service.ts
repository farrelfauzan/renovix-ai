import { Injectable, Logger } from "@nestjs/common";
import { ConversationRepository } from "../repository/conversation.repository";
import { MessageRepository } from "../repository/message.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import {
  DocumentService,
  type DocumentResult,
} from "../../document/service/document.service";
import { buildFallbackTitle } from "../utils/build-fallback-title";
import { normalizeTitle } from "../utils/normalize-title";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface SavedDocumentMetadata {
  format: string;
  filename: string;
  key: string;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly providerRouter: ProviderRouter,
    private readonly registry: ModelRegistryService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Creates a new conversation or returns an existing one.
   * If conversationId is provided, validates ownership and returns it.
   * Otherwise creates a new conversation.
   */
  async getOrCreateConversation(
    userId: string,
    model: string,
    conversationId?: string,
  ): Promise<string> {
    if (conversationId) {
      const existing = await this.conversations.findUserConversation(
        conversationId,
        userId,
      );

      if (existing) {
        return existing.id;
      }

      this.logger.warn(
        `Conversation ${conversationId} not found for user ${userId}, creating new`,
      );
    }

    const conversation = await this.conversations.createConversation(
      userId,
      model,
    );

    return conversation.id;
  }

  /**
   * Saves user and assistant messages to the conversation.
   */
  async saveMessages(
    conversationId: string,
    userMessages: ChatMessage[],
    assistantContent: string,
    document?: SavedDocumentMetadata,
  ): Promise<void> {
    const data = [
      // Save only the latest user message (not the full history they sent)
      ...userMessages
        .filter((m) => m.role === "user")
        .slice(-1)
        .map((m) => ({
          conversationId,
          role: m.role,
          content: m.content,
        })),
      {
        conversationId,
        role: "assistant" as const,
        content: assistantContent,
        documentFormat: document?.format,
        documentFilename: document?.filename,
        documentKey: document?.key,
      },
    ];

    await this.messages.createMessages(data);
  }

  /**
   * Generates a short title for the conversation using the AI model,
   * based on the assistant response. Runs async (fire-and-forget).
   */
  async generateTitle(
    conversationId: string,
    assistantResponse: string,
  ): Promise<void> {
    if (!assistantResponse?.trim()) {
      return;
    }

    try {
      // Try cheaper models first, then fall back to deterministic local title.
      const models = (await this.registry.getAllModels()).sort(
        (a, b) => a.inputPrice.toNumber() - b.inputPrice.toNumber(),
      );

      let title: string | undefined;

      for (const model of models) {
        try {
          const response = await this.providerRouter.chat(model.provider, {
            model: model.slug,
            providerId: model.providerId,
            messages: [
              {
                role: "system",
                content:
                  "Generate a short, concise title (max 6 words) for a conversation based on the following AI assistant response. Return ONLY the title text, nothing else. No quotes, no punctuation at the end.",
              },
              {
                role: "user",
                content: assistantResponse.slice(0, 500),
              },
            ],
            temperature: 0.3,
            max_tokens: 30,
          });

          title = response.choices[0]?.message?.content?.trim();
          if (title) {
            break;
          }
        } catch (error: any) {
          this.logger.warn(
            `Title generation failed with ${model.slug}: ${error.message}`,
          );
        }
      }

      if (!title) {
        title = buildFallbackTitle(assistantResponse);
      }

      const normalizedTitle = normalizeTitle(title);

      if (normalizedTitle) {
        await this.conversations.updateConversationTitle(
          conversationId,
          normalizedTitle,
        );

        this.logger.debug(
          `Generated title for conversation ${conversationId}: "${normalizedTitle}"`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to generate title for conversation ${conversationId}: ${error.message}`,
      );
    }
  }

  /**
   * Lists conversations for a user, ordered by most recent activity.
   */
  async listConversations(userId: string, limit = 20, offset = 0) {
    const [conversations, total] = await Promise.all([
      this.conversations.listUserConversations(userId, offset, limit),
      this.conversations.countUserConversations(userId),
    ]);

    return { conversations, total };
  }

  /**
   * Retrieves a single conversation with all its messages.
   */
  async getConversation(conversationId: string, userId: string) {
    const conversation =
      await this.conversations.findUserConversationWithMessages(
        conversationId,
        userId,
      );

    if (!conversation) {
      return null;
    }

    const messages = await Promise.all(
      conversation.messages.map(async (message) => {
        let document: DocumentResult | undefined;

        if (
          message.documentFormat &&
          message.documentFilename &&
          message.documentKey
        ) {
          try {
            document = await this.documentService.getDocumentFromStorage({
              format: message.documentFormat,
              filename: message.documentFilename,
              key: message.documentKey,
            });
          } catch (error: any) {
            this.logger.warn(
              `Failed to rehydrate document for message ${message.id}: ${error.message}`,
            );
          }
        }

        return {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          ...(document ? { document } : {}),
        };
      }),
    );

    return {
      ...conversation,
      messages,
    };
  }

  /**
   * Deletes a conversation and all its messages (cascade).
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const conversation = await this.conversations.findUserConversation(
      conversationId,
      userId,
    );

    if (!conversation) {
      return false;
    }

    await this.conversations.deleteConversation(conversationId);

    return true;
  }
}
