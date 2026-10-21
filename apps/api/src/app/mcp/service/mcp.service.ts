import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { McpClientService, McpServerConfig, McpToolSchema } from "./mcp-client.service";
import { McpRegistryService } from "./mcp-registry.service";
import * as crypto from "crypto";
import { readEncryptionKey } from "../../../common/utils/read-encryption-key";

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mcpClient: McpClientService,
    private readonly registry: McpRegistryService,
  ) {
    this.encryptionKey = readEncryptionKey(process.env, "MCP_ENCRYPTION_KEY");
  }

  getRegistry() {
    return this.registry.getAllPackages();
  }

  /**
   * List user's connected MCP integrations (from user_mcp_credentials).
   */
  async listServers(userId: string) {
    const credentials = await this.prisma.userMcpCredential.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });

    const allPackages = this.registry.getAllPackages();

    return credentials
      .filter((cred) => !!allPackages[cred.provider])
      .map((cred) => {
      const pkg = allPackages[cred.provider];
      return {
        id: cred.id,
        name: cred.provider,
        displayName: pkg?.displayName || cred.provider,
        transport: "stdio",
        status: cred.status,
        isGlobal: false,
        createdAt: cred.connectedAt,
      };
      });
  }

  /**
   * Test connection to an MCP provider using user's stored credentials.
   */
  async testConnection(userId: string, credentialId: string) {
    const cred = await this.prisma.userMcpCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!cred) {
      throw new NotFoundException("MCP credential not found");
    }

    const pkg = this.registry.getPackageInfo(cred.provider);
    if (!pkg) {
      return { status: "error", error: `Unknown provider: ${cred.provider}` };
    }

    const env = this.decryptJson(cred.envEncrypted);
    const config: McpServerConfig = {
      id: `test-${cred.id}`,
      name: cred.provider,
      transport: "stdio",
      command: "npx",
      args: ["-y", pkg.package],
      env,
    };

    try {
      // RNX-217: its own connection, closed here; nothing is shared with a run.
      const connection = await this.mcpClient.connect(config);
      let tools: McpToolSchema[];
      try {
        ({ tools } = (await connection.client.listTools()) as { tools: McpToolSchema[] });
      } finally {
        await this.mcpClient.close(connection);
      }

      await this.prisma.userMcpCredential.update({
        where: { id: cred.id },
        data: { status: "connected" },
      });

      return {
        status: "connected",
        toolCount: tools.length,
        tools: tools.map((t) => t.name),
      };
    } catch (err: any) {
      await this.prisma.userMcpCredential.update({
        where: { id: cred.id },
        data: { status: "expired" },
      });
      return { status: "error", error: err.message };
    }
  }

  /**
   * Disconnect (delete) a user's MCP credential by ID.
   */
  async deleteServer(userId: string, credentialId: string) {
    const cred = await this.prisma.userMcpCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!cred) {
      throw new NotFoundException("MCP credential not found");
    }

    await this.prisma.userMcpCredential.delete({ where: { id: cred.id } });
    return { deleted: true };
  }

  /**
   * Build an MCP server config from a provider name + user credentials.
   * Used by AgentToolService at runtime.
   */
  buildConfigFromProvider(
    provider: string,
    env: Record<string, string>,
    userId: string,
  ): McpServerConfig | null {
    const pkg = this.registry.getPackageInfo(provider);
    if (!pkg) return null;

    return {
      id: `${provider}-${userId}`,
      name: provider,
      transport: "stdio",
      command: "npx",
      args: ["-y", pkg.package],
      env,
    };
  }

  // ─── Helpers ───

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
