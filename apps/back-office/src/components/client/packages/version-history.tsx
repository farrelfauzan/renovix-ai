"use client";

import { describePrice, describeTerms } from "@/lib/packages/describe-terms";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { OfferKind } from "@/lib/packages/offer-kind";

/** Every version of an offer, newest first: earlier versions stay as history, and buyers keep the one they bought (D37). */
export function VersionHistory({ kind, offer }: { kind: OfferKind; offer: CatalogOffer }) {
  const now = new Date();
  return (
    <ul aria-label={`Versions of ${offer.name}`} className="flex flex-col gap-1 text-sm">
      {offer.versions.map((version) => (
        <li key={version.id}>
          <strong>v{version.versionNumber}</strong>
          {new Date(version.effectiveFrom) > now ? " (scheduled)" : ""} · from {new Date(version.effectiveFrom).toLocaleDateString("en-GB")} · {describePrice(kind, version)} · {describeTerms(kind, version)}
          <span className="text-rx-muted"> · {version.reason}</span>
        </li>
      ))}
    </ul>
  );
}
