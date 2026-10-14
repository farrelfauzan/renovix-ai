import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  Req,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply } from "fastify";
import { McpUserService } from "../service/mcp-user.service";

/**
 * Per-user MCP OAuth and credential management.
 * Users connect their own accounts (Google, GitHub, Slack) via platform-level OAuth apps.
 * Credentials are stored per-user and used at runtime when agents execute MCP tools.
 */
@Controller("mcp/user")
export class McpUserController {
  constructor(
    private readonly mcpUserService: McpUserService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Start OAuth flow for the authenticated user.
   * Returns an auth URL to redirect the user to.
   */
  @Get("oauth/start")
  @Access({ auth: ["jwt", "session"] })
  async startOAuth(
    @Req() req: any,
    @Query("provider") provider: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    if (!provider) {
      throw new BadRequestException("provider query param is required");
    }
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }

    const authUrl = await this.mcpUserService.getOAuthUrl(
      req.user.userId,
      workspaceId,
      provider,
    );
    return { authUrl };
  }

  /**
   * OAuth callback handler. Exchanges code for tokens, stores in UserMcpCredential,
   * then redirects to frontend.
   */
  @Get("oauth/callback")
  @Access({ public: true, reason: "the OAuth provider redirects the browser here; the state parameter names the user" })
  async oauthCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: FastifyReply,
  ) {
    const frontendUrl =
      this.configService.get<string>("CHAT_APP_URL") || "http://localhost:4201";

    if (!code || !state) {
      return res
        .code(302)
        .redirect(
          `${frontendUrl}/agents?view=settings&oauth=error&message=Missing+code+or+state`,
        );
    }

    try {
      await this.mcpUserService.handleOAuthCallback(code, state);
      return res
        .code(302)
        .redirect(`${frontendUrl}/agents?view=settings&oauth=success`);
    } catch (err: any) {
      const message = encodeURIComponent(err.message || "Authorization failed");
      return res
        .code(302)
        .redirect(
          `${frontendUrl}/agents?view=settings&oauth=error&message=${message}`,
        );
    }
  }

  /**
   * Connect a token-based MCP provider (e.g., Notion with API key).
   */
  @Post("connect")
  @Access({ auth: ["jwt", "session"] })
  async connectWithToken(
    @Req() req: any,
    @Body()
    body: {
      provider: string;
      workspaceId: string;
      env: Record<string, string>;
    },
  ) {
    if (!body.provider || !body.workspaceId || !body.env) {
      throw new BadRequestException(
        "provider, workspaceId, and env are required",
      );
    }
    return this.mcpUserService.connectWithToken(
      req.user.userId,
      body.workspaceId,
      body.provider,
      body.env,
    );
  }

  /**
   * List current user's connected credentials for a workspace.
   */
  @Get("credentials")
  @Access({ auth: ["jwt", "session"] })
  async listCredentials(
    @Req() req: any,
    @Query("workspaceId") workspaceId: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }
    return this.mcpUserService.getUserCredentials(req.user.userId, workspaceId);
  }

  /**
   * Disconnect (revoke) a provider for the current user.
   */
  @Delete("credentials/:provider")
  @Access({ auth: ["jwt", "session"] })
  async disconnect(
    @Req() req: any,
    @Param("provider") provider: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }
    return this.mcpUserService.revokeCredential(
      req.user.userId,
      workspaceId,
      provider,
    );
  }
}
