import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import * as crypto from "crypto";
import { readEncryptionKey } from "../../../common/utils/read-encryption-key";
import { readRequiredSecret } from "../../../common/utils/read-required-secret";
import type { OAuthStatePayload } from "../dto/oauth-state-payload.dto";
import { McpOAuthStateRepository } from "../repository/mcp-oauth-state.repository";
import { signOAuthState } from "../utils/sign-oauth-state";
import { verifyOAuthState } from "../utils/verify-oauth-state";

/** Signs the OAuth `state` (RX-151); required, read when a flow starts and at its callback. */
const STATE_SECRET_NAME = "MCP_OAUTH_STATE_SECRET";
/** How long a started OAuth flow may take, unless MCP_OAUTH_STATE_TTL_SECONDS says otherwise. */
const DEFAULT_STATE_TTL_SECONDS = 600;
const STATE_NONCE_BYTES = 32;
const MS_PER_SECOND = 1000;
/** One message for every refused state, so the redirect does not tell which check failed. */
const INVALID_STATE_MESSAGE = "Invalid or expired OAuth state";

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
  private readonly stateTtlSeconds: number;

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
    private readonly oauthStates: McpOAuthStateRepository,
  ) {
    this.encryptionKey = readEncryptionKey(process.env, "MCP_ENCRYPTION_KEY");
    this.stateTtlSeconds =
      Number(this.configService.get<string>("MCP_OAUTH_STATE_TTL_SECONDS")) || DEFAULT_STATE_TTL_SECONDS;

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
    // RX-151: no signing secret, no flow (nothing is stored or issued).
    const stateSecret = readRequiredSecret(process.env, STATE_SECRET_NAME);
    const oauthProvider = this.getOAuthProvider(provider);
    const app = this.oauthApps[oauthProvider];

    if (!app?.clientId || !app?.clientSecret) {
      throw new BadRequestException(
        `OAuth not configured for provider: ${oauthProvider}. Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env`,
      );
    }

    const scopes = this.providerScopes[provider];
    if (oauthProvider === "google" && !scopes) {
      throw new BadRequestException(`Unknown Google provider: ${provider}`);
    }

    // Verify user is a member of the workspace
    await this.verifyWorkspaceMembership(userId, workspaceId);

    const state = await this.issueOAuthState(userId, workspaceId, provider, stateSecret);

    if (oauthProvider === "google") {
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
    state: string,
  ): Promise<{ userId: string; workspaceId: string; provider: string }> {
    // RX-151: only the user, workspace and provider of a verified, unused state; before any code exchange.
    const { u: userId, w: workspaceId, p: provider } = await this.acceptOAuthState(state);

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

    return { userId, workspaceId, provider };
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

  /** Stores a new one-time value (after clearing expired ones) and returns the signed state for it (RX-151). */
  private async issueOAuthState(
    userId: string,
    workspaceId: string,
    provider: string,
    secret: string,
  ): Promise<string> {
    const nowMs = Date.now();
    const nonce = crypto.randomBytes(STATE_NONCE_BYTES).toString("base64url");
    const exp = Math.floor(nowMs / MS_PER_SECOND) + this.stateTtlSeconds;
    await this.oauthStates.deleteExpired(new Date(nowMs));
    await this.oauthStates.create({
      nonce,
      userId,
      workspaceId,
      provider,
      expiresAt: new Date(exp * MS_PER_SECOND),
    });
    return signOAuthState({ n: nonce, u: userId, w: workspaceId, p: provider, exp }, secret);
  }

  /**
   * RX-151: the payload of a state this server signed, not expired, used now for the first and
   * only time, whose user is still a member of its workspace. Otherwise throws without naming
   * which check failed (and never with the state in the message).
   */
  private async acceptOAuthState(state: string): Promise<OAuthStatePayload> {
    const secret = readRequiredSecret(process.env, STATE_SECRET_NAME);
    const nowMs = Date.now();
    const payload = verifyOAuthState(state, secret, Math.floor(nowMs / MS_PER_SECOND));
    if (!payload) throw new BadRequestException(INVALID_STATE_MESSAGE);
    const isFirstUse = await this.oauthStates.consume({
      nonce: payload.n,
      userId: payload.u,
      workspaceId: payload.w,
      provider: payload.p,
      now: new Date(nowMs),
    });
    if (!isFirstUse) throw new BadRequestException(INVALID_STATE_MESSAGE);
    await this.verifyWorkspaceMembership(payload.u, payload.w);
    return payload;
  }

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
      if (parts.length !== 3) throw new Error("not in iv:tag:data form");
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
    } catch (err) {
      // RX-110: a wrong MCP_ENCRYPTION_KEY or damaged data is an error, never an empty credential.
      this.logger.error(`MCP credential could not be decrypted: ${(err as Error).message}`);
      throw new Error("MCP credential could not be decrypted");
    }
  }
}
