import type { Prisma } from "@generated/prisma/client.js";
import type { CatalogChangeInput } from "../types/catalog-change-input";

/** A value as JSON (Decimal and Date become strings), for the before and after columns. */
const toJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** The row of a change record: who, why, when it takes effect, and the values before and after. */
export function buildCatalogChange(change: CatalogChangeInput): Prisma.CatalogChangeCreateInput {
  return {
    entity: change.entity,
    entityId: change.entityId,
    changedBy: change.author.changedBy,
    reason: change.author.reason,
    after: toJson(change.after),
    ...(change.before !== null && change.before !== undefined && { before: toJson(change.before) }),
    ...(change.effectiveFrom && { effectiveFrom: change.effectiveFrom }),
  };
}
