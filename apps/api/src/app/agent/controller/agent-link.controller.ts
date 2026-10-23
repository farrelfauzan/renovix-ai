import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AgentLinkService } from "../service/agent-link.service";
import { CreateAgentLinkSchema } from "../dto/create-agent-link.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/** RNX-118: an agent's links ("Can call"), for the workspace owner of the agent only (AgentLinkService). */
@Controller("agents")
@Access({ auth: ["session"] })
export class AgentLinkController {
  constructor(private readonly linkService: AgentLinkService) {}

  /** The agents this agent may call. */
  @Get(":id/links")
  async listLinks(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.linkService.listLinks(req.user.userId, id);
  }

  /** Lets this agent call another agent of its workspace. */
  @Post(":id/links")
  @HttpCode(201)
  async addLink(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const parsed = CreateAgentLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.linkService.addLink(req.user.userId, id, parsed.data.calleeAgentId);
  }

  /** Removes the link to this callee. */
  @Delete(":id/links/:calleeAgentId")
  @HttpCode(204)
  async removeLink(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("calleeAgentId", ParseUUIDPipe) calleeAgentId: string,
    @Req() req: any,
  ) {
    await this.linkService.removeLink(req.user.userId, id, calleeAgentId);
  }
}
