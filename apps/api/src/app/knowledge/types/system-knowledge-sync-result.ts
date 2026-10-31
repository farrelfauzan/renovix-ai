/** What one system knowledge base sync did (RNX-27): `skipped` when another sync held the lock and nothing ran. */
export type SystemKnowledgeSyncResult = {
  readonly synced: number;
  readonly unchanged: number;
  readonly skipped: boolean;
};
