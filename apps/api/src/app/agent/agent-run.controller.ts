import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
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
import type { FastifyReply } from "fastify";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentChatSchema } from "./dto/agent-chat.dto";
import { DocumentService } from "../document/document.service";
import { ProviderRouter } from "../providers/provider-router";

@Controller("agents")
@UseGuards(CombinedAuthGuard)
export class AgentRunController {
  private readonly logger = new Logger(AgentRunController.name);

  constructor(
    private readonly runService: AgentRunService,
    private readonly toolService: AgentToolService,
    private readonly documentService: DocumentService,
    private readonly providerRouter: ProviderRouter,
  ) {}

  @Post(":id/chat")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async chat(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
    @Res() res: FastifyReply,
  ) {
    const parsed = AgentChatSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const { message, sessionId, output_format } = parsed.data;
    const userId = req.user.userId;

    // Classify document intent via LLM
    const detectedFormat =
      output_format || (await this.classifyDocumentIntent(message));

    // Setup SSE headers (frontend expects this format)
    res.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Increase timeout for long-running agent chats (3 minutes)
    req.raw.socket.setTimeout(180000);

    try {
      // Emit status
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

      // Use non-streaming chat (reliable, no stream issues)
      const result = await this.runService.chat(
        userId,
        id,
        message,
        sessionId,
        detectedFormat ? { documentFormat: detectedFormat } : undefined,
      );

      this.logger.log(
        `[Controller] chat completed | runId=${result.runId} contentLen=${result.message.content?.length ?? 0}`,
      );

      // Check if create_document tool was called during the run
      const toolDocumentResult = this.toolService.getLastDocumentResult();
      this.toolService.clearLastDocumentResult();

      if (toolDocumentResult) {
        // Document was generated via tool call — send it
        const summary = this.buildDocumentSummary(
          message,
          toolDocumentResult.format,
        );
        const chunk = JSON.stringify({
          choices: [{ delta: { content: summary } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
        const { key: _key, ...document } = toolDocumentResult;
        res.raw.write(`data: ${JSON.stringify({ document })}\n\n`);
      } else if (detectedFormat && result.message.content) {
        // Fallback: classifier detected format, generate from response content
        try {
          const document = await this.documentService.generate(
            result.message.content,
            detectedFormat,
          );
          // Send short summary instead of full content
          const summary = this.buildDocumentSummary(message, detectedFormat);
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
          // Fallback: show full content
          const chunk = JSON.stringify({
            choices: [{ delta: { content: result.message.content } }],
          });
          res.raw.write(`data: ${chunk}\n\n`);
        }
      } else {
        // No document — send full content as usual
        const chunk = JSON.stringify({
          choices: [{ delta: { content: result.message.content } }],
        });
        res.raw.write(`data: ${chunk}\n\n`);
      }

      // Send session info
      res.raw.write(
        `data: ${JSON.stringify({ sessionId: result.sessionId, runId: result.runId })}\n\n`,
      );

      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    } catch (error: any) {
      this.logger.error(`Agent chat error: ${error.message}`, error.stack);

      if (!res.raw.headersSent) {
        throw error;
      }

      res.raw.write(
        `data: ${JSON.stringify({ error: { message: error.message } })}\n\n`,
      );
      res.raw.write("data: [DONE]\n\n");
      res.raw.end();
    }
  }

  @Get(":id/runs")
  async listRuns(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.runService.listRuns(req.user.userId, id);
  }

  @Get(":id/runs/:runId")
  async getRun(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Req() req: any,
  ) {
    return this.runService.getRun(req.user.userId, id, runId);
  }

  @Delete(":id/runs/:runId")
  @HttpCode(204)
  async deleteRun(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Req() req: any,
  ) {
    return this.runService.deleteRun(req.user.userId, id, runId);
  }

  private async classifyDocumentIntent(
    message: string,
  ): Promise<string | null> {
    try {
      const response = await this.providerRouter.chat("openrouter", {
        model: "classifier",
        providerId: "deepseek/deepseek-v4-pro",
        messages: [
          {
            role: "system",
            content:
              "You classify user messages. If the user is asking to generate/create/export a document, reply with ONLY the format: pdf, docx, or xlsx. If not, reply with: none. No explanation.",
          },
          { role: "user", content: message },
        ],
        max_tokens: 200,
        temperature: 0,
      });
      const raw = response.choices[0]?.message?.content ?? "";
      this.logger.log(`[classifyDocumentIntent] raw="${raw}"`);
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
