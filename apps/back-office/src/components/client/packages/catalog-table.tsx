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
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="text-rx-muted">
          <tr>
            <th className="pr-3 font-normal">Name</th>
            <th className="pr-3 font-normal">Price (USD)</th>
            <th className="pr-3 font-normal">Rupiah (derived)</th>
            <th className="pr-3 font-normal">Terms</th>
            <th className="pr-3 font-normal">Status</th>
            <th className="pr-3 font-normal">Version</th>
            <th className="font-normal"><span className="sr-only">Actions</span></th>
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
