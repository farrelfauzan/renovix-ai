import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  NotFoundException,
  HttpCode,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { ConversationService } from "../service/conversation.service";

@Controller("conversations")
@Access({ auth: ["apiKey"] })
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  async list(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const l = Math.min(Math.max(parseInt(limit || "20", 10) || 20, 1), 100);
    const o = Math.max(parseInt(offset || "0", 10) || 0, 0);

    const { conversations, total } =
      await this.conversationService.listConversations(req.user.id, l, o);

    return {
      object: "list",
      data: conversations,
      total,
      limit: l,
      offset: o,
    };
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const conversation = await this.conversationService.getConversation(
      id,
      req.user.id,
    );

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const deleted = await this.conversationService.deleteConversation(
      id,
      req.user.id,
    );

    if (!deleted) {
      throw new NotFoundException("Conversation not found");
    }
  }
}
