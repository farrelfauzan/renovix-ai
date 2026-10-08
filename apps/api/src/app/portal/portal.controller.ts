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
  UseGuards,
  BadRequestException,
  HttpCode,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { PortalGuard, PortalIdentity } from "./portal.guard";
import { PortalTierService } from "./portal-tier.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { BillingService } from "../billing/billing.service";
import { ProviderRouter } from "../providers/provider-router";
import { UsageService } from "../usage/usage.service";
import { PromptTuningService } from "../chat/prompt-tuning.service";
import { ConversationService } from "../chat/conversation.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { DocumentService } from "../document/document.service";
import {
  ChatCompletionRequest,
  ChatCompletionRequestSchema,
} from "../chat/dto/chat-completion.dto";
import type { Decimal } from "@prisma/client/runtime/client";

const PortalCompletionSchema = ChatCompletionRequestSchema.extend({
  model: ChatCompletionRequestSchema.shape.model.optional(),
});

@Controller("chat/portal")
export class PortalController {
  private readonly logger = new Logger(PortalController.name);

  constructor(
    private readonly tierService: PortalTierService,
    private readonly registry: ModelRegistryService,
    private readonly billing: BillingService,
    private readonly providerRouter: ProviderRouter,
    private readonly usage: UsageService,
    private readonly promptTuning: PromptTuningService,
    private readonly conversation: ConversationService,
    private readonly knowledge: KnowledgeService,
    private readonly guardrail: GuardrailService,
    private readonly documentService: DocumentService,
  ) {}

  @Post("completions")
  @UseGuards(PortalGuard)
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

    // Extract IP for session creation
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.ip ||
      undefined;

    const origin = req.headers["origin"] || "*";

    if (identity.tier === "free") {
      return this.handleFreeRequest(identity, requestData, ip, res, origin);
    }

    return this.handlePaidRequest(identity, requestData, res, origin);
  }

  @Get("usage")
  @UseGuards(PortalGuard)
  async getUsage(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;
    return this.tierService.getUsage(
      identity.sessionId,
      identity.user?.balance,
    );
  }

  @Get("models")
  @UseGuards(PortalGuard)
  async getModels(@Req() req: any) {
    const identity: PortalIdentity = req.portalIdentity;

    if (identity.tier === "free") {
      const cheapest = await this.registry.getCheapestModel();
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
  @UseGuards(PortalGuard)
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
    ip: string | undefined,
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

    // Check limit
    const { allowed } = await this.tierService.canMakeRequest(
      identity.sessionId,
    );
    if (!allowed) {
      throw new BadRequestException({
        error: {
          message:
            "Free request limit reached. Register and add credits to continue.",
          type: "rate_limit_error",
          remaining: 0,
          limit: 20,
        },
      });
    }

    // Force cheapest model
    const cheapest = await this.registry.getCheapestModel();
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

      const stream = this.providerRouter.chatStream(cheapest.provider, {
        model: cheapest.slug,
        providerId: cheapest.providerId,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: this.resolveMaxTokens(
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

      // Track after successful response
      await this.tierService.trackFreeRequest(identity.sessionId);
    } catch (error: any) {
      const providerError = this.extractProviderError(error);
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

    const pricing = await this.registry.getUserPrice(body.model);
    if (!pricing) {
      throw new BadRequestException(`Pricing not found for "${body.model}"`);
    }

    // Estimate + reserve credits
    const estimatedTokens = this.billing.estimateTokens(body.messages);
    const estimatedCost = this.billing.estimateCost(
      estimatedTokens,
      pricing.inputPrice.toNumber(),
      pricing.creditMultiplier.toNumber(),
    );

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

    // Stream response + accumulate for billing
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });

    let fullContent = "";
    let totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    try {
      // Emit status: understanding
      res.raw.write(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);

      // Check if user has knowledge bases for status indicator
      const userKbs = await this.knowledge.listKnowledgeBases(user.id);
      if (userKbs.length > 0) {
        res.raw.write(
          `data: ${JSON.stringify({ status: "searching_knowledge" })}\n\n`,
        );
      }

      // Apply prompt tuning (with user KB context)
      const { tunedMessages, matchedTemplate } =
        await this.promptTuning.applyTuning(body.messages, user.id);

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

      const stream = this.providerRouter.chatStream(modelConfig.provider, {
        model: body.model,
        providerId: modelConfig.providerId,
        messages: tunedMessages,
        temperature: body.temperature,
        max_tokens: this.resolveMaxTokens(
          body.max_tokens,
          modelConfig.maxOutputTokens,
          outputFormat,
        ),
      });

      for await (const chunk of stream) {
        // When generating a document, don't stream raw content to frontend
        if (!outputFormat) {
          res.raw.write(`data: ${chunk}\n\n`);
        }

        // Accumulate content for conversation saving
        try {
          const parsed = JSON.parse(chunk);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
          if (parsed.usage) totalUsage = parsed.usage;
        } catch {
          // ignore parse errors on individual chunks
        }
      }

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

      // Calculate actual cost (use estimated if no usage data from stream)
      const actualTokens =
        totalUsage.total_tokens > 0
          ? totalUsage
          : {
              prompt_tokens: estimatedTokens,
              completion_tokens: Math.ceil(fullContent.length / 4),
              total_tokens: estimatedTokens + Math.ceil(fullContent.length / 4),
            };

      const actualCost = this.billing.calculateActualCost(
        actualTokens.prompt_tokens,
        actualTokens.completion_tokens,
        pricing.inputPrice.toNumber(),
        pricing.outputPrice.toNumber(),
        pricing.creditMultiplier.toNumber(),
      );

      // Adjust balance
      await this.billing.adjustBalance(user.id, reservedAmount, actualCost);

      // Log usage async
      this.usage
        .logUsage({
          userId: user.id,
          model: body.model,
          inputTokens: actualTokens.prompt_tokens,
          outputTokens: actualTokens.completion_tokens,
          cost: actualCost,
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
      // Refund on failure
      await this.billing.refundReservation(user.id, reservedAmount);
      const providerError = this.extractProviderError(error);
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
        `data: ${JSON.stringify({ error: { message: `${providerError.clientMessage}. Balance refunded.` } })}\n\n`,
      );
      res.raw.end();
    }
  }

  private resolveMaxTokens(
    requestedMaxTokens: number | undefined,
    modelMaxOutputTokens: number | null | undefined,
    outputFormat: string | null,
  ): number {
    const desired = outputFormat
      ? Math.max(requestedMaxTokens ?? 4096, 8192)
      : (requestedMaxTokens ?? 4096);

    if (!modelMaxOutputTokens || modelMaxOutputTokens <= 0) {
      return desired;
    }

    return Math.min(desired, modelMaxOutputTokens);
  }

  private extractProviderError(error: any): {
    status?: number;
    message: string;
    clientMessage: string;
  } {
    const status = error?.response?.status;
    const responseData = error?.response?.data;

    let details: string | undefined;
    if (typeof responseData === "string") {
      details = responseData;
    } else if (responseData && typeof responseData === "object") {
      details =
        responseData?.error?.message ||
        responseData?.message ||
        JSON.stringify(responseData);
    }

    const normalizedDetails = details
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const message =
      normalizedDetails || error?.message || "Unknown stream error";

    let clientMessage = "Stream error";
    if (status === 400) {
      clientMessage = normalizedDetails
        ? `Provider rejected request: ${normalizedDetails}`
        : "Provider rejected request (HTTP 400)";
    } else if (status) {
      clientMessage = normalizedDetails
        ? `Provider request failed (${status}): ${normalizedDetails}`
        : `Provider request failed (${status})`;
    }

    return { status, message, clientMessage };
  }
}
