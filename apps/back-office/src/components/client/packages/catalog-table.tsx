"use client";

import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { OfferKind } from "@/lib/packages/offer-kind";
import type { PriceList } from "@/lib/packages/price-list";
import { CatalogRow } from "./catalog-row";

type CatalogTableProps = {
  readonly kind: OfferKind;
  readonly offers: readonly CatalogOffer[];
  readonly priceList: PriceList | null;
  readonly canWrite: boolean;
  readonly historyOpenId: string | null;
  readonly onToggleHistory: (id: string) => void;
  readonly onNewVersion: (offer: CatalogOffer) => void;
  readonly onEditFlags: (offer: CatalogOffer) => void;
};

/** The offers of one kind with their current version; a wide table scrolls inside its box on a phone. */
export function CatalogTable({ kind, offers, priceList, canWrite, historyOpenId, onToggleHistory, onNewVersion, onEditFlags }: CatalogTableProps) {
  if (offers.length === 0) return <p className="mt-2 text-sm text-rx-muted">Nothing here yet.</p>;
  const prices = kind === "package" ? priceList?.packages : kind === "top-up-pack" ? priceList?.topUpPacks : undefined;
  return (
    <div className="relative mt-3 overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="bg-rx-surface text-rx-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Price (USD)</th>
            <th className="px-3 py-2 font-medium">Rupiah (derived)</th>
            <th className="px-3 py-2 font-medium">Terms</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Version</th>
            <th className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <CatalogRow key={offer.id} kind={kind} offer={offer} rupiahPrice={prices?.find((entry) => entry.name === offer.name)?.priceRupiah} canWrite={canWrite}
              isHistoryOpen={historyOpenId === offer.id} onToggleHistory={() => onToggleHistory(offer.id)} onNewVersion={() => onNewVersion(offer)} onEditFlags={() => onEditFlags(offer)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
