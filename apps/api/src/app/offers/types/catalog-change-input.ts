import type { CatalogEntity } from "@generated/prisma/client.js";
import type { ChangeAuthor } from "./change-author";

/** One change to record: the row or setting it is about, its values before (null on create) and after. */
export type CatalogChangeInput = {
  readonly entity: CatalogEntity;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly author: ChangeAuthor;
  /** When the change takes effect; now when left out. */
  readonly effectiveFrom?: Date;
};
