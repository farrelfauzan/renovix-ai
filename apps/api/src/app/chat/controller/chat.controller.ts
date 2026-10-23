import {
  Controller,
  Post,
  Body,
  Req,
  Res,
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
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

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
      throw createInvalidBodyException(parsed.error);
    }

    if (!parsed.data.stream) {
      const { completion, creditsUsed } = await this.chatService.createCompletion(
        parsed.data as ChatCompletionRequest,
        req.user,
      );
      // RNX-232 (D47): the credits this call used.
      return res.header("X-Credits-Used", creditsUsed).send(completion);
    }

    // RNX-196: the streamed answer. RNX-171: an error after the SSE headers ends that stream, not the process.
    return guardSseStream({
      response: res.raw,
      logger: this.logger,
      stream: () => this.chatService.streamCompletion(parsed.data, req.user, res.raw),
    });
  }
}
