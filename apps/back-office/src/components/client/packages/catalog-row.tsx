"use client";

import { CopyPlus, Flag, History } from "lucide-react";
import { describePrice, describeTerms } from "@/lib/packages/describe-terms";
import { findCurrentVersion } from "@/lib/packages/current-version";
import { formatRupiah } from "@/lib/packages/format-rupiah";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { OfferKind } from "@/lib/packages/offer-kind";
import { IconActionButton } from "../form/icon-action-button";
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

/** One offer: its current version, its flags, and (with `packages:write`) the actions that change it. */
export function CatalogRow({ kind, offer, rupiahPrice, canWrite, isHistoryOpen, onToggleHistory, onNewVersion, onEditFlags }: CatalogRowProps) {
  const current = findCurrentVersion(offer);
  return (
    <>
      <tr className="border-t border-rx-line align-top">
        <td className="px-3 py-2 font-medium">{offer.name}</td>
        <td className="px-3 py-2">{current ? describePrice(kind, current) : "no version in force"}</td>
        <td className="px-3 py-2">{rupiahPrice === undefined ? "–" : formatRupiah(rupiahPrice)}</td>
        <td className="px-3 py-2">{current ? describeTerms(kind, current) : "–"}</td>
        <td className="px-3 py-2">{offer.active ? "Active" : "Inactive"}{offer.visible === undefined ? "" : offer.visible ? " · visible" : " · hidden"}</td>
        <td className="px-3 py-2">{current ? `v${current.versionNumber}` : "–"}</td>
        <td className="px-3 py-2">
          <div className="flex gap-2">
            <IconActionButton title="History" icon={History} onClick={onToggleHistory} isExpanded={isHistoryOpen} />
            {canWrite && <IconActionButton title="New version" icon={CopyPlus} onClick={onNewVersion} />}
            {canWrite && <IconActionButton title="Flags" icon={Flag} onClick={onEditFlags} />}
          </div>
        </td>
      </tr>
      {isHistoryOpen && (
        <tr>
          <td colSpan={7} className="px-3 pb-3"><VersionHistory kind={kind} offer={offer} /></td>
        </tr>
      )}
    </>
  );
}
