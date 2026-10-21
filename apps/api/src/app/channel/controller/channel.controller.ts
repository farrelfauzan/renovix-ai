import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  ParseUUIDPipe,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { buildDocumentSummary } from "../../../common/utils/build-document-summary";
import { guardSseStream } from "../../../common/utils/guard-sse-stream";
import { codedRefusalOf } from "../../../common/utils/coded-refusal-of";
import {
  CreateChannelSchema,
  UpdateChannelSchema,
  AddAgentSchema,
  ChatMessageSchema,
  type ChatMessageDto,
} from "../dto/channel.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("channels")
@Access({ auth: ["session"] })
export class ChannelController {
  private readonly logger = new Logger(ChannelController.name);

  constructor(
    private readonly channelService: ChannelService,
    private readonly chatService: ChannelChatService,
    private readonly s3Service: S3Service,
    private readonly documentService: DocumentService,
    private readonly providerRouter: ProviderRouter,
    private readonly registry: ModelRegistryService,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async create(@Body() body: unknown, @Req() req: any) {
    const parsed = CreateChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.channelService.create(req.user.userId, parsed.data);
  }

  @Post("upload-icon")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async uploadIconStandalone(@Req() req: FastifyRequest) {
    const userId = (req as any).user.userId;
    const file = await (req as any).file();
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Allowed: jpeg, png, gif, webp, svg",
      );
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException("File size exceeds 5MB limit");
    }

    const ext = file.filename.split(".").pop() || "png";
    const key = `channels/${userId}/icons/${Date.now()}.${ext}`;

    await this.s3Service.upload(key, buffer, file.mimetype);

    return { icon: key };
  }

  @Get()
  async list(@Req() req: any) {
    return this.channelService.list(req.user.userId);
  }

  @Get(":id")
  async findById(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.channelService.findById(req.user.userId, id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = UpdateChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.channelService.update(req.user.userId, id, parsed.data);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.channelService.delete(req.user.userId, id);
  }

  // ─── Icon Upload ───

  @Post(":id/icon")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async uploadIcon(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = (req as any).user.userId;
    const file = await (req as any).file();
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Allowed: jpeg, png, gif, webp, svg",
      );
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException("File size exceeds 5MB limit");
    }

    const ext = file.filename.split(".").pop() || "png";
    const key = `channels/${userId}/${id}/${Date.now()}.${ext}`;

    await this.s3Service.upload(key, buffer, file.mimetype);

    const iconUrl = `${key}`;
    await this.channelService.update(userId, id, { icon: iconUrl });

    return { icon: iconUrl };
  }

  // ─── Agent Management ───

  @Post(":id/agents")
  @HttpCode(201)
  async addAgent(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = AddAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.channelService.addAgent(
      req.user.userId,
      id,
      parsed.data.agentId,
      parsed.data.role,
    );
  }

  @Delete(":id/agents/:agentId")
  @HttpCode(204)
  async removeAgent(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Req() req: any,
  ) {
    return this.channelService.removeAgent(req.user.userId, id, agentId);
  }

  // ─── Messages (per user per agent room) ───

  @Get(":id/agents/:agentId/messages")
  async getMessages(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Query("limit") limit: string,
    @Query("offset") offset: string,
    @Req() req: any,
  ) {
    return this.channelService.getMessages(
      req.user.userId,
      id,
      agentId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
  }

  @Delete(":id/agents/:agentId/messages")
  @HttpCode(204)
  async clearMessages(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Req() req: any,
  ) {
    return this.channelService.clearMessages(req.user.userId, id, agentId);
  }

  // ─── Chat (SSE stream per user per agent room) ───

  @Post(":id/agents/:agentId/chat")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async chat(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Body() body: unknown,
    @Req() req: any,
    @Res() res: FastifyReply,
  ) {
    const parsed = ChatMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    // RNX-171: an error after the SSE headers ends that stream, not the process.
    return guardSseStream({
      response: res.raw,
      logger: this.logger,
      stream: () => this.streamChat(id, agentId, parsed.data, req, res),
    });
  }

  private async streamChat(id: string, agentId: string, input: ChatMessageDto, req: any, res: FastifyReply) {
    const userId = req.user.userId;
    const origin = req.headers.origin || req.headers.Origin || "*";

    // RX-178 (review B1), RNX-200: the room access check, the fixed 400 for an unusable model and the run's 402s
    // (credits, per-run cap) are real HTTP answers, before the SSE headers and the classifier call.
    await this.chatService.assertRunCanStart(userId, id, agentId, input.message);

    // Setup SSE streaming
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });

    req.raw.socket.setTimeout(180000);

    const heartbeat = setInterval(() => {
      if (!res.raw.destroyed) {
        res.raw.write(`: heartbeat\n\n`);
      }
    }, 15000);

    try {
      // Classify document intent via LLM
      const detectedFormat =
        input.output_format ||
        (await this.classifyDocumentIntent(input.message));
      this.logger.log(`[chat] detectedFormat=${detectedFormat}`);

      if (detectedFormat) {
        res.raw.write(
          `data: ${JSON.stringify({ status: "generating_document" })}\n\n`,
        );
      } else {
        res.raw.write(
          `data: ${JSON.stringify({ status: "understanding" })}\n\n`,
        );
      }

      const result = await this.chatService.chat(
        userId,
        id,
        agentId,
        input.message,
        detectedFormat ? { documentFormat: detectedFormat } : undefined,
      );

      // RNX-222: the document this run's own create_document call generated, if it was called
      const toolDocumentResult = result.document;

      if (toolDocumentResult) {
        // Document generated via tool call
        const summary = buildDocumentSummary(
          input.message,
          toolDocumentResult.format,
        );
        if (result.assistantMessageId) {
          const { key: _key, ...docForAttach } = toolDocumentResult;
          await this.channelService.attachDocumentToMessage(
            userId,
            id,
            agentId,
            result.assistantMessageId,
            summary,
            docForAttach,
          );
        }
        const chunk = JSON.stringify({
          choices: [{ delta: { content: summary } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
        const { key: _key, ...document } = toolDocumentResult;
        res.raw.write(`data: ${JSON.stringify({ document })}\n\n`);
      } else if (detectedFormat && result.content) {
        // Fallback: classifier detected format
        this.logger.log(
          `[chat] Generating ${detectedFormat} document, content length=${result.content.length}`,
        );
        try {
          const document = await this.documentService.generate(
            result.content,
            detectedFormat,
          );
          // Send a short summary message instead of full content
          const summary = buildDocumentSummary(
            input.message,
            detectedFormat,
          );
          if (result.assistantMessageId) {
            await this.channelService.attachDocumentToMessage(
              userId,
              id,
              agentId,
              result.assistantMessageId,
              summary,
              document,
            );
          }
          const chunk = JSON.stringify({
            choices: [{ delta: { content: summary } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
          res.raw.write(`data: ${JSON.stringify({ document })}\n\n`);
        } catch (err: any) {
          this.logger.error(
            `Document generation failed: ${err.message}`,
            err.stack,
          );
          // Fall back to showing full content if doc generation fails
          const chunk = JSON.stringify({
            choices: [{ delta: { content: result.content } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
        }
      } else {
        // No document — send the full content as usual
        const chunk = JSON.stringify({
          choices: [{ delta: { content: result.content } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
      }

      res.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);

      clearInterval(heartbeat);
      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    } catch (error: any) {
      clearInterval(heartbeat);
      this.logger.error(`Channel chat error: ${error.message}`, error.stack);

      // RNX-200: a refusal with a code (402 CREDITS_EXHAUSTED, RUN_CAP_EXCEEDED) goes to the stream guard, which
      // sends its code in the error event.
      if (!res.raw.headersSent || codedRefusalOf(error)) {
        throw error;
      }

      res.raw.write(
        `data: ${JSON.stringify({ error: { message: error.message } })}\n\n`,
      );
      res.raw.end();
    }
  }

  private async classifyDocumentIntent(
    message: string,
  ): Promise<string | null> {
    try {
      // RX-178: the cheapest resolvable Standard model, never a hard-coded vendor id.
      const connection = await this.registry.resolveCheapestConnection("standard");
      const response = await this.providerRouter.chat({
        model: connection.slug,
        connection,
        messages: [
          {
            role: "system",
            content:
              "You classify user messages. If the user is asking to generate/create/export a downloadable document, reply with ONLY the format: pdf, docx, or xlsx. If the user mentions Google Sheets, Google Docs, Google Slides, or any cloud-based document service, reply with: none (we cannot create those). If not a document request, reply with: none. No explanation.",
          },
          { role: "user", content: message },
        ],
        max_tokens: 200,
        temperature: 0,
      });
      const raw = response.choices[0]?.message?.content ?? "";
      this.logger.log(
        `[classifyDocumentIntent] full response=${JSON.stringify(response.choices[0])}`,
      );
      // Extract format from anywhere in the response
      const lower = raw.toLowerCase();
      if (lower.includes("pdf")) return "pdf";
      if (lower.includes("docx")) return "docx";
      if (lower.includes("xlsx")) return "xlsx";
      return null;
    } catch (err: any) {
      this.logger.warn(`Document intent classification failed: ${err.message}`);
      return null;
    }
  }
}
