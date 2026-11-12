import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  ParseUUIDPipe,
  Logger,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import type { FastifyReply } from "fastify";
import { AgentRunService } from "../service/agent-run.service";
import { type AgentChatDto, AgentChatSchema } from "../dto/agent-chat.dto";
import { DocumentService } from "../../document/service/document.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { buildDocumentSummary } from "../../../common/utils/build-document-summary";
import { guardSseStream } from "../../../common/utils/guard-sse-stream";
import type { SseStream } from "../../../common/utils/sse-stream";
import { codedRefusalOf } from "../../../common/utils/coded-refusal-of";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("agents")
@Access({ auth: ["session"] })
export class AgentRunController {
  private readonly logger = new Logger(AgentRunController.name);

  constructor(
    private readonly runService: AgentRunService,
    private readonly documentService: DocumentService,
    private readonly providerRouter: ProviderRouter,
    private readonly registry: ModelRegistryService,
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
      throw createInvalidBodyException(parsed.error);
    }
    // RNX-171: an error after the SSE headers ends that stream, not the process.
    return guardSseStream({ response: res.raw, logger: this.logger, stream: (sse) => this.streamChat(id, parsed.data, req, res, sse) });
  }

  // RNX-42: `sse.signal` is aborted when the client leaves; RNX-25 (D336): the run gets it, so no further model call starts and no answer is stored.
  private async streamChat(id: string, input: AgentChatDto, req: any, res: FastifyReply, sse: SseStream) {
    const { message, sessionId, output_format } = input;
    const userId = req.user.userId;

    // RX-178 (review B1), RNX-200: 404, the fixed 400 for an unusable model, 403 without a subscription and the run's
    // 402s (credits, per-run cap) are real HTTP answers, before the classifier call and the SSE headers.
    await this.runService.assertRunCanStart(userId, id, message);

    // Classify document intent via LLM
    const detectedFormat =
      output_format || (await this.classifyDocumentIntent(message));

    // Setup SSE headers (frontend expects this format). RNX-42: CORS from the app's allow-list, no longer `*`.
    sse.open();

    try {
      // Emit status
      if (detectedFormat) {
        sse.writeJson({ status: "generating_document" });
      } else {
        sse.writeJson({ status: "understanding" });
      }

      // Use non-streaming chat (reliable, no stream issues)
      const result = await this.runService.chat(
        userId,
        id,
        message,
        sessionId,
        { ...(detectedFormat && { documentFormat: detectedFormat }), signal: sse.signal },
      );

      this.logger.log(
        `[Controller] chat completed | runId=${result.runId} contentLen=${result.message.content?.length ?? 0}`,
      );

      // RNX-222: the document this run's own create_document call generated, if it was called
      const toolDocumentResult = result.document;

      if (toolDocumentResult) {
        // Document was generated via tool call — send it
        const summary = buildDocumentSummary(
          message,
          toolDocumentResult.format,
        );
        const chunk = JSON.stringify({
          choices: [{ delta: { content: summary } }],
        });
        sse.writeData(chunk);
        const { key: _key, ...document } = toolDocumentResult;
        sse.writeJson({ document });
      } else if (detectedFormat && result.message.content) {
        // Fallback: classifier detected format, generate from response content
        try {
          const document = await this.documentService.generate(
            result.message.content,
            detectedFormat,
          );
          // Send short summary instead of full content
          const summary = buildDocumentSummary(message, detectedFormat);
          const chunk = JSON.stringify({
            choices: [{ delta: { content: summary } }],
          });
          sse.writeData(chunk);
          sse.writeJson({ document });
        } catch (err: any) {
          this.logger.error(
            `Document generation failed: ${err.message}`,
            err.stack,
          );
          // Fallback: show full content
          const chunk = JSON.stringify({
            choices: [{ delta: { content: result.message.content } }],
          });
          sse.writeData(chunk);
        }
      } else {
        // No document — send full content as usual
        const chunk = JSON.stringify({
          choices: [{ delta: { content: result.message.content } }],
        });
        sse.writeData(chunk);
      }

      // Send session info
      sse.writeJson({ sessionId: result.sessionId, runId: result.runId });

      sse.writeData("[DONE]");
      sse.end();
    } catch (error: any) {
      this.logger.error(`Agent chat error: ${error.message}`, error.stack);

      // RNX-200: a refusal with a code (402 CREDITS_EXHAUSTED, RUN_CAP_EXCEEDED) goes to the stream guard, which
      // sends its code in the error event.
      if (!res.raw.headersSent || codedRefusalOf(error)) {
        throw error;
      }

      sse.writeJson({ error: { message: error.message } });
      sse.writeData("[DONE]");
      sse.end();
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
      // RX-178: the cheapest resolvable Standard model, never a hard-coded vendor id.
      const connection = await this.registry.resolveCheapestConnection("standard");
      const response = await this.providerRouter.chat({
        model: connection.slug,
        connection,
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
}
