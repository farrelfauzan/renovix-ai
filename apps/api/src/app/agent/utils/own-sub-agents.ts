import type { Logger } from "@nestjs/common";

/**
 * RX-112: keeps only the sub-agents owned by the parent agent's owner (not the
 * caller: channel chats and public agents can be run by someone else) and logs
 * a security warning, ids only, for every other one.
 */
export function ownSubAgents<T extends { id: string; userId: string }>(
  parent: { id: string; userId: string },
  subAgents: T[],
  logger: Logger,
): T[] {
  return subAgents.filter((sub) => {
    if (sub.userId === parent.userId) return true;
    logger.warn(
      `[security] Dropped foreign sub-agent ${sub.id} (owner ${sub.userId}) under parent ${parent.id} (owner ${parent.userId})`,
    );
    return false;
  });
}
