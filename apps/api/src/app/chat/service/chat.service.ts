import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import type { Decimal } from "@prisma/client/runtime/client";
import { ModelRegistryService } from "../../config/model-registry.service";
import { BillingService } from "../../billing/service/billing.service";
import { estimateTokens } from "../../billing/utils/estimate-tokens";
import { estimateCost } from "../../billing/utils/estimate-cost";
import { calculateActualCost } from "../../billing/utils/calculate-actual-cost";
import { ProviderRouter } from "../../providers/provider-router";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "./prompt-tuning.service";
import { ConversationService } from "./conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { ChatCompletionRequest } from "../dto/chat-completion.dto";
import { buildDocumentResponseText } from "../utils/build-document-response-text";

interface AuthenticatedUser {
  id: string;
  email: string;
  balance: Decimal;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly billing: BillingService,
    private readonly providerRouter: ProviderRouter,
    private readonly usage: UsageService,
    private readonly registry: ModelRegistryService,
    private readonly promptTuning: PromptTuningService,
    private readonly conversation: ConversationService,
    private readonly documentService: DocumentService,
  ) {}

  async createCompletion(body: ChatCompletionRequest, user: AuthenticatedUser) {
    const startTime = Date.now();

    // 1. Validate model exists
    const modelConfig = await this.registry.getModel(body.model);
    if (!modelConfig) {
      const available = await this.registry.getAllModels();
      throw new BadRequestException(
        `Model "${body.model}" is not supported. Available models: ${available.map((m) => m.slug).join(", ")}`,
      );
    }

    // 2. Estimate cost — the tier's per-token credit rate (RX-21), not price x multiplier.
    const tierRates = await this.registry.getTierRates(modelConfig.tier);
    if (!tierRates) {
      throw new BadRequestException(
        `No credit rates found for tier "${modelConfig.tier}"`,
      );
    }
    const estimatedTokens = estimateTokens(body.messages);
    const estimatedCost = estimateCost(
      estimatedTokens,
      tierRates.inputCreditsPerToken.toNumber(),
    );

    // 3. Reserve credits (atomic balance check + deduction)
    let reservedAmount: Decimal;
    try {
      reservedAmount = await this.billing.reserveCredits(
        user.id,
        estimatedCost,
      );
    } catch {
      throw new BadRequestException(
        "Insufficient balance. Please top up your account.",
      );
    }

    // 4. Apply prompt tuning (inject system prompt)
    const { tunedMessages, matchedTemplate } =
      await this.promptTuning.applyTuning(body.messages, user.id);

    // 5. Call provider
    let providerResponse;
    try {
      providerResponse = await this.providerRouter.chat(modelConfig.provider, {
        model: body.model,
        providerId: modelConfig.providerId,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
    } catch (error: any) {
      // Refund on provider failure
      await this.billing.refundReservation(user.id, reservedAmount);
      this.logger.error(`Provider call failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        "Failed to get response from model provider. Your balance has been refunded.",
      );
    }

    const latencyMs = Date.now() - startTime;

    // 6. Calculate actual cost — tier credit rates (RX-21). The adapter's usage shape does not
    // surface the provider's cached-token count today, so cached input is priced as input; when
    // the adapter reports cachedTokens, they are priced at the tier's cached rate.
    const actualCost = calculateActualCost(
      providerResponse.usage.prompt_tokens,
      providerResponse.usage.completion_tokens,
      tierRates.inputCreditsPerToken.toNumber(),
      tierRates.outputCreditsPerToken.toNumber(),
    );

    // 7. Adjust balance (refund difference)
    await this.billing.adjustBalance(user.id, reservedAmount, actualCost);

    // 8. Log usage (async — don't block response)
    this.usage
      .logUsage({
        userId: user.id,
        model: body.model,
        inputTokens: providerResponse.usage.prompt_tokens,
        outputTokens: providerResponse.usage.completion_tokens,
        cost: actualCost,
        latencyMs,
        provider: modelConfig.provider,
      })
      .catch((err) => this.logger.error("Failed to log usage", err));

    // 9. Save chat history only when store=true (web chat)
    let conversationId: string | undefined;

    // 10. Generate document if output_format detected
    const assistantMarkdown =
      providerResponse.choices[0]?.message?.content ?? "";
    const outputFormat =
      body.output_format || matchedTemplate?.outputFormat || null;
    let document:
      | {
          format: string;
          url: string;
          filename: string;
          expiresAt: string;
          key: string;
        }
      | undefined;

    if (outputFormat && assistantMarkdown) {
      try {
        document = await this.documentService.generateWithStorage(
          assistantMarkdown,
          outputFormat,
        );
      } catch (err: any) {
        this.logger.error(
          `Document generation failed: ${err.message}`,
          err.stack,
        );
      }
    }

    if (body.store) {
      conversationId = await this.conversation.getOrCreateConversation(
        user.id,
        body.model,
        body.conversation_id,
      );

      const assistantContent = document
        ? buildDocumentResponseText(document)
        : assistantMarkdown;

      this.conversation
        .saveMessages(
          conversationId,
          body.messages,
          assistantContent,
          document
            ? {
                format: document.format,
                filename: document.filename,
                key: document.key,
              }
            : undefined,
        )
        .catch((err) => this.logger.error("Failed to save chat history", err));

      // Generate title for new conversations based on first assistant response
      if (!body.conversation_id && assistantContent) {
        this.conversation
          .generateTitle(conversationId, assistantContent)
          .catch((err) =>
            this.logger.error("Failed to generate conversation title", err),
          );
      }
    }

    const documentResponse = document
      ? {
          format: document.format,
          url: document.url,
          filename: document.filename,
          expiresAt: document.expiresAt,
        }
      : undefined;

    // 11. Return response
    return {
      id: providerResponse.id,
      object: "chat.completion",
      model: body.model,
      ...(conversationId && { conversation_id: conversationId }),
      ...(documentResponse && { document: documentResponse }),
      choices: providerResponse.choices,
      usage: {
        prompt_tokens: providerResponse.usage.prompt_tokens,
        completion_tokens: providerResponse.usage.completion_tokens,
        total_tokens: providerResponse.usage.total_tokens,
      },
    };
  }
}
