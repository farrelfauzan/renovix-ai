import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import { AgentService } from "./agent.service";
import { CreateAgentSchema } from "./dto/create-agent.dto";
import { UpdateAgentSchema } from "./dto/update-agent.dto";
import {
  AttachToolSchema,
  AttachIntegrationSchema,
  DeployChannelSchema,
  AttachKnowledgeBaseSchema,
} from "./dto/agent-chat.dto";

@Controller("agents")
@UseGuards(CombinedAuthGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async create(@Body() body: unknown, @Req() req: any) {
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.create(req.user.userId, parsed.data);
  }

  @Get()
  async list(@Req() req: any) {
    return this.agentService.list(req.user.userId);
  }

  @Get("tools/available")
  async getAvailableTools() {
    return this.agentService.getAvailableTools();
  }

  @Get("public")
  async listPublic() {
    return this.agentService.listPublic();
  }

  @Post("generate-prompt")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async generatePrompt(@Body() body: unknown, @Req() req: any) {
    const name = (body as any)?.name;
    const description = (body as any)?.description;
    if (!name || typeof name !== "string") {
      throw new BadRequestException({
        error: {
          message: "Agent name is required to generate a prompt",
          type: "invalid_request_error",
        },
      });
    }
    return this.agentService.generatePrompt(name, description);
  }

  @Post("clone/:templateId")
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async cloneFromTemplate(
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Req() req: any,
  ) {
    return this.agentService.cloneFromTemplate(req.user.userId, templateId);
  }

  @Get("subscription")
  async getSubscription(@Req() req: any) {
    return this.agentService.getSubscription(req.user.userId);
  }

  @Get(":id")
  async findById(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.agentService.findById(req.user.userId, id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = UpdateAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.update(req.user.userId, id, parsed.data);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.agentService.delete(req.user.userId, id);
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const status = (body as any)?.status;
    if (!status || !["active", "draft", "archived"].includes(status)) {
      throw new BadRequestException({
        error: {
          message: "Invalid status. Must be one of: active, draft, archived",
          type: "invalid_request_error",
        },
      });
    }
    return this.agentService.updateStatus(req.user.userId, id, status);
  }

  @Post(":id/publish")
  @HttpCode(200)
  async publish(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.agentService.publish(req.user.userId, id);
  }

  // ─── Tools ───

  @Post(":id/tools")
  @HttpCode(201)
  async attachTool(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = AttachToolSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.attachTool(
      req.user.userId,
      id,
      parsed.data.toolType,
      parsed.data.config,
      parsed.data.enabled,
    );
  }

  @Delete(":id/tools/:toolId")
  @HttpCode(204)
  async removeTool(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("toolId", ParseUUIDPipe) toolId: string,
    @Req() req: any,
  ) {
    return this.agentService.removeTool(req.user.userId, id, toolId);
  }

  // ─── Integrations ───

  @Post(":id/integrations")
  @HttpCode(201)
  async attachIntegration(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = AttachIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.attachIntegration(
      req.user.userId,
      id,
      parsed.data.provider,
      parsed.data.config,
      parsed.data.scopes,
    );
  }

  @Delete(":id/integrations/:integrationId")
  @HttpCode(204)
  async removeIntegration(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("integrationId", ParseUUIDPipe) integrationId: string,
    @Req() req: any,
  ) {
    return this.agentService.removeIntegration(
      req.user.userId,
      id,
      integrationId,
    );
  }

  // ─── Knowledge Bases ───

  @Post(":id/knowledge-bases")
  @HttpCode(201)
  async attachKnowledgeBase(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = AttachKnowledgeBaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.attachKnowledgeBase(
      req.user.userId,
      id,
      parsed.data.knowledgeBaseId,
    );
  }

  @Delete(":id/knowledge-bases/:kbId")
  @HttpCode(204)
  async removeKnowledgeBase(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("kbId", ParseUUIDPipe) kbId: string,
    @Req() req: any,
  ) {
    return this.agentService.removeKnowledgeBase(req.user.userId, id, kbId);
  }

  // ─── Channels ───

  @Post(":id/channels")
  @HttpCode(201)
  async deployChannel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = DeployChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.agentService.deployChannel(
      req.user.userId,
      id,
      parsed.data.channelType,
      parsed.data.config,
    );
  }

  @Patch(":id/channels/:channelId")
  async updateChannel(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const config = body as Record<string, any>;
    return this.agentService.updateChannel(
      req.user.userId,
      id,
      channelId,
      config,
    );
  }

  @Delete(":id/channels/:channelId")
  @HttpCode(204)
  async removeChannel(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    return this.agentService.removeChannel(req.user.userId, id, channelId);
  }
}
