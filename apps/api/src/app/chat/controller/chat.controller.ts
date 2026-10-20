import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  BadRequestException,
  HttpCode,
  Logger,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { guardSseStream } from "../../../common/utils/guard-sse-stream";
import { ChatService } from "../service/chat.service";
import {
  ChatCompletionRequest,
  ApiChatCompletionRequestSchema,
} from "../dto/chat-completion.dto";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post("completions")
  @Access({ auth: ["apiKey"] })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async createCompletion(@Body() body: unknown, @Req() req: any, @Res() res: FastifyReply) {
    const parsed = ApiChatCompletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    if (!parsed.data.stream) {
      return res.send(
        await this.chatService.createCompletion(
          parsed.data as ChatCompletionRequest,
          req.user,
        ),
      );
    }

    // RNX-196: the streamed answer. RNX-171: an error after the SSE headers ends that stream, not the process.
    return guardSseStream({
      response: res.raw,
      logger: this.logger,
      stream: () => this.chatService.streamCompletion(parsed.data, req.user, res.raw),
    });
  }
}
