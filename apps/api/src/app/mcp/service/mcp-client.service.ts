import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
  private clients = new Map<string, Client>();
  private credentialDirs = new Map<string, string>(); // serverId → temp dir path

  async connectServer(config: McpServerConfig): Promise<void> {
    // Skip if already connected
    if (this.clients.has(config.id)) return;

    const client = new Client({
      name: "renovix-agent",
      version: "1.0.0",
    });

    if (config.transport === "stdio") {
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
      await this.prepareGoogleCredentials(config, env);

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env,
      });

      await client.connect(transport);
    } else {
      throw new Error(
        `Transport "${config.transport}" not supported. Use stdio.`,
      );
    }

    this.clients.set(config.id, client);
    this.logger.log(`Connected to MCP server: ${config.name} (${config.id})`);
  }

  async listTools(serverId: string): Promise<McpToolSchema[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const { tools } = await client.listTools();
    return tools as McpToolSchema[];
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.close();
      this.clients.delete(serverId);
      this.cleanupCredentialFiles(serverId);
      this.logger.log(`Disconnected MCP server: ${serverId}`);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id] of this.clients) {
      await this.disconnectServer(id);
    }
  }

  isConnected(serverId: string): boolean {
    return this.clients.has(serverId);
  }

  /**
   * Convert MCP tool schema to OpenAI function-calling format
   */
  mcpToolToOpenAI(mcpTool: McpToolSchema): {
    type: "function";
    function: { name: string; description: string; parameters: any };
  } {
    return {
      type: "function",
      function: {
        name: mcpTool.name,
        description: mcpTool.description || "",
        parameters: mcpTool.inputSchema || { type: "object", properties: {} },
      },
    };
  }

  /**
   * For Google MCP packages, prepare credentials based on what each package expects.
   * - google-sheets (domdomegg): just needs GOOGLE_ACCESS_TOKEN env var (stdio mode)
   * - google-gmail: needs credential files (web format)
   * - google-calendar: needs credential files (flat format)
   * Pre-refreshes the access token so packages see a valid session.
   */
  private async prepareGoogleCredentials(
    config: McpServerConfig,
    env: Record<string, string>,
  ): Promise<void> {
    if (!config.name.startsWith("google-")) return;

    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const refreshToken = env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return;

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
      return;
    }

    // Other Google packages need credential files on disk
    const credDir = path.join(os.tmpdir(), `mcp-google-${config.id}`);
    fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    this.credentialDirs.set(config.id, credDir);

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
  }

  /**
   * Remove ephemeral credential files for a disconnected server.
   */
  private cleanupCredentialFiles(serverId: string): void {
    const credDir = this.credentialDirs.get(serverId);
    if (!credDir) return;

    try {
      fs.rmSync(credDir, { recursive: true, force: true });
      this.credentialDirs.delete(serverId);
      this.logger.log(`Cleaned up credential files at ${credDir}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to clean up credential files at ${credDir}: ${err.message}`,
      );
    }
  }
}
