import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { CreditCallOutcome, CreditLedgerEntry } from "@generated/prisma/client.js";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import { tokensFromUsage } from "../../billing/utils/tokens-from-usage";
import { promptText } from "../../billing/utils/prompt-text";
import { streamedCallTokens } from "../../billing/utils/streamed-call-tokens";
import type { UsageRecord } from "../../billing/types/usage-record";
import { ProviderRouter } from "../../providers/provider-router";
import type { ChatRequest, ChatUsage } from "../../providers/provider.interface";
import type { ServedBy } from "../../providers/types/served-by";
import type { CallHooks } from "../../providers/types/call-hooks";
import { failedAttemptRecord } from "../../billing/utils/failed-attempt-record";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";
import { ProviderStreamError } from "../../providers/errors/provider-stream-error";
import { ProviderTimeoutError } from "../../providers/errors/provider-timeout-error";
import { toProviderErrorText } from "../../../common/utils/to-provider-error-text";
import { streamedCallOutcome } from "../../portal/utils/streamed-call-outcome";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "./prompt-tuning.service";
import { ConversationService } from "./conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { ApiChatCompletionRequest, ChatCompletionRequest } from "../dto/chat-completion.dto";
import { buildDocumentResponseText } from "../utils/build-document-response-text";
import { completionChunk } from "../utils/completion-chunk";
import { completionUsageOf } from "../utils/completion-usage-of";
import { readCompletionDelta } from "../utils/read-completion-delta";

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
    const { connection, request, matchedTemplate, call } = await this.openCall(body, user);

    // 5. Call provider. RNX-179: each attempt that falls over to a fallback model is its own provider_error entry
    // (rule 6); the call's entry below names the last model tried (the one that answered or failed).
    let attempt: ServedBy = connection;
    let providerResponse;
    try {
      providerResponse = await this.providerRouter.chat(request, this.attemptHooks(call, (tried) => (attempt = tried)));
    } catch (error: any) {
      // A provider error is charged 0 and releases the hold (docs/credits.md section 3.1 rule 6).
      await this.credits.finishCall({
        ...call,
        modelId: attempt.slug,
        tokens: tokensFromUsage(0, 0, 0),
        outcome: "provider_error",
        cost: { servedBy: attempt },
      });
      this.logger.error(`Provider call failed: ${error.message}`, error.stack);
      // RNX-190 (D199): a typed upstream error gives the client its fixed text; the status code stays 500.
      const isTyped = error instanceof ProviderHttpError || error instanceof ProviderTimeoutError;
      throw new InternalServerErrorException(
        `${isTyped ? error.message : "Failed to get response from model provider"}. No credits were charged.`,
      );
    }

    const latencyMs = Date.now() - startTime;

    // 6. One usage entry from the provider's reported tokens (cached input at the cached rate), then settle.
    const { usage } = providerResponse;
    const entry = await this.credits.finishCall({
      ...call,
      modelId: attempt.slug,
      tokens: tokensFromUsage(usage.prompt_tokens, usage.cachedTokens ?? 0, usage.completion_tokens),
      outcome: "completed",
      cost: { servedBy: attempt, usage },
    });
    const actualCost = entry.amount.negated();

    // 8. Log usage (async — don't block response): the model and provider that answered (RNX-179: a fallback after a
    // 502/503), charged above at the requested model's rates (D149).
    this.usage
      .logUsage({
        userId: user.id,
        model: attempt.slug,
        inputTokens: providerResponse.usage.prompt_tokens,
        outputTokens: providerResponse.usage.completion_tokens,
        cost: actualCost,
        latencyMs,
        provider: attempt.providerName,
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
      conversationId = await this.storeConversation(body, user.id, {
        content: document ? buildDocumentResponseText(document) : assistantMarkdown,
        document: document && { format: document.format, filename: document.filename, key: document.key },
      });
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

  /**
   * The streamed answer of POST /chat/completions (RNX-196, docs/credits.md section 3.1). Every 400 and 402 comes from
   * `openCall`, before the SSE headers. Then OpenAI `chat.completion.chunk` events end with `data: [DONE]` (with
   * `stream_options.include_usage`, a last chunk carries the ledger entry's tokens). The one usage entry is written
   * when the stream ends: a client that goes away aborts the upstream request; a provider error is charged 0 and ends
   * the stream with its fixed text (D197, D208). The conversation (`store`) is saved only after a completed stream.
   */
  async streamCompletion(body: ApiChatCompletionRequest, user: AuthenticatedUser, response: ServerResponse): Promise<void> {
    const startTime = Date.now();
    const opened = await this.openCall(body, user);
    const sentPrompt = promptText(opened.request.messages);
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const disconnected = new AbortController();
    response.on("close", () => disconnected.abort());
    const head = { id: `chatcmpl-${opened.call.requestId}`, created: Math.floor(startTime / 1000), model: body.model };
    const received: { content: string; finishReason: string; usage?: ChatUsage; isOpened: boolean } = {
      content: "",
      finishReason: "stop",
      isOpened: false,
    };
    // RNX-179: the last model tried (the one that answered, after any 502/503 before the first payload); each attempt
    // that fell over is its own provider_error entry (rule 6).
    let attempt: ServedBy = opened.connection;
    const hooks = this.attemptHooks(opened.call, (tried) => (attempt = tried));
    try {
      for await (const payload of this.providerRouter.chatStream({ ...opened.request, signal: disconnected.signal }, hooks)) {
        received.isOpened = true;
        const delta = readCompletionDelta(payload);
        if (delta.content) {
          const role = received.content ? {} : { role: "assistant" };
          response.write(completionChunk(head, { choices: [{ index: 0, delta: { ...role, content: delta.content }, finish_reason: null }] }));
          received.content += delta.content;
        }
        received.finishReason = delta.finishReason ?? received.finishReason;
        received.usage = delta.usage ?? received.usage;
      }
    } catch (error) {
      const call = { ...opened.call, modelId: attempt.slug, cost: { servedBy: attempt, usage: received.usage } };
      return this.endFailedStream(error, { call, sentPrompt, received, aborted: disconnected.signal.aborted, response });
    }
    const outcome = streamedCallOutcome({ providerFailed: false, aborted: disconnected.signal.aborted, streamOpened: received.isOpened });
    const call = { ...opened.call, modelId: attempt.slug, cost: { servedBy: attempt, usage: received.usage } };
    const entry = await this.finishStreamedCall(call, outcome, { sentPrompt, ...received });
    this.usage
      .logUsage({
        userId: user.id,
        model: attempt.slug,
        inputTokens: (entry.tokensNew ?? 0) + (entry.tokensCached ?? 0),
        outputTokens: entry.tokensOut ?? 0,
        cost: entry.amount.negated(),
        latencyMs: Date.now() - startTime,
        provider: attempt.providerName,
      })
      .catch((err) => this.logger.error("Failed to log usage", err));
    if (outcome === "completed" && body.store) await this.storeConversation(body, user.id, { content: received.content });
    if (outcome === "completed") {
      response.write(completionChunk(head, { choices: [{ index: 0, delta: {}, finish_reason: received.finishReason }] }));
      if (body.stream_options?.include_usage) response.write(completionChunk(head, { choices: [], usage: completionUsageOf(entry) }));
      response.write("data: [DONE]\n\n");
    }
    response.end();
  }

  /**
   * Steps 1 to 4 of a completion, shared by the JSON and the streamed answer: resolves the model (400), reads its tier
   * rates (400), refuses an unaffordable untuned prompt (402) before tuning, tunes the prompt and reserves its estimate
   * (402). Returns the provider request of the call's one model call and the call's ledger fields.
   */
  private async openCall(body: ChatCompletionRequest, user: AuthenticatedUser) {
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
    const request: ChatRequest = {
      model: body.model,
      connection,
      messages: tunedMessages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      response_format: body.response_format,
      reasoning_effort: body.reasoning_effort,
    };
    return { connection, request, matchedTemplate, call };
  }

  /**
   * A streamed answer that failed (RNX-196): its one usage entry (a provider error, also after the client went away,
   * is charged 0 and releases the hold; a client that went away once the stream opened is charged what it received),
   * then a provider error ends the stream with the fixed text of its status (D197, D208: never the provider's text), and
   * of its kind for a typed upstream error (D199, RNX-190: an HTTP error or a timeout).
   * Any other error is rethrown to RNX-171's stream guard, which ends the stream with its own fixed event.
   */
  private async endFailedStream(
    error: unknown,
    failed: {
      call: Omit<UsageRecord, "tokens" | "outcome">;
      sentPrompt: string;
      received: { content: string; usage?: ChatUsage; isOpened: boolean };
      aborted: boolean;
      response: ServerResponse;
    },
  ): Promise<void> {
    const isProviderError =
      error instanceof ProviderHttpError || error instanceof ProviderStreamError || error instanceof ProviderTimeoutError;
    const outcome = streamedCallOutcome({
      providerFailed: isProviderError || !failed.aborted,
      aborted: failed.aborted,
      streamOpened: failed.received.isOpened,
    });
    await this.finishStreamedCall(failed.call, outcome, { sentPrompt: failed.sentPrompt, ...failed.received }).catch((err) =>
      this.logger.error("Failed to record the failed call's usage", err),
    );
    if (!isProviderError) throw error;
    const text =
      error instanceof ProviderTimeoutError
        ? toProviderErrorText(undefined, error.kind)
        : toProviderErrorText(error.status, error instanceof ProviderHttpError ? error.kind : undefined);
    this.logger.error(`Stream error: ${text.logText}`);
    failed.response.write(`data: ${JSON.stringify({ error: { message: `${text.clientMessage}. No credits were charged.` } })}\n\n`);
    failed.response.end();
  }

  /**
   * RNX-179: the router hooks of one call: `onTried` learns each model tried, and each attempt that falls over to a
   * fallback is written as its own provider_error usage entry under the call's reservation (docs/credits.md section
   * 3.1 rule 6), without closing it.
   */
  private attemptHooks(call: Omit<UsageRecord, "tokens" | "outcome">, onTried: (tried: ServedBy) => void): CallHooks {
    return {
      onAttempt: onTried,
      onAttemptFailed: async (failed) => void (await this.credits.recordUsage(failedAttemptRecord(call, failed))),
    };
  }

  /**
   * Writes the one usage entry of a streamed call and ends its reservation (`CreditService.finishCall`): a provider
   * error records only the tokens the provider reported (0 if none, charged 0); a completed or cancelled call is
   * charged the reported tokens, or without a report the local chars/4 count of the prompt sent and the output
   * received (D205).
   */
  private finishStreamedCall(
    call: Omit<UsageRecord, "tokens" | "outcome">,
    outcome: CreditCallOutcome,
    stream: { sentPrompt: string; content: string; usage?: ChatUsage },
  ): Promise<CreditLedgerEntry> {
    const tokens =
      outcome === "provider_error"
        ? streamedCallTokens(stream.usage, "", "")
        : streamedCallTokens(stream.usage, stream.sentPrompt, stream.content);
    return this.credits.finishCall({ ...call, tokens, outcome });
  }

  /**
   * Saves an answer to the user's conversation (`store`, web chat): the conversation is picked or created, then the
   * messages are saved and a new conversation gets its title, both in the background. Returns the conversation id.
   */
  private async storeConversation(
    body: ChatCompletionRequest,
    userId: string,
    answer: { content: string; document?: { format: string; filename: string; key: string } },
  ): Promise<string> {
    const conversationId = await this.conversation.getOrCreateConversation(
      userId,
      body.model,
      body.conversation_id,
    );

    this.conversation
      .saveMessages(conversationId, body.messages, answer.content, answer.document)
      .catch((err) => this.logger.error("Failed to save chat history", err));

    // Generate title for new conversations based on first assistant response
    if (!body.conversation_id && answer.content) {
      this.conversation
        .generateTitle(conversationId, answer.content)
        .catch((err) =>
          this.logger.error("Failed to generate conversation title", err),
        );
    }
    return conversationId;
  }
}
