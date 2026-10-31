/**
 * How long the transaction that holds the system knowledge base sync lock may stay open, in ms (RNX-27): the whole
 * sync (S3 downloads and embedding calls) runs while it is held, so it is far above Prisma's 5-second default.
 * The lock is best-effort past this limit: Prisma then ends the transaction and releases the lock while the sync
 * keeps going, so another instance's sync may start alongside it, and this one throws at the end.
 */
export const SYSTEM_KNOWLEDGE_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
