import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpConnection } from "../types/mcp-connection";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  /**
   * RNX-217: opens a new connection (its own client and child process; for a Google package its own credential temp
   * dir) and hands it to the caller, who closes it with close(). Nothing is kept here: two runs never share a
   * connection, also two runs of one user on the same provider.
   */
  async connect(config: McpServerConfig): Promise<McpConnection> {
    const client = new Client({
      name: "renovix-agent",
      version: "1.0.0",
    });

    if (config.transport !== "stdio") {
      throw new Error(
        `Transport "${config.transport}" not supported. Use stdio.`,
      );
    }
    if (!config.command) {
      throw new Error(
        `MCP server ${config.name}: command is required for stdio transport`,
      );
    }

    // Prepare env — for Google MCP packages, write credential files
    const env = { ...process.env, ...(config.env || {}) } as Record<
      string,
      string
    >;
    const credentialDir = await this.prepareGoogleCredentials(config, env);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env,
    });

    try {
      await client.connect(transport);
    } catch (err) {
      this.cleanupCredentialFiles(credentialDir);
      throw err;
    }

    this.logger.log(`Connected to MCP server: ${config.name} (${config.id})`);
    return { serverId: config.id, client, credentialDir };
  }

  /** RNX-217: closes one connection and removes its credential temp dir, also when closing the client fails. */
  async close(connection: McpConnection): Promise<void> {
    try {
      await connection.client.close();
    } finally {
      this.cleanupCredentialFiles(connection.credentialDir);
    }
    this.logger.log(`Disconnected MCP server: ${connection.serverId}`);
  }

  /**
   * For Google MCP packages, prepare credentials based on what each package expects.
   * - google-sheets (domdomegg): just needs GOOGLE_ACCESS_TOKEN env var (stdio mode)
   * - google-gmail: needs credential files (web format)
   * - google-calendar: needs credential files (flat format)
   * Pre-refreshes the access token so packages see a valid session.
   * Returns the credential temp dir it created (RNX-217: a new one per connection), or null.
   */
  private async prepareGoogleCredentials(
    config: McpServerConfig,
    env: Record<string, string>,
  ): Promise<string | null> {
    if (!config.name.startsWith("google-")) return null;

    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const refreshToken = env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;

    // Pre-refresh: exchange refresh_token for a fresh access_token
    let accessToken = "";
    let expiryDate = 0;
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          access_token: string;
          expires_in: number;
        };
        accessToken = data.access_token;
        expiryDate = Date.now() + data.expires_in * 1000;
      } else {
        this.logger.warn(
          `Failed to pre-refresh Google token for ${config.name}: ${res.status}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Token refresh request failed for ${config.name}: ${err.message}`,
      );
    }

    // google-sheets (domdomegg): only needs GOOGLE_ACCESS_TOKEN, no files
    if (config.name === "google-sheets") {
      if (accessToken) {
        env.GOOGLE_ACCESS_TOKEN = accessToken;
      }
      this.logger.log(
        `Prepared Google access token for server ${config.name} (${config.id})`,
      );
      return null;
    }

    // Other Google packages need credential files on disk, in a new dir per connection (mode 0700)
    const credDir = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-google-${config.id}-`));

    // gcp-oauth.keys.json — OAuth client credentials
    // Gmail package expects {"web": {...}}, Calendar accepts flat format
    const oauthKeysPath = path.join(credDir, "gcp-oauth.keys.json");
    const oauthKeysContent =
      config.name === "google-gmail"
        ? {
            web: {
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uris: ["http://localhost:3000/oauth2callback"],
            },
          }
        : {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uris: ["http://localhost:3000/oauth2callback"],
          };
    fs.writeFileSync(oauthKeysPath, JSON.stringify(oauthKeysContent), {
      mode: 0o600,
    });

    // tokens.json — stored OAuth tokens (with pre-refreshed access_token)
    const tokensPath = path.join(credDir, "tokens.json");
    fs.writeFileSync(
      tokensPath,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expiry_date: expiryDate,
      }),
      { mode: 0o600 },
    );

    // Set env vars based on which Google package is being used
    if (config.name === "google-gmail") {
      env.GMAIL_OAUTH_PATH = oauthKeysPath;
      env.GMAIL_CREDENTIALS_PATH = tokensPath;
    } else if (config.name === "google-calendar") {
      env.GOOGLE_OAUTH_CREDENTIALS = oauthKeysPath;
      env.GOOGLE_CALENDAR_MCP_TOKEN_PATH = tokensPath;
    }

    this.logger.log(
      `Prepared ephemeral Google credentials at ${credDir} for server ${config.name} (${config.id})`,
    );
    return credDir;
  }

  /**
   * Remove the ephemeral credential files of one connection.
   */
  private cleanupCredentialFiles(credDir: string | null): void {
    if (!credDir) return;

    try {
      fs.rmSync(credDir, { recursive: true, force: true });
      this.logger.log(`Cleaned up credential files at ${credDir}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to clean up credential files at ${credDir}: ${err.message}`,
      );
    }
  }
}
