import { SOFT_DELETE_RETENTION_DAYS } from "../config/soft-delete-retention-days";

const MILLISECONDS_PER_DAY = 86_400_000;

/** RNX-126: a deleted row with `purgeAt`, its `deletedAt` plus the retention window (decision 23); null when not deleted. */
export function withPurgeAt<T extends { deletedAt: Date | null }>(row: T): T & { purgeAt: Date | null } {
  const purgeAt = row.deletedAt && new Date(row.deletedAt.getTime() + SOFT_DELETE_RETENTION_DAYS * MILLISECONDS_PER_DAY);
  return { ...row, purgeAt };
}
