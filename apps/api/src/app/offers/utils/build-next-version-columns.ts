import type { NextVersionColumns } from "../types/next-version-columns";
import type { VersionInput } from "../types/version-input";

/** The number, author and effective time of the version that follows `latest` (version 1 when there is none). */
export function buildNextVersionColumns(latest: { readonly versionNumber: number } | null, input: VersionInput<unknown>): NextVersionColumns {
  return {
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    createdBy: input.author.changedBy,
    reason: input.author.reason,
    ...(input.effectiveFrom && { effectiveFrom: input.effectiveFrom }),
  };
}
