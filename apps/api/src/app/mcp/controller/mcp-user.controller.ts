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
import type { FastifyReply, FastifyRequest } from "fastify";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { ConnectMcpTokenSchema } from "../dto/connect-mcp-token.dto";
import { McpUserService } from "../service/mcp-user.service";
import { mcpOAuthCookieName } from "../utils/mcp-oauth-cookie-name";
import { mcpOAuthSetCookie } from "../utils/mcp-oauth-set-cookie";
import { parseCookieHeader } from "../utils/parse-cookie-header";
import { readStateProvider } from "../utils/read-state-provider";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

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
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Start OAuth flow for the authenticated user.
   * Returns an auth URL to redirect the user to, and sets the flow's one-time value as a cookie
   * for the provider (RX-152), so only this browser can complete the flow.
   */
  @Get("oauth/start")
  @Access({ auth: ["jwt", "session"] })
  async startOAuth(
    @Req() req: any,
    @Query("provider") provider: string,
    @Query("workspaceId") workspaceId: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header("cache-control", "no-store");
    if (!provider) {
      throw new BadRequestException("provider query param is required");
    }
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }

    const isProduction = process.env.NODE_ENV === "production";
    const cookieName = mcpOAuthCookieName(provider, isProduction);
    if (!cookieName) {
      throw new BadRequestException("Unsupported OAuth provider");
    }
    const { authUrl, oneTimeValue, maxAgeSeconds } = await this.mcpUserService.startOAuthFlow(
      req.user.userId,
      workspaceId,
      provider,
    );
    res.header("set-cookie", mcpOAuthSetCookie({ name: cookieName, value: oneTimeValue, maxAgeSeconds, isProduction }));
    return { authUrl };
  }

  /**
   * OAuth callback handler. Exchanges code for tokens, stores in UserMcpCredential,
   * then redirects to frontend. RX-152: only for the browser holding the flow's one-time value in
   * its cookie for the state's provider; every reply clears that cookie, success or failure.
   */
  @Get("oauth/callback")
  @Access({ public: true, reason: "the OAuth provider redirects the browser here; the state parameter names the user" })
  async oauthCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const frontendUrl =
      this.configService.get<string>("CHAT_APP_URL") || "http://localhost:4201";
    const isProduction = process.env.NODE_ENV === "production";
    // The provider is read from the state unverified, only to name the cookie; the service verifies the state.
    const provider = readStateProvider(state);
    const cookieName = provider ? mcpOAuthCookieName(provider, isProduction) : null;
    if (cookieName) {
      res.header("set-cookie", mcpOAuthSetCookie({ name: cookieName, value: "", maxAgeSeconds: 0, isProduction }));
    }

    if (!code || !state) {
      return res
        .code(302)
        .redirect(
          `${frontendUrl}/agents?view=settings&oauth=error&message=Missing+code+or+state`,
        );
    }

    try {
      const browserValue = cookieName ? parseCookieHeader(req.headers.cookie).get(cookieName) : undefined;
      await this.mcpUserService.handleOAuthCallback(code, state, browserValue);
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
    @Body() body: unknown,
  ) {
    const parsed = ConnectMcpTokenSchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    await this.workspaceService.requireMembership(parsed.data.workspaceId, req.user.userId);
    return this.mcpUserService.connectWithToken(
      req.user.userId,
      parsed.data.workspaceId,
      parsed.data.provider,
      parsed.data.env,
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
    await this.workspaceService.requireMembership(workspaceId, req.user.userId);
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
    await this.workspaceService.requireMembership(workspaceId, req.user.userId);
    return this.mcpUserService.revokeCredential(
      req.user.userId,
      workspaceId,
      provider,
    );
  }
}
