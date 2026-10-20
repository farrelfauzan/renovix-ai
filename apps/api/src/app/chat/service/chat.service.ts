import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import { tokensFromUsage } from "../../billing/utils/tokens-from-usage";
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
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly credits: CreditService,
    private readonly providerRouter: ProviderRouter,
    private readonly usage: UsageService,
    private readonly registry: ModelRegistryService,
    private readonly promptTuning: PromptTuningService,
    private readonly conversation: ConversationService,
    private readonly documentService: DocumentService,
  ) {}

  async createCompletion(body: ChatCompletionRequest, user: AuthenticatedUser) {
    const startTime = Date.now();

    // 1. Resolve the slug to its provider record (RX-178): an unresolvable model is a 400, nothing reserved.
    const connection = await this.registry.resolveConnection(body.model);
    const modelConfig = await this.registry.getModel(body.model);
    if (!modelConfig) {
      const available = await this.registry.getAllModels();
      throw new BadRequestException(
        `Model "${body.model}" is not supported. Available models: ${available.map((m) => m.slug).join(", ")}`,
      );
    }

    // 2. The tier's credit rates (RX-21), not price x multiplier.
    const tierRates = await this.registry.getTierRates(modelConfig.tier);
    if (!tierRates) {
      throw new BadRequestException(
        `No credit rates found for tier "${modelConfig.tier}"`,
      );
    }
    const rates = callRatesOf(tierRates);

    // 3. M is the max_tokens the adapter will send. RX-22 review B1: refuse with 402 before any paid work (tuning
    // embeds the query for the knowledge searches) when the paid wallet cannot cover the estimate of the untuned
    // prompt, a lower bound (tuning only adds content).
    const maxTokens = this.providerRouter.resolveMaxTokens({
      connection,
      max_tokens: body.max_tokens,
    });
    await this.credits.assertAvailable(
      user.id,
      estimateCallCredits(countPromptTokens(body.messages), maxTokens, rates),
    );

    // 4. Apply prompt tuning (inject system prompt), then reserve the estimate of the prompt actually sent
    // (docs/credits.md section 3.1): 402 CREDITS_EXHAUSTED when the paid wallet cannot cover it.
    const { tunedMessages, matchedTemplate } =
      await this.promptTuning.applyTuning(body.messages, user.id);
    const requestId = randomUUID();
    const reservation = await this.credits.reserve({
      userId: user.id,
      requestId,
      amount: estimateCallCredits(countPromptTokens(tunedMessages), maxTokens, rates),
    });
    const call = {
      reservationId: reservation.id,
      memberUserId: user.id,
      requestId,
      callId: randomUUID(),
      modelId: modelConfig.slug,
      tier: modelConfig.tier,
      rates,
    };

    // 5. Call provider
    let providerResponse;
    try {
      providerResponse = await this.providerRouter.chat({
        model: body.model,
        connection,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
    } catch (error: any) {
      // A provider error is charged 0 and releases the hold (docs/credits.md section 3.1 rule 6).
      await this.credits.finishCall({ ...call, tokens: tokensFromUsage(0, 0, 0), outcome: "provider_error" });
      this.logger.error(`Provider call failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        "Failed to get response from model provider. No credits were charged.",
      );
    }

    const latencyMs = Date.now() - startTime;

    // 6. One usage entry from the provider's reported tokens (cached input at the cached rate), then settle.
    const { usage } = providerResponse;
    const entry = await this.credits.finishCall({
      ...call,
      tokens: tokensFromUsage(usage.prompt_tokens, usage.cachedTokens ?? 0, usage.completion_tokens),
      outcome: "completed",
    });
    const actualCost = entry.amount.negated();

    // 8. Log usage (async — don't block response)
    this.usage
      .logUsage({
        userId: user.id,
        model: body.model,
        inputTokens: providerResponse.usage.prompt_tokens,
        outputTokens: providerResponse.usage.completion_tokens,
        cost: actualCost,
        latencyMs,
        provider: connection.providerName,
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
