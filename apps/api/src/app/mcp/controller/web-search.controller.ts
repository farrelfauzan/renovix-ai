import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WebSearchService } from "../service/web-search.service";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { WebSearchKeySchema } from "../dto/web-search-key.dto";
import { UpdateWebSearchPolicySchema } from "../dto/update-web-search-policy.dto";

@Controller("integrations/web-search")
@Access({ auth: ["jwt", "session"] })
export class WebSearchController {
  constructor(
    private readonly webSearchService: WebSearchService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  @Get("status")
  async getStatus(@Req() req: any, @Query("workspaceId") workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }

    await this.workspaceService.requireMembership(workspaceId, req.user.userId);

    return this.webSearchService.getUserWebSearchStatus(
      req.user.userId,
      workspaceId,
    );
  }

  @Put("brave/key")
  async upsertBraveKey(@Req() req: any, @Body() body: unknown) {
    const parsed = WebSearchKeySchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { workspaceId, apiKey } = parsed.data;

    await this.workspaceService.requireMembership(workspaceId, req.user.userId);

    return this.webSearchService.upsertBraveApiKey(
      req.user.userId,
      workspaceId,
      apiKey,
    );
  }

  @Delete("brave/key")
  async deleteBraveKey(@Req() req: any, @Query("workspaceId") workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }

    await this.workspaceService.requireMembership(workspaceId, req.user.userId);

    return this.webSearchService.revokeBraveApiKey(req.user.userId, workspaceId);
  }

  @Get("policy")
  async getPolicy(@Req() req: any, @Query("workspaceId") workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }

    await this.workspaceService.requireMembership(workspaceId, req.user.userId);
    return this.webSearchService.getPolicy(workspaceId);
  }

  @Put("policy")
  async updatePolicy(@Req() req: any, @Body() body: unknown) {
    const parsed = UpdateWebSearchPolicySchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { workspaceId, ...policy } = parsed.data;

    await this.workspaceService.requireRole(workspaceId, req.user.userId, [
      "owner",
      "admin",
    ]);

    return this.webSearchService.updatePolicy(workspaceId, policy);
  }

  @Put("providers/:provider/key")
  async upsertProviderKey(
    @Req() req: any,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ) {
    if (provider !== "brave-search") {
      throw new BadRequestException("Only brave-search supports user API key setup");
    }

    const parsed = WebSearchKeySchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const { workspaceId, apiKey } = parsed.data;

    await this.workspaceService.requireMembership(workspaceId, req.user.userId);

    return this.webSearchService.upsertBraveApiKey(
      req.user.userId,
      workspaceId,
      apiKey,
    );
  }
}
