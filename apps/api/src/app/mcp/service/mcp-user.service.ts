import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import * as crypto from "crypto";

interface OAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

@Injectable()
export class McpUserService {
  private readonly logger = new Logger(McpUserService.name);
  private readonly encryptionKey: Buffer;
  private readonly oauthApps: Record<string, OAuthApp>;

  private readonly providerScopes: Record<string, string[]> = {
    "google-gmail": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    "google-calendar": [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    "google-sheets": ["https://www.googleapis.com/auth/spreadsheets"],
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const key =
      this.configService.get<string>("MCP_ENCRYPTION_KEY") ||
      "default-dev-key-32-bytes-long!!";
    this.encryptionKey = Buffer.from(key.padEnd(32, "0").slice(0, 32));

    this.oauthApps = {
      google: {
        clientId:
          this.configService.get<string>("GOOGLE_OAUTH_CLIENT_ID") || "",
        clientSecret:
          this.configService.get<string>("GOOGLE_OAUTH_CLIENT_SECRET") || "",
        redirectUri:
          this.configService.get<string>("GOOGLE_OAUTH_REDIRECT_URI") || "",
      },
      github: {
        clientId:
          this.configService.get<string>("GITHUB_OAUTH_CLIENT_ID") || "",
        clientSecret:
          this.configService.get<string>("GITHUB_OAUTH_CLIENT_SECRET") || "",
        redirectUri:
          this.configService.get<string>("GITHUB_OAUTH_REDIRECT_URI") || "",
      },
      slack: {
        clientId: this.configService.get<string>("SLACK_OAUTH_CLIENT_ID") || "",
        clientSecret:
          this.configService.get<string>("SLACK_OAUTH_CLIENT_SECRET") || "",
        redirectUri:
          this.configService.get<string>("SLACK_OAUTH_REDIRECT_URI") || "",
      },
    };
  }

  /**
   * Generate OAuth consent URL for a user.
   */
  async getOAuthUrl(
    userId: string,
    workspaceId: string,
    provider: string,
  ): Promise<string> {
    const oauthProvider = this.getOAuthProvider(provider);
    const app = this.oauthApps[oauthProvider];

    if (!app?.clientId || !app?.clientSecret) {
      throw new BadRequestException(
        `OAuth not configured for provider: ${oauthProvider}. Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env`,
      );
    }

    // Verify user is a member of the workspace
    await this.verifyWorkspaceMembership(userId, workspaceId);

    const state = Buffer.from(
      JSON.stringify({ userId, workspaceId, provider }),
    ).toString("base64url");

    if (oauthProvider === "google") {
      const scopes = this.providerScopes[provider];
      if (!scopes) {
        throw new BadRequestException(`Unknown Google provider: ${provider}`);
      }

      const params = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: app.redirectUri,
        response_type: "code",
        scope: scopes.join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
      });

      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    if (oauthProvider === "github") {
      const params = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: app.redirectUri,
        scope: "repo read:user",
        state,
      });
      return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }

    if (oauthProvider === "slack") {
      const params = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: app.redirectUri,
        scope: "channels:read,chat:write,users:read",
        state,
      });
      return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    }

    throw new BadRequestException(
      `Unsupported OAuth provider: ${oauthProvider}`,
    );
  }

  /**
   * Handle OAuth callback: exchange code for tokens and store credentials.
   */
  async handleOAuthCallback(
    code: string,
    stateB64: string,
  ): Promise<{ userId: string; workspaceId: string; provider: string }> {
    let state: { userId: string; workspaceId: string; provider: string };
    try {
      state = JSON.parse(Buffer.from(stateB64, "base64url").toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid OAuth state parameter");
    }

    const { userId, workspaceId, provider } = state;
    if (!userId || !workspaceId || !provider) {
      throw new BadRequestException(
        "Missing userId, workspaceId, or provider in OAuth state",
      );
    }

    const oauthProvider = this.getOAuthProvider(provider);
    const app = this.oauthApps[oauthProvider];

    if (oauthProvider === "google") {
      const tokens = await this.exchangeGoogleCode(code, app);
      if (!tokens.refresh_token) {
        throw new BadRequestException(
          "No refresh token received. Try revoking app access at https://myaccount.google.com/permissions and re-authorizing.",
        );
      }

      const envEncrypted = this.encryptJson({
        GOOGLE_CLIENT_ID: app.clientId,
        GOOGLE_CLIENT_SECRET: app.clientSecret,
        GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
      });

      await this.prisma.userMcpCredential.upsert({
        where: {
          userId_workspaceId_provider: { userId, workspaceId, provider },
        },
        create: {
          userId,
          workspaceId,
          provider,
          envEncrypted,
          status: "connected",
        },
        update: {
          envEncrypted,
          status: "connected",
          connectedAt: new Date(),
        },
      });
    } else if (oauthProvider === "github") {
      const token = await this.exchangeGithubCode(code, app);
      const envEncrypted = this.encryptJson({
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
      });

      await this.prisma.userMcpCredential.upsert({
        where: {
          userId_workspaceId_provider: { userId, workspaceId, provider },
        },
        create: {
          userId,
          workspaceId,
          provider,
          envEncrypted,
          status: "connected",
        },
        update: {
          envEncrypted,
          status: "connected",
          connectedAt: new Date(),
        },
      });
    } else if (oauthProvider === "slack") {
      const token = await this.exchangeSlackCode(code, app);
      const envEncrypted = this.encryptJson({
        SLACK_BOT_TOKEN: token,
      });

      await this.prisma.userMcpCredential.upsert({
        where: {
          userId_workspaceId_provider: { userId, workspaceId, provider },
        },
        create: {
          userId,
          workspaceId,
          provider,
          envEncrypted,
          status: "connected",
        },
        update: {
          envEncrypted,
          status: "connected",
          connectedAt: new Date(),
        },
      });
    }

    this.logger.log(
      `User ${userId} connected ${provider} in workspace ${workspaceId}`,
    );

    return state;
  }

  /**
   * Connect a token-based provider (e.g., Notion with API key).
   * Stores encrypted env in user_mcp_credentials.
   */
  async connectWithToken(
    userId: string,
    workspaceId: string,
    provider: string,
    env: Record<string, string>,
  ) {
    const envEncrypted = this.encryptJson(env);

    await this.prisma.userMcpCredential.upsert({
      where: {
        userId_workspaceId_provider: { userId, workspaceId, provider },
      },
      create: {
        userId,
        workspaceId,
        provider,
        envEncrypted,
        status: "connected",
      },
      update: {
        envEncrypted,
        status: "connected",
        connectedAt: new Date(),
      },
    });

    return { connected: true, provider };
  }

  /**
   * List user's connected providers for a workspace.
   */
  async getUserCredentials(userId: string, workspaceId: string) {
    return this.prisma.userMcpCredential.findMany({
      where: { userId, workspaceId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
        expiresAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });
  }

  /**
   * Disconnect (revoke) a user's credential for a provider.
   */
  async revokeCredential(
    userId: string,
    workspaceId: string,
    provider: string,
  ) {
    const cred = await this.prisma.userMcpCredential.findUnique({
      where: {
        userId_workspaceId_provider: { userId, workspaceId, provider },
      },
    });

    if (!cred) {
      throw new NotFoundException("Credential not found");
    }

    await this.prisma.userMcpCredential.delete({
      where: { id: cred.id },
    });

    return { disconnected: true, provider };
  }

  /**
   * Resolve credentials for a specific user + provider at runtime.
   * Returns decrypted env vars or null if not connected.
   */
  async resolveCredentials(
    userId: string,
    workspaceId: string,
    provider: string,
  ): Promise<Record<string, string> | null> {
    const cred = await this.prisma.userMcpCredential.findUnique({
      where: {
        userId_workspaceId_provider: { userId, workspaceId, provider },
      },
    });

    if (!cred || cred.status !== "connected") {
      return null;
    }

    return this.decryptJson(cred.envEncrypted);
  }

  /**
   * Get all connected providers for a user in a workspace (for buildToolSchemas).
   */
  async getUserConnectedProviders(
    userId: string,
    workspaceId: string,
  ): Promise<Map<string, Record<string, string>>> {
    const creds = await this.prisma.userMcpCredential.findMany({
      where: { userId, workspaceId, status: "connected" },
    });

    const map = new Map<string, Record<string, string>>();
    for (const cred of creds) {
      map.set(cred.provider, this.decryptJson(cred.envEncrypted));
    }
    return map;
  }

  // ─── Private helpers ───

  private getOAuthProvider(provider: string): string {
    if (provider.startsWith("google-")) return "google";
    if (provider.startsWith("github")) return "github";
    if (provider.startsWith("slack")) return "slack";
    return provider;
  }

  private async verifyWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
        status: "active",
      },
    });

    // Also allow workspace owner
    if (!membership) {
      const workspace = await this.prisma.workspace.findFirst({
        where: { id: workspaceId, ownerId: userId },
      });
      if (!workspace) {
        throw new BadRequestException("You are not a member of this workspace");
      }
    }
  }

  private async exchangeGoogleCode(
    code: string,
    app: OAuthApp,
  ): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: app.redirectUri,
      grant_type: "authorization_code",
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`Google token exchange failed: ${errorBody}`);
      throw new BadRequestException("Failed to exchange authorization code");
    }

    return response.json() as Promise<GoogleTokenResponse>;
  }

  private async exchangeGithubCode(
    code: string,
    app: OAuthApp,
  ): Promise<string> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          code,
          redirect_uri: app.redirectUri,
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException("Failed to exchange GitHub code");
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
    };
    if (data.error || !data.access_token) {
      throw new BadRequestException(
        `GitHub OAuth error: ${data.error || "no access token"}`,
      );
    }
    return data.access_token;
  }

  private async exchangeSlackCode(
    code: string,
    app: OAuthApp,
  ): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: app.redirectUri,
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new BadRequestException("Failed to exchange Slack code");
    }

    const data = (await response.json()) as {
      ok: boolean;
      access_token?: string;
      error?: string;
    };
    if (!data.ok || !data.access_token) {
      throw new BadRequestException(
        `Slack OAuth error: ${data.error || "no access token"}`,
      );
    }
    return data.access_token;
  }

  private encryptJson(data: Record<string, string>): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
  }

  private decryptJson(encrypted: string): Record<string, string> {
    try {
      const parts = encrypted.split(":");
      if (parts.length !== 3) return {};
      const [ivHex, tagHex, data] = parts;
      const iv = Buffer.from(ivHex, "hex");
      const tag = Buffer.from(tagHex, "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(data, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return JSON.parse(decrypted);
    } catch {
      return {};
    }
  }
}
