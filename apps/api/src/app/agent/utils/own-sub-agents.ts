import type { Logger } from "@nestjs/common";

/**
 * RX-112: keeps only the sub-agents in the parent agent's workspace (RNX-203; not
 * the caller's: channel chats and public agents can be run by someone else) and
 * logs a security warning, ids only, for every other one. The owners in the
 * warning are the creators (`userId`).
 */
export function ownSubAgents<
  T extends { id: string; userId: string; workspaceId: string },
>(
  parent: { id: string; userId: string; workspaceId: string },
  subAgents: T[],
  logger: Logger,
): T[] {
  return subAgents.filter((sub) => {
    if (sub.workspaceId === parent.workspaceId) return true;
    logger.warn(
      `[security] Dropped foreign sub-agent ${sub.id} (owner ${sub.userId}) under parent ${parent.id} (owner ${parent.userId})`,
    );
    return false;
  });
}
