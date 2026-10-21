import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * One open connection to an MCP server (RNX-217): its own client (its own child process) and, for a Google package,
 * its own credential temp dir. It belongs to whoever opened it, who closes it with McpClientService.close; it is
 * never shared or pooled.
 */
export type McpConnection = {
  readonly serverId: string;
  readonly client: Client;
  readonly credentialDir: string | null;
};
