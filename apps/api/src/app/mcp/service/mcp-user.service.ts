import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { McpOAuthState } from "@generated/prisma/client.js";
import { ConfigService } from "@nestjs/config";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import * as crypto from "crypto";
import { readEncryptionKey } from "../../../common/utils/read-encryption-key";
import { readRequiredSecret } from "../../../common/utils/read-required-secret";
import { McpOAuthStateRepository } from "../repository/mcp-oauth-state.repository";
import { UserMcpCredentialRepository } from "../repository/user-mcp-credential.repository";
import { WorkspaceMcpConnectionRepository } from "../repository/workspace-mcp-connection.repository";
import type { McpOAuthCallbackResult } from "../types/mcp-oauth-callback-result";
import type { McpOAuthStart } from "../types/mcp-oauth-start";
import { isSameOneTimeValue } from "../utils/is-same-one-time-value";
import { signOAuthState } from "../utils/sign-oauth-state";
import { verifyOAuthState } from "../utils/verify-oauth-state";
import { getOAuthProvider } from "../utils/get-oauth-provider";

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
    private readonly credentials: UserMcpCredentialRepository,
    private readonly oauthStates: McpOAuthStateRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly connections: WorkspaceMcpConnectionRepository,
  ) {
    this.encryptionKey = readEncryptionKey(process.env, "MCP_ENCRYPTION_KEY");
    const stateTtlSeconds = Number(this.configService.get<string>("MCP_OAUTH_STATE_TTL_SECONDS"));
    // RX-152: not a whole number of seconds above 0 (unset included) falls back to the default.
    this.stateTtlSeconds =
      Number.isInteger(stateTtlSeconds) && stateTtlSeconds > 0 ? stateTtlSeconds : DEFAULT_STATE_TTL_SECONDS;

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
   * Starts an OAuth flow for a user (RX-152): the consent URL, plus the flow's one-time value and
   * lifetime, which the controller sets as the cookie that ties the callback to this browser.
   * RNX-292: the credential is the account's; `workspaceId`, if given, is where the callback switches it on.
   */
  async startOAuthFlow(userId: string, workspaceId: string | undefined, provider: string): Promise<McpOAuthStart> {
    const oneTimeValue = crypto.randomBytes(STATE_NONCE_BYTES).toString("base64url");
    const authUrl = await this.getOAuthUrl(userId, workspaceId, provider, oneTimeValue);
    return { authUrl, oneTimeValue, maxAgeSeconds: this.stateTtlSeconds };
  }

  /**
   * Generate OAuth consent URL for a user, whose state carries the one-time value `nonce`.
   */
  private async getOAuthUrl(
    userId: string,
    workspaceId: string | undefined,
    provider: string,
    nonce: string,
  ): Promise<string> {
    // RX-151: no signing secret, no flow (nothing is stored or issued).
    const stateSecret = readRequiredSecret(process.env, STATE_SECRET_NAME);
    const oauthProvider = getOAuthProvider(provider);
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

    // RNX-206: the same membership check as the workspace routes (403, collaboration rule, default workspace 404).
    if (workspaceId) await this.workspaceService.requireMembership(workspaceId, userId);

    const state = await this.issueOAuthState(userId, workspaceId, provider, nonce, stateSecret);

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
   * Handle OAuth callback: exchange code for tokens and store the account's credential. `browserValue` is the
   * one-time value the calling browser holds in its cookie for the state's provider (RX-152). RNX-292: then, if the
   * flow was started from a workspace and the user is still allowed in it, the credential is switched on there.
   */
  async handleOAuthCallback(
    code: string,
    state: string,
    browserValue: string | undefined,
  ): Promise<McpOAuthCallbackResult> {
    // RX-151/RX-152: only the user and provider of a verified, unused state, presented by the browser that
    // started the flow; before any code exchange. RNX-292: the workspace comes from the stored row, not the state.
    const { userId, workspaceId, provider } = await this.acceptOAuthState(state, browserValue);

    const oauthProvider = getOAuthProvider(provider);
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

      await this.credentials.upsertCredential({ userId, provider, envEncrypted });
    } else if (oauthProvider === "github") {
      const token = await this.exchangeGithubCode(code, app);
      const envEncrypted = this.encryptJson({
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
      });

      await this.credentials.upsertCredential({ userId, provider, envEncrypted });
    } else if (oauthProvider === "slack") {
      const token = await this.exchangeSlackCode(code, app);
      const envEncrypted = this.encryptJson({
        SLACK_BOT_TOKEN: token,
      });

      await this.credentials.upsertCredential({ userId, provider, envEncrypted });
    }

    this.logger.log(`User ${userId} connected ${provider}`);
    const switchedOnIn = workspaceId ? await this.switchOnIfMember(userId, workspaceId, provider) : null;

    return { userId, provider, workspaceId: switchedOnIn };
  }

  /**
   * Connect a token-based provider (e.g., Notion with API key).
   * Stores encrypted env in user_mcp_credentials, for the account (RNX-292). With `workspaceId` (whose membership
   * the caller has checked) the connection is also switched on in that workspace.
   */
  async connectWithToken(
    userId: string,
    workspaceId: string | undefined,
    provider: string,
    env: Record<string, string>,
  ) {
    const envEncrypted = this.encryptJson(env);

    const credential = await this.credentials.upsertCredential({ userId, provider, envEncrypted });
    if (workspaceId) await this.connections.switchOn(workspaceId, credential.id);

    return { connected: true, provider };
  }

  /**
   * List user's connected providers switched on in a workspace.
   */
  async getUserCredentials(userId: string, workspaceId: string) {
    return this.credentials.listCredentialSummaries(userId, workspaceId);
  }

  /** RNX-292: every account connection of the user, each with the ids of the workspaces it is switched on in. */
  async getAccountCredentials(userId: string) {
    const credentials = await this.credentials.listAccountCredentialSummaries(userId);
    return credentials.map(({ workspaceConnections, ...credential }) => ({
      ...credential,
      workspaceIds: workspaceConnections.map((connection) => connection.workspaceId),
    }));
  }

  /**
   * RNX-292: switches the user's own account connection of `provider` on in a workspace (whose membership the caller
   * has checked). 404 when the account has no such connection.
   */
  async enableInWorkspace(userId: string, workspaceId: string, provider: string) {
    const cred = await this.credentials.findCredential({ userId, provider });

    if (!cred) {
      throw new NotFoundException("Credential not found");
    }

    await this.connections.switchOn(workspaceId, cred.id);

    return { enabled: true, provider, workspaceId };
  }

  /**
   * Disconnect (revoke) a user's credential for a provider. RNX-292: with `workspaceId` it is only switched off in
   * that workspace and the account keeps it; without, the account credential and every switch of it go.
   */
  async revokeCredential(
    userId: string,
    workspaceId: string | undefined,
    provider: string,
  ) {
    const cred = await this.credentials.findCredential({ userId, provider });

    if (!cred) {
      throw new NotFoundException("Credential not found");
    }

    if (workspaceId) await this.connections.switchOff(workspaceId, cred.id);
    else await this.credentials.deleteCredential(cred.id);

    return { disconnected: true, provider };
  }

  /**
   * Resolve credentials for a specific user + provider at runtime.
   * Returns decrypted env vars, or null unless the account's credential is connected and switched on in the
   * workspace (RNX-292).
   */
  async resolveCredentials(
    userId: string,
    workspaceId: string,
    provider: string,
  ): Promise<Record<string, string> | null> {
    const cred = await this.credentials.findSwitchedOnCredential({ userId, workspaceId, provider });

    if (!cred) {
      return null;
    }

    return this.decryptJson(cred.envEncrypted);
  }

  /**
   * Get all connected providers for a user switched on in a workspace (for buildToolSchemas).
   */
  async getUserConnectedProviders(
    userId: string,
    workspaceId: string,
  ): Promise<Map<string, Record<string, string>>> {
    const creds = await this.credentials.listConnectedCredentials(userId, workspaceId);

    const map = new Map<string, Record<string, string>>();
    for (const cred of creds) {
      map.set(cred.provider, this.decryptJson(cred.envEncrypted));
    }
    return map;
  }

  // ─── Private helpers ───

  /**
   * Stores the one-time value `nonce` (after clearing expired ones) and returns the signed state for it (RX-151).
   * RNX-292: the workspace is stored on the row only, never signed into the state.
   */
  private async issueOAuthState(
    userId: string,
    workspaceId: string | undefined,
    provider: string,
    nonce: string,
    secret: string,
  ): Promise<string> {
    const nowMs = Date.now();
    const exp = Math.floor(nowMs / MS_PER_SECOND) + this.stateTtlSeconds;
    await this.oauthStates.deleteExpired(new Date(nowMs));
    await this.oauthStates.create({
      nonce,
      userId,
      workspaceId: workspaceId ?? null,
      provider,
      expiresAt: new Date(exp * MS_PER_SECOND),
    });
    return signOAuthState({ n: nonce, u: userId, p: provider, exp }, secret);
  }

  /**
   * RX-151: the stored flow of a state this server signed, not expired, used now for the first and
   * only time. RX-152: and whose one-time value the calling browser holds (`browserValue`, its cookie).
   * Otherwise throws without naming which check failed (and never with the state or cookie in the message).
   * RNX-292: the flow's workspace, if any, is the stored row's; the caller uses it only after these checks.
   */
  private async acceptOAuthState(state: string, browserValue: string | undefined): Promise<McpOAuthState> {
    const secret = readRequiredSecret(process.env, STATE_SECRET_NAME);
    const nowMs = Date.now();
    const payload = verifyOAuthState(state, secret, Math.floor(nowMs / MS_PER_SECOND));
    if (!payload) throw new BadRequestException(INVALID_STATE_MESSAGE);
    const flow = await this.oauthStates.consume({
      nonce: payload.n,
      userId: payload.u,
      provider: payload.p,
      now: new Date(nowMs),
    });
    if (!flow) throw new BadRequestException(INVALID_STATE_MESSAGE);
    // RX-152: compared AFTER the value is used up, so a link presented without the starter's cookie
    // burns the flow: the starter (who may be the attacker) cannot replay a code that leaked from it.
    if (!isSameOneTimeValue(browserValue, payload.n)) throw new BadRequestException(INVALID_STATE_MESSAGE);
    return flow;
  }

  /**
   * RNX-292: after an OAuth callback stored the account credential, switches it on in the workspace the flow was
   * started from, if the user is still allowed there (requireMembership, checked again now). Returns that
   * workspace, or null when the user lost access: the credential then stays on the account only.
   */
  private async switchOnIfMember(userId: string, workspaceId: string, provider: string): Promise<string | null> {
    try {
      await this.workspaceService.requireMembership(workspaceId, userId);
    } catch (err) {
      if (!(err instanceof NotFoundException || err instanceof ForbiddenException)) throw err;
      this.logger.warn(`User ${userId} connected ${provider} but may no longer use workspace ${workspaceId}; not switched on there`);
      return null;
    }
    await this.enableInWorkspace(userId, workspaceId, provider);
    return workspaceId;
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
