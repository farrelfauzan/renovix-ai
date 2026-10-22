"use client";

import { describePrice, describeTerms } from "@/lib/packages/describe-terms";
import { findCurrentVersion } from "@/lib/packages/current-version";
import { formatRupiah } from "@/lib/packages/format-rupiah";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { OfferKind } from "@/lib/packages/offer-kind";
import { VersionHistory } from "./version-history";

type CatalogRowProps = {
  readonly kind: OfferKind;
  readonly offer: CatalogOffer;
  /** The derived rupiah price of the current version from the public price list, when it has one. */
  readonly rupiahPrice?: number;
  readonly canWrite: boolean;
  readonly isHistoryOpen: boolean;
  readonly onToggleHistory: () => void;
  readonly onNewVersion: () => void;
  readonly onEditFlags: () => void;
};

const BUTTON = "rounded-rx border border-rx-line px-3 py-1 text-sm";

/** One offer: its current version, its flags, and (with `packages:write`) the actions that change it. */
export function CatalogRow({ kind, offer, rupiahPrice, canWrite, isHistoryOpen, onToggleHistory, onNewVersion, onEditFlags }: CatalogRowProps) {
  const current = findCurrentVersion(offer);
  return (
    <>
      <tr className="border-t border-rx-line align-top">
        <td className="py-2 pr-3 font-medium">{offer.name}</td>
        <td className="py-2 pr-3">{current ? describePrice(kind, current) : "no version in force"}</td>
        <td className="py-2 pr-3">{rupiahPrice === undefined ? "–" : formatRupiah(rupiahPrice)}</td>
        <td className="py-2 pr-3">{current ? describeTerms(kind, current) : "–"}</td>
        <td className="py-2 pr-3">{offer.active ? "Active" : "Inactive"}{offer.visible === undefined ? "" : offer.visible ? " · visible" : " · hidden"}</td>
        <td className="py-2 pr-3">{current ? `v${current.versionNumber}` : "–"}</td>
        <td className="flex flex-wrap gap-2 py-2">
          <button type="button" onClick={onToggleHistory} aria-expanded={isHistoryOpen} className={BUTTON}>History</button>
          {canWrite && <button type="button" onClick={onNewVersion} className={BUTTON}>New version</button>}
          {canWrite && <button type="button" onClick={onEditFlags} className={BUTTON}>Flags</button>}
        </td>
      </tr>
      {isHistoryOpen && (
        <tr>
          <td colSpan={7} className="pb-3"><VersionHistory kind={kind} offer={offer} /></td>
        </tr>
      )}
    </>
  );
}
