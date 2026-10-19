import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  BadRequestException,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { PortalIdentity } from "../guard/portal.guard";
import {
  PortalTierService,
  FreeReservation,
} from "../service/portal-tier.service";
import { clientIp } from "../../../common/utils/client-ip";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import { promptText } from "../../billing/utils/prompt-text";
import { streamedCallTokens } from "../../billing/utils/streamed-call-tokens";
import { ProviderRouter } from "../../providers/provider-router";
import type { ChatUsage } from "../../providers/provider.interface";
import { readStreamError } from "../../providers/utils/read-stream-error";
import { readUsage } from "../../providers/utils/read-usage";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import {
  ChatCompletionRequest,
  ChatCompletionRequestSchema,
} from "../../chat/dto/chat-completion.dto";
import { randomUUID } from "node:crypto";
import { Access } from "../../../common/decorators/access.decorator";
import { resolveMaxTokens } from "../utils/resolve-max-tokens";
import { extractProviderError } from "../utils/extract-provider-error";

const PortalCompletionSchema = ChatCompletionRequestSchema.extend({
  model: ChatCompletionRequestSchema.shape.model.optional(),
});

const FREE_CAP_MESSAGES: Record<Exclude<FreeReservation, "ok">, string> = {
  free_limit_reached:
    "You've reached today's free chat limit. It resets at 00:00 WIB. Sign in with a package or an invitation code to keep chatting.",
  free_capacity_reached:
    "Free chat is very busy right now. Please try again later, or sign in with a package or an invitation code to keep chatting.",
};

@Controller("chat/portal")
export class PortalController {
  private readonly logger = new Logger(PortalController.name);

  constructor(
    private readonly tierService: PortalTierService,
    private readonly registry: ModelRegistryService,
    private readonly credits: CreditService,
    private readonly providerRouter: ProviderRouter,
    private readonly usage: UsageService,
    private readonly promptTuning: PromptTuningService,
    private readonly conversation: ConversationService,
    private readonly knowledge: KnowledgeService,
    private readonly guardrail: GuardrailService,
    private readonly documentService: DocumentService,
  ) {}

  @Post("completions")
  @Access({ auth: ["portal"] })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async createCompletion(
    @Body() body: unknown,
    @Req() req: any,
    @Res() res: FastifyReply,
  ) {
    const identity: PortalIdentity = req.portalIdentity;

    const parsed = PortalCompletionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const requestData = parsed.data as ChatCompletionRequest;

    const ip = clientIp(req);

    const origin = req.headers["origin"] || "*";

    if (identity.tier === "free") {
      return this.handleFreeRequest(identity, requestData, ip, res, origin);
    }

    return this.handlePaidRequest(identity, requestData, res, origin);
  }

  @Get("usage")
  @Access({ auth: ["portal"] })
  async getUsage(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;
    return this.tierService.getUsage(
      identity.sessionId,
      identity.user?.balance,
    );
  }

  @Get("models")
  @Access({ auth: ["portal"] })
  async getModels(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;

    if (identity.tier === "free") {
      const cheapest = await this.registry.getCheapestModel("standard");
      if (!cheapest) return { models: [] };
      return {
        models: [{ slug: cheapest.slug, name: cheapest.modelName }],
      };
    }

    // Paid: return all models with pricing
    const models = await this.registry.getAllModels();
    const markup = await this.registry.getMarkup();
    return {
      models: models.map((m) => ({
        slug: m.slug,
        name: m.modelName,
        inputPrice: m.inputPrice.mul(markup).toString(),
        outputPrice: m.outputPrice.mul(markup).toString(),
      })),
    };
  }

  @Post("link-session")
  @Access({ auth: ["portal"] })
  @HttpCode(200)
  async linkSession(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;

    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    await this.tierService.linkSessionToUser(
      identity.sessionId,
      identity.user.id,
    );

    return { linked: true };
  }

  // ─── Conversation History Endpoints ───

  @Get("conversations")
  @Access({ auth: ["portal"] })
  async listConversations(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    const l = Math.min(Math.max(parseInt(limit || "20", 10) || 20, 1), 100);
    const o = Math.max(parseInt(offset || "0", 10) || 0, 0);

    const { conversations, total } = await this.conversation.listConversations(
      identity.user.id,
      l,
      o,
    );

    return { object: "list", data: conversations, total, limit: l, offset: o };
  }

  @Get("conversations/:id")
  @Access({ auth: ["portal"] })
  async getConversation(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    const conv = await this.conversation.getConversation(id, identity.user.id);
    if (!conv) {
      throw new NotFoundException("Conversation not found");
    }
    return conv;
  }

  @Delete("conversations/:id")
  @Access({ auth: ["portal"] })
  @HttpCode(204)
  async deleteConversation(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    const deleted = await this.conversation.deleteConversation(
      id,
      identity.user.id,
    );
    if (!deleted) {
      throw new NotFoundException("Conversation not found");
    }
  }

  // ─── Knowledge Base Endpoints ───

  @Get("knowledge")
  @Access({ auth: ["portal"] })
  async listKnowledgeBases(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }
    if (identity.user.balance <= 0) {
      throw new BadRequestException(
        "Top up required to use knowledge base features",
      );
    }

    return this.knowledge.listKnowledgeBases(identity.user.id);
  }

  @Post("knowledge")
  @Access({ auth: ["portal"] })
  @HttpCode(201)
  async createKnowledgeBase(@Body() body: unknown, @Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }
    if (identity.user.balance <= 0) {
      throw new BadRequestException(
        "Top up required to use knowledge base features",
      );
    }

    const { name, description } = body as {
      name?: string;
      description?: string;
    };
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new BadRequestException("Name is required");
    }

    return this.knowledge.createKnowledgeBase(identity.user.id, {
      name: name.trim(),
      description: description?.trim(),
    });
  }

  @Delete("knowledge/:id")
  @Access({ auth: ["portal"] })
  @HttpCode(204)
  async deleteKnowledgeBase(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    await this.knowledge.deleteKnowledgeBase(identity.user.id, id);
  }

  @Post("knowledge/:id/upload")
  @Access({ auth: ["portal"] })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async uploadToKnowledgeBase(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }
    if (identity.user.balance <= 0) {
      throw new BadRequestException(
        "Top up required to use knowledge base features",
      );
    }

    const file = await req.file();
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException("File size exceeds 10 MB limit");
    }

    return this.knowledge.uploadMarkdown(identity.user.id, id, {
      filename: file.filename,
      buffer,
    });
  }

  @Get("knowledge/:id/chunks")
  @Access({ auth: ["portal"] })
  async listChunks(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    const l = Math.min(Math.max(parseInt(limit || "50", 10) || 50, 1), 100);
    const o = Math.max(parseInt(offset || "0", 10) || 0, 0);

    return this.knowledge.listChunks(identity.user.id, id, {
      limit: l,
      offset: o,
    });
  }

  @Delete("knowledge/:id/chunks/:chunkId")
  @Access({ auth: ["portal"] })
  @HttpCode(204)
  async deleteChunk(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("chunkId", ParseUUIDPipe) chunkId: string,
    @Req() req: any,
  ) {
    const identity: PortalIdentity = req.portalIdentity;
    if (!identity.user) {
      throw new BadRequestException("Authentication required");
    }

    await this.knowledge.deleteChunk(identity.user.id, id, chunkId);
  }

  private async handleFreeRequest(
    identity: PortalIdentity,
    body: ChatCompletionRequest,
    ip: string,
    res: FastifyReply,
    origin: string,
  ) {
    // Get or create session
    const session = await this.tierService.getOrCreateSession(
      identity.sessionId,
      ip,
    );

    if (!session) {
      throw new BadRequestException(
        "Too many sessions from this IP. Please try again later.",
      );
    }

    // Reserve the session, per-IP and global daily counters before the model call
    const reservation = await this.tierService.reserveFreeRequest(
      identity.sessionId,
      ip,
    );
    if (reservation !== "ok") {
      throw new HttpException(
        {
          error: {
            code: reservation,
            message: FREE_CAP_MESSAGES[reservation],
            type: "rate_limit_error",
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Force cheapest standard-tier model
    const cheapest = await this.registry.getCheapestModel("standard");
    if (!cheapest) {
      throw new InternalServerErrorException("No models available");
    }

    // Input guardrail check — extract last user message
    const lastUserMsg = body.messages.filter((m) => m.role === "user").pop();
    if (lastUserMsg) {
      const inputCheck = await this.guardrail.checkInput(
        typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content),
        identity.sessionId,
      );
      if (inputCheck.blocked) {
        res.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        });
        const chunk = JSON.stringify({
          choices: [{ delta: { content: inputCheck.userMessage } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
        res.raw.write("data: [DONE]\n\n");
        res.raw.end();
        return;
      }
    }

    // Stream response
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });

    try {
      // Emit status: understanding
      res.raw.write(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);

      // Apply prompt tuning
      const { tunedMessages, matchedTemplate } =
        await this.promptTuning.applyTuning(body.messages);

      // Determine if document generation is needed
      const outputFormat =
        body.output_format || matchedTemplate?.outputFormat || null;

      if (outputFormat) {
        res.raw.write(
          `data: ${JSON.stringify({ status: "generating_document" })}\n\n`,
        );
      } else {
        // Emit status: generating
        res.raw.write(`data: ${JSON.stringify({ status: "generating" })}\n\n`);
      }

      // RX-161: a client that disconnects aborts the upstream request.
      const disconnected = new AbortController();
      res.raw.on("close", () => disconnected.abort());
      const stream = this.providerRouter.chatStream(cheapest.provider, {
        signal: disconnected.signal,
        model: cheapest.slug,
        providerId: cheapest.providerId,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: resolveMaxTokens(
          body.max_tokens,
          cheapest.maxOutputTokens,
          outputFormat,
        ),
      });

      let fullContent = "";
      for await (const chunk of stream) {
        if (!outputFormat) {
          res.raw.write(`data: ${chunk}\n\n`);
        }
        // Accumulate content for conversation saving
        try {
          const parsed = JSON.parse(chunk);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {
          // ignore parse errors
        }
      }

      // Generate document if format was detected
      if (outputFormat && fullContent) {
        try {
          const document = await this.documentService.generateWithStorage(
            fullContent,
            outputFormat,
          );

          const formatLabels: Record<string, string> = {
            pdf: "PDF",
            docx: "Word document",
            xlsx: "Excel spreadsheet",
          };
          const label =
            formatLabels[outputFormat] || outputFormat.toUpperCase();
          const summary = `Here's the ${label} you requested:`;
          const chunk = JSON.stringify({
            choices: [{ delta: { content: summary } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
          res.raw.write(
            `data: ${JSON.stringify({ document: { format: document.format, url: document.url, filename: document.filename, expiresAt: document.expiresAt } })}\n\n`,
          );

          fullContent = summary;
        } catch (err: any) {
          this.logger.error(
            `Portal document generation (free) failed: ${err.message}`,
            err.stack,
          );
          const chunk = JSON.stringify({
            choices: [{ delta: { content: fullContent } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
        }
      }

      // Save conversation for logged-in users (even free tier)
      if (identity.user && fullContent) {
        const conversationId = await this.conversation.getOrCreateConversation(
          identity.user.id,
          cheapest.slug,
          body.conversation_id,
        );

        this.conversation
          .saveMessages(conversationId, body.messages, fullContent)
          .then(async () => {
            if (!body.conversation_id) {
              if (fullContent) {
                await this.conversation.generateTitle(
                  conversationId,
                  fullContent,
                );
              }
            }
          })
          .catch((err) =>
            this.logger.error("Failed to save free-tier conversation", err),
          );

        res.raw.write(
          `data: ${JSON.stringify({ conversation_id: conversationId })}\n\n`,
        );
      }

      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    } catch (error: any) {
      const providerError = extractProviderError(error);
      this.logger.error(
        `Stream error${providerError.status ? ` (status ${providerError.status})` : ""}: ${providerError.message}`,
        error.stack,
      );
      res.raw.write(
        `data: ${JSON.stringify({ error: { message: providerError.clientMessage } })}\n\n`,
      );
      res.raw.end();
    }
  }

  private async handlePaidRequest(
    identity: PortalIdentity,
    body: ChatCompletionRequest,
    res: FastifyReply,
    origin: string,
  ) {
    const user = identity.user!;
    const startTime = Date.now();

    // Input guardrail check — extract last user message
    const lastUserMsg = body.messages.filter((m) => m.role === "user").pop();
    if (lastUserMsg) {
      const inputCheck = await this.guardrail.checkInput(
        typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content),
        user.id,
      );
      if (inputCheck.blocked) {
        res.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        });
        const chunk = JSON.stringify({
          choices: [{ delta: { content: inputCheck.userMessage } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
        res.raw.write("data: [DONE]\n\n");
        res.raw.end();
        return;
      }
    }

    // Validate model
    const modelConfig = await this.registry.getModel(body.model);
    if (!modelConfig) {
      const available = await this.registry.getAllModels();
      throw new BadRequestException(
        `Model "${body.model}" is not supported. Available: ${available.map((m) => m.slug).join(", ")}`,
      );
    }

    // The tier's credit rates (RX-21), not price x multiplier.
    const tierRates = await this.registry.getTierRates(modelConfig.tier);
    if (!tierRates) {
      throw new BadRequestException(
        `No credit rates found for tier "${modelConfig.tier}"`,
      );
    }
    const rates = callRatesOf(tierRates);

    // Prompt tuning (with user KB context) comes before the reservation (RX-22): the estimate counts the prompt
    // actually sent, and a 402 is answered before the stream opens.
    const userKbs = await this.knowledge.listKnowledgeBases(user.id);
    const { tunedMessages, matchedTemplate } =
      await this.promptTuning.applyTuning(body.messages, user.id);
    const outputFormat =
      body.output_format || matchedTemplate?.outputFormat || null;
    const maxTokens = resolveMaxTokens(
      body.max_tokens,
      modelConfig.maxOutputTokens,
      outputFormat,
    );

    // Reserve the estimate on the paid wallet (docs/credits.md section 3.1): 402 CREDITS_EXHAUSTED when it cannot
    // cover it. M is the max_tokens the adapter will send.
    const promptTokens = countPromptTokens(tunedMessages);
    const sentPrompt = promptText(tunedMessages);
    const requestId = randomUUID();
    const reservation = await this.credits.reserve({
      userId: user.id,
      requestId,
      amount: estimateCallCredits(
        promptTokens,
        this.providerRouter.resolveMaxTokens(modelConfig.provider, {
          providerId: modelConfig.providerId,
          max_tokens: maxTokens,
        }),
        rates,
      ),
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

    // Stream response + accumulate for billing
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });

    // RX-161: a client that disconnects aborts the upstream request.
    const disconnected = new AbortController();
    res.raw.on("close", () => disconnected.abort());
    let fullContent = "";
    let reportedUsage: ChatUsage | undefined;
    let isBilled = false;

    try {
      // Emit status: understanding
      res.raw.write(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);

      // Status indicator when the user has knowledge bases
      if (userKbs.length > 0) {
        res.raw.write(
          `data: ${JSON.stringify({ status: "searching_knowledge" })}\n\n`,
        );
      }

      if (outputFormat) {
        res.raw.write(
          `data: ${JSON.stringify({ status: "generating_document" })}\n\n`,
        );
      } else {
        // Emit status: generating
        res.raw.write(`data: ${JSON.stringify({ status: "generating" })}\n\n`);
      }

      const stream = this.providerRouter.chatStream(modelConfig.provider, {
        signal: disconnected.signal,
        model: body.model,
        providerId: modelConfig.providerId,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: maxTokens,
      });

      for await (const chunk of stream) {
        let parsed: any;
        try {
          parsed = JSON.parse(chunk);
        } catch {
          // ignore parse errors on individual chunks
        }
        // RX-22: a mid-stream error chunk (HTTP 200, top-level error) is a provider error, never part of the answer.
        const streamError = parsed && readStreamError(parsed);
        if (streamError) throw streamError;

        // When generating a document, don't stream raw content to frontend
        if (!outputFormat) {
          res.raw.write(`data: ${chunk}\n\n`);
        }

        // Accumulate content for conversation saving, and the usage chunk (before [DONE]) for billing
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
        reportedUsage = readUsage(parsed?.usage) ?? reportedUsage;
      }

      // One usage entry for the call, then settle (docs/credits.md section 3.1 rules 4, 5 and 7): the provider's
      // reported tokens; without a usage chunk (client gone, or none sent) the local chars/4 count (D202-5, D205).
      const entry = await this.credits.finishCall({
        ...call,
        tokens: streamedCallTokens(reportedUsage, sentPrompt, fullContent),
        outcome: disconnected.signal.aborted ? "client_cancel" : "completed",
      });
      isBilled = true;

      // Generate document if format was detected
      if (outputFormat && fullContent) {
        try {
          const document = await this.documentService.generateWithStorage(
            fullContent,
            outputFormat,
          );

          // Send a short summary message
          const formatLabels: Record<string, string> = {
            pdf: "PDF",
            docx: "Word document",
            xlsx: "Excel spreadsheet",
          };
          const label =
            formatLabels[outputFormat] || outputFormat.toUpperCase();
          const summary = `Here's the ${label} you requested:`;
          const chunk = JSON.stringify({
            choices: [{ delta: { content: summary } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
          res.raw.write(
            `data: ${JSON.stringify({ document: { format: document.format, url: document.url, filename: document.filename, expiresAt: document.expiresAt } })}\n\n`,
          );

          // Replace fullContent with summary for conversation saving
          fullContent = summary;
        } catch (err: any) {
          this.logger.error(
            `Portal document generation failed: ${err.message}`,
            err.stack,
          );
          // Fallback: send the full markdown content
          const chunk = JSON.stringify({
            choices: [{ delta: { content: fullContent } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
        }
      }

      const latencyMs = Date.now() - startTime;

      // Log usage async
      this.usage
        .logUsage({
          userId: user.id,
          model: body.model,
          inputTokens: (entry.tokensNew ?? 0) + (entry.tokensCached ?? 0),
          outputTokens: entry.tokensOut ?? 0,
          cost: entry.amount.negated(),
          latencyMs,
          provider: modelConfig.provider,
        })
        .catch((err) => this.logger.error("Failed to log usage", err));

      // Save conversation for paid users (always store=true)
      let conversationId: string | undefined;
      if (fullContent) {
        conversationId = await this.conversation.getOrCreateConversation(
          user.id,
          body.model,
          body.conversation_id,
        );

        this.conversation
          .saveMessages(conversationId, body.messages, fullContent)
          .then(async () => {
            if (!body.conversation_id) {
              if (fullContent) {
                await this.conversation.generateTitle(
                  conversationId!,
                  fullContent,
                );
              }
            }
          })
          .catch((err) =>
            this.logger.error("Failed to save conversation", err),
          );
      }

      // Emit conversation_id so frontend can continue the conversation
      if (conversationId) {
        res.raw.write(
          `data: ${JSON.stringify({ conversation_id: conversationId })}\n\n`,
        );
      }

      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    } catch (error: any) {
      // Not billed yet: a provider error is charged 0 and releases the hold (rule 6); a client that went away is
      // charged what it received (rule 7). A failed write stays for the expiry sweep.
      if (!isBilled) {
        await this.credits
          .finishCall({
            ...call,
            tokens: disconnected.signal.aborted
              ? streamedCallTokens(reportedUsage, sentPrompt, fullContent)
              : streamedCallTokens(reportedUsage, "", ""),
            outcome: disconnected.signal.aborted ? "client_cancel" : "provider_error",
          })
          .catch((err) => this.logger.error("Failed to record the failed call's usage", err));
      }
      const providerError = extractProviderError(error);
      this.logger.error(
        `Stream error${providerError.status ? ` (status ${providerError.status})` : ""}: ${providerError.message}`,
        error.stack,
      );

      // Save partial conversation if we accumulated any content
      if (fullContent) {
        this.conversation
          .getOrCreateConversation(user.id, body.model, body.conversation_id)
          .then((convId) =>
            this.conversation.saveMessages(convId, body.messages, fullContent),
          )
          .catch((err) =>
            this.logger.error(
              "Failed to save partial conversation on error",
              err,
            ),
          );
      }

      res.raw.write(
        `data: ${JSON.stringify({ error: { message: isBilled ? providerError.clientMessage : `${providerError.clientMessage}. No credits were charged.` } })}\n\n`,
      );
      res.raw.end();
    }
  }
}
