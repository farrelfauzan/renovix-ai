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
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ChannelService } from "./channel.service";
import { ChannelChatService } from "./channel-chat.service";
import { S3Service } from "../knowledge/s3.service";
import { DocumentService } from "../document/document.service";
import { AgentToolService } from "../agent/agent-tool.service";
import { ProviderRouter } from "../providers/provider-router";
import { z } from "zod";

const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(500).optional(),
  color: z.string().max(7).optional(),
});

const UpdateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(500).optional(),
  color: z.string().max(7).optional(),
});

const AddAgentSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(["primary", "sub"]).optional().default("primary"),
});

const ChatMessageSchema = z.object({
  message: z.string().min(1).max(32000),
  output_format: z.enum(["pdf", "docx", "xlsx"]).optional(),
});

@Controller("channels")
@UseGuards(CombinedAuthGuard)
export class ChannelController {
  private readonly logger = new Logger(ChannelController.name);

  constructor(
    private readonly channelService: ChannelService,
    private readonly chatService: ChannelChatService,
    private readonly s3Service: S3Service,
    private readonly documentService: DocumentService,
    private readonly toolService: AgentToolService,
    private readonly providerRouter: ProviderRouter,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async create(@Body() body: unknown, @Req() req: any) {
    const parsed = CreateChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
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
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
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
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
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
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const userId = req.user.userId;
    const origin = req.headers.origin || req.headers.Origin || "*";

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
        parsed.data.output_format ||
        (await this.classifyDocumentIntent(parsed.data.message));
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

      // Clear any previous document result before running
      this.toolService.clearLastDocumentResult();

      const result = await this.chatService.chat(
        userId,
        id,
        agentId,
        parsed.data.message,
        detectedFormat ? { documentFormat: detectedFormat } : undefined,
      );

      // Check if create_document tool was called during the run
      const toolDocumentResult = this.toolService.getLastDocumentResult();
      this.toolService.clearLastDocumentResult();

      if (toolDocumentResult) {
        // Document generated via tool call
        const summary = this.buildDocumentSummary(
          parsed.data.message,
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
          const summary = this.buildDocumentSummary(
            parsed.data.message,
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

      if (!res.raw.headersSent) {
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
      const response = await this.providerRouter.chat("openrouter", {
        model: "classifier",
        providerId: "deepseek/deepseek-chat-v3.1",
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

  private buildDocumentSummary(message: string, format: string): string {
    const formatLabels: Record<string, string> = {
      pdf: "PDF",
      docx: "Word document",
      xlsx: "Excel spreadsheet",
    };
    const label = formatLabels[format] || format.toUpperCase();
    return `Here's the ${label} you requested:`;
  }
}
