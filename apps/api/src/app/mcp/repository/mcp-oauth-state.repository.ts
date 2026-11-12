import { Injectable } from "@nestjs/common";
import type { McpOAuthState, Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { ConsumeMcpOAuthStateInput } from "../types/consume-mcp-oauth-state-input";
import type { NewMcpOAuthState } from "../types/new-mcp-oauth-state";

/** RNX-292: a flow started from no workspace, or from one that is not deleted (RNX-125, D313). */
const LIVE_WORKSPACE_OR_NONE: Prisma.McpOAuthStateWhereInput[] = [{ workspaceId: null }, { workspace: { deletedAt: null } }];

/** The queries on `mcp_oauth_states` (RX-151): the one-time values of started MCP OAuth flows. */
@Injectable()
export class McpOAuthStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores a started flow. */
  create(state: NewMcpOAuthState, tx?: DbTransaction): Promise<McpOAuthState> {
    return (tx ?? this.prisma).mcpOAuthState.create({ data: state });
  }

  /**
   * Uses a stored flow once and returns it (null when there is none to use): the row where nonce, user and provider
   * all match and it has not expired. One conditional DELETE decides, so a second use (from any instance) finds
   * nothing. RNX-125 (D313): the flow of a deleted workspace is hidden, not erased: never used. RNX-292: the row's
   * workspace (nullable) is read here, server side; the signed state does not carry one.
   */
  async consume(input: ConsumeMcpOAuthStateInput, tx?: DbTransaction): Promise<McpOAuthState | null> {
    const { nonce, userId, provider, now } = input;
    const where = { nonce, userId, provider, expiresAt: { gt: now }, OR: LIVE_WORKSPACE_OR_NONE };
    const state = await (tx ?? this.prisma).mcpOAuthState.findFirst({ where });
    if (!state) return null;
    const { count } = await (tx ?? this.prisma).mcpOAuthState.deleteMany({ where });
    return count === 1 ? state : null;
  }

  /** Removes the flows that expired before `now`, but not those of a deleted workspace (RNX-125, D313). Returns how many. */
  async deleteExpired(now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).mcpOAuthState.deleteMany({
      where: { expiresAt: { lte: now }, OR: LIVE_WORKSPACE_OR_NONE },
    });
    return count;
  }
}
