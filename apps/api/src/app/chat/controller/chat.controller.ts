import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  HttpCode,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiKeyGuard } from "../../guards/api-key.guard";
import { ChatService } from "../service/chat.service";
import {
  ChatCompletionRequest,
  ChatCompletionRequestSchema,
} from "../dto/chat-completion.dto";

@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("completions")
  @UseGuards(ApiKeyGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async createCompletion(@Body() body: unknown, @Req() req: any) {
    const parsed = ChatCompletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    return this.chatService.createCompletion(
      parsed.data as ChatCompletionRequest,
      req.user,
    );
  }
}
