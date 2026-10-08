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
  UseGuards,
} from "@nestjs/common";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import { WorkspaceService } from "../workspace/workspace.service";
import { WebSearchService } from "./web-search.service";

@Controller("integrations/web-search")
@UseGuards(CombinedAuthGuard)
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

    return this.webSearchService.getUserWebSearchStatus(
      req.user.userId,
      workspaceId,
    );
  }

  @Put("brave/key")
  async upsertBraveKey(
    @Req() req: any,
    @Body() body: { workspaceId: string; apiKey: string },
  ) {
    if (!body.workspaceId) {
      throw new BadRequestException("workspaceId is required");
    }
    if (!body.apiKey) {
      throw new BadRequestException("apiKey is required");
    }

    await this.workspaceService.requireMembership(body.workspaceId, req.user.userId);

    return this.webSearchService.upsertBraveApiKey(
      req.user.userId,
      body.workspaceId,
      body.apiKey,
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
  async updatePolicy(
    @Req() req: any,
    @Body()
    body: {
      workspaceId: string;
      allowedProviders?: Array<"brave-search" | "duckduckgo">;
      preferredProvider?: "brave-search" | "duckduckgo";
      maxResults?: number;
      dailyLimitPerUser?: number;
    },
  ) {
    if (!body.workspaceId) {
      throw new BadRequestException("workspaceId is required");
    }

    await this.workspaceService.requireRole(body.workspaceId, req.user.userId, [
      "owner",
      "admin",
    ]);

    return this.webSearchService.updatePolicy(body.workspaceId, {
      allowedProviders: body.allowedProviders,
      preferredProvider: body.preferredProvider,
      maxResults: body.maxResults,
      dailyLimitPerUser: body.dailyLimitPerUser,
    });
  }

  @Put("providers/:provider/key")
  async upsertProviderKey(
    @Req() req: any,
    @Param("provider") provider: string,
    @Body() body: { workspaceId: string; apiKey: string },
  ) {
    if (provider !== "brave-search") {
      throw new BadRequestException("Only brave-search supports user API key setup");
    }

    if (!body.workspaceId || !body.apiKey) {
      throw new BadRequestException("workspaceId and apiKey are required");
    }

    await this.workspaceService.requireMembership(body.workspaceId, req.user.userId);

    return this.webSearchService.upsertBraveApiKey(
      req.user.userId,
      body.workspaceId,
      body.apiKey,
    );
  }
}
