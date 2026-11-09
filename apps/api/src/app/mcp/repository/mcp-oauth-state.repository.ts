import { Injectable } from "@nestjs/common";
import type { McpOAuthState } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { ConsumeMcpOAuthStateInput } from "../types/consume-mcp-oauth-state-input";
import type { NewMcpOAuthState } from "../types/new-mcp-oauth-state";

/** The queries on `mcp_oauth_states` (RX-151): the one-time values of started MCP OAuth flows. */
@Injectable()
export class McpOAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores a started flow. */
  create(state: NewMcpOAuthState, tx?: DbTransaction): Promise<McpOAuthState> {
    return (tx ?? this.prisma).mcpOAuthState.create({ data: state });
  }

  /**
   * Uses a stored flow once: one DELETE of the row where nonce, user, workspace and provider all
   * match and it has not expired. True only when it deleted that row, so a second use (from any
   * instance) finds nothing. RNX-125 (D313): the flow of a deleted workspace is hidden, not erased: never used.
   */
  async consume(input: ConsumeMcpOAuthStateInput, tx?: DbTransaction): Promise<boolean> {
    const { nonce, userId, workspaceId, provider, now } = input;
    const { count } = await (tx ?? this.prisma).mcpOAuthState.deleteMany({
      where: { nonce, userId, workspaceId, provider, expiresAt: { gt: now }, workspace: { deletedAt: null } },
    });
    return count === 1;
  }

  /** Removes the flows that expired before `now`, but not those of a deleted workspace (RNX-125, D313). Returns how many. */
  async deleteExpired(now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).mcpOAuthState.deleteMany({
      where: { expiresAt: { lte: now }, workspace: { deletedAt: null } },
    });
    return count;
  }
}
